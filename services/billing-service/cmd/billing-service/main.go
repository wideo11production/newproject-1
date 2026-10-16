package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/billing-service/src/config"
	"newproject/services/billing-service/src/database"
	"newproject/services/billing-service/src/entitlement"
	"newproject/services/billing-service/src/handler"
	"newproject/services/billing-service/src/middleware"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := database.NewPostgresDB(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}()

	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	planRepo := repository.NewSubscriptionPlanRepository(db)
	subRepo := repository.NewSubscriptionRepository(db)
	taxRepo := repository.NewTaxRateRepository(db)
	invoiceRepo := repository.NewInvoiceRepository(db)
	itemRepo := repository.NewInvoiceItemRepository(db)
	paymentRepo := repository.NewPaymentRepository(db)
	expenseRepo := repository.NewManualExpenseRepository(db)
	// The identity adapter: auth-service's UUID -> billing's uint.
	// `Subscribe` cannot resolve a caller without it.
	identityRepo := repository.NewUserIdentityRepository(db)
	pushAllocRepo := repository.NewPushAllocationRepository(db)
	contentRevRepo := repository.NewContentRevenueRepository(db)
	campaignRepo := repository.NewCampaignRepository(db)

	billingSvc := service.NewBillingService(db, planRepo, subRepo, taxRepo, invoiceRepo, itemRepo, paymentRepo, expenseRepo, identityRepo, pushAllocRepo, contentRevRepo, campaignRepo)

	// ---- THE PLAN CATALOGUE, SEEDED BEFORE ANY REQUEST IS ANSWERED ----
	//
	// Seven tiers are declared in `service.Tiers()` and `subscription_plans` had
	// ZERO ROWS. `GET /pricing` answered 500 and `POST /subscriptions/pending`
	// refused every checkout, because the registry describes plans that exist
	// only in Go memory and nothing had ever written them to the database.
	//
	// This is the "correct code with no writer" pattern this repository records
	// repeatedly, and the fix is the same every time: find the code that assumes
	// the row exists and write it. It runs before the server starts so the first
	// request finds the catalogue ready, rather than finding a 500 that is
	// actually a startup ordering problem.
	//
	// A failure here is FATAL and deliberately so. A service that boots with an
	// empty catalogue serves a pricing page that 500s and refuses every
	// checkout - which looks like a working product that rejects every customer,
	// rather than like a service that failed to start.
	seedCtx, seedCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := service.SeedPlans(seedCtx, planRepo); err != nil {
		seedCancel()
		log.Fatalf("plan catalogue seed failed: %v - refusing to serve an empty catalogue", err)
	}
	seedCancel()

	// ---- Payment-success auto-fire (P0.3) ----
	//
	// When a subscription is recorded, the subscriber must be
	// granted the plan they paid for, and entitlements live in
	// auth-service. The fire needs BOTH the internal URL and the
	// shared JWT secret, so it is fail-closed here: a service
	// that starts without them would silently skip every grant,
	// and "users paid but got nothing" is the worst possible
	// silent failure. Refusing to start is the loud version.
	//
	// `JWT_SECRET_KEY` is the same SSOT value the payout middleware
	// already reads (`os.Getenv` there too), and compose supplies
	// both variables with `:?`/static bindings - this check is the
	// in-process backstop, not the first line of defense.
	authInternalURL := strings.TrimSpace(os.Getenv("AUTH_INTERNAL_URL"))
	jwtSecret := os.Getenv("JWT_SECRET_KEY")
	if authInternalURL == "" || jwtSecret == "" {
		missing := []string{}
		if authInternalURL == "" {
			missing = append(missing, "AUTH_INTERNAL_URL")
		}
		if jwtSecret == "" {
			missing = append(missing, "JWT_SECRET_KEY")
		}
		log.Fatalf("refusing to start: entitlement auto-fire is unconfigured (%s). "+
			"Without it a recorded sale grants nothing, and that failure is silent.",
			strings.Join(missing, ", "))
	}
	billingSvc.SetEntitlementFirer(entitlement.NewClient(authInternalURL, []byte(jwtSecret)))

	// ---- Stripe Checkout API wiring ----
	//
	// `CreateCheckoutSession` calls the real Stripe Checkout Sessions API
	// to create a `cs_...` id that the webhook will echo back. If
	// `STRIPE_SECRET_KEY` is unset, the service falls back to a placeholder
	// generator so the rest of the chain still works in dev/test.
	stripeKey := strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY"))
	if stripeKey != "" {
		billingSvc.SetStripeClient(service.NewStripeClient(stripeKey))
		log.Printf("[billing] Stripe Checkout Sessions API wired with key prefix %s", stripeKey[:8])
	}

	h := handler.NewHandler(billingSvc)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// ---- Order matters, and this is why ----
	//
	// `RegisterRoutes` decides WHICH routes are public. `middleware.AuthRequired`
	// is applied INSIDE it, per group. Nothing global is added here, because a
	// global auth middleware would also guard `/health` - and a health endpoint
	// that requires a credential makes Docker kill a healthy container, which is
	// the exact bug recorded for the frontend apps in `updatedtodo.md` Session 19.
	//
	// The previous arrangement registered every billing route on the bare engine
	// and applied auth to ONE group (the payouts). `POST /subscriptions`,
	// `POST /plans`, `POST /invoices`, `POST /invoices/payments` and
	// `PUT /payments/:id/refund` were reachable with no credential, taking
	// `user_id` from the request body.
	h.RegisterRoutes(r)

	// Health check route: Kubernetes/Docker healthcheck is endpoint par depend karta hai.
	// Pehle ye route register nahi thi, isliye /health par 404 aata tha aur container
	// unhealthy mark ho jata tha. Ab service ready hone par 200 return karta hai.
	// Hinglish: health route add kiya taaki container healthcheck pass ho sake
	// ---- Payout identity routes (dedup protection) ----
	//
	// Ye endpoints UPI/bank/wire add karne dete hain. Core protection:
	// ek payout identity sirf EK account se link ho sakti hai (unique index).
	//
	// SECURITY: SAARE payout routes ab JWT protected hain. User ID URL se nahi,
	// TOKEN se aati hai - isliye koi unauthenticated user dusre account ki
	// payout dekh ya modify nahi kar sakta.
	// KYC engine: automated bank validation (pluggable provider).
	// KYC_PROVIDER env se select hota hai. Default "local" = deterministic
	// validation, ZERO cost, offline (bank API ki zarurat nahi).
	// NOTE: "local" provider format/structure verify karta hai (IFSC checksum,
	// VPA shape, account digits) - ye REAL typo detection hai. Lekin bank se
	// account-EXISTENCE confirm nahi karta (uske liye paid provider chahiye).
	kycEngine := service.NewKycEngine(db, os.Getenv("KYC_PROVIDER"))
	log.Printf("[KYC] Automated bank validation engine active (provider=%s)", kycEngine.ProviderName())

	payoutSvc := service.NewPayoutIdentityService(db, kycEngine)
	payoutHandler := handler.NewPayoutHandler(payoutSvc, db)

	// Public: payout types (UI ke liye, koi sensitive data nahi)
	r.GET("/payout/types", payoutHandler.Types)

	// Protected: sab payout operations
	payoutProtected := r.Group("/")
	payoutProtected.Use(middleware.AuthRequired())
	{
		payoutProtected.POST("/payouts", payoutHandler.AddPayout)
		payoutProtected.GET("/payouts", payoutHandler.ListPayouts)
		payoutProtected.DELETE("/payouts/:payoutId", payoutHandler.DeletePayout)
		// Verify payout = admin action

		// ---- Earnings status ----
		//
		// Reads the gate in `service.EarningsSubject.MayEarn` and reports it with
		// its reason. It is on the protected group because the answer is about the
		// caller's own account and carries nothing anyone else should read.
		//
		// This is what makes the gate VISIBLE. The rule can stop an accrual
		// correctly and the creator still has no way to learn why their earnings
		// are zero - and "why is my earning zero" has four different answers that
		// need four different actions from them.
		payoutProtected.GET("/me/earnings-status", payoutHandler.EarningsStatus)

		// Device ad revenue - superadmin ledger ke liye (cross-DB data source)
		payoutProtected.GET("/admin/device-revenue", payoutHandler.GetDeviceRevenues)
	}

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "billing-service",
			"port":    cfg.Server.Port,
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	go func() {
		log.Printf("starting billing service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("server exiting")
}

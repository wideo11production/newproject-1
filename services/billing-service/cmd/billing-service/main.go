package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/billing-service/src/config"
	"newproject/services/billing-service/src/database"
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

	billingSvc := service.NewBillingService(planRepo, subRepo, taxRepo, invoiceRepo, itemRepo, paymentRepo, expenseRepo)

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

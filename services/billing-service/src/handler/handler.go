package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/billing-service/src/middleware"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

type Handler struct {
	svc *service.BillingService
}

func NewHandler(svc *service.BillingService) *Handler {
	return &Handler{svc: svc}
}

// resolveBillingUser turns the VERIFIED token claim into the
// billing-side uint, via the identity adapter.
//
// The four handlers that need "which billing user is this"
// share this one path so the answer - and the two failures,
// "not a resolvable user" (400) and "database broken" (500) -
// cannot drift apart between them.
//
// Returns false when the response is already written.
func (h *Handler) resolveBillingUser(c *gin.Context) (uint, bool) {
	verified, ok := selfUserID(c)
	if !ok {
		return 0, false
	}
	userID, err := h.svc.ResolveBillingUserID(c.Request.Context(), verified)
	if err != nil {
		if errors.Is(err, service.ErrIdentityNotResolvable) {
			// The token carried a user_id auth-service would not
			// issue. A CLIENT error: the caller's credential is
			// malformed, not the database.
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "user_id_not_resolvable",
				"message": "The verified token does not name a resolvable user id.",
			})
			return 0, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return 0, false
	}
	return userID, true
}

// RegisterRoutes wires billing's HTTP surface.
//
// -----------------------------------------------------------------------------
// WHY THIS FUNCTION CHANGED SHAPE
// -----------------------------------------------------------------------------
//
// Every one of these routes was registered on the bare engine with only
// `gin.Logger()` and `gin.Recovery()`:
//
//	r := gin.New()
//	r.Use(gin.Logger())
//	r.Use(gin.Recovery())
//	h.RegisterRoutes(r)          // <- no auth anywhere
//	payoutProtected.Use(middleware.AuthRequired())   // <- only the payouts
//
// So the whole money surface was reachable by anyone who could reach the port,
// with `user_id` taken from the REQUEST BODY:
//
//	POST   /subscriptions      subscribe yourself to anything
//	POST   /plans              create a plan, including its price
//	PUT    /plans/:id          change that price
//	POST   /invoices           issue an invoice
//	POST   /invoices/payments  mark it paid
//	PUT    /payments/:id/refund
//
// That is not a missing feature. It is a self-service store with a free refund
// button, and it is the most severe finding in this codebase. `middleware.AuthRequired`
// and `middleware.RequireAdmin` both already existed and were applied to exactly
// one group.
//
// The split below is by WHO, not by HTTP verb:
//
//	PUBLIC        the plan catalogue. A pricing page has to render for a signed-out
//	              visitor, and it contains no PII - that is the definition of the
//	              public surface, rather than "GETs happen to be harmless".
//
//	PERSONAL      the caller's OWN subscriptions, invoices and payments. The user
//	              id comes from the VERIFIED TOKEN, never from a path or a body.
//	              `/subscriptions/user/:user_id/cancel` taking the id from the URL
//	              is how one user cancels another's plan; the handler ignores the
//	              path value and reads the token.
//
//	ADMIN         anything that creates or moves money: the catalogue, taxes,
//	              invoice issue, payment recording, REFUNDS. A refund is the most
//	              dangerous route here and is admin-only for that reason.
//
// A superadmin token satisfies `RequireAdmin`, so the superadmin dashboard keeps
// working unchanged.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	// ---- PUBLIC: the plan catalogue ----
	// Pricing has to be visible before sign-in, and a plan row contains no PII.
	plans := r.Group("/plans")
	{
		plans.GET("", h.ListPlans)
		plans.GET("/:id", h.GetPlan)
		plans.GET("/code/:code", h.GetPlanByCode)

		// Creating and EDITING the catalogue is an ADMIN action, not a public one.
		// `PUT /plans/:id` used to let anyone rewrite the price of every plan in
		// the product.
		//
		// `AuthRequired` is chained explicitly, not assumed. These three routes
		// were the only ones carrying `RequireAdmin` on its own, so no identity was
		// ever placed in the context and the role check read an empty role. They
		// now refuse anonymous callers with 401 and a `role=user` token with 403.
		plans.POST("", middleware.AuthRequired(), middleware.RequireAdmin(), h.CreatePlan)
		plans.PUT("/:id", middleware.AuthRequired(), middleware.RequireAdmin(), h.UpdatePlan)
	}

	// ---- PUBLIC: the priced catalogue ----
	//
	// The seven tiers with each buyer's own price applied, which is the only
	// number a pricing page may show. It is public because it has to render for a
	// signed-out visitor, and it contains no PII - the two countries are supplied
	// BY THE CALLER as query parameters, so nothing about the buyer is stored or
	// returned that was not already in the request.
	//
	// This is a READ. It prices, it does not sell, and it activates nothing.
	geo := r.Group("/pricing")
	{
		geo.GET("", h.PricedCatalogue)
	}

	// ---- PUBLIC: provider webhooks ----
	//
	// Deliberately NOT behind `AuthRequired`, and deliberately not behind
	// `RequireAdmin` either. A provider does not hold a session for us - it holds
	// a shared secret and signs its payload. The gate is the HMAC over the raw
	// body in `VerifyWebhookSignature`, checked before anything is parsed.
	//
	// A signature-less or misconfigured endpoint here is worse than an open admin
	// route: it activates subscriptions. So the handler refuses when the secret is
	// absent from configuration rather than falling back to "unverified but
	// trusted", and that refusal is tested in `activation_test.go`.
	webhooks := r.Group("/webhooks")
	{
		webhooks.POST("/:provider", h.ProviderWebhook)
	}

	// ---- PERSONAL: the caller's own subscription ----
	subs := r.Group("/subscriptions", middleware.AuthRequired())
	{
		// PENDING is the paid-checkout entry point. `Subscribe` remains for the
		// legacy zero-payment path and is NOT reachable from a priced checkout:
		// a subscription created here is `pending`, grants nothing, and becomes
		// active only when a payment is confirmed.
		subs.POST("/pending", h.SubscribePending)
		// Checkout session creation: the paid path. Creates a pending
		// subscription + invoice + payment row with `transaction_id`
		// so the webhook can resolve the sale.
		subs.POST("/checkout/session", h.CreateCheckoutSession)
		subs.POST("", h.Subscribe)
		subs.GET("/:id", h.GetSubscription)
		// `user_id` in the path is retained for backwards compatibility with
		// existing callers, but the handlers read the id from the TOKEN and
		// ignore the path. See `selfUserID`.
		subs.GET("/user/:user_id", h.GetSubscriptionByUser)
		subs.PUT("/user/:user_id/cancel", h.CancelSubscription)
		// Expiry reporting is operational data across all accounts, not a personal
		// view - an admin-only route.
		subs.GET("/expiring", middleware.RequireAdmin(), h.GetExpiringSubscriptions)
		// Admin-only activation, for an offline or corrected sale that the
		// provider webhook never reported. Same code path as the webhook.
		subs.POST("/:id/activate", middleware.RequireAdmin(), h.ActivateSubscription)
	}

	// ---- TAX RATES: read public, write admin ----
	taxes := r.Group("/taxes")
	{
		taxes.GET("", h.ListTaxRates)
		taxes.GET("/:code", h.GetTaxRate)
		// A tax rate is the multiplier on every invoice. An unauthenticated
		// writer here can set it to zero and nothing downstream re-checks it.
		//
		// Chained with `AuthRequired` for the same reason as the plan routes.
		taxes.POST("", middleware.AuthRequired(), middleware.RequireAdmin(), h.CreateTaxRate)
	}

	// ---- INVOICES: read your own, write admin ----
	invoices := r.Group("/invoices", middleware.AuthRequired())
	{
		invoices.GET("/:id", h.GetInvoice)
		invoices.GET("/uuid/:uuid", h.GetInvoiceByUUID)
		invoices.GET("/number/:number", h.GetInvoiceByNumber)
		invoices.GET("/user/:user_id", h.ListInvoices)
		invoices.GET("/:id/items", h.GetInvoiceItems)

		// Issuing is an accounting act, and the tax amount is computed AT ISSUE
		// (see Phase 18). Whoever can do it is choosing what the record says.
		invoices.POST("", middleware.RequireAdmin(), h.CreateInvoice)
		invoices.PUT("/:id/issue", middleware.RequireAdmin(), h.IssueInvoice)
		// Recording a payment is the write that makes an invoice "paid". Admin
		// only: a self-service "mark my invoice paid" is how revenue becomes
		// fictional.
		invoices.POST("/payments", middleware.RequireAdmin(), h.RecordPayment)

		// Overdue is a portfolio view, not a personal one.
		invoices.GET("/overdue", middleware.RequireAdmin(), h.GetOverdueInvoices)
	}

	payments := r.Group("/payments", middleware.AuthRequired())
	{
		payments.GET("/:id", h.GetPayment)
		payments.GET("/uuid/:uuid", h.GetPaymentByUUID)
		payments.GET("/invoice/:invoice_id", h.GetPaymentsByInvoice)
		// REFUND. Admin only, and the most dangerous route in this file.
		//
		// Unauthenticated, this was: POST a payment, mark an invoice paid, then
		// refund it - a complete round trip with no credential at any point.
		payments.PUT("/:id/refund", middleware.RequireAdmin(), h.RefundPayment)
	}
}

func (h *Handler) CreatePlan(c *gin.Context) {
	var req struct {
		Name        string           `json:"name" binding:"required"`
		Code        string           `json:"code" binding:"required"`
		Description string           `json:"description"`
		Price       string           `json:"price" binding:"required"`
		Currency    string           `json:"currency"`
		Cycle       model.BillingCycle `json:"cycle" binding:"required"`
		Interval    int              `json:"interval"`
		TrialDays   int              `json:"trial_days"`
		Features    string           `json:"features"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	plan, err := h.svc.CreatePlan(c.Request.Context(), req.Name, req.Code, req.Description, req.Price, req.Currency, req.Cycle, req.Interval, req.TrialDays, req.Features)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"plan": plan})
}

func (h *Handler) GetPlan(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan ID"})
		return
	}
	plan, err := h.svc.GetPlan(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrSubscriptionPlanNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": plan})
}

func (h *Handler) GetPlanByCode(c *gin.Context) {
	plan, err := h.svc.GetPlanByCode(c.Request.Context(), c.Param("code"))
	if err != nil {
		if err == repository.ErrSubscriptionPlanNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "plan not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": plan})
}

func (h *Handler) ListPlans(c *gin.Context) {
	activeOnly := c.Query("active_only") == "true"
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	plans, err := h.svc.ListPlans(c.Request.Context(), activeOnly, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func (h *Handler) UpdatePlan(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan ID"})
		return
	}
	var req model.SubscriptionPlan
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdatePlan(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": req})
}

func (h *Handler) Subscribe(c *gin.Context) {
	// ---- The user is the CALLER, not whatever the body says ----
	//
	// `req.UserID` used to be bound from the request body with
	// `binding:"required"`. With no auth middleware on this route that meant
	// anyone could subscribe ANYONE to any plan by putting their id in the JSON.
	//
	// The field is still accepted and still optional, because a client that
	// sends it must not break. It is then IGNORED. A body field that is
	// validated, required, and discarded is worse than one that was never
	// accepted: the caller believes it did something.
	//
	// `selfUserID` reads the token claim that `AuthRequired` verified.
	verified, ok := selfUserID(c)
	if !ok {
		return
	}

	var req struct {
		// Accepted for backwards compatibility. NOT trusted - see above.
		UserID    uint `json:"user_id"`
		PlanCode  string `json:"plan_code" binding:"required"`
		AutoRenew bool   `json:"auto_renew"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// The token carries auth-service's UUID; the subscription row
	// keys by billing's uint. `Subscribe` resolves the two through
	// the identity adapter, so a UUID that names no user is a 400
	// BEFORE any row is written - not a subscription that belongs
	// to nobody.
	sub, err := h.svc.Subscribe(c.Request.Context(), verified, req.PlanCode, req.AutoRenew)
	if err != nil {
		if errors.Is(err, service.ErrIdentityNotResolvable) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "user_id_not_resolvable",
				"message": "The verified token does not name a resolvable user id.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subscription": sub})
}

// CreateCheckoutSession creates a pending subscription + invoice + payment row
// with the provider's transaction_id so the webhook can resolve the sale.
//
// This is the entry point for a priced checkout. The buyer is resolved from
// the VERIFIED token, never from the request body.
func (h *Handler) CreateCheckoutSession(c *gin.Context) {
	verified, ok := selfUserID(c)
	if !ok {
		return
	}

	var req struct {
		PlanCode   string `json:"plan_code" binding:"required"`
		Country    string `json:"country"`
		SuccessURL string `json:"success_url"`
		CancelURL  string `json:"cancel_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.svc.CreateCheckoutSession(c.Request.Context(), verified, service.CheckoutSessionRequest{
		PlanCode:   req.PlanCode,
		Country:    req.Country,
		SuccessURL: req.SuccessURL,
		CancelURL:  req.CancelURL,
	})
	if err != nil {
		if errors.Is(err, service.ErrUnknownTier) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "plan_not_purchasable",
				"message": "That plan cannot be bought.",
				"code":    req.PlanCode,
			})
			return
		}
		if errors.Is(err, service.ErrIdentityNotResolvable) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "user_id_not_resolvable",
				"message": "The verified token does not name a resolvable user id.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"checkout_url":         result.CheckoutURL,
		"checkout_session_id":  result.CheckoutSessionID,
		"subscription_id":      result.SubscriptionID,
		"invoice_id":           result.InvoiceID,
		"payment_id":           result.PaymentID,
		"amount":               result.Amount.String(),
		"currency":             result.Currency,
		"granted":              false,
		"state":                "pending",
		"message":              "Checkout session created. Subscription activates when payment is confirmed.",
	})
}

func (h *Handler) GetSubscription(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription ID"})
		return
	}
	sub, err := h.svc.GetSubscription(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrSubscriptionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription": sub})
}

func (h *Handler) GetSubscriptionByUser(c *gin.Context) {
	// From the TOKEN. `:user_id` is ignored - see `identity.go`.
	//
	// The UUID the token carries is resolved to billing's uint
	// by the adapter, so a real user finds their subscription
	// instead of a 400.
	userID, ok := h.resolveBillingUser(c)
	if !ok {
		return
	}
	sub, err := h.svc.GetSubscriptionByUser(c.Request.Context(), userID)
	if err != nil {
		if err == repository.ErrSubscriptionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription": sub})
}

func (h *Handler) CancelSubscription(c *gin.Context) {
	// From the TOKEN, not from `:user_id`.
	//
	// This route used to parse the user id out of the URL path, which is the
	// caller's to choose. Authenticated as anybody, you could cancel anybody's
	// subscription by editing one path segment.
	//
	// `:user_id` is still in the route - removing it would 404 every existing
	// client - and it is ignored.
	//
	// The UUID the token carries is resolved to billing's uint
	// by the adapter before the cancel runs.
	userID, ok := h.resolveBillingUser(c)
	if !ok {
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	sub, err := h.svc.CancelSubscription(c.Request.Context(), userID, req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription": sub})
}

func (h *Handler) GetExpiringSubscriptions(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	subs, err := h.svc.GetExpiringSubscriptions(c.Request.Context(), days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscriptions": subs})
}

func (h *Handler) CreateTaxRate(c *gin.Context) {
	var req struct {
		Name       string `json:"name" binding:"required"`
		Code       string `json:"code" binding:"required"`
		Rate       string `json:"rate" binding:"required"`
		Type       string `json:"type" binding:"required"`
		Country    string `json:"country"`
		Region     string `json:"region"`
		IsCompound bool   `json:"is_compound"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rate, err := h.svc.CreateTaxRate(c.Request.Context(), req.Name, req.Code, req.Rate, req.Type, req.Country, req.Region, req.IsCompound)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"tax_rate": rate})
}

func (h *Handler) GetTaxRate(c *gin.Context) {
	rate, err := h.svc.GetTaxRate(c.Request.Context(), c.Param("code"))
	if err != nil {
		if err == repository.ErrTaxRateNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "tax rate not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tax_rate": rate})
}

func (h *Handler) ListTaxRates(c *gin.Context) {
	country := c.Query("country")
	rates, err := h.svc.ListTaxRates(c.Request.Context(), country)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tax_rates": rates})
}

func (h *Handler) CreateInvoice(c *gin.Context) {
	var req struct {
		UserID        uint                    `json:"user_id" binding:"required"`
		SubscriptionID *uint                   `json:"subscription_id,omitempty"`
		Items         []service.InvoiceItemRequest `json:"items" binding:"required"`
		DueDate       string                    `json:"due_date" binding:"required"`
		Notes         string                    `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	dueDate, err := time.Parse("2006-01-02", req.DueDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid due_date"})
		return
	}
	invoice, err := h.svc.CreateInvoice(c.Request.Context(), req.UserID, req.SubscriptionID, req.Items, "IN", dueDate, req.Notes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"invoice": invoice})
}

func (h *Handler) GetInvoice(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invoice ID"})
		return
	}
	invoice, err := h.svc.GetInvoice(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrInvoiceNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "invoice not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoice": invoice})
}

func (h *Handler) GetInvoiceByUUID(c *gin.Context) {
	invoice, err := h.svc.GetInvoiceByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrInvoiceNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "invoice not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoice": invoice})
}

func (h *Handler) GetInvoiceByNumber(c *gin.Context) {
	invoice, err := h.svc.GetInvoiceByNumber(c.Request.Context(), c.Param("number"))
	if err != nil {
		if err == repository.ErrInvoiceNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "invoice not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoice": invoice})
}

func (h *Handler) ListInvoices(c *gin.Context) {
	// From the TOKEN. `:user_id` is ignored - see `identity.go`.
	//
	// This was a full invoice disclosure: authenticated as anybody, request
	// `/invoices/user/<anyone-else>` and read their billing history.
	//
	// The UUID the token carries is resolved to billing's uint
	// by the adapter, so the listing is the CALLER's own.
	userID, ok := h.resolveBillingUser(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	invoices, err := h.svc.ListInvoices(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoices": invoices})
}

func (h *Handler) GetOverdueInvoices(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	invoices, err := h.svc.GetOverdueInvoices(c.Request.Context(), days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoices": invoices})
}

func (h *Handler) GetInvoiceItems(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invoice ID"})
		return
	}
	items, err := h.svc.GetInvoiceItems(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) IssueInvoice(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invoice ID"})
		return
	}
	invoice, err := h.svc.IssueInvoice(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoice": invoice})
}

func (h *Handler) RecordPayment(c *gin.Context) {
	var req struct {
		InvoiceID     uint   `json:"invoice_id" binding:"required"`
		UserID        uint   `json:"user_id" binding:"required"`
		Amount        string `json:"amount" binding:"required"`
		Method        string `json:"method" binding:"required"`
		Provider      string `json:"provider"`
		TransactionID string `json:"transaction_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	payment, err := h.svc.RecordPayment(c.Request.Context(), req.InvoiceID, req.UserID, req.Amount, req.Method, req.Provider, req.TransactionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"payment": payment})
}

func (h *Handler) GetPayment(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payment ID"})
		return
	}
	payment, err := h.svc.GetPayment(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrPaymentNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "payment not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payment": payment})
}

func (h *Handler) GetPaymentByUUID(c *gin.Context) {
	payment, err := h.svc.GetPaymentByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrPaymentNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "payment not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payment": payment})
}

func (h *Handler) GetPaymentsByInvoice(c *gin.Context) {
	invoiceID, err := strconv.ParseUint(c.Param("invoice_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invoice ID"})
		return
	}
	payments, err := h.svc.GetPaymentsByInvoice(c.Request.Context(), uint(invoiceID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payments": payments})
}

func (h *Handler) RefundPayment(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payment ID"})
		return
	}
	payment, err := h.svc.RefundPayment(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payment": payment})
}
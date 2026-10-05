package handler

import (
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

	// ---- PERSONAL: the caller's own subscription ----
	subs := r.Group("/subscriptions", middleware.AuthRequired())
	{
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

	// The billing model stores `UserID uint`. The token carries a UUID, so the
	// cast can fail for a real user.
	//
	// It is left failing LOUDLY rather than defaulting to 0. A silent 0 matches
	// no rows, so the user is told "you have no subscriptions" instead of an
	// error - and that reads as "billing is broken for me", which is worse than a
	// 400 they can report. See `identity.go` for why the mismatch is not fixed
	// here.
	parsed, err := strconv.ParseUint(verified, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "user_id_not_resolvable",
			"message": "This service's user id space does not match the auth service's. See identity.go.",
		})
		return
	}

	sub, err := h.svc.Subscribe(c.Request.Context(), uint(parsed), req.PlanCode, req.AutoRenew)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subscription": sub})
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
	verified, ok := selfUserID(c)
	if !ok {
		return
	}
	userID, err := strconv.ParseUint(verified, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	sub, err := h.svc.GetSubscriptionByUser(c.Request.Context(), uint(userID))
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
	verified, ok := selfUserID(c)
	if !ok {
		return
	}
	userID, err := strconv.ParseUint(verified, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	sub, err := h.svc.CancelSubscription(c.Request.Context(), uint(userID), req.Reason)
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
	verified, ok := selfUserID(c)
	if !ok {
		return
	}
	userID, err := strconv.ParseUint(verified, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	invoices, err := h.svc.ListInvoices(c.Request.Context(), uint(userID), limit, offset)
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
		InvoiceID uint   `json:"invoice_id" binding:"required"`
		UserID    uint   `json:"user_id" binding:"required"`
		Amount    string `json:"amount" binding:"required"`
		Method    string `json:"method" binding:"required"`
		Provider  string `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	payment, err := h.svc.RecordPayment(c.Request.Context(), req.InvoiceID, req.UserID, req.Amount, req.Method, req.Provider)
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
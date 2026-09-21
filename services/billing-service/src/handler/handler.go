package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
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

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	plans := r.Group("/plans")
	{
		plans.POST("", h.CreatePlan)
		plans.GET("", h.ListPlans)
		plans.GET("/:id", h.GetPlan)
		plans.GET("/code/:code", h.GetPlanByCode)
		plans.PUT("/:id", h.UpdatePlan)
	}

	subs := r.Group("/subscriptions")
	{
		subs.POST("", h.Subscribe)
		subs.GET("/:id", h.GetSubscription)
		subs.GET("/user/:user_id", h.GetSubscriptionByUser)
		subs.PUT("/user/:user_id/cancel", h.CancelSubscription)
		subs.GET("/expiring", h.GetExpiringSubscriptions)
	}

	taxes := r.Group("/taxes")
	{
		taxes.POST("", h.CreateTaxRate)
		taxes.GET("", h.ListTaxRates)
		taxes.GET("/:code", h.GetTaxRate)
	}

	invoices := r.Group("/invoices")
	{
		invoices.POST("", h.CreateInvoice)
		invoices.GET("/:id", h.GetInvoice)
		invoices.GET("/uuid/:uuid", h.GetInvoiceByUUID)
		invoices.GET("/number/:number", h.GetInvoiceByNumber)
		invoices.GET("/user/:user_id", h.ListInvoices)
		invoices.GET("/overdue", h.GetOverdueInvoices)
		invoices.GET("/:id/items", h.GetInvoiceItems)
		invoices.PUT("/:id/issue", h.IssueInvoice)
		invoices.POST("/payments", h.RecordPayment)
	}

	payments := r.Group("/payments")
	{
		payments.GET("/:id", h.GetPayment)
		payments.GET("/uuid/:uuid", h.GetPaymentByUUID)
		payments.GET("/invoice/:invoice_id", h.GetPaymentsByInvoice)
		payments.PUT("/:id/refund", h.RefundPayment)
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
	var req struct {
		UserID     uint             `json:"user_id" binding:"required"`
		PlanCode   string           `json:"plan_code" binding:"required"`
		AutoRenew  bool             `json:"auto_renew"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.Subscribe(c.Request.Context(), req.UserID, req.PlanCode, req.AutoRenew)
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
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
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
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
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
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
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
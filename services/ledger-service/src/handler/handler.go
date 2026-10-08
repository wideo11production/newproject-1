package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"newproject/services/ledger-service/src/model"
	"newproject/services/ledger-service/src/repository"
	"newproject/services/ledger-service/src/service"
)

type Handler struct {
	svc               *service.LedgerService
	sisterProfileSvc  *service.SisterProfileService
}

func NewHandler(svc *service.LedgerService, sisterProfileSvc *service.SisterProfileService) *Handler {
	return &Handler{svc: svc, sisterProfileSvc: sisterProfileSvc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	events := r.Group("/audit-events")
	{
		events.POST("", h.RecordEvent)
		events.GET("/:id", h.GetEvent)
		events.GET("/uuid/:uuid", h.GetEventByUUID)
		events.GET("/type/:type", h.ListEventsByType)
		events.GET("/source/:source", h.ListEventsBySource)
		events.GET("/range/:start/:end", h.ListEventsByTimeRange)
		events.GET("/verify", h.VerifyChain)
	}

	recons := r.Group("/reconciliations")
	{
		recons.POST("", h.StartReconciliation)
		recons.GET("/:id", h.GetReconciliation)
		recons.GET("/uuid/:uuid", h.GetReconciliationByUUID)
		recons.GET("", h.ListReconciliations)
		recons.POST("/:id/items", h.AddReconciliationItem)
		recons.GET("/:id/items", h.GetReconciliationItems)
		recons.GET("/:id/mismatches", h.GetMismatchedItems)
		recons.PUT("/:id/complete", h.CompleteReconciliation)
		recons.PUT("/:id/resolve", h.ResolveReconciliation)
	}

	sister := r.Group("/sister-profile")
	{
		sister.POST("", h.CreateOrGetSisterProfile)
		sister.GET("/:wallet_user_id", h.GetSisterProfile)
		sister.GET("/:wallet_user_id/balance", h.GetSisterBalance)
		sister.POST("/:wallet_user_id/withdraw", h.WithdrawSisterFunds)
	}
}

func (h *Handler) RecordEvent(c *gin.Context) {
	var req struct {
		EventType  model.AuditEventType `json:"event_type" binding:"required"`
		Source     string               `json:"source" binding:"required"`
		ActorID    *uint                `json:"actor_id,omitempty"`
		ActorType  string               `json:"actor_type,omitempty"`
		ResourceID string               `json:"resource_id" binding:"required"`
		Resource   string               `json:"resource" binding:"required"`
		Data       string               `json:"data"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	event, err := h.svc.RecordEvent(c.Request.Context(), req.EventType, req.Source, req.ActorID, req.ActorType, req.ResourceID, req.Resource, req.Data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event": event})
}

func (h *Handler) GetEvent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event ID"})
		return
	}
	event, err := h.svc.GetEvent(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrAuditEventNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"event": event})
}

func (h *Handler) GetEventByUUID(c *gin.Context) {
	event, err := h.svc.GetEventByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrAuditEventNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"event": event})
}

func (h *Handler) ListEventsByType(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	events, err := h.svc.ListEventsByType(c.Request.Context(), model.AuditEventType(c.Param("type")), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *Handler) ListEventsBySource(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	events, err := h.svc.ListEventsBySource(c.Request.Context(), c.Param("source"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *Handler) ListEventsByTimeRange(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	events, err := h.svc.ListEventsByTimeRange(c.Request.Context(), c.Param("start"), c.Param("end"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *Handler) VerifyChain(c *gin.Context) {
	valid, err := h.svc.VerifyChain(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"valid": valid})
}

func (h *Handler) StartReconciliation(c *gin.Context) {
	var req struct {
		Source      string `json:"source" binding:"required"`
		Target      string `json:"target" binding:"required"`
		Reference   string `json:"reference"`
		StartTime   string `json:"start_time" binding:"required"`
		EndTime     string `json:"end_time" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	start, err := parseTime(req.StartTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_time"})
		return
	}
	end, err := parseTime(req.EndTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_time"})
		return
	}
	recon, err := h.svc.StartReconciliation(c.Request.Context(), req.Source, req.Target, req.Reference, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"reconciliation": recon})
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05Z", s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
	}
	return t, err
}

func (h *Handler) GetReconciliation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	recon, err := h.svc.GetReconciliation(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrReconciliationNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "reconciliation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": recon})
}

func (h *Handler) GetReconciliationByUUID(c *gin.Context) {
	recon, err := h.svc.GetReconciliationByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrReconciliationNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "reconciliation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": recon})
}

func (h *Handler) ListReconciliations(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	source := c.Query("source")
	recs, err := h.svc.ListReconciliations(c.Request.Context(), source, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliations": recs})
}

func (h *Handler) AddReconciliationItem(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	var req struct {
		SourceID      string `json:"source_id" binding:"required"`
		SourceAmount  string `json:"source_amount" binding:"required"`
		TargetID      string `json:"target_id" binding:"required"`
		TargetAmount  string `json:"target_amount" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AddReconciliationItem(c.Request.Context(), uint(id), req.SourceID, req.SourceAmount, req.TargetID, req.TargetAmount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "item added"})
}

func (h *Handler) GetReconciliationItems(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	items, err := h.svc.GetReconciliationItems(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) GetMismatchedItems(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	items, err := h.svc.GetMismatchedItems(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CompleteReconciliation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	recon, err := h.svc.CompleteReconciliation(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": recon})
}

func (h *Handler) ResolveReconciliation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation ID"})
		return
	}
	var req struct {
		ResolvedBy uint   `json:"resolved_by" binding:"required"`
		Notes      string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	recon, err := h.svc.ResolveReconciliation(c.Request.Context(), uint(id), req.ResolvedBy, req.Notes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": recon})
}

// ============================================================================
// Sister Profile handlers
// ============================================================================

func (h *Handler) CreateOrGetSisterProfile(c *gin.Context) {
	var req struct {
		WalletUserID uint   `json:"wallet_user_id" binding:"required"`
		Name         string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile, err := h.sisterProfileSvc.CreateOrGetSisterProfile(c.Request.Context(), req.WalletUserID, req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"profile": profile})
}

func (h *Handler) GetSisterProfile(c *gin.Context) {
	walletUserID, err := strconv.ParseUint(c.Param("wallet_user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet_user_id"})
		return
	}

	profile, err := h.sisterProfileSvc.GetSisterProfile(c.Request.Context(), uint(walletUserID))
	if err != nil {
		if err == repository.ErrSisterProfileNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "sister profile not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) GetSisterBalance(c *gin.Context) {
	walletUserID, err := strconv.ParseUint(c.Param("wallet_user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet_user_id"})
		return
	}

	balance, err := h.sisterProfileSvc.GetSisterProfileBalance(c.Request.Context(), uint(walletUserID))
	if err != nil {
		if err == repository.ErrSisterProfileNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "sister profile not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"balance": balance.String()})
}

func (h *Handler) WithdrawSisterFunds(c *gin.Context) {
	walletUserID, err := strconv.ParseUint(c.Param("wallet_user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet_user_id"})
		return
	}

	var req struct {
		Amount string `json:"amount" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	amount, err := decimal.NewFromString(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid amount"})
		return
	}

	if err := h.sisterProfileSvc.WithdrawSisterFunds(c.Request.Context(), uint(walletUserID), amount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "withdrawal successful"})
}

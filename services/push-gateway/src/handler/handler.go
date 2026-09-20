package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/push-gateway/src/repository"
	"newproject/services/push-gateway/src/service"
)

type Handler struct {
	svc *service.PushGatewayService
}

func NewHandler(svc *service.PushGatewayService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	templates := r.Group("/templates")
	{
		templates.POST("", h.CreateTemplate)
		templates.GET("", h.ListTemplates)
		templates.GET("/:id", h.GetTemplate)
		templates.GET("/uuid/:uuid", h.GetTemplateByUUID)
		templates.GET("/category/:category", h.GetTemplatesByCategory)
		templates.PUT("/:id", h.UpdateTemplate)
		templates.DELETE("/:id", h.DeleteTemplate)
		templates.POST("/:id/render", h.RenderTemplate)
	}

	campaigns := r.Group("/campaigns")
	{
		campaigns.POST("", h.CreateCampaign)
		campaigns.GET("", h.ListCampaigns)
		campaigns.GET("/:id", h.GetCampaign)
		campaigns.GET("/uuid/:uuid", h.GetCampaignByUUID)
		campaigns.PUT("/:id", h.UpdateCampaign)
		campaigns.DELETE("/:id", h.DeleteCampaign)
		campaigns.POST("/:id/schedule", h.ScheduleCampaign)
		campaigns.POST("/:id/launch", h.LaunchCampaign)
		campaigns.GET("/pending", h.GetPendingCampaigns)
		campaigns.GET("/:id/analytics", h.GetCampaignAnalytics)
	}

	analytics := r.Group("/analytics")
	{
		analytics.POST("/event", h.RecordEvent)
	}

	platforms := r.Group("/platforms")
	{
		platforms.GET("", h.GetPlatformConfigs)
		platforms.GET("/:name", h.GetPlatformConfig)
		platforms.POST("", h.UpsertPlatformConfig)
	}

	scheduled := r.Group("/scheduled")
	{
		scheduled.POST("", h.SchedulePush)
		scheduled.GET("", h.ListScheduledPushes)
		scheduled.GET("/:id", h.GetScheduledPush)
		scheduled.GET("/pending", h.GetPendingScheduledPushes)
	}
}

func (h *Handler) CreateTemplate(c *gin.Context) {
	var req service.CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.CreateTemplate(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"template": t})
}

func (h *Handler) GetTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid template ID"})
		return
	}
	t, err := h.svc.GetTemplate(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrTemplateNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"template": t})
}

func (h *Handler) GetTemplateByUUID(c *gin.Context) {
	t, err := h.svc.GetTemplateByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrTemplateNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"template": t})
}

func (h *Handler) GetTemplatesByCategory(c *gin.Context) {
	templates, err := h.svc.GetTemplatesByCategory(c.Request.Context(), c.Param("category"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

func (h *Handler) ListTemplates(c *gin.Context) {
	templates, err := h.svc.GetTemplatesByCategory(c.Request.Context(), "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

func (h *Handler) UpdateTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid template ID"})
		return
	}
	var req service.CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.UpdateTemplate(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"template": t})
}

func (h *Handler) DeleteTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid template ID"})
		return
	}
	if err := h.svc.DeleteTemplate(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) RenderTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid template ID"})
		return
	}
	var req struct {
		Variables map[string]string `json:"variables"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.GetTemplate(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
		return
	}
	title, body := h.svc.RenderTemplate(t, req.Variables)
	c.JSON(http.StatusOK, gin.H{"title": title, "body": body})
}

func (h *Handler) CreateCampaign(c *gin.Context) {
	var req service.CreateCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	campaign, err := h.svc.CreateCampaign(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"campaign": campaign})
}

func (h *Handler) GetCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	campaign, err := h.svc.GetCampaign(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrCampaignNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) GetCampaignByUUID(c *gin.Context) {
	campaign, err := h.svc.GetCampaignByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrCampaignNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) ListCampaigns(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	campaigns, err := h.svc.ListCampaigns(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": campaigns})
}

func (h *Handler) UpdateCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req service.CreateCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	campaign, err := h.svc.UpdateCampaign(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) DeleteCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	if err := h.svc.DeleteCampaign(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ScheduleCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req struct {
		ScheduledAt time.Time `json:"scheduled_at" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ScheduleCampaign(c.Request.Context(), uint(id), req.ScheduledAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "campaign scheduled"})
}

func (h *Handler) LaunchCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	if err := h.svc.LaunchCampaign(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "campaign launched"})
}

func (h *Handler) GetPendingCampaigns(c *gin.Context) {
	campaigns, err := h.svc.GetPendingCampaigns(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": campaigns})
}

func (h *Handler) GetCampaignAnalytics(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	stats, err := h.svc.GetAnalytics(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"analytics": stats})
}

func (h *Handler) RecordEvent(c *gin.Context) {
	var req struct {
		CampaignID     uint                   `json:"campaign_id" binding:"required"`
		SubscriptionID uint                   `json:"subscription_id" binding:"required"`
		EventType      string                 `json:"event_type" binding:"required"`
		Platform       string                 `json:"platform"`
		Metadata       map[string]interface{} `json:"metadata,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RecordEvent(c.Request.Context(), req.CampaignID, req.SubscriptionID, req.EventType, req.Platform, req.Metadata); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "event recorded"})
}

func (h *Handler) GetPlatformConfigs(c *gin.Context) {
	configs, err := h.svc.GetPlatformConfigs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"platforms": configs})
}

func (h *Handler) GetPlatformConfig(c *gin.Context) {
	config, err := h.svc.GetPlatformConfig(c.Request.Context(), c.Param("name"))
	if err != nil {
		if err == repository.ErrConfigNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": config})
}

func (h *Handler) UpsertPlatformConfig(c *gin.Context) {
	var req service.PlatformConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	config, err := h.svc.UpsertPlatformConfig(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": config})
}

func (h *Handler) SchedulePush(c *gin.Context) {
	var req service.SchedulePushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sp, err := h.svc.SchedulePush(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"scheduled_push": sp})
}

func (h *Handler) GetScheduledPush(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scheduled push ID"})
		return
	}
	sp, err := h.svc.GetScheduledPush(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrScheduledNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "scheduled push not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"scheduled_push": sp})
}

func (h *Handler) ListScheduledPushes(c *gin.Context) {
	_, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "not implemented - filter by user_id"})
}

func (h *Handler) GetPendingScheduledPushes(c *gin.Context) {
	scheduled, err := h.svc.GetPendingScheduledPushes(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"scheduled_pushes": scheduled})
}
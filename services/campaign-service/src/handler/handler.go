package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/campaign-service/src/model"
	"newproject/services/campaign-service/src/repository"
	"newproject/services/campaign-service/src/service"
)

type Handler struct {
	svc *service.CampaignService
}

func NewHandler(svc *service.CampaignService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	campaigns := r.Group("/campaigns")
	{
		campaigns.POST("", h.CreateCampaign)
		campaigns.GET("/:id", h.GetCampaign)
		campaigns.GET("/uuid/:uuid", h.GetCampaignByUUID)
		campaigns.GET("/code/:code", h.GetCampaignByCode)
		campaigns.GET("", h.ListCampaigns)
		campaigns.PUT("/:id", h.UpdateCampaign)
		campaigns.PUT("/:id/start", h.StartCampaign)
		campaigns.PUT("/:id/pause", h.PauseCampaign)
		campaigns.PUT("/:id/resume", h.ResumeCampaign)
		campaigns.PUT("/:id/reject", h.RejectCampaign)
		campaigns.PUT("/:id/complete", h.CompleteCampaign)
		campaigns.GET("/active/all", h.GetActiveCampaigns)
		campaigns.GET("/expiring", h.GetExpiringCampaigns)
	}

	targeting := r.Group("/campaigns/:campaign_id/targeting")
	{
		targeting.POST("", h.AddTargetingRule)
		targeting.GET("", h.GetTargetingRules)
		targeting.PUT("/:id", h.UpdateTargetingRule)
		targeting.DELETE("/:id", h.DeleteTargetingRule)
		targeting.DELETE("", h.ClearTargetingRules)
	}

	stats := r.Group("/stats")
	{
		stats.POST("", h.RecordStat)
		stats.GET("/campaign/:campaign_id", h.GetStats)
	}
}

func (h *Handler) CreateCampaign(c *gin.Context) {
	var req struct {
		Name              string `json:"name" binding:"required"`
		Code              string `json:"code" binding:"required"`
		Description       string `json:"description"`
		AdvertiserID      uint   `json:"advertiser_id" binding:"required"`
		Budget            string `json:"budget" binding:"required"`
		CPC               string `json:"cpc"`
		CPM               string `json:"cpm"`
		StartDate         string `json:"start_date" binding:"required"`
		EndDate           string `json:"end_date" binding:"required"`
		Targeting         string `json:"targeting"`
		AdFormat          string `json:"ad_format"`
		FrequencyCap      int    `json:"frequency_cap"`
		FrequencyWindow   int    `json:"frequency_window"`
		Priority          int    `json:"priority"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	start, err := parseDateTime(req.StartDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date"})
		return
	}
	end, err := parseDateTime(req.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date"})
		return
	}
	campaign, err := h.svc.CreateCampaign(c.Request.Context(), req.Name, req.Code, req.Description, req.AdvertiserID, req.Budget, req.CPC, req.CPM, start, end, req.Targeting, req.AdFormat, req.FrequencyCap, req.FrequencyWindow, req.Priority)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"campaign": campaign})
}

func parseDateTime(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
	}
	return t, err
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

func (h *Handler) GetCampaignByCode(c *gin.Context) {
	campaign, err := h.svc.GetCampaignByCode(c.Request.Context(), c.Param("code"))
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
	advertiserID, _ := strconv.ParseUint(c.Query("advertiser_id"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	campaigns, err := h.svc.ListCampaigns(c.Request.Context(), uint(advertiserID), limit, offset)
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
	var req model.Campaign
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateCampaign(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": req})
}

func (h *Handler) StartCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req struct {
		ApproverID uint `json:"approver_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	campaign, err := h.svc.StartCampaign(c.Request.Context(), uint(id), req.ApproverID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) PauseCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	campaign, err := h.svc.PauseCampaign(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) ResumeCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	campaign, err := h.svc.ResumeCampaign(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) RejectCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req struct {
		ApproverID uint   `json:"approver_id" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	campaign, err := h.svc.RejectCampaign(c.Request.Context(), uint(id), req.ApproverID, req.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) CompleteCampaign(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	campaign, err := h.svc.CompleteCampaign(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaign": campaign})
}

func (h *Handler) GetActiveCampaigns(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	campaigns, err := h.svc.GetActiveCampaigns(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": campaigns})
}

func (h *Handler) GetExpiringCampaigns(c *gin.Context) {
	days := 7
	if d := c.Query("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil {
			days = parsed
		}
	}
	campaigns, err := h.svc.GetExpiringCampaigns(c.Request.Context(), days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": campaigns})
}

func (h *Handler) AddTargetingRule(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req service.TargetingRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule, err := h.svc.AddTargetingRule(c.Request.Context(), uint(campaignID), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"targeting_rule": rule})
}

func (h *Handler) GetTargetingRules(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	rules, err := h.svc.GetTargetingRules(c.Request.Context(), uint(campaignID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var targetingJson map[string]interface{}
	if len(rules) > 0 {
		jsonData, _ := json.Marshal(rules)
		_ = json.Unmarshal(jsonData, &targetingJson)
	}
	c.JSON(http.StatusOK, gin.H{"targeting_rules": rules, "targeting_json": targetingJson})
}

func (h *Handler) UpdateTargetingRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}
	var req model.TargetingRule
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateTargetingRule(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"targeting_rule": req})
}

func (h *Handler) DeleteTargetingRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}
	if err := h.svc.DeleteTargetingRule(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ClearTargetingRules(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	if err := h.svc.ClearTargetingRules(c.Request.Context(), uint(campaignID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "targeting rules cleared"})
}

func (h *Handler) RecordStat(c *gin.Context) {
	var req struct {
		CampaignID  uint   `json:"campaign_id" binding:"required"`
		Date        string `json:"date" binding:"required"`
		Impressions int    `json:"impressions"`
		Clicks      int    `json:"clicks"`
		Spent       string `json:"spent"`
		Conversions int    `json:"conversions"`
		Revenue     string `json:"revenue"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date"})
		return
	}
	stat, err := h.svc.RecordStat(c.Request.Context(), req.CampaignID, date, req.Impressions, req.Clicks, req.Spent, req.Conversions, req.Revenue)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"stat": stat})
}

func (h *Handler) GetStats(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	stats, err := h.svc.GetStats(c.Request.Context(), uint(campaignID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

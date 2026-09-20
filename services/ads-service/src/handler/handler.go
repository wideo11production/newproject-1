package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/ads-service/src/model"
	"newproject/services/ads-service/src/repository"
	"newproject/services/ads-service/src/service"
)

type Handler struct {
	svc *service.AdService
}

func NewHandler(svc *service.AdService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	ads := r.Group("/ads")
	{
		ads.POST("", h.CreateAd)
		ads.GET("/:id", h.GetAd)
		ads.GET("/uuid/:uuid", h.GetAdByUUID)
		ads.GET("/campaign/:campaign_id", h.ListAds)
		ads.PUT("/:id", h.UpdateAd)
		ads.PUT("/:id/activate", h.ActivateAd)
		ads.PUT("/:id/pause", h.PauseAd)
		ads.GET("/:id/stats", h.GetAdStats)
	}

	placements := r.Group("/placements")
	{
		placements.POST("", h.CreatePlacement)
		placements.GET("/code/:code", h.GetPlacementByCode)
		placements.GET("/type/:ad_type", h.ListPlacements)
		placements.PUT("/:id", h.UpdatePlacement)
	}

	slots := r.Group("/slots")
	{
		slots.POST("", h.CreateAdSlot)
		slots.GET("/placement/:placement_id", h.GetAdSlots)
		slots.PUT("/:id", h.UpdateAdSlot)
	}

	delivery := r.Group("/delivery")
	{
		delivery.POST("/deliver", h.DeliverAd)
		delivery.POST("/impression", h.RecordImpression)
		delivery.POST("/click", h.RecordClick)
		delivery.POST("/conversion", h.RecordConversion)
	}
}

func (h *Handler) CreateAd(c *gin.Context) {
	var req struct {
		CampaignID  uint   `json:"campaign_id" binding:"required"`
		Name        string `json:"name" binding:"required"`
		AdType      string `json:"ad_type" binding:"required"`
		HTMLContent string `json:"html_content"`
		MediaURL    string `json:"media_url"`
		TargetURL   string `json:"target_url" binding:"required"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		CPC         string `json:"cpc"`
		CPM         string `json:"cpm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ad, err := h.svc.CreateAd(c.Request.Context(), req.CampaignID, req.Name, req.AdType, req.HTMLContent, req.MediaURL, req.TargetURL, req.Width, req.Height, req.CPC, req.CPM)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ad": ad})
}

func (h *Handler) GetAd(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ad ID"})
		return
	}
	ad, err := h.svc.GetAd(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrAdNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "ad not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad": ad})
}

func (h *Handler) GetAdByUUID(c *gin.Context) {
	ad, err := h.svc.GetAdByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrAdNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "ad not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad": ad})
}

func (h *Handler) ListAds(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	ads, err := h.svc.ListAds(c.Request.Context(), uint(campaignID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ads": ads})
}

func (h *Handler) UpdateAd(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ad ID"})
		return
	}
	var req model.Ad
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateAd(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad": req})
}

func (h *Handler) ActivateAd(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ad ID"})
		return
	}
	if err := h.svc.ActivateAd(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ad activated"})
}

func (h *Handler) PauseAd(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ad ID"})
		return
	}
	if err := h.svc.PauseAd(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ad paused"})
}

func (h *Handler) GetAdStats(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ad ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	stats := h.svc.GetAdStats(c.Request.Context(), uint(id), limit)
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func (h *Handler) CreatePlacement(c *gin.Context) {
	var req struct {
		Name      string `json:"name" binding:"required"`
		Code      string `json:"code" binding:"required"`
		AdType    string `json:"ad_type" binding:"required"`
		Page      string `json:"page"`
		Zone      string `json:"zone"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	placement, err := h.svc.CreatePlacement(c.Request.Context(), req.Name, req.Code, req.AdType, req.Page, req.Zone, req.Width, req.Height)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"placement": placement})
}

func (h *Handler) GetPlacementByCode(c *gin.Context) {
	placement, err := h.svc.GetPlacementByCode(c.Request.Context(), c.Param("code"))
	if err != nil {
		if err == repository.ErrPlacementNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "placement not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"placement": placement})
}

func (h *Handler) ListPlacements(c *gin.Context) {
	var at model.AdType
	switch c.Param("ad_type") {
	case "banner":
		at = model.AdTypeBanner
	case "video":
		at = model.AdTypeVideo
	case "native":
		at = model.AdTypeNative
	case "overlay":
		at = model.AdTypeOverlay
	case "sponsored":
		at = model.AdTypeSponsored
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	placements, err := h.svc.ListPlacements(c.Request.Context(), at, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"placements": placements})
}

func (h *Handler) UpdatePlacement(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid placement ID"})
		return
	}
	var req model.AdPlacement
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdatePlacement(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"placement": req})
}

func (h *Handler) CreateAdSlot(c *gin.Context) {
	var req struct {
		PlacementID uint   `json:"placement_id" binding:"required"`
		AdID        uint   `json:"ad_id" binding:"required"`
		Score       string `json:"score"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	slot, err := h.svc.CreateAdSlot(c.Request.Context(), req.PlacementID, req.AdID, req.Score)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ad_slot": slot})
}

func (h *Handler) GetAdSlots(c *gin.Context) {
	placementID, err := strconv.ParseUint(c.Param("placement_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid placement ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	slots, err := h.svc.GetAdSlots(c.Request.Context(), uint(placementID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad_slots": slots})
}

func (h *Handler) UpdateAdSlot(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid slot ID"})
		return
	}
	var req model.AdSlot
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateAdSlot(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad_slot": req})
}

func (h *Handler) DeliverAd(c *gin.Context) {
	var req service.AdDeliveryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	resp, err := h.svc.DeliverAd(c.Request.Context(), req)
	if err != nil {
		if err == repository.ErrPlacementNotFound || err == repository.ErrPlacementInactive {
			c.JSON(http.StatusNotFound, gin.H{"error": "placement not found or inactive"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if resp == nil {
		c.JSON(http.StatusOK, gin.H{"ad": nil, "message": "no ad available"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ad": resp})
}

func (h *Handler) RecordImpression(c *gin.Context) {
	var req struct {
		AdID        uint   `json:"ad_id" binding:"required"`
		CampaignID  uint   `json:"campaign_id" binding:"required"`
		PlacementID uint   `json:"placement_id"`
		UserID      *uint  `json:"user_id,omitempty"`
		IPAddress   string `json:"ip_address"`
		UserAgent   string `json:"user_agent"`
		Country     string `json:"country"`
		Region      string `json:"region"`
		City        string `json:"city"`
		Device      string `json:"device"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RecordImpression(c.Request.Context(), req.AdID, req.CampaignID, req.PlacementID, req.IPAddress, req.UserAgent, req.Country, req.Region, req.City, req.Device, req.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "impression recorded"})
}

func (h *Handler) RecordClick(c *gin.Context) {
	var req struct {
		AdID        uint   `json:"ad_id" binding:"required"`
		CampaignID  uint   `json:"campaign_id" binding:"required"`
		PlacementID uint   `json:"placement_id"`
		UserID      *uint  `json:"user_id,omitempty"`
		IPAddress   string `json:"ip_address"`
		UserAgent   string `json:"user_agent"`
		Country     string `json:"country"`
		Region      string `json:"region"`
		City        string `json:"city"`
		Device      string `json:"device"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	clickID, err := h.svc.RecordClick(c.Request.Context(), req.AdID, req.CampaignID, req.PlacementID, req.IPAddress, req.UserAgent, req.Country, req.Region, req.City, req.Device, req.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"click_id": clickID})
}

func (h *Handler) RecordConversion(c *gin.Context) {
	var req struct {
		AdID              uint   `json:"ad_id" binding:"required"`
		CampaignID        uint   `json:"campaign_id" binding:"required"`
		EventType         string `json:"event_type" binding:"required"`
		EventValue        string `json:"event_value"`
		ConversionRevenue string `json:"conversion_revenue"`
		ClickID           *uint  `json:"click_id,omitempty"`
		UserID            *uint  `json:"user_id,omitempty"`
		IPAddress         string `json:"ip_address"`
		UserAgent         string `json:"user_agent"`
		Country           string `json:"country"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RecordConversion(c.Request.Context(), req.AdID, req.CampaignID, req.EventType, req.EventValue, req.ConversionRevenue, req.ClickID, req.UserID, req.IPAddress, req.UserAgent, req.Country); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "conversion recorded"})
}

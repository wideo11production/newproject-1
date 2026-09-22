package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/cdn-service/src/service"
)

type Handler struct {
	svc *service.CDNService
}

func NewHandler(svc *service.CDNService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	cdn := r.Group("/cdn")
	{
		// Config management
		cdn.POST("/configs", h.CreateCDNConfig)
		cdn.GET("/configs", h.ListCDNConfigs)
		cdn.GET("/configs/:id", h.GetCDNConfig)
		cdn.PUT("/configs/:id", h.UpdateCDNConfig)
		cdn.DELETE("/configs/:id", h.DeleteCDNConfig)

		// Cache rules
		cdn.POST("/configs/:id/rules", h.CreateCacheRule)
		cdn.GET("/configs/:id/rules", h.ListCacheRules)
		cdn.PUT("/rules/:id", h.UpdateCacheRule)
		cdn.DELETE("/rules/:id", h.DeleteCacheRule)

		// Invalidation
		cdn.POST("/configs/:id/invalidate", h.CreateInvalidation)
		cdn.GET("/invalidations/:id", h.GetInvalidation)
		cdn.GET("/configs/:id/invalidations", h.ListInvalidations)

		// Signed URLs
		cdn.POST("/configs/:id/signed-urls", h.GenerateSignedURL)
		cdn.GET("/signed-urls/:token", h.ValidateSignedURL)

		// Video CDN mappings
		cdn.POST("/video-mappings", h.CreateVideoMapping)
		cdn.GET("/video-mappings/:videoID", h.GetVideoMapping)
		cdn.POST("/video-mappings/:videoID/purge", h.PurgeVideoCache)

		// Analytics
		cdn.GET("/configs/:id/analytics", h.GetCDNAnalytics)
	}

	// Health check
	cdn.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "cdn-service",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})
}

func (h *Handler) CreateCDNConfig(c *gin.Context) {
	var req service.CreateCDNConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.CreateCDNConfig(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"config": resp})
}

func (h *Handler) GetCDNConfig(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	resp, err := h.svc.GetCDNConfig(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func (h *Handler) ListCDNConfigs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	resp, err := h.svc.ListCDNConfigs(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"configs": resp})
}

func (h *Handler) UpdateCDNConfig(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	var req service.UpdateCDNConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.UpdateCDNConfig(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": resp})
}

func (h *Handler) DeleteCDNConfig(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	if err := h.svc.DeleteCDNConfig(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) CreateCacheRule(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	var req service.CreateCacheRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.CreateCacheRule(c.Request.Context(), uint(configID), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rule": resp})
}

func (h *Handler) ListCacheRules(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	resp, err := h.svc.ListCacheRules(c.Request.Context(), uint(configID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": resp})
}

func (h *Handler) UpdateCacheRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}

	var req service.UpdateCacheRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.UpdateCacheRule(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": resp})
}

func (h *Handler) DeleteCacheRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}

	if err := h.svc.DeleteCacheRule(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) CreateInvalidation(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	var req service.CreateInvalidationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.CreateInvalidation(c.Request.Context(), uint(configID), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"invalidation": resp})
}

func (h *Handler) GetInvalidation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invalidation ID"})
		return
	}

	resp, err := h.svc.GetInvalidation(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invalidation": resp})
}

func (h *Handler) ListInvalidations(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	resp, err := h.svc.ListInvalidations(c.Request.Context(), uint(configID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invalidations": resp})
}

func (h *Handler) GenerateSignedURL(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	var req service.GenerateSignedURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.GenerateSignedURL(c.Request.Context(), uint(configID), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"signed_url": resp})
}

func (h *Handler) ValidateSignedURL(c *gin.Context) {
	token := c.Param("token")
	resourcePath := c.Query("path")
	clientIP := c.ClientIP()

	valid, err := h.svc.ValidateSignedURL(c.Request.Context(), token, resourcePath, clientIP)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"valid": valid})
}

func (h *Handler) CreateVideoMapping(c *gin.Context) {
	var req service.CreateVideoMappingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.svc.CreateVideoMapping(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"mapping": resp})
}

func (h *Handler) GetVideoMapping(c *gin.Context) {
	videoID := c.Param("videoID")

	resp, err := h.svc.GetVideoMapping(c.Request.Context(), videoID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"mapping": resp})
}

func (h *Handler) PurgeVideoCache(c *gin.Context) {
	videoID := c.Param("videoID")

	var req struct {
		Paths []string `json:"paths"`
	}
	c.ShouldBindJSON(&req)

	resp, err := h.svc.PurgeVideoCache(c.Request.Context(), videoID, req.Paths)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": resp})
}

func (h *Handler) GetCDNAnalytics(c *gin.Context) {
	configID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config ID"})
		return
	}

	startDate, _ := time.Parse("2006-01-02", c.Query("start_date"))
	endDate, _ := time.Parse("2006-01-02", c.Query("end_date"))

	if startDate.IsZero() {
		startDate = time.Now().AddDate(0, 0, -7)
	}
	if endDate.IsZero() {
		endDate = time.Now()
	}

	resp, err := h.svc.GetCDNAnalytics(c.Request.Context(), uint(configID), startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"analytics": resp})
}
package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"newproject/services/settings/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	settingService *service.SettingService
}

// NewHandler creates a new Handler with the given setting service
func NewHandler(ss *service.SettingService) *Handler {
	return &Handler{
		settingService: ss,
	}
}

// RegisterRoutes registers the settings-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	settingsGroup := r.Group("/settings")
	{
		settingsGroup.POST("", h.CreateSetting)
		settingsGroup.GET("/:id", h.GetSettingByID)
		settingsGroup.GET("/key/:key", h.GetSettingByKey)
		settingsGroup.PUT("/:id", h.UpdateSetting)
		settingsGroup.DELETE("/:id", h.DeleteSetting)
		settingsGroup.GET("", h.ListSettings)
	}
}

// CreateSetting handles POST /settings
// Expects JSON: { "key": "<key>", "value": "<value>", "description": "<description>" }
// Returns JSON: { "setting": <setting object> }
func (h *Handler) CreateSetting(c *gin.Context) {
	var req struct {
		Key          string `json:"key" binding:"required"`
		Value        string `json:"value" binding:"required"`
		Description  string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

		setting, err := h.settingService.CreateSetting(c.Request.Context(), req.Key, req.Value, req.Description)
	if err != nil {
		switch err {
		case service.ErrSettingExists:
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"setting": setting})
}

// GetSettingByID handles GET /settings/:id
// Returns JSON: { "setting": <setting object> }
func (h *Handler) GetSettingByID(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid setting ID"})
		return
	}

	setting, err := h.settingService.GetSettingByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case service.ErrSettingNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"setting": setting})
}

// GetSettingByKey handles GET /settings/key/:key
// Returns JSON: { "setting": <setting object> }
func (h *Handler) GetSettingByKey(c *gin.Context) {
	key := c.Param("key")
	setting, err := h.settingService.GetSettingByKey(c.Request.Context(), key)
	if err != nil {
		switch err {
		case service.ErrSettingNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"setting": setting})
}

// UpdateSetting handles PUT /settings/:id
// Expects JSON: { "value": "<value>", "description": "<description>" }
// Returns JSON: { "setting": <setting object> }
func (h *Handler) UpdateSetting(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid setting ID"})
		return
	}

	var req struct {
		Value      string `json:"value" binding:"omitempty"`
		Description string `json:"description" binding:"omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get the existing setting to update
	existing, err := h.settingService.GetSettingByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case service.ErrSettingNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// Update fields if provided
	if req.Value != "" {
		existing.Value = req.Value
	}
	if req.Description != "" {
		existing.Description = req.Description
	}

	if err := h.settingService.UpdateSetting(c.Request.Context(), existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"setting": existing})
}

// DeleteSetting handles DELETE /settings/:id
// Returns HTTP 204 No Content on success
func (h *Handler) DeleteSetting(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid setting ID"})
		return
	}

	if err := h.settingService.DeleteSetting(c.Request.Context(), uid); err != nil {
		switch err {
		case service.ErrSettingNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

// ListSettings handles GET /settings
// Returns JSON: { "settings": [<setting object>] }
func (h *Handler) ListSettings(c *gin.Context) {
	settings, err := h.settingService.ListSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"settings": settings})
}
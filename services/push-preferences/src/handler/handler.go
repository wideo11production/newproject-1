package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"newproject/services/push-preferences/src/model"
	"newproject/services/push-preferences/src/service"
)

type Handler struct {
	svc *service.PreferencesService
}

func NewHandler(svc *service.PreferencesService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	prefsGroup := r.Group("/preferences")
	{
		prefsGroup.GET("/users/:user_id", h.GetUserPreferences)
		prefsGroup.PUT("/users/:user_id", h.UpdateUserPreferences)
		prefsGroup.DELETE("/users/:user_id", h.DeleteUserPreferences)
		prefsGroup.GET("/users/:user_id/categories/:category", h.IsCategoryEnabled)
	}

	devGroup := r.Group("/devices")
	{
		devGroup.GET("/users/:user_id", h.GetDevices)
		devGroup.POST("/users/:user_id", h.AddDevice)
		devGroup.PUT("/devices/:device_id", h.UpdateDevice)
		devGroup.DELETE("/devices/:device_id", h.DeleteDevice)
	}
}

func (h *Handler) GetUserPreferences(c *gin.Context) {
	userID := c.Param("user_id")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	prefs, err := h.svc.GetUserPreferences(c.Request.Context(), userUint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"preferences": prefs})
}

func (h *Handler) UpdateUserPreferences(c *gin.Context) {
	userID := c.Param("user_id")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	var prefs model.UserPreferences
	if err := c.ShouldBindJSON(&prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.svc.UpdateUserPreferences(c.Request.Context(), userUint, &prefs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "preferences updated"})
}

func (h *Handler) DeleteUserPreferences(c *gin.Context) {
	userID := c.Param("user_id")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	if err := h.svc.DeleteUserPreferences(c.Request.Context(), userUint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "preferences deleted"})
}

func (h *Handler) IsCategoryEnabled(c *gin.Context) {
	userID := c.Param("user_id")
	category := c.Param("category")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	enabled, err := h.svc.IsCategoryEnabled(c.Request.Context(), userUint, model.NotificationCategory(category))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"category": category, "enabled": enabled})
}

func (h *Handler) GetDevices(c *gin.Context) {
	userID := c.Param("user_id")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	devices, err := h.svc.GetDevices(c.Request.Context(), userUint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"devices": devices})
}

func (h *Handler) AddDevice(c *gin.Context) {
	userID := c.Param("user_id")
	var userUint uint
	if _, err := fmt.Sscanf(userID, "%d", &userUint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	var dev model.DevicePreference
	if err := c.ShouldBindJSON(&dev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	dev.UserID = userUint

	if err := h.svc.AddDevice(c.Request.Context(), &dev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "device added"})
}

func (h *Handler) UpdateDevice(c *gin.Context) {
	deviceID := c.Param("device_id")
	var dev model.DevicePreference
	if err := c.ShouldBindJSON(&dev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	dev.DeviceID = deviceID

	if err := h.svc.UpdateDevice(c.Request.Context(), &dev); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "device updated"})
}

func (h *Handler) DeleteDevice(c *gin.Context) {
	deviceID := c.Param("device_id")
	if err := h.svc.DeleteDevice(c.Request.Context(), deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "device deleted"})
}

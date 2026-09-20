package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/profile-service/src/service"
)

type Handler struct {
	svc *service.ProfileService
}

func NewHandler(svc *service.ProfileService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	profiles := r.Group("/profiles")
	{
		profiles.POST("", h.CreateProfile)
		profiles.GET("/:id", h.GetProfileByID)
		profiles.GET("/user/:user_id", h.GetProfileByUserID)
		profiles.GET("/username/:username", h.GetProfileByUsername)
		profiles.PUT("/user/:user_id", h.UpdateProfile)
		profiles.DELETE("/user/:user_id", h.DeleteProfile)
		profiles.POST("/user/:user_id/views", h.IncrementViewCount)
		profiles.POST("/user/:user_id/subscribers", h.IncrementSubscriberCount)
	}

	prefs := r.Group("/preferences")
	{
		prefs.GET("/user/:user_id", h.GetUserPreferences)
		prefs.PUT("/user/:user_id", h.UpdateUserPreferences)
	}
}

func (h *Handler) CreateProfile(c *gin.Context) {
	var req service.CreateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	profile, err := h.svc.CreateProfile(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"profile": profile})
}

func (h *Handler) GetProfileByID(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}
	profile, err := h.svc.GetProfileByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) GetProfileByUserID(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	profile, err := h.svc.GetProfileByUserID(c.Request.Context(), uint(userID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) GetProfileByUsername(c *gin.Context) {
	profile, err := h.svc.GetProfileByUsername(c.Request.Context(), c.Param("username"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	var req service.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	profile, err := h.svc.UpdateProfile(c.Request.Context(), uint(userID), req)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) DeleteProfile(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	if err := h.svc.DeleteProfile(c.Request.Context(), uint(userID)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetUserPreferences(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	pref, err := h.svc.GetUserPreferences(c.Request.Context(), uint(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"preferences": pref})
}

func (h *Handler) UpdateUserPreferences(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	var req service.UpdatePreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	pref, err := h.svc.UpdateUserPreferences(c.Request.Context(), uint(userID), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"preferences": pref})
}

func (h *Handler) IncrementViewCount(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	if err := h.svc.IncrementViewCount(c.Request.Context(), uint(userID)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "view count incremented"})
}

func (h *Handler) IncrementSubscriberCount(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	if err := h.svc.IncrementSubscriberCount(c.Request.Context(), uint(userID)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "subscriber count incremented"})
}

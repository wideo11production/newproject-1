package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/newproject/services/profile/src/model"
	"github.com/newproject/services/profile/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	profileService *service.ProfileService
}

// NewHandler creates a new Handler with the given profile service
func NewHandler(ps *service.ProfileService) *Handler {
	return &Handler{
		profileService: ps,
	}
}

// RegisterRoutes registers the profile-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	profileGroup := r.Group("/profiles")
	{
		profileGroup.POST("", h.CreateProfile)
		profileGroup.GET("/:id", h.GetProfileByID)
		profileGroup.GET("/user/:user_id", h.GetProfileByUserID)
		profileGroup.PUT("/:id", h.UpdateProfile)
		profileGroup.DELETE("/:id", h.DeleteProfile)
	}
}

// CreateProfile handles POST /profiles
// Expects JSON: { "user_id": <uint>, "bio": "<bio>", "avatar_url": "<avatar_url>" }
// Returns JSON: { "profile": <profile object> }
func (h *Handler) CreateProfile(c *gin.Context) {
	var req struct {
		UserID    uint   `json:"user_id" binding:"required"`
		Bio       string `json:"bio"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile, err := h.profileService.CreateProfile(c.Request.Context(), req.UserID, req.Bio, req.AvatarURL)
	if err != nil {
		switch err {
		case errors.New("profile already exists for this user"):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"profile": profile})
}

// GetProfileByID handles GET /profiles/:id
// Returns JSON: { "profile": <profile object> }
func (h *Handler) GetProfileByID(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}

	profile, err := h.profileService.GetProfileByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case errors.New("profile not found"):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

// GetProfileByUserID handles GET /profiles/user/:user_id
// Returns JSON: { "profile": <profile object> }
func (h *Handler) GetProfileByUserID(c *gin.Context) {
	userID := c.Param("user_id")
	var uid uint
	if _, err := fmt.Sscanf(userID, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	profile, err := h.profileService.GetProfileByUserID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case errors.New("profile not found"):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

// UpdateProfile handles PUT /profiles/:id
// Expects JSON: { "bio": "<bio>", "avatar_url": "<avatar_url>" }
// Returns JSON: { "profile": <profile object> }
func (h *Handler) UpdateProfile(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}

	var req struct {
		Bio       string `json:"bio"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get the existing profile to update
	existing, err := h.profileService.GetProfileByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case errors.New("profile not found"):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// Update fields if provided
	if req.Bio != "" {
		existing.Bio = req.Bio
	}
	if req.AvatarURL != "" {
		existing.AvatarURL = req.AvatarURL
	}

	if err := h.profileService.UpdateProfile(c.Request.Context(), existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"profile": existing})
}

// DeleteProfile handles DELETE /profiles/:id
// Returns HTTP 204 No Content on success
func (h *Handler) DeleteProfile(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}

	if err := h.profileService.DeleteProfile(c.Request.Context(), uid); err != nil {
		switch err {
		case errors.New("profile not found"):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.Status(http.StatusNoContent)
}
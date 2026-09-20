package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/profile/src/model"
	"newproject/services/profile/src/repository"
	"newproject/services/profile/src/service"
)

type Handler struct {
	profileService *service.ProfileService
}

func NewHandler(ps *service.ProfileService) *Handler {
	return &Handler{
		profileService: ps,
	}
}

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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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

	profile, err := h.profileService.GetProfileByID(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrProfileNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
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

	profile, err := h.profileService.GetProfileByUserID(c.Request.Context(), uint(userID))
	if err != nil {
		if err == repository.ErrProfileNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}

	var req model.Profile
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)

	if err := h.profileService.UpdateProfile(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": &req})
}

func (h *Handler) DeleteProfile(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile ID"})
		return
	}

	if err := h.profileService.DeleteProfile(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/newproject/services/user/src/model"
	"github.com/newproject/services/user/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	userService *service.UserService
}

// NewHandler creates a new Handler with the given user service
func NewHandler(us *service.UserService) *Handler {
	return &Handler{
		userService: us,
	}
}

// RegisterRoutes registers the user-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	userGroup := r.Group("/users")
	{
		userGroup.POST("", h.CreateUser)
		userGroup.GET("/:id", h.GetUserByID)
		userGroup.GET("/uuid/:uuid", h.GetUserByUUID)
		userGroup.PUT("/:id", h.UpdateUser)
		userGroup.DELETE("/:id", h.DeleteUser)
		userGroup.GET("", h.ListUsers)
	}
}

// CreateUser handles POST /users
// Expects JSON: { "email": "<email>", "name": "<name>" }
// Returns JSON: { "user": <user object> }
func (h *Handler) CreateUser(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
		Name  string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userService.CreateUser(c.Request.Context(), req.Email, req.Name)
	if err != nil {
		switch err {
		case service.ErrUserExists:
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user": user})
}

// GetUserByID handles GET /users/:id
// Returns JSON: { "user": <user object> }
func (h *Handler) GetUserByID(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	user, err := h.userService.GetUserByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case service.ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// GetUserByUUID handles GET /users/uuid/:uuid
// Returns JSON: { "user": <user object> }
func (h *Handler) GetUserByUUID(c *gin.Context) {
	uuidStr := c.Param("uuid")
	userUUID, err := uuid.Parse(uuidStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid UUID"})
		return
	}

	user, err := h.userService.GetUserByUUID(c.Request.Context(), userUUID)
	if err != nil {
		switch err {
		case service.ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// UpdateUser handles PUT /users/:id
// Expects JSON: { "email": "<email>", "name": "<name>" }
// Returns JSON: { "user": <user object> }
func (h *Handler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req struct {
		Email string `json:"email" binding:"omitempty,email"`
		Name  string `json:"name" binding:"omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get the existing user to update
	existing, err := h.userService.GetUserByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case service.ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// Update fields if provided
	if req.Email != "" {
		existing.Email = req.Email
	}
	if req.Name != "" {
		existing.Name = req.Name
	}

	if err := h.userService.UpdateUser(c.Request.Context(), existing); err != nil {
		switch err {
		case service.ErrUserExists:
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": existing})
}

// DeleteUser handles DELETE /users/:id
// Returns HTTP 204 No Content on success
func (h *Handler) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	if err := h.userService.DeleteUser(c.Request.Context(), uid); err != nil {
		switch err {
		case service.ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

// ListUsers handles GET /users
// Returns JSON: { "users": [<user object>], "total": <total count>, "page": <page>, "page_size": <pageSize> }
func (h *Handler) ListUsers(c *gin.Context) {
	page := c.DefaultQuery("page", "1")
	pageSize := c.DefaultQuery("page_size", "10")

	var p int
	var ps int
	if _, err := fmt.Sscanf(page, "%d", &p); err != nil || p < 1 {
		p = 1
	}
	if _, err := fmt.Sscanf(pageSize, "%d", &ps); err != nil || ps < 1 {
		ps = 10
	}

	users, total, err := h.userService.ListUsers(c.Request.Context(), p, ps)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users":     users,
		"total":     total,
		"page":      p,
		"page_size": ps,
	})
}
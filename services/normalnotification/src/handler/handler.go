package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/newproject/services/normalnotification/src/model"
	"github.com/newproject/services/normalnotification/src/repository"
	"github.com/newproject/services/normalnotification/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	notificationService *service.NotificationService
}

// NewHandler creates a new Handler with the given notification service
func NewHandler(ns *service.NotificationService) *Handler {
	return &Handler{
		notificationService: ns,
	}
}

// RegisterRoutes registers the notification-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	notificationGroup := r.Group("/notifications")
	{
		notificationGroup.POST("", h.CreateNotification)
		notificationGroup.GET("/pending", h.GetPendingNotifications)
		notificationGroup.POST("/retry-failed", h.RetryFailedNotifications)
		notificationGroup.GET("/:id", h.GetNotificationByID)
		notificationGroup.DELETE("/:id", h.DeleteNotification)
	}
}

// CreateNotification handles POST /notifications
// Expects JSON: { "recipient": "<recipient>", "subject": "<subject>", "body": "<body>", "channel": "<channel>" }
// Returns JSON: { "notification": <notification object> }
func (h *Handler) CreateNotification(c *gin.Context) {
	var req struct {
		Recipient string `json:"recipient" binding:"required"`
		Subject   string `json:"subject" binding:"required"`
		Body      string `json:"body" binding:"required"`
		Channel   string `json:"channel" binding:"required,oneof=email sms push"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	notification, err := h.notificationService.CreateNotification(c.Request.Context(), req.Recipient, req.Subject, req.Body, req.Channel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"notification": notification})
}

// GetPendingNotifications handles GET /notifications/pending
// Returns JSON: { "notifications": [<notification object>] }
func (h *Handler) GetPendingNotifications(c *gin.Context) {
	notifications, err := h.notificationService.GetPendingNotifications(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"notifications": notifications})
}

// RetryFailedNotifications handles POST /notifications/retry-failed
// Retries all failed notifications
func (h *Handler) RetryFailedNotifications(c *gin.Context) {
	if err := h.notificationService.RetryFailedNotifications(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

// GetNotificationByID handles GET /notifications/:id
// Returns JSON: { "notification": <notification object> }
func (h *Handler) GetNotificationByID(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification ID"})
		return
	}

	notification, err := h.notificationService.GetByID(c.Request.Context(), uid)
	if err != nil {
		switch err {
		case repository.ErrNotificationNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"notification": notification})
}

// DeleteNotification handles DELETE /notifications/:id
// Returns HTTP 204 No Content on success
func (h *Handler) DeleteNotification(c *gin.Context) {
	id := c.Param("id")
	var uid uint
	if _, err := fmt.Sscanf(id, "%d", &uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification ID"})
		return
	}

	if err := h.notificationService.DeleteByID(c.Request.Context(), uid); err != nil {
		switch err {
		case repository.ErrNotificationNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.Status(http.StatusNoContent)
}
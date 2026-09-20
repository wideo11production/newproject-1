package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/push-service/src/model"
	"newproject/services/push-service/src/service"
)

type Handler struct {
	pushService *service.PushService
}

func NewHandler(ps *service.PushService) *Handler {
	return &Handler{pushService: ps}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	pushGroup := r.Group("/push")
	{
		pushGroup.POST("/subscribe", h.Subscribe)
		pushGroup.POST("/send", h.SendPush)
		pushGroup.GET("/status/:id", h.GetMessageStatus)
		pushGroup.DELETE("/unsubscribe/:id", h.Unsubscribe)
		pushGroup.DELETE("/unsubscribe/user/:user_id", h.UnsubscribeByUser)
		pushGroup.GET("/vapid-public-key", h.GetVAPIDPublicKey)
	}
}

func (h *Handler) Subscribe(c *gin.Context) {
	var req struct {
		UserID    uint   `json:"user_id" binding:"required"`
		Endpoint  string `json:"endpoint" binding:"required"`
		P256DH    string `json:"p256dh" binding:"required"`
		AuthSecret string `json:"auth_secret" binding:"required"`
		UserAgent string `json:"user_agent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub := &model.PushSubscription{
		UserID:    req.UserID,
		Endpoint:  req.Endpoint,
		P256DH:    req.P256DH,
		AuthSecret: req.AuthSecret,
		UserAgent: req.UserAgent,
	}
	if err := h.pushService.Subscribe(c.Request.Context(), sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "subscription saved"})
}

func (h *Handler) SendPush(c *gin.Context) {
	var req struct {
		UserID  uint   `json:"user_id" binding:"required"`
		Title   string `json:"title" binding:"required"`
		Body    string `json:"body"`
		Icon    string `json:"icon"`
		URL     string `json:"url"`
		Tag     string `json:"tag"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	msg, err := h.pushService.SendMessage(c.Request.Context(), req.UserID, req.Title, req.Body, req.Icon, req.URL, req.Tag)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message_id": msg.MessageID, "status": msg.Status})
}

func (h *Handler) GetMessageStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message ID"})
		return
	}

	msg, err := h.pushService.GetMessageStatus(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": msg})
}

func (h *Handler) Unsubscribe(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription ID"})
		return
	}
	if err := h.pushService.Unsubscribe(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) UnsubscribeByUser(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	if err := h.pushService.UnsubscribeByUser(c.Request.Context(), uint(userID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetVAPIDPublicKey(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"public_key": "placeholder",
	})
}

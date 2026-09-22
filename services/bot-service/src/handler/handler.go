package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"newproject/services/bot-service/src/model"
	"newproject/services/bot-service/src/service"
)

// ChatHandler handles HTTP requests for chats.
type ChatHandler struct {
	KnowledgeService *service.KnowledgeService
}

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(ks *service.KnowledgeService) *ChatHandler {
	return &ChatHandler{
		KnowledgeService: ks,
	}
}

// CreateChat godoc
// @Summary Create a new chat
// @Description Create a new chat for the authenticated user
// @Tags chats
// @Accept json
// @Produce json
// @Param user_id header int true "User ID"
// @Success 200 {object} model.Chat
// @Failure 400 {object} handler.errorResponse
// @Failure 500 {object} handler.errorResponse
// @Router /chats [post]
func (h *ChatHandler) CreateChat(c *gin.Context) {
	userIDStr := c.GetHeader("X-User-ID")
	if userIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing X-User-ID header"})
		return
	}
	userID, err := strconv.ParseUint(userIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid X-User-ID"})
		return
	}

	chat, err := h.KnowledgeService.CreateChat(c.Request.Context(), uint(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chat"})
		return
	}
	c.JSON(http.StatusOK, chat)
}

// SendMessage godoc
// @Summary Send a message and get bot response
// @Description Send a user message to a chat and get the bot's response
// @Tags chats
// @Accept json
// @Produce json
// @Param chatID path int true "Chat ID"
// @Param user_id header int true "User ID"
// @Param request body messageRequest true "Message request"
// @Success 200 {object} handler.messageResponse
// @Failure 400 {object} handler.errorResponse
// @Failure 500 {object} handler.errorResponse
// @Router /chats/{chatID}/messages [post]
func (h *ChatHandler) SendMessage(c *gin.Context) {
	chatIDStr := c.Param("chatID")
	chatID, err := strconv.ParseUint(chatIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chatID"})
		return
	}

	userIDStr := c.GetHeader("X-User-ID")
	if userIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing X-User-ID header"})
		return
	}
	userID, err := strconv.ParseUint(userIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid X-User-ID"})
		return
	}

	var req messageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	resp, err := h.KnowledgeService.SendMessage(c.Request.Context(), uint(chatID), uint(userID), req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process message"})
		return
	}
	c.JSON(http.StatusOK, messageResponse{
		Response: resp.Response,
		ChatID:   resp.ChatID,
	})
}

// GetMessages godoc
// @Summary Get messages for a chat
// @Description Get paginated messages for a chat
// @Tags chats
// @Accept json
// @Produce json
// @Param chatID path int true "Chat ID"
// @Param limit query int false "Limit" default(50)
// @Success 200 {object} []model.Message
// @Failure 400 {object} handler.errorResponse
// @Failure 500 {object} handler.errorResponse
// @Router /chats/{chatID}/messages [get]
func (h *ChatHandler) GetMessages(c *gin.Context) {
	chatIDStr := c.Param("chatID")
	chatID, err := strconv.ParseUint(chatIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chatID"})
		return
	}

	limitStr := c.DefaultQuery("limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = 50
	}

	messages, err := h.KnowledgeService.Repo.GetMessagesByChatID(c.Request.Context(), uint(chatID), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to retrieve messages"})
		return
	}
	c.JSON(http.StatusOK, messages)
}

// messageRequest represents the request body for sending a message.
type messageRequest struct {
	Content string `json:"content" binding:"required"`
}

// messageResponse represents the response body for sending a message.
type messageResponse struct {
	Response string `json:"response"`
	ChatID   uint   `json:"chat_id"`
}

// errorResponse represents an error response.
type errorResponse struct {
	Error string `json:"error"`
}
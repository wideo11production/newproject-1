package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"newproject/services/recommendation-service/src/repository"
	"newproject/services/recommendation-service/src/service"
)

// Handler represents the HTTP handler for recommendation endpoints
type Handler struct {
	feedService *service.FeedService
	repo        *repository.RecommendationRepository
}

// NewHandler creates a new handler instance
func NewHandler(feedService *service.FeedService, repo *repository.RecommendationRepository) *Handler {
	return &Handler{
		feedService: feedService,
		repo:        repo,
	}
}

// GetPersonalizedFeed handles GET /feeds/personalized
// Returns personalized feeds for a user
func (h *Handler) GetPersonalizedFeed(c *gin.Context) {
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}
	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	language := c.Query("language")
	currency := c.Query("currency")

	ctx := context.Background()
	feedResponse, err := h.feedService.GetPersonalizedFeed(ctx, userID, page, pageSize, language, currency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, feedResponse)
}

// GetSearchSuggestions handles GET /search/suggestions
// Returns search suggestions based on query
func (h *Handler) GetSearchSuggestions(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter q is required"})
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if err != nil || limit < 1 {
		limit = 10
	}
	language := c.Query("language")

	ctx := context.Background()
	// We'll use the repository's search function to get suggestions
	// For simplicity, we'll return a few content items that match the query
	items, err := h.repo.SearchContentFullText(ctx, query, language, limit, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Format suggestions
	suggestions := []gin.H{}
	for _, item := range items {
		suggestions = append(suggestions, gin.H{
			"id":          item.UUID,
			"title":       item.Title,
			"category":    item.Category,
			"content_type": item.ContentType,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"query":         query,
		"suggestions": suggestions,
	})
}
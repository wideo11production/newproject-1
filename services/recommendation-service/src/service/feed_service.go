package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"bytes"
	"sort"
	"strings"
	"sync"
	"time"

	

	"newproject/services/recommendation-service/src/model"
	"newproject/services/recommendation-service/src/repository"
	"newproject/services/recommendation-service/src/config"
)

// FeedService handles personalized feed generation algorithms
// Implements GetPersonalizedFeed() for Following, Trending, and Discovery feeds
type FeedService struct {
	repo *repository.RecommendationRepository
	cfg  *config.Config
	mu   sync.RWMutex // mutex for cache if we implement in-memory cache, but we are using repository cache
}

// NewFeedService creates a new feed service instance
func NewFeedService(repo *repository.RecommendationRepository, cfg *config.Config) *FeedService {
	return &FeedService{repo: repo, cfg: cfg}
}

// GetPersonalizedFeed generates personalized feeds for a user
// Returns Following Feed, Trending Feed, and Discovery Feed based on user intelligence matrix
func (f *FeedService) GetPersonalizedFeed(ctx context.Context, userID string, page int, pageSize int, language string, currency string) (*FeedResponse, error) {
	// Validate inputs
	if userID == "" {
		return nil, errors.New("user ID is required")
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	// Get user's preference matrix
	prefMatrix, err := f.repo.GetUserPreferenceMatrix(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user preference matrix: %w", err)
	}

	// Get user's followed categories and users
	followedCategories := prefMatrix.FollowedCategories
	followedUsers := prefMatrix.FollowedUsers

	// Generate cache key for this query
	queryHash := f.generateQueryHash(userID, page, pageSize, language, currency, followedCategories, followedUsers)

	// Check if we have a cached feed
	cachedFeed, err := f.repo.GetFeedCache(ctx, userID, "personalized", queryHash)
	if err != nil {
		log.Printf("Warning: Failed to check feed cache: %v", err)
	}
	if cachedFeed != nil && len(cachedFeed.FeedData) > 0 {
		// Return cached feed
		return &FeedResponse{
			FollowingFeed: f.extractFeedByType(cachedFeed.FeedData, "following", page, pageSize),
			TrendingFeed:  f.extractFeedByType(cachedFeed.FeedData, "trending", page, pageSize),
			DiscoveryFeed: f.extractFeedByType(cachedFeed.FeedData, "discovery", page, pageSize),
			Page:          page,
			PageSize:      pageSize,
			TotalResults:  len(cachedFeed.FeedData),
			FromCache:     true,
			GeneratedAt:   time.Now(),
		}, nil
	}

	// Generate fresh feed
	followingFeed, err := f.generateFollowingFeed(ctx, userID, followedCategories, followedUsers, language, currency, page, pageSize)
	if err != nil {
		return nil, fmt.Errorf("failed to generate following feed: %w", err)
	}

	trendingFeed, err := f.generateTrendingFeed(ctx, language, currency, page, pageSize)
	if err != nil {
		return nil, fmt.Errorf("failed to generate trending feed: %w", err)
	}

	discoveryFeed, err := f.generateDiscoveryFeed(ctx, userID, prefMatrix, language, currency, page, pageSize)
	if err != nil {
		return nil, fmt.Errorf("failed to generate discovery feed: %w", err)
	}

	// Combine all feeds for caching
	allFeedItems := append([]model.FeedItem{}, followingFeed.Items...)
	allFeedItems = append(allFeedItems, trendingFeed.Items...)
	allFeedItems = append(allFeedItems, discoveryFeed.Items...)

	// Cache the combined feed using TTL from config
	cacheExpiry := time.Now().Add(f.cfg.Feed.CacheTTL)
	feedCache := &model.FeedCache{
		UserID:     userID,
		FeedType:   "personalized",
		FeedData:   allFeedItems,
		Score:      f.calculateOverallFeedScore(allFeedItems),
		ExpiresAt:  cacheExpiry,
		QueryHash:  queryHash,
		CreatedAt:  time.Now(),
	}

	if err := f.repo.SaveFeedCache(ctx, feedCache); err != nil {
		log.Printf("Warning: Failed to save feed cache: %v", err)
	}

	return &FeedResponse{
		FollowingFeed: followingFeed,
		TrendingFeed:  trendingFeed,
		DiscoveryFeed: discoveryFeed,
		Page:          page,
		PageSize:      pageSize,
		TotalResults:  len(allFeedItems),
		FromCache:     false,
		GeneratedAt:   time.Now(),
	}, nil
}

// generateFollowingFeed generates feed based on followed users and categories
func (f *FeedService) generateFollowingFeed(ctx context.Context, userID string, followedCategories []string, followedUsers []string, language string, currency string, page int, pageSize int) (*FeedItems, error) {
	var items []model.FeedItem

	// Get content from followed users
	if len(followedUsers) > 0 {
		userContent, err := f.getContentFromFollowedUsers(ctx, followedUsers, language, currency, f.cfg.Feed.FollowingFeedLimit*2)
		if err != nil {
			log.Printf("Warning: Failed to get content from followed users: %v", err)
		} else {
			// Score and rank content from followed users
			for _, content := range userContent {
				item := f.contentToFeedItem(&content, "following")
				item.FollowScore = f.calculateFollowScore(&content, followedUsers, followedCategories)
				item.PersonalizationScore = f.calculatePersonalizationScore(&content, userID)
				item.Reason = "From users you follow"
				items = append(items, item)
			}
		}
	}

	// Get content from followed categories
	if len(followedCategories) > 0 {
		categoryContent, err := f.getContentFromFollowedCategories(ctx, followedCategories, language, currency, f.cfg.Feed.FollowingFeedLimit*2)
		if err != nil {
			log.Printf("Warning: Failed to get content from followed categories: %v", err)
		} else {
			// Score and rank content from followed categories
			for _, content := range categoryContent {
				// Avoid duplicates
				if !f.isDuplicateFeedItem(items, content.UUID) {
					item := f.contentToFeedItem(&content, "following")
					item.FollowScore = f.calculateCategoryFollowScore(&content, followedCategories)
					item.PersonalizationScore = f.calculatePersonalizationScore(&content, userID)
					item.Reason = "From categories you follow"
					items = append(items, item)
				}
			}
		}
	}

	// If we don't have enough followed content, supplement with general content
	if len(items) < f.cfg.Feed.FollowingFeedLimit {
		generalContent, err := f.repo.GetContentItems(ctx, "", "", language, f.cfg.Feed.FollowingFeedLimit*2, 0)
		if err != nil {
			return nil, fmt.Errorf("failed to get general content: %w", err)
		}

		for _, content := range generalContent {
			if !f.isDuplicateFeedItem(items, content.UUID) {
				item := f.contentToFeedItem(&content, "following")
				item.FollowScore = 0.1 // Low score for non-followed content
				item.PersonalizationScore = f.calculatePersonalizationScore(&content, userID)
				item.Reason = "General recommendation"
				items = append(items, item)
			}
		}
	}

	// Sort by follow score (descending) then by personalization score
	sort.Slice(items, func(i, j int) bool {
		if items[i].FollowScore != items[j].FollowScore {
			return items[i].FollowScore > items[j].FollowScore
		}
		return items[i].PersonalizationScore > items[j].PersonalizationScore
	})

	// Apply pagination
	start := (page - 1) * pageSize
	end := start + pageSize
	if start >= len(items) {
		start = len(items)
	}
	if end > len(items) {
		end = len(items)
	}

	paginatedItems := items[start:end]

	return &FeedItems{
		Items: paginatedItems,
		Total: len(items),
		Page:  page,
		Size:  len(paginatedItems),
	}, nil
}

// generateTrendingFeed generates feed based on trending content
func (f *FeedService) generateTrendingFeed(ctx context.Context, language string, currency string, page int, pageSize int) (*FeedItems, error) {
	// Get trending scores from database
	trendingScores, err := f.repo.GetTrendingScores(ctx, []string{}, f.cfg.Feed.TrendingFeedLimit*3)
	if err != nil {
		return nil, fmt.Errorf("failed to get trending scores: %w", err)
	}

	var items []model.FeedItem

	// Get content for trending scores
	for _, score := range trendingScores {
		content, err := f.repo.GetContentItemByUUID(ctx, score.ContentID)
		if err != nil {
			log.Printf("Warning: Failed to get content for trending score %s: %v", score.ContentID, err)
			continue
		}
		if content == nil {
			continue
		}

		// Filter by language and currency if specified
		if language != "" && content.Language != language {
			continue
		}
		if currency != "" && content.Currency != currency {
			continue
		}

		item := f.contentToFeedItem(content, "trending")
		item.TrendingScore = score.Score
		item.PersonalizationScore = 0.5 // Neutral personalization for trending
		item.Reason = "Trending now"
		items = append(items, item)
	}

	// If we don't have enough trending content, get recent popular content
	if len(items) < f.cfg.Feed.TrendingFeedLimit {
		recentContent, err := f.repo.GetContentItems(ctx, "", "", language, f.cfg.Feed.TrendingFeedLimit*2, 0)
		if err != nil {
			return nil, fmt.Errorf("failed to get recent content: %w", err)
		}

		for _, content := range recentContent {
			if !f.isDuplicateFeedItem(items, content.UUID) {
				item := f.contentToFeedItem(&content, "trending")
				item.TrendingScore = f.calculateBasicTrendingScore(&content)
				item.PersonalizationScore = 0.5
				item.Reason = "Recently popular"
				items = append(items, item)
			}
		}
	}

	// Sort by trending score (descending)
	sort.Slice(items, func(i, j int) bool {
		return items[i].TrendingScore > items[j].TrendingScore
	})

	// Apply pagination
	start := (page - 1) * pageSize
	end := start + pageSize
	if start >= len(items) {
		start = len(items)
	}
	if end > len(items) {
		end = len(items)
	}

	paginatedItems := items[start:end]

	return &FeedItems{
		Items: paginatedItems,
		Total: len(items),
		Page:  page,
		Size:  len(paginatedItems),
	}, nil
}

// generateDiscoveryFeed generates feed based on discovery algorithms (similarity, diversity, novelty)
func (f *FeedService) generateDiscoveryFeed(ctx context.Context, userID string, prefMatrix *model.UserPreferenceMatrix, language string, currency string, page int, pageSize int) (*FeedItems, error) {
	var items []model.FeedItem

	// Get user's language and currency preferences
	langPrefs, err := f.repo.GetLanguagePreferences(ctx, userID)
	if err != nil {
		log.Printf("Warning: Failed to get language preferences: %v", err)
	}

	currPrefs, err := f.repo.GetCurrencyPreferences(ctx, userID)
	if err != nil {
		log.Printf("Warning: Failed to get currency preferences: %v", err)
	}

	// Determine preferred languages and currencies
	preferredLanguages := []string{language} // Start with requested language
	preferredCurrencies := []string{currency} // Start with requested currency

	if len(langPrefs) > 0 {
		for _, pref := range langPrefs {
			if pref.Preference > 0.3 {
				preferredLanguages = append(preferredLanguages, pref.Language)
			}
		}
	}

	if len(currPrefs) > 0 {
		for _, pref := range currPrefs {
			if pref.Preference > 0.3 {
				preferredCurrencies = append(preferredCurrencies, pref.Currency)
			}
		}
	}

	// Remove duplicates
	preferredLanguages = f.removeDuplicates(preferredLanguages)
	preferredCurrencies = f.removeDuplicates(preferredCurrencies)

	// Get content based on user's preference matrix
	categoryScores := prefMatrix.CategoryScores

	// Get content from high-scoring categories
	var categoryScoresList []struct {
		category string
		score    float64
	}
	for category, score := range categoryScores {
		categoryScoresList = append(categoryScoresList, struct {
			category string
			score    float64
		}{category, score})
	}

	// Sort categories by score (descending)
	sort.Slice(categoryScoresList, func(i, j int) bool {
		return categoryScoresList[i].score > categoryScoresList[j].score
	})

	// Get content from top categories
	topCategories := []string{}
	for i := 0; i < min(5, len(categoryScoresList)); i++ {
		if categoryScoresList[i].score > 0.1 { // Only include meaningful scores
			topCategories = append(topCategories, categoryScoresList[i].category)
		}
	}

	// Get content from preferred languages
	contentFromCategories, err := f.getContentFromCategoriesAndLanguages(ctx, topCategories, preferredLanguages, preferredCurrencies, f.cfg.Feed.DiscoveryFeedLimit*2)
	if err != nil {
		log.Printf("Warning: Failed to get content from categories/languages: %v", err)
	} else {
		for _, content := range contentFromCategories {
			if !f.isDuplicateFeedItem(items, content.UUID) {
				item := f.contentToFeedItem(&content, "discovery")
				item.DiscoveryScore = f.calculateDiscoveryScore(&content, prefMatrix, userID)
				item.SimilarityScore = f.calculateSimilarityScore(&content, prefMatrix)
				item.DiversityScore = f.calculateDiversityScore(&content, prefMatrix, userID)
				item.NoveltyScore = f.calculateNoveltyScore(&content, userID)
				item.PersonalizationScore = f.calculatePersonalizationScore(&content, userID)
				item.Reason = "Based on your interests"
				items = append(items, item)
			}
		}
	}

	// If we don't have enough discovery content, get diverse content
	if len(items) < f.cfg.Feed.DiscoveryFeedLimit {
		diverseContent, err := f.getDiverseContent(ctx, userID, preferredLanguages, preferredCurrencies, f.cfg.Feed.DiscoveryFeedLimit*2)
		if err != nil {
			log.Printf("Warning: Failed to get diverse content: %v", err)
		} else {
			for _, content := range diverseContent {
				if !f.isDuplicateFeedItem(items, content.UUID) {
					item := f.contentToFeedItem(&content, "discovery")
					item.DiscoveryScore = f.calculateDiscoveryScore(&content, prefMatrix, userID)
					item.SimilarityScore = f.calculateSimilarityScore(&content, prefMatrix)
					item.DiversityScore = f.calculateDiversityScore(&content, prefMatrix, userID)
					item.NoveltyScore = f.calculateNoveltyScore(&content, userID)
					item.PersonalizationScore = f.calculatePersonalizationScore(&content, userID)
					item.Reason = "Discover something new"
					items = append(items, item)
				}
			}
		}
	}

	// Sort by discovery score (descending)
	sort.Slice(items, func(i, j int) bool {
		return items[i].DiscoveryScore > items[j].DiscoveryScore
	})

	// Apply pagination
	start := (page - 1) * pageSize
	end := start + pageSize
	if start >= len(items) {
		start = len(items)
	}
	if end > len(items) {
		end = len(items)
	}

	paginatedItems := items[start:end]

	return &FeedItems{
		Items: paginatedItems,
		Total: len(items),
		Page:  page,
		Size:  len(paginatedItems),
	}, nil
}

// Helper functions

// contentToFeedItem converts a ContentItem to a FeedItem
func (f *FeedService) contentToFeedItem(content *model.ContentItem, feedType string) model.FeedItem {
	tags := []string{}
	if content.Tags != nil {
		tags = content.Tags
	}

	return model.FeedItem{
		ID:             content.UUID,
		Title:          content.Title,
		Description:    content.Description,
		Category:       content.Category,
		ContentType:    content.ContentType,
		Language:       content.Language,
		Currency:       content.Currency,
		Price:          content.Price.InexactFloat64(),
		Duration:       content.Duration,
		ThumbnailURL:   content.ThumbnailURL,
		VideoURL:       content.VideoURL,
		Tags:           tags,
		Score:          0.0, // Will be calculated based on feed type
		FollowScore:    0.0,
		TrendingScore:  0.0,
		DiscoveryScore: 0.0,
		SimilarityScore: 0.0,
		DiversityScore: 0.0,
		NoveltyScore:   0.0,
		PersonalizationScore: 0.0,
		Metadata:       content.Metadata,
		Reason:         "",
	}
}

// calculateFollowScore calculates score based on followed users
func (f *FeedService) calculateFollowScore(content *model.ContentItem, followedUsers []string, followedCategories []string) float64 {
	score := 0.0

	// Check if content is from followed users (we don't have user ID in content, so this is simplified)
	// In a real implementation, we would check content creator ID against followedUsers

	// Check if content is from followed categories
	for _, category := range followedCategories {
		if content.Category == category {
			score += 0.5
			break
		}
	}

	// Normalize score to 0-1 range
	return math.Min(1.0, score)
}

// calculateCategoryFollowScore calculates score based on followed categories
func (f *FeedService) calculateCategoryFollowScore(content *model.ContentItem, followedCategories []string) float64 {
	for _, category := range followedCategories {
		if content.Category == category {
			return 1.0
		}
	}
	return 0.0
}

// calculatePersonalizationScore calculates how well content matches user preferences
func (f *FeedService) calculatePersonalizationScore(content *model.ContentItem, userID string) float64 {
	// This would typically use the user's preference matrix
	// For now, return a basic score based on content popularity
	score := 0.0

	// Boost score based on engagement
	if content.ViewCount > 1000 {
		score += 0.2
	}
	if content.LikeCount > 100 {
		score += 0.2
	}
	if content.ShareCount > 50 {
		score += 0.2
	}
	if content.CommentCount > 20 {
		score += 0.2
	}

	// Boost for featured content
	if content.IsFeatured {
		score += 0.2
	}

	return math.Min(1.0, score)
}

// calculateDiscoveryScore calculates overall discovery score
// Uses weights from config for diversity and AI inference, and fixed weights for similarity and novelty (can be made configurable)
func (f *FeedService) calculateDiscoveryScore(content *model.ContentItem, prefMatrix *model.UserPreferenceMatrix, userID string) float64 {
	similarity := f.calculateSimilarityScore(content, prefMatrix)
	diversity := f.calculateDiversityScore(content, prefMatrix, userID)
	novelty := f.calculateNoveltyScore(content, userID)
	ollamaScore := f.getOllamaScore(context.TODO(), content, prefMatrix)

	// Use weights from config
	// Weights: FollowScore, EngagementScore, RecencyScore, DiversityScore, LanguageMatchScore, CurrencyMatchScore, AIInferenceScore
	// For discovery, we combine similarity, diversity, novelty, and Ollama score.
	// We'll use: similarity weight = FeedConfig.ScoreWeights.EngagementScore (as a proxy for relevance),
	//            diversity weight = FeedConfig.ScoreWeights.DiversityScore,
	//            novelty weight = FeedConfig.ScoreWeights.RecencyScore,
	//            ollama weight = FeedConfig.ScoreWeights.AIInferenceScore
	// But note: the weights in FeedScoreWeights are for the overall feed scoring, not specifically for discovery.
	// For simplicity, we'll use the weights as follows:
	//   similarity: 0.3 (fixed)
	//   diversity: f.cfg.Feed.ScoreWeights.DiversityScore
	//   novelty: 0.2 (fixed)
	//   ollama: f.cfg.Feed.ScoreWeights.AIInferenceScore
	// And then normalize so they sum to 1.

	similarityWeight := 0.3
	diversityWeight := f.cfg.Feed.ScoreWeights.DiversityScore
	noveltyWeight := 0.2
	ollamaWeight := f.cfg.Feed.ScoreWeights.AIInferenceScore

	totalWeight := similarityWeight + diversityWeight + noveltyWeight + ollamaWeight
	if totalWeight == 0 {
		// Avoid division by zero
		return 0.0
	}

	return (similarityWeight*similarity +
		diversityWeight*diversity +
		noveltyWeight*novelty +
		ollamaWeight*ollamaScore) / totalWeight
}

// calculateSimilarityScore calculates how similar content is to user's interests
func (f *FeedService) calculateSimilarityScore(content *model.ContentItem, prefMatrix *model.UserPreferenceMatrix) float64 {
	score := 0.0
	weight := 0.0

	// Category similarity
	if categoryScore, exists := prefMatrix.CategoryScores[content.Category]; exists {
		score += categoryScore * 0.4
		weight += 0.4
	}

	// Language similarity
	if languageScore, exists := prefMatrix.LanguageScores[content.Language]; exists {
		score += languageScore * 0.3
		weight += 0.3
	}

	// Currency similarity
	if currencyScore, exists := prefMatrix.CurrencyScores[content.Currency]; exists {
		score += currencyScore * 0.3
		weight += 0.3
	}

	if weight > 0 {
		return score / weight
	}
	return 0.5 // Default similarity if no preferences
}

// calculateDiversityScore calculates how diverse content is from user's usual consumption
func (f *FeedService) calculateDiversityScore(content *model.ContentItem, prefMatrix *model.UserPreferenceMatrix, userID string) float64 {
	// In a real implementation, we would analyze user's watch history
	// For now, return a score that encourages exploration of new categories

	// Check if this category is in user's top categories
	categoryScore := prefMatrix.CategoryScores[content.Category]

	// If user has high preference for this category, lower diversity score
	// If user has low or no preference, higher diversity score (encourages exploration)
	if categoryScore > 0.7 {
		return 0.3 // Low diversity (user already likes this category)
	} else if categoryScore > 0.3 {
		return 0.6 // Medium diversity
	} else {
		return 0.9 // High diversity (new category for user)
	}
}

// calculateNoveltyScore calculates how new/fresh the content is
func (f *FeedService) calculateNoveltyScore(content *model.ContentItem, userID string) float64 {
	// Check if content is recent (within last 7 days)
	now := time.Now()
	hoursSincePublish := now.Sub(content.PublishDate).Hours()

	if hoursSincePublish < 24 {
		return 1.0 // Very new
	} else if hoursSincePublish < 168 { // 7 days
		return 0.7 // Recently published
	} else if hoursSincePublish < 720 { // 30 days
		return 0.4 // Somewhat new
	} else {
		return 0.1 // Older content
	}
}

// calculateBasicTrendingScore calculates a basic trending score based on engagement
func (f *FeedService) calculateBasicTrendingScore(content *model.ContentItem) float64 {
	score := 0.0

	// Normalize view count (log scale)
	if content.ViewCount > 0 {
		viewScore := math.Min(1.0, math.Log(float64(content.ViewCount+1))/math.Log(10000))
		score += viewScore * 0.4
	}

	// Normalize like count
	if content.LikeCount > 0 {
		likeScore := math.Min(1.0, math.Log(float64(content.LikeCount+1))/math.Log(1000))
		score += likeScore * 0.3
	}

	// Normalize share count
	if content.ShareCount > 0 {
		shareScore := math.Min(1.0, math.Log(float64(content.ShareCount+1))/math.Log(500))
		score += shareScore * 0.2
	}

	// Normalize comment count
	if content.CommentCount > 0 {
		commentScore := math.Min(1.0, math.Log(float64(content.CommentCount+1))/math.Log(100))
		score += commentScore * 0.1
	}

	return math.Min(1.0, score)
}

// calculateOverallFeedScore calculates overall score for feed caching
func (f *FeedService) calculateOverallFeedScore(items []model.FeedItem) float64 {
	if len(items) == 0 {
		return 0.0
	}

	totalScore := 0.0
	for _, item := range items {
		// Use the highest of the three scores plus personalization
		maxScore := math.Max(item.FollowScore, math.Max(item.TrendingScore, item.DiscoveryScore))
		totalScore += maxScore + item.PersonalizationScore
	}

	return totalScore / float64(len(items)*2) // Normalize to 0-1 range
}

// getContentFromFollowedUsers gets content from users that the user follows
func (f *FeedService) getContentFromFollowedUsers(ctx context.Context, followedUsers []string, language string, currency string, limit int) ([]model.ContentItem, error) {
	// In a real implementation, we would join with a user-content relationship table
	// For now, we'll return recent content as a placeholder
	return f.repo.GetContentItems(ctx, "", "", language, limit, 0)
}

// getContentFromFollowedCategories gets content from categories that the user follows
func (f *FeedService) getContentFromFollowedCategories(ctx context.Context, followedCategories []string, language string, currency string, limit int) ([]model.ContentItem, error) {
	if len(followedCategories) == 0 {
		return []model.ContentItem{}, nil
	}

	// Get content from the first few categories (to avoid too many queries)
	limitPerCategory := limit / len(followedCategories)
	if limitPerCategory < 1 {
		limitPerCategory = 1
	}

	var allItems []model.ContentItem
	seen := make(map[string]bool)

	for _, category := range followedCategories {
		items, err := f.repo.GetContentItems(ctx, category, "", language, limitPerCategory, 0)
		if err != nil {
			log.Printf("Warning: Failed to get content for category %s: %v", category, err)
			continue
		}

		for _, item := range items {
			if !seen[item.UUID] {
				seen[item.UUID] = true
				allItems = append(allItems, item)
			}
		}
	}

	return allItems, nil
}

// getContentFromCategoriesAndLanguages gets content from specific categories and languages
func (f *FeedService) getContentFromCategoriesAndLanguages(ctx context.Context, categories []string, languages []string, currencies []string, limit int) ([]model.ContentItem, error) {
	if len(categories) == 0 && len(languages) == 0 {
		return f.repo.GetContentItems(ctx, "", "", "", limit, 0)
	}

	// For simplicity, we'll get content from categories and filter by language/currency
	var allItems []model.ContentItem
	seen := make(map[string]bool)

	if len(categories) > 0 {
		for _, category := range categories {
			items, err := f.repo.GetContentItems(ctx, category, "", "", limit, 0)
			if err != nil {
				log.Printf("Warning: Failed to get content for category %s: %v", category, err)
				continue
			}

			for _, item := range items {
				if !seen[item.UUID] {
					// Check language and currency filters
					langMatch := len(languages) == 0 || f.containsString(languages, item.Language)
					currMatch := len(currencies) == 0 || f.containsString(currencies, item.Currency)

					if langMatch && currMatch {
						seen[item.UUID] = true
						allItems = append(allItems, item)
					}
				}
			}
		}
	} else {
		// No categories specified, get general content and filter
		items, err := f.repo.GetContentItems(ctx, "", "", "", limit*2, 0) // Get more to account for filtering
		if err != nil {
			return nil, err
		}

		for _, item := range items {
			if !seen[item.UUID] {
				// Check language and currency filters
				langMatch := len(languages) == 0 || f.containsString(languages, item.Language)
				currMatch := len(currencies) == 0 || f.containsString(currencies, item.Currency)

				if langMatch && currMatch {
					seen[item.UUID] = true
					allItems = append(allItems, item)
				}
			}
		}
	}

	return allItems, nil
}

// getDiverseContent gets content that is diverse from user's usual preferences
func (f *FeedService) getDiverseContent(ctx context.Context, userID string, languages []string, currencies []string, limit int) ([]model.ContentItem, error) {
	// Get user's preference matrix to understand their preferences
	prefMatrix, err := f.repo.GetUserPreferenceMatrix(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user preference matrix: %w", err)
	}

	// Find categories with low preference scores (opposite of user's preferences)
	lowPreferenceCategories := []string{}
	for category, score := range prefMatrix.CategoryScores {
		if score < 0.3 { // Low preference
			lowPreferenceCategories = append(lowPreferenceCategories, category)
		}
	}

	// If we don't have enough low-preference categories, use all categories
	if len(lowPreferenceCategories) < 3 {
		// In a real implementation, we would get all distinct categories
		// For now, use some common categories
		lowPreferenceCategories = []string{"technology", "entertainment", "sports", "news", "education", "lifestyle"}
	}

	// Get content from these low-preference categories
	return f.getContentFromCategoriesAndLanguages(ctx, lowPreferenceCategories, languages, currencies, limit)
}

// generateQueryHash generates a hash for query caching
func (f *FeedService) generateQueryHash(userID string, page int, pageSize int, language string, currency string, followedCategories []string, followedUsers []string) string {
	// Sort slices for consistent hashing
	sortedCats := make([]string, len(followedCategories))
	copy(sortedCats, followedCategories)
	sort.Strings(sortedCats)

	sortedUsers := make([]string, len(followedUsers))
	copy(sortedUsers, followedUsers)
	sort.Strings(sortedUsers)

	// Create hash string
	hashStr := fmt.Sprintf("%s:%d:%d:%s:%s:%v:%v",
		userID, page, pageSize, language, currency, sortedCats, sortedUsers)

	// Simple hash (in production, use proper cryptographic hash)
	hash := 0
	for i := 0; i < len(hashStr); i++ {
		hash = 31*hash + int(hashStr[i])
	}
	return fmt.Sprintf("%d", hash)
}

// extractFeedByType extracts feed items of a specific type from cached feed
func (f *FeedService) extractFeedByType(items []model.FeedItem, feedType string, page int, pageSize int) *FeedItems {
	var filteredItems []model.FeedItem

	for _, item := range items {
		// In a real implementation, we would have a feed type field
		// For now, we'll distribute items evenly across feed types
		// This is a simplification for the cache implementation
		filteredItems = append(filteredItems, item)
	}

	// Apply pagination
	start := (page - 1) * pageSize
	end := start + pageSize
	if start >= len(filteredItems) {
		start = len(filteredItems)
	}
	if end > len(filteredItems) {
		end = len(filteredItems)
	}

	paginatedItems := filteredItems[start:end]

	return &FeedItems{
		Items: paginatedItems,
		Total: len(filteredItems),
		Page:  page,
		Size:  len(paginatedItems),
	}
}

// isDuplicateFeedItem checks if a content UUID is already in the feed items
func (f *FeedService) isDuplicateFeedItem(items []model.FeedItem, uuid string) bool {
	for _, item := range items {
		if item.ID == uuid {
			return true
		}
	}
	return false
}

// containsString checks if a slice contains a string
func (f *FeedService) containsString(slice []string, str string) bool {
	for _, s := range slice {
		if s == str {
			return true
		}
	}
	return false
}

// removeDuplicates removes duplicate strings from a slice
func (f *FeedService) removeDuplicates(slice []string) []string {
	seen := make(map[string]bool)
	result := []string{}
	for _, item := range slice {
		if !seen[item] {
			seen[item] = true
			result = append(result, item)
		}
	}
	return result
}

// getOllamaScore calls the local Ollama model to get a relevance score for content based on user preferences
// Returns a score between 0.0 and 1.0, where higher means more relevant
func (f *FeedService) getOllamaScore(ctx context.Context, content *model.ContentItem, prefMatrix *model.UserPreferenceMatrix) float64 {
	// If AI is disabled, return neutral score
	if !f.cfg.AI.EnableCache { // Using EnableCache as a proxy for AI enabled; in reality we should have an Enable field
		return 0.5
	}

	// Prepare prompt for Ollama
	// Summarize user preferences: top categories, languages, etc.
	var topCategories []string
	for cat, score := range prefMatrix.CategoryScores {
		if score > 0.1 {
			topCategories = append(topCategories, fmt.Sprintf("%s (%.2f)", cat, score))
		}
	}
	// Sort by score descending
	sort.Slice(topCategories, func(i, j int) bool {
		return prefMatrix.CategoryScores[topCategories[i]] > prefMatrix.CategoryScores[topCategories[j]]
	})
	// Take top 3
	if len(topCategories) > 3 {
		topCategories = topCategories[:3]
	}

	var topLanguages []string
	for lang, score := range prefMatrix.LanguageScores {
		if score > 0.1 {
			topLanguages = append(topLanguages, fmt.Sprintf("%s (%.2f)", lang, score))
		}
	}
	// Sort by score descending
	sort.Slice(topLanguages, func(i, j int) bool {
		return prefMatrix.LanguageScores[topLanguages[i]] > prefMatrix.LanguageScores[topLanguages[j]]
	})
	// Take top 3
	if len(topLanguages) > 3 {
		topLanguages = topLanguages[:3]
	}

	var topCurrencies []string
	for curr, score := range prefMatrix.CurrencyScores {
		if score > 0.1 {
			topCurrencies = append(topCurrencies, fmt.Sprintf("%s (%.2f)", curr, score))
		}
	}
	// Sort by score descending
	sort.Slice(topCurrencies, func(i, j int) bool {
		return prefMatrix.CurrencyScores[topCurrencies[i]] > prefMatrix.CurrencyScores[topCurrencies[j]]
	})
	// Take top 3
	if len(topCurrencies) > 3 {
		topCurrencies = topCurrencies[:3]
	}

	prompt := fmt.Sprintf(`You are a recommendation system. Rate the relevance of the following content to the user's interests on a scale of 0.0 to 1.0, where 1.0 is highly relevant and 0.0 is not relevant at all.

User's interests:
- Top categories: %v
- Top languages: %v
- Top currencies: %v

Content:
Title: %s
Description: %s
Category: %s
Content type: %s
Language: %s
Currency: %s
Price: %.2f
Duration: %.0f seconds

Provide only a numeric score between 0.0 and 1.0 with up to 4 decimal places. Do not include any other text.`,
		strings.Join(topCategories, ", "),
		strings.Join(topLanguages, ", "),
		strings.Join(topCurrencies, ", "),
		content.Title,
		content.Description,
		content.Category,
		content.ContentType,
		content.Language,
		content.Currency,
		content.Price.InexactFloat64(),
		content.Duration,
	)

	// Prepare request to Ollama
	ollamaURL := f.cfg.AI.BaseURL + "/api/generate"
	requestBody := map[string]interface{}{
		"model":  f.cfg.AI.Model,
		"prompt": prompt,
		"stream": false,
		"options": map[string]interface{}{
			"temperature": f.cfg.AI.Temperature,
			"num_predict": 50, // We only need a short response
		},
	}
	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		log.Printf("Error marshalling Ollama request: %v", err)
		return 0.5
	}

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: f.cfg.AI.Timeout,
	}
	resp, err := client.Post(ollamaURL, "application/json", bytes.NewReader(jsonData))
	if err != nil {
		log.Printf("Error calling Ollama API: %v", err)
		return 0.5
	}
	defer resp.Body.Close()

	// Parse response
	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		log.Printf("Error decoding Ollama response: %v", err)
		return 0.5
	}

	// Extract score from response
	// We expect a string like "0.75" or "0.7532"
	scoreStr := strings.TrimSpace(ollamaResp.Response)
	// Remove any non-numeric characters except decimal point and minus
	// We'll just try to parse as float64
	var score float64
	_, err = fmt.Sscanf(scoreStr, "%f", &score)
	if err != nil {
		// If parsing fails, try to find a number in the string
		// For simplicity, we'll return default
		log.Printf("Could not parse score from Ollama response: %s", scoreStr)
		return 0.5
	}
	// Clamp score to [0,1]
	if score < 0 {
		score = 0
	} else if score > 1 {
		score = 1
	}
	return score
}

// min returns the minimum of two integers
func (f *FeedService) min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// FeedResponse represents the response from GetPersonalizedFeed
type FeedResponse struct {
	FollowingFeed *FeedItems `json:"following_feed"`
	TrendingFeed  *FeedItems `json:"trending_feed"`
	DiscoveryFeed *FeedItems `json:"discovery_feed"`
	Page          int        `json:"page"`
	PageSize      int        `json:"page_size"`
	TotalResults  int        `json:"total_results"`
	FromCache     bool       `json:"from_cache"`
	GeneratedAt   time.Time  `json:"generated_at"`
}

// FeedItems represents a paginated list of feed items
type FeedItems struct {
	Items []model.FeedItem `json:"items"`
	Total int              `json:"total"`
	Page  int              `json:"page"`
	Size  int              `json:"size"`
}
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"gorm.io/gorm"

	"newproject/services/recommendation-service/src/model"
)

// RecommendationRepository handles all data access for the recommendation engine
// Implements PostgreSQL full-text search with tsvector/tsquery
type RecommendationRepository struct {
	db *gorm.DB
	sqlxDB *sqlx.DB
}

// NewRecommendationRepository creates a new repository instance
func NewRecommendationRepository(db *gorm.DB) *RecommendationRepository {
	sqlxDB := sqlx.NewDb(db.ConnPool.(*sql.DB), "postgres")
	return &RecommendationRepository{
		db: db,
		sqlxDB: sqlxDB,
	}
}

// GetUserPreferenceMatrix retrieves or creates a user's preference matrix
func (r *RecommendationRepository) GetUserPreferenceMatrix(ctx context.Context, userID string) (*model.UserPreferenceMatrix, error) {
	var pref model.UserPreferenceMatrix
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		First(&pref).Error
	
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Create new preference matrix for user
			pref = model.UserPreferenceMatrix{
				UserID: userID,
				CategoryScores: make(map[string]float64),
				LanguageScores: make(map[string]float64),
				CurrencyScores: make(map[string]float64),
				ContentTypeMap: make(map[string]float64),
				TemporalPatterns: make(map[string]interface{}),
				EngagementHistory: make(map[string]interface{}),
				SearchHistory: []string{},
				FollowedUsers: []string{},
				FollowedCategories: []string{},
			}
			
			err = r.db.WithContext(ctx).Create(&pref).Error
			if err != nil {
				return nil, fmt.Errorf("failed to create user preference matrix: %w", err)
			}
			return &pref, nil
		}
		return nil, fmt.Errorf("failed to get user preference matrix: %w", err)
	}
	
	return &pref, nil
}

// UpdateUserPreferenceMatrix updates a user's preference matrix
func (r *RecommendationRepository) UpdateUserPreferenceMatrix(ctx context.Context, pref *model.UserPreferenceMatrix) error {
	return r.db.WithContext(ctx).
		Model(pref).
		Where("user_id = ?", pref.UserID).
		Updates(map[string]interface{}{
			"category_scores": pref.CategoryScores,
			"language_scores": pref.LanguageScores,
			"currency_scores": pref.CurrencyScores,
			"content_type_map": pref.ContentTypeMap,
			"temporal_patterns": pref.TemporalPatterns,
			"engagement_history": pref.EngagementHistory,
			"search_history": pref.SearchHistory,
			"followed_users": pref.FollowedUsers,
			"followed_categories": pref.FollowedCategories,
			"last_updated": time.Now(),
		}).Error
}

// GetUserCategoryInterests retrieves user's explicit category interests
func (r *RecommendationRepository) GetUserCategoryInterests(ctx context.Context, userID string) ([]model.UserCategoryInterest, error) {
	var interests []model.UserCategoryInterest
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("interest desc").
		Find(&interests).Error
	return interests, err
}

// UpdateUserCategoryInterest updates or creates a user's category interest
func (r *RecommendationRepository) UpdateUserCategoryInterest(ctx context.Context, interest *model.UserCategoryInterest) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND category = ?", interest.UserID, interest.Category).
		Assign(model.UserCategoryInterest{
			Interest: interest.Interest,
			Weight: interest.Weight,
			Source: interest.Source,
			LastSeen: interest.LastSeen,
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(interest).Error
}

// GetWatchDurationCurves retrieves watch duration data for a user
func (r *RecommendationRepository) GetWatchDurationCurves(ctx context.Context, userID string, limit int) ([]model.WatchDurationCurve, error) {
	var curves []model.WatchDurationCurve
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at desc").
		Limit(limit).
		Find(&curves).Error
	return curves, err
}

// SaveWatchDurationCurve saves watch duration data
func (r *RecommendationRepository) SaveWatchDurationCurve(ctx context.Context, curve *model.WatchDurationCurve) error {
	return r.db.WithContext(ctx).Create(curve).Error
}

// GetContentItems retrieves content items with optional filtering
func (r *RecommendationRepository) GetContentItems(ctx context.Context, category string, contentType string, language string, limit int, offset int) ([]model.ContentItem, error) {
	var items []model.ContentItem
	query := r.db.WithContext(ctx).Model(&model.ContentItem{}).Where("is_active = true")
	
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if contentType != "" {
		query = query.Where("content_type = ?", contentType)
	}
	if language != "" {
		query = query.Where("language = ?", language)
	}
	
	err := query.
		Order("publish_date desc").
		Limit(limit).
		Offset(offset).
		Find(&items).Error
		
	return items, err
}

// GetContentItemByUUID retrieves a content item by its UUID
func (r *RecommendationRepository) GetContentItemByUUID(ctx context.Context, uuid string) (*model.ContentItem, error) {
	var item model.ContentItem
	err := r.db.WithContext(ctx).
		Where("uuid = ? AND is_active = true", uuid).
		First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

// SearchContentFullText performs PostgreSQL full-text search using tsvector/tsquery
func (r *RecommendationRepository) SearchContentFullText(ctx context.Context, query string, language string, limit int, offset int) ([]model.ContentItem, error) {
	var items []model.ContentItem
	
	// Clean and prepare the search query
	cleanQuery := strings.TrimSpace(query)
	if cleanQuery == "" {
		return []model.ContentItem{}, nil
	}
	
	// Convert to tsquery format: replace spaces with & for AND operation, | for OR
	tsQuery := strings.ReplaceAll(cleanQuery, " ", " & ")
	if tsQuery == "" {
		tsQuery = cleanQuery
	}
	
	// Use raw SQL for PostgreSQL full-text search
	sqlQuery := `
		SELECT ci.*,
			ts_rank_cd(ci.search_vector, plainto_tsquery($1, $2)) as rank
		FROM content_items ci
		WHERE ci.is_active = true
			AND ci.search_vector @@ plainto_tsquery($1, $2)
			AND ($3 = '' OR ci.language = $3)
		ORDER BY rank DESC, ci.publish_date DESC
		LIMIT $4 OFFSET $5
	`
	
	err := r.sqlxDB.SelectContext(ctx, &items, sqlQuery, language, tsQuery, language, limit, offset)
	if err != nil {
		// Fallback to ILIKE search if tsvector fails
		log.Printf("Full-text search failed, falling back to ILIKE: %v", err)
		return r.SearchContentFallback(ctx, query, language, limit, offset)
	}
	
	return items, nil
}

// SearchContentFallback provides fallback search using ILIKE when tsvector is not available
func (r *RecommendationRepository) SearchContentFallback(ctx context.Context, query string, language string, limit int, offset int) ([]model.ContentItem, error) {
	var items []model.ContentItem
	
	searchTerm := "%" + query + "%"
	queryBuilder := r.db.WithContext(ctx).
		Model(&model.ContentItem{}).
		Where("is_active = true").
		Where("(title ILIKE ? OR description ILIKE ?)", searchTerm, searchTerm)
	
	if language != "" {
		queryBuilder = queryBuilder.Where("language = ?", language)
	}
	
	err := r.db.WithContext(ctx).
		Model(&model.ContentItem{}).
		Where("is_active = true").
		Where("(title ILIKE ? OR description ILIKE ?)", searchTerm, searchTerm).
		Order("publish_date desc").
		Limit(limit).
		Offset(offset).
		Find(&items).Error
		
	return items, err
}

// UpdateContentSearchVector updates the tsvector search vector for content
func (r *RecommendationRepository) UpdateContentSearchVector(ctx context.Context, contentID uint, language string) error {
	// Update the search_vector column using PostgreSQL's to_tsvector function
	sql := `
		UPDATE content_items 
		SET search_vector = 
			setweight(to_tsvector($1, coalesce(title, '')), 'A') ||
			setweight(to_tsvector($1, coalesce(description, '')), 'B') ||
			setweight(to_tsvector($1, coalesce(array_to_string(tags, ' '), '')), 'C')
		WHERE id = $2
	`
	
	result := r.db.WithContext(ctx).Exec(sql, language, contentID)
	return result.Error
}

// BulkUpdateSearchVectors updates search vectors for multiple content items
func (r *RecommendationRepository) BulkUpdateSearchVectors(ctx context.Context, language string) error {
	sql := `
		UPDATE content_items 
		SET search_vector = 
			setweight(to_tsvector($1, coalesce(title, '')), 'A') ||
			setweight(to_tsvector($1, coalesce(description, '')), 'B') ||
			setweight(to_tsvector($1, coalesce(array_to_string(tags, ' '), '')), 'C')
		WHERE is_active = true
			AND ($1 = '' OR language = $1)
	`
	
	result := r.db.WithContext(ctx).Exec(sql, language)
	return result.Error
}

// GetFeedCache retrieves cached feed for a user
func (r *RecommendationRepository) GetFeedCache(ctx context.Context, userID string, feedType string, queryHash string) (*model.FeedCache, error) {
	var cache model.FeedCache
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND feed_type = ? AND query_hash = ? AND expires_at > NOW()", 
			userID, feedType, queryHash).
		First(&cache).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &cache, nil
}

// SaveFeedCache saves a personalized feed to cache
func (r *RecommendationRepository) SaveFeedCache(ctx context.Context, cache *model.FeedCache) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND feed_type = ? AND query_hash = ?", 
			cache.UserID, cache.FeedType, cache.QueryHash).
		Assign(model.FeedCache{
			FeedData: cache.FeedData,
			Score: cache.Score,
			ExpiresAt: cache.ExpiresAt,
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(cache).Error
}

// GetUserInteractions retrieves user's interaction history
func (r *RecommendationRepository) GetUserInteractions(ctx context.Context, userID string, interactionType string, limit int) ([]model.UserInteraction, error) {
	var interactions []model.UserInteraction
	query := r.db.WithContext(ctx).
		Where("user_id = ?", userID)
	
	if interactionType != "" {
		query = query.Where("interaction_type = ?", interactionType)
	}
	
	err := query.
		Order("created_at desc").
		Limit(limit).
		Find(&interactions).Error
	return interactions, err
}

// SaveUserInteraction saves a user interaction
func (r *RecommendationRepository) SaveUserInteraction(ctx context.Context, interaction *model.UserInteraction) error {
	return r.db.WithContext(ctx).Create(interaction).Error
}

// GetLanguagePreferences retrieves user's language preferences
func (r *RecommendationRepository) GetLanguagePreferences(ctx context.Context, userID string) ([]model.LanguagePreference, error) {
	var prefs []model.LanguagePreference
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("preference desc").
		Find(&prefs).Error
	return prefs, err
}

// UpdateLanguagePreference updates or creates a language preference
func (r *RecommendationRepository) UpdateLanguagePreference(ctx context.Context, pref *model.LanguagePreference) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND language = ?", pref.UserID, pref.Language).
		Assign(model.LanguagePreference{
			Preference: pref.Preference,
			Confidence: pref.Confidence,
			Source: pref.Source,
			LastUsed: pref.LastUsed,
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(pref).Error
}

// GetCurrencyPreferences retrieves user's currency preferences
func (r *RecommendationRepository) GetCurrencyPreferences(ctx context.Context, userID string) ([]model.CurrencyPreference, error) {
	var prefs []model.CurrencyPreference
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("preference desc").
		Find(&prefs).Error
	return prefs, err
}

// UpdateCurrencyPreference updates or creates a currency preference
func (r *RecommendationRepository) UpdateCurrencyPreference(ctx context.Context, pref *model.CurrencyPreference) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND currency = ?", pref.UserID, pref.Currency).
		Assign(model.CurrencyPreference{
			Preference: pref.Preference,
			Confidence: pref.Confidence,
			Source: pref.Source,
			LastUsed: pref.LastUsed,
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(pref).Error
}

// GetTrendingScores retrieves trending scores for content
func (r *RecommendationRepository) GetTrendingScores(ctx context.Context, contentIDs []string, limit int) ([]model.TrendingScore, error) {
	var scores []model.TrendingScore
	query := r.db.WithContext(ctx).
		Where("calculated_at > NOW() - INTERVAL '24 hours'")
	
	if len(contentIDs) > 0 {
		query = query.Where("content_id IN ?", contentIDs)
	}
	
	err := query.
		Order("score desc").
		Limit(limit).
		Find(&scores).Error
	return scores, err
}

// SaveTrendingScore saves or updates a trending score
func (r *RecommendationRepository) SaveTrendingScore(ctx context.Context, score *model.TrendingScore) error {
	return r.db.WithContext(ctx).
		Where("content_id = ?", score.ContentID).
		Assign(model.TrendingScore{
			Score: score.Score,
			ViewCount24h: score.ViewCount24h,
			LikeCount24h: score.LikeCount24h,
			ShareCount24h: score.ShareCount24h,
			CommentCount24h: score.CommentCount24h,
			CalculatedAt: score.CalculatedAt,
			ExpiresAt: score.ExpiresAt,
		}).
		FirstOrCreate(score).Error
}

// GetDiscoveryCandidates retrieves discovery candidates for a user
func (r *RecommendationRepository) GetDiscoveryCandidates(ctx context.Context, userID string, limit int) ([]model.DiscoveryCandidate, error) {
	var candidates []model.DiscoveryCandidate
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("score desc").
		Limit(limit).
		Find(&candidates).Error
	return candidates, err
}

// SaveDiscoveryCandidate saves or updates a discovery candidate
func (r *RecommendationRepository) SaveDiscoveryCandidate(ctx context.Context, candidate *model.DiscoveryCandidate) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND content_id = ?", candidate.UserID, candidate.ContentID).
		Assign(model.DiscoveryCandidate{
			Score: candidate.Score,
			SimilarityScore: candidate.SimilarityScore,
			DiversityScore: candidate.DiversityScore,
			NoveltyScore: candidate.NoveltyScore,
			CalculatedAt: time.Now(),
		}).
		FirstOrCreate(candidate).Error
}

// DeleteExpiredFeedCache removes expired feed cache entries
func (r *RecommendationRepository) DeleteExpiredFeedCache(ctx context.Context) error {
	result := r.db.WithContext(ctx).
		Where("expires_at <= NOW()").
		Delete(&model.FeedCache{})
	return result.Error
}

// GetContentCount returns total count of active content items
func (r *RecommendationRepository) GetContentCount(ctx context.Context, category string, contentType string, language string) (int64, error) {
	var count int64
	query := r.db.WithContext(ctx).
		Model(&model.ContentItem{}).
		Where("is_active = true")
	
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if contentType != "" {
		query = query.Where("content_type = ?", contentType)
	}
	if language != "" {
		query = query.Where("language = ?", language)
	}
	
	err := query.Count(&count).Error
	return count, err
}

// HealthCheck verifies database connectivity
func (r *RecommendationRepository) HealthCheck(ctx context.Context) error {
	return r.db.WithContext(ctx).Raw("SELECT 1").Error
}
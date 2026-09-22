package model

import (
	"time"
	"github.com/shopspring/decimal"
)

// UserPreferenceMatrix represents the user's preference scoring matrix
// Tracks user preferences across categories, languages, currencies, and content types
// Core intelligence layer for personalized recommendations
type UserPreferenceMatrix struct {
	ID              uint                  `gorm:"primarykey" json:"id"`
	UserID          string                `gorm:"type:varchar(100);not null;index" json:"user_id"`
	CategoryScores  map[string]float64    `gorm:"type:text;serializer:json" json:"category_scores"`      // Category preference scores
	LanguageScores  map[string]float64    `gorm:"type:text;serializer:json" json:"language_scores"`      // Language preference scores  
	CurrencyScores  map[string]float64    `gorm:"type:text;serializer:json" json:"currency_scores"`      // Currency preference scores
	ContentTypeMap  map[string]float64    `gorm:"type:text;serializer:json" json:"content_type_map"`     // Content type preferences
	TemporalPatterns map[string]interface{} `gorm:"type:text;serializer:json" json:"temporal_patterns"`    // Time-based preference patterns
	EngagementHistory map[string]interface{} `gorm:"type:text;serializer:json" json:"engagement_history"`   // Historical engagement data
	SearchHistory   []string              `gorm:"type:text" json:"search_history"`                       // Recent search queries
	FollowedUsers   []string              `gorm:"type:text" json:"followed_users"`                       // Followed user IDs
	FollowedCategories []string             `gorm:"type:text" json:"followed_categories"`                  // Followed category IDs
	LastUpdated     time.Time             `gorm:"autoUpdateTime" json:"last_updated"`
	CreatedAt       time.Time             `gorm:"autoCreateTime" json:"created_at"`
}

func (UserPreferenceMatrix) TableName() string {
	return "user_preference_matrices"
}

// UserCategoryInterest tracks explicit user interests in specific categories
// Users can explicitly follow/unfollow categories for better personalization
type UserCategoryInterest struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	Category  string         `gorm:"type:varchar(100);not null;index" json:"category"`
	Interest  float64        `gorm:"type:numeric(5,4);not null" json:"interest"` // 0.0 to 1.0
	Weight    float64        `gorm:"type:numeric(5,4);default:1.0" json:"weight"` // Interest weight
	Source    string         `gorm:"type:varchar(50);default:'explicit'" json:"source"` // explicit, inferred, ai_suggested
	LastSeen  time.Time      `gorm:"not null" json:"last_seen"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (UserCategoryInterest) TableName() string {
	return "user_category_interests"
}

// WatchDurationCurve tracks user's watch duration patterns for content
// Maps content attributes to actual watch duration for engagement scoring
type WatchDurationCurve struct {
	ID              uint           `gorm:"primarykey" json:"id"`
	UserID          string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	ContentID       string         `gorm:"type:varchar(100);not null;index" json:"content_id"`
	Category        string         `gorm:"type:varchar(100);not null" json:"category"`
	ContentType     string         `gorm:"type:varchar(50)" json:"content_type"` // video, article, live, etc.
	DurationWatched float64        `gorm:"type:numeric(10,4);not null" json:"duration_watched"` // Actual watched seconds
	DurationTotal   float64        `gorm:"type:numeric(10,4);not null" json:"duration_total"`   // Total content duration
	CompletionRate  float64        `gorm:"type:numeric(5,4)" json:"completion_rate"`             // DurationWatched/DurationTotal
	EngagementScore float64        `gorm:"type:numeric(10,4)" json:"engagement_score"`           // Calculated engagement score
	DeviceType      string         `gorm:"type:varchar(50)" json:"device_type"`                  // mobile, desktop, tablet
	NetworkType     string         `gorm:"type:varchar(50)" json:"network_type"`                 // wifi, 4g, 5g
	TimeOfDay       string         `gorm:"type:varchar(20)" json:"time_of_day"`                  // morning, afternoon, evening, night
	DayOfWeek       string         `gorm:"type:varchar(20)" json:"day_of_week"`                  // monday, tuesday, etc.
	Season          string         `gorm:"type:varchar(20)" json:"season"`                       // spring, summer, autumn, winter
	CreatedAt       time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (WatchDurationCurve) TableName() string {
	return "watch_duration_curves"
}

// ContentItem represents content items in the catalog
// All content that can be recommended (videos, articles, live streams, etc.)
type ContentItem struct {
	ID              uint           `gorm:"primarykey" json:"id"`
	UUID            string         `gorm:"type:varchar(100);uniqueIndex;not null" json:"uuid"`
	Title           string         `gorm:"type:varchar(500);not null" json:"title"`
	Description     string         `gorm:"type:text" json:"description"`
	Category        string         `gorm:"type:varchar(100);not null;index" json:"category"`
	ContentType     string         `gorm:"type:varchar(50);not null" json:"content_type"` // video, article, live, podcast, etc.
	Language        string         `gorm:"type:varchar(10);not null" json:"language"`      // en, hi, es, etc.
	Currency        string         `gorm:"type:varchar(10);not null" json:"currency"`      // USD, INR, EUR, etc.
	Price           decimal.Decimal `gorm:"type:numeric(10,2);default:0" json:"price"`       // Price for paid content
	Duration        float64        `gorm:"type:numeric(10,4)" json:"duration"`              // Duration in seconds (for video/audio)
	ThumbnailURL    string         `gorm:"type:varchar(500)" json:"thumbnail_url"`          // Thumbnail image URL
	VideoURL        string         `gorm:"type:varchar(500)" json:"video_url"`              // Video streaming URL
	Tags            []string       `gorm:"type:text" json:"tags"`                            // Content tags for categorization
	Metadata        map[string]string `gorm:"type:text;serializer:json" json:"metadata"`        // Additional metadata
	SearchVector    string         `gorm:"type:text" json:"-"`                               // tsvector for full-text search (indexed)
	IsActive        bool           `gorm:"not null;default:true" json:"is_active"`
	IsFeatured      bool           `gorm:"default:false" json:"is_featured"`
	PublishDate     time.Time      `gorm:"not null" json:"publish_date"`
	ExpiresAt       *time.Time     `json:"expires_at,omitempty"`                             // Optional expiration
	TrendingScore   float64        `gorm:"type:numeric(10,4);default:0" json:"trending_score"` // Calculated trending score
	ViewCount       uint64         `gorm:"default:0" json:"view_count"`                      // Total views
	LikeCount       uint64         `gorm:"default:0" json:"like_count"`                      // Total likes
	ShareCount      uint64         `gorm:"default:0" json:"share_count"`                     // Total shares
	CommentCount    uint64         `gorm:"default:0" json:"comment_count"`                   // Total comments
	CreatedAt       time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (ContentItem) TableName() string {
	return "content_items"
}

// FeedCache stores pre-computed personalized feeds for performance
// Caches personalized feeds to reduce computation load
type FeedCache struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UserID      string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	FeedType    string         `gorm:"type:varchar(50);not null" json:"feed_type"` // following, trending, discovery
	FeedData    []FeedItem     `gorm:"type:text;serializer:json" json:"feed_data"`   // Serialized feed items
	Score       float64        `gorm:"type:numeric(10,4)" json:"score"`              // Overall feed relevance score
	ExpiresAt   time.Time      `gorm:"not null" json:"expires_at"`                   // When cache expires
	QueryHash   string         `gorm:"type:varchar(100);not null;index" json:"query_hash"` // Hash of query parameters
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (FeedCache) TableName() string {
	return "feed_caches"
}

// SearchIndex maintains full-text search indexes for content
// PostgreSQL tsvector/tsquery based search indexing
type SearchIndex struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	ContentID   uint           `gorm:"not null;index" json:"content_id"`
	Term        string         `gorm:"type:varchar(200);not null" json:"term"`          // Search term
	SearchVector string        `gorm:"type:text" json:"-"`                               // tsvector of content
	RankScore   float64        `gorm:"type:numeric(10,4)" json:"rank_score"`             // Relevance score for term
	Language    string         `gorm:"type:varchar(10);not null" json:"language"`        // Language of content
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (SearchIndex) TableName() string {
	return "search_indexes"
}

// UserInteraction tracks user interactions with content
// Likes, shares, comments, watches, skips, etc.
type UserInteraction struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	UserID        string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	ContentID     string         `gorm:"type:varchar(100);not null;index" json:"content_id"`
	InteractionType string       `gorm:"type:varchar(50);not null" json:"interaction_type"` // like, share, comment, watch, skip, etc.
	InteractionValue float64     `gorm:"type:numeric(10,4)" json:"interaction_value"`      // Numeric value of interaction
	ContextData   map[string]string `gorm:"type:text;serializer:json" json:"context_data"`    // Additional context (device, location, etc.)
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (UserInteraction) TableName() string {
	return "user_interactions"
}

// LanguagePreference tracks user's language preferences
// Derived from user behavior and explicit settings
type LanguagePreference struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	Language  string         `gorm:"type:varchar(10);not null" json:"language"`
	Preference float64       `gorm:"type:numeric(5,4)" json:"preference"` // 0.0 to 1.0
	Confidence float64      `gorm:"type:numeric(5,4)" json:"confidence"`  // Confidence in preference score
	Source    string         `gorm:"type:varchar(50)" json:"source"`       // explicit, detected, inferred
	LastUsed  time.Time      `gorm:"not null" json:"last_used"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (LanguagePreference) TableName() string {
	return "language_preferences"
}

// CurrencyPreference tracks user's currency preferences
// For pricing display and payment processing
type CurrencyPreference struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	Currency  string         `gorm:"type:varchar(10);not null" json:"currency"`
	Preference float64       `gorm:"type:numeric(5,4)" json:"preference"` // 0.0 to 1.0
	Confidence float64      `gorm:"type:numeric(5,4)" json:"confidence"`  // Confidence in preference score
	Source    string         `gorm:"type:varchar(50)" json:"source"`       // explicit, detected, inferred
	LastUsed  time.Time      `gorm:"not null" json:"last_used"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (CurrencyPreference) TableName() string {
	return "currency_preferences"
}

// FeedItem represents a single item in a personalized feed
type FeedItem struct {
	ID             string         `json:"id"`                           // ContentItem UUID
	Title          string         `json:"title"`
	Description    string         `json:"description"`
	Category       string         `json:"category"`
	ContentType    string         `json:"content_type"`
	Language       string         `json:"language"`
	Currency       string         `json:"currency"`
	Price          float64        `json:"price"`
	Duration       float64        `json:"duration"`
	ThumbnailURL   string         `json:"thumbnail_url"`
	VideoURL       string         `json:"video_url"`
	Tags           []string       `json:"tags"`
	Score          float64        `json:"score"`                        // Overall relevance score
	FollowScore    float64        `json:"follow_score"`                 // Following-based score
	TrendingScore  float64        `json:"trending_score"`               // Trending-based score
	DiscoveryScore float64        `json:"discovery_score"`              // Discovery-based score
	SimilarityScore float64       `json:"similarity_score"`             // Similarity to user interests
	DiversityScore float64        `json:"diversity_score"`              // Diversity from usual content
	NoveltyScore   float64        `json:"novelty_score"`                // Novelty/new content factor
	PersonalizationScore float64   `json:"personalization_score"`        // Personalization score
	Metadata       map[string]string `json:"metadata"`                     // Additional metadata
	Reason         string         `json:"reason"`                       // Why this item is recommended
}

// TrendingScore tracks calculated trending scores for content
// Updated periodically based on recent engagement
type TrendingScore struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	ContentID   string         `gorm:"type:varchar(100);not null;index" json:"content_id"`
	Score       float64        `gorm:"type:numeric(10,4);not null" json:"score"`
	ViewCount24h uint64        `gorm:"default:0" json:"view_count_24h"`                  // Views in last 24h
	LikeCount24h uint64        `gorm:"default:0" json:"like_count_24h"`                  // Likes in last 24h
	ShareCount24h uint64       `gorm:"default:0" json:"share_count_24h"`                 // Shares in last 24h
	CommentCount24h uint64      `gorm:"default:0" json:"comment_count_24h"`               // Comments in last 24h
	CalculatedAt time.Time     `gorm:"not null" json:"calculated_at"`
	ExpiresAt   time.Time     `gorm:"not null" json:"expires_at"`                       // When score expires
}

func (TrendingScore) TableName() string {
	return "trending_scores"
}

// DiscoveryCandidate represents potential content for discovery feed
// Content that might be interesting to user based on similarity and diversity
type DiscoveryCandidate struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UserID      string         `gorm:"type:varchar(100);not null;index" json:"user_id"`
	ContentID   string         `gorm:"type:varchar(100);not null;index" json:"content_id"`
	Score       float64        `gorm:"type:numeric(10,4);not null" json:"score"`        // Overall discovery score
	SimilarityScore float64     `gorm:"type:numeric(10,4)" json:"similarity_score"`      // Similarity to user's interests
	DiversityScore float64     `gorm:"type:numeric(10,4)" json:"diversity_score"`       // Diversity from user's usual content
	NoveltyScore float64      `gorm:"type:numeric(10,4)" json:"novelty_score"`         // Novelty/new content factor
	CalculatedAt time.Time     `gorm:"not null" json:"calculated_at"`
}

func (DiscoveryCandidate) TableName() string {
	return "discovery_candidates"
}
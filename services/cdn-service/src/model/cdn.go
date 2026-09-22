package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CDNProvider represents the CDN provider type
type CDNProvider string

const (
	CDNProviderCloudFront CDNProvider = "cloudfront"
	CDNProviderCloudflare CDNProvider = "cloudflare"
	CDNProviderAkamai     CDNProvider = "akamai"
	CDNProviderFastly     CDNProvider = "fastly"
)

// CDNConfig represents a CDN configuration for a domain
type CDNConfig struct {
	gorm.Model
	UUID           uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name           string     `gorm:"size:100;not null" json:"name"`
	Provider       CDNProvider `gorm:"size:20;not null" json:"provider"`
	Domain         string     `gorm:"size:255;not null;uniqueIndex" json:"domain"`
	DistributionID string     `gorm:"size:100" json:"distribution_id"`
	OriginDomain   string     `gorm:"size:255;not null" json:"origin_domain"`
	OriginPath     string     `gorm:"size:500" json:"origin_path"`
	Enabled        bool       `gorm:"default:true" json:"enabled"`
	
	// CloudFront specific
	CloudFrontKeyPairID string `gorm:"size:100" json:"cloudfront_key_pair_id"`
	CloudFrontPrivateKey string `gorm:"type:text" json:"-"` // Encrypted
	
	// Cloudflare specific
	CloudflareZoneID string `gorm:"size:100" json:"cloudflare_zone_id"`
	CloudflareAPIKey string `gorm:"type:text" json:"-"` // Encrypted
	
	// Cache settings
	DefaultTTL    int  `gorm:"default:86400" json:"default_ttl"`    // 24 hours
	MaxTTL        int  `gorm:"default:31536000" json:"max_ttl"`     // 1 year
	MinTTL        int  `gorm:"default:0" json:"min_ttl"`            // 0 seconds
	Compress      bool `gorm:"default:true" json:"compress"`
	
	// Security settings
	RequireSignedURLs bool   `gorm:"default:false" json:"require_signed_urls"`
	AllowedIPs        string `gorm:"type:text" json:"allowed_ips"`  // JSON array of CIDR ranges
	BlockedCountries  string `gorm:"type:text" json:"blocked_countries"` // JSON array of country codes
	
	// Headers
	CustomHeaders string `gorm:"type:text" json:"custom_headers"` // JSON map
	
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (CDNConfig) TableName() string {
	return "cdn_configs"
}

// CDNCacheRule represents a cache behavior rule
type CDNCacheRule struct {
	gorm.Model
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CDNConfigID uint      `gorm:"not null;index" json:"cdn_config_id"`
	PathPattern string    `gorm:"size:500;not null" json:"path_pattern"` // e.g., "/videos/*", "/thumbnails/*"
	
	// Cache settings
	TTL         int  `gorm:"default:86400" json:"ttl"`
	AllowedMethods string `gorm:"size:100;default:'GET,HEAD'" json:"allowed_methods"` // JSON array
	CachedMethods  string `gorm:"size:100;default:'GET,HEAD'" json:"cached_methods"`   // JSON array
	
	// Forward settings
	ForwardHeaders string `gorm:"type:text" json:"forward_headers"` // JSON array
	ForwardQueryString bool `gorm:"default:false" json:"forward_query_string"`
	ForwardCookies string `gorm:"size:100" json:"forward_cookies"` // "none", "whitelist", "all"
	CookieWhitelist string `gorm:"type:text" json:"cookie_whitelist"` // JSON array
	
	// Compression
	Compress bool `gorm:"default:true" json:"compress"`
	
	// Priority (higher = more specific)
	Priority int `gorm:"default:0" json:"priority"`
	
	Enabled bool `gorm:"default:true" json:"enabled"`
	
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (CDNCacheRule) TableName() string {
	return "cdn_cache_rules"
}

// CDNInvalidation represents a cache invalidation request
type CDNInvalidation struct {
	gorm.Model
	UUID           uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CDNConfigID    uint      `gorm:"not null;index" json:"cdn_config_id"`
	InvalidationID string    `gorm:"size:100;uniqueIndex" json:"invalidation_id"` // Provider's invalidation ID
	Paths          string    `gorm:"type:text;not null" json:"paths"` // JSON array of paths
	
	Status         string    `gorm:"size:20;default:'pending'" json:"status"` // pending, in_progress, completed, failed
	ErrorMessage   string    `gorm:"type:text" json:"error_message"`
	
	RequestedBy    uint      `gorm:"index" json:"requested_by"` // User ID who requested
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (CDNInvalidation) TableName() string {
	return "cdn_invalidations"
}

// CDNSignedURL represents a signed URL for private content
type CDNSignedURL struct {
	gorm.Model
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CDNConfigID uint      `gorm:"not null;index" json:"cdn_config_id"`
	
	ResourcePath string    `gorm:"size:500;not null" json:"resource_path"`
	SignedURL    string    `gorm:"type:text;not null" json:"signed_url"`
	ExpiresAt    time.Time `gorm:"not null;index" json:"expires_at"`
	
	IPRestriction string    `gorm:"size:100" json:"ip_restriction"` // Single IP or CIDR
	
	Used         bool      `gorm:"default:false" json:"used"`
	UsedAt       *time.Time `json:"used_at,omitempty"`
	UsedBy       *uint     `json:"used_by,omitempty"` // User ID
	
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (CDNSignedURL) TableName() string {
	return "cdn_signed_urls"
}

// CDNAnalytics represents CDN usage analytics
type CDNAnalytics struct {
	gorm.Model
	CDNConfigID uint      `gorm:"not null;index" json:"cdn_config_id"`
	Date        time.Time `gorm:"index;not null" json:"date"`
	
	// Traffic metrics
	Requests        int64   `gorm:"default:0" json:"requests"`
	BytesTransferred int64  `gorm:"default:0" json:"bytes_transferred"`
	
	// Cache metrics
	CacheHits       int64   `gorm:"default:0" json:"cache_hits"`
	CacheMisses     int64   `gorm:"default:0" json:"cache_misses"`
	CacheHitRatio   float64 `gorm:"type:numeric(10,4);default:0" json:"cache_hit_ratio"`
	
	// Error metrics
	Error4xx        int64   `gorm:"default:0" json:"error_4xx"`
	Error5xx        int64   `gorm:"default:0" json:"error_5xx"`
	
	// Geographic
	TopCountries string `gorm:"type:text" json:"top_countries"` // JSON map
	
	// Performance
	AvgLatencyMs float64 `gorm:"type:numeric(10,2);default:0" json:"avg_latency_ms"`
	P95LatencyMs float64 `gorm:"type:numeric(10,2);default:0" json:"p95_latency_ms"`
	
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (CDNAnalytics) TableName() string {
	return "cdn_analytics"
}

// VideoCDNMapping represents the mapping between video content and CDN
type VideoCDNMapping struct {
	gorm.Model
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	VideoID     string    `gorm:"size:100;not null;index" json:"video_id"`
	CDNConfigID uint      `gorm:"not null;index" json:"cdn_config_id"`
	
	// Content paths
	HLSPath       string `gorm:"size:500" json:"hls_path"`        // /videos/{id}/hls/
	DASHPath      string `gorm:"size:500" json:"dash_path"`       // /videos/{id}/dash/
	ThumbnailPath string `gorm:"size:500" json:"thumbnail_path"`  // /thumbnails/{id}/
	SpritePath    string `gorm:"size:500" json:"sprite_path"`     // /sprites/{id}/
	SubtitlePath  string `gorm:"size:500" json:"subtitle_path"`   // /subtitles/{id}/
	
	// Signed URL settings
	RequireSignedURL bool `gorm:"default:false" json:"require_signed_url"`
	SignedURLTTL     int  `gorm:"default:3600" json:"signed_url_ttl"` // 1 hour default
	
	// Geo restrictions
	AllowedCountries string `gorm:"type:text" json:"allowed_countries"` // JSON array
	BlockedCountries string `gorm:"type:text" json:"blocked_countries"` // JSON array
	
	Enabled bool `gorm:"default:true" json:"enabled"`
	
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (VideoCDNMapping) TableName() string {
	return "video_cdn_mappings"
}
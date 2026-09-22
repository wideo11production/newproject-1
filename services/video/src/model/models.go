package model

import (
	"time"
)

// TrackType represents the type of track (video, audio, etc.)
type TrackType string

const (
	TrackTypeVideo TrackType = "video"
	TrackTypeAudio TrackType = "audio"
)

// Track represents a timeline track
type Track struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	ProjectID uint           `gorm:"not null" json:"project_id"`
	Name      string         `gorm:"type:text;not null" json:"name"`
	TrackType TrackType      `gorm:"type:text;not null" json:"track_type"`
	Position  int            `gorm:"not null" json:"position"` // Order in the timeline (0-based)
	IsLocked  bool           `gorm:"not null;default:false" json:"is_locked"`
	IsVisible bool           `gorm:"not null;default:true" json:"is_visible"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Track) TableName() string {
	return "tracks"
}

// Clip represents a media clip on a track
type Clip struct {
	ID          uint           `gorm:"primarykey" json:"-"`
	TrackID     uint           `gorm:"not null" json:"track_id"`
	AssetID     string         `gorm:"type:text;not null" json:"asset_id"` // Reference to asset in MinIO or database
	Name        string         `gorm:"type:text" json:"name"`
	StartTime   float64        `gorm:"not null" json:"start_time"` // In seconds
	EndTime     float64        `gorm:"not null" json:"end_time"`   // In seconds
	Duration    float64        `gorm:"not null" json:"duration"`   // In seconds (EndTime - StartTime)
	OffsetIn    float64        `gorm:"not null;default:0" json:"offset_in"` // Offset within the asset (for trimming)
	OffsetOut   float64        `gorm:"not null;default:0" json:"offset_out"` // Offset within the asset (for trimming)
	Volume      float64        `gorm:"not null;default:1.0" json:"volume"` // Volume level (0.0 to 1.0)
	IsSelected  bool           `gorm:"not null;default:false" json:"is_selected"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Clip) TableName() string {
	return "clips"
}

// Project represents a video editing project
type Project struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	UUID      string         `gorm:"type:text;uniqueIndex;not null" json:"uuid"`
	Name      string         `gorm:"type:text;not null" json:"name"`
	Duration  float64        `gorm:"not null" json:"duration"` // Total duration in seconds
	FPS       int            `gorm:"not null;default:30" json:"fps"` // Frames per second
	Width     int            `gorm:"not null;default:1920" json:"width"` // Video width
	Height    int            `gorm:"not null;default:1080" json:"height"` // Video height
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Project) TableName() string {
	return "projects"
}

// ThumbnailCache stores generated thumbnails for quick preview
type ThumbnailCache struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	ClipID    uint           `gorm:"not null" json:"clip_id"`
	FrameTime float64        `gorm:"not null" json:"frame_time"` // Time in seconds within the clip
	Width     int            `gorm:"not null" json:"width"`      // Thumbnail width
	Height    int            `gorm:"not null" json:"height"`     // Thumbnail height
	Data      []byte         `gorm:"type:blob;not null" json:"-"` // Thumbnail image data (JPEG/PNG)
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

// TableName overrides the table name used by GORM
func (ThumbnailCache) TableName() string {
	return "thumbnail_caches"
}

// VideoFingerprint represents the visual fingerprint of a video clip
// Uses SHA256 hash and visual token for duplicate detection
// Essential for copyright protection and content moderation
type VideoFingerprint struct {
	ID           uint            `gorm:"primarykey" json:"id"`
	ClipID       string          `gorm:"type:varchar(255);not null;index" json:"clip_id"`
	VisualToken  string          `gorm:"type:varchar(50);not null;uniqueIndex" json:"visual_token"`
	SHA256Hash   string          `gorm:"type:varchar(64);not null;uniqueIndex" json:"sha256_hash"`
	Duration     float64         `gorm:"type:numeric(10,4);not null" json:"duration"`
	Width        int             `gorm:"not null" json:"width"`
	Height       int             `gorm:"not null" json:"height"`
	FrameCount   int             `gorm:"not null" json:"frame_count"`
	ColorPalette []string        `gorm:"type:text;serializer:json" json:"color_palette"`
	Metadata     map[string]string `gorm:"type:text;serializer:json" json:"metadata"`
	Status       string          `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (VideoFingerprint) TableName() string {
	return "video_fingerprints"
}

// AudioFingerprint represents the audio fingerprint for copyright protection
// Validates audio clips against stock audio ledger
// Essential for audio copyright compliance
type AudioFingerprint struct {
	ID         uint             `gorm:"primarykey" json:"id"`
	ClipID     string           `gorm:"type:varchar(255);not null;index" json:"clip_id"`
	AudioHash  string           `gorm:"type:varchar(64);not null;uniqueIndex" json:"audio_hash"`
	Duration   float64          `gorm:"type:numeric(10,4);not null" json:"duration"`
	SampleRate int              `gorm:"not null" json:"sample_rate"`
	Channels   int              `gorm:"not null" json:"channels"`
	BitDepth   int              `gorm:"not null" json:"bit_depth"`
	Metadata     map[string]string `gorm:"type:text;serializer:json" json:"metadata"`
	CreatedAt  time.Time        `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt  time.Time        `gorm:"autoUpdateTime" json:"updated_at"`
	Status     string           `gorm:"type:varchar(20);default:'pending'" json:"status"`
}

func (AudioFingerprint) TableName() string {
	return "audio_fingerprints"
}

// Target represents stock audio for licensing validation
// Tracks usage statistics and licensing requirements
// Essential for free stock audio ledger management
type Target struct {
	ID             uint            `gorm:"primarykey" json:"id"`
	AudioHash      string          `gorm:"type:varchar(64);not null;uniqueIndex" json:"audio_hash"`
	Title          string          `gorm:"type:varchar(255);not null" json:"title"`
	Artist         string          `gorm:"type:varchar(255);not null" json:"artist"`
	Genre          string          `gorm:"type:varchar(100)" json:"genre"`
	Duration       float64         `gorm:"type:numeric(10,4);not null" json:"duration"`
	IsLicensed     bool            `gorm:"not null;default:false" json:"is_licensed"`
	LicenseID      string          `gorm:"type:varchar(100)" json:"license_id"`
	LicenseType    string          `gorm:"type:varchar(50)" json:"license_type"`
	UsageCount     int             `gorm:"not null;default:0" json:"usage_count"`
	LastUsed       time.Time       `gorm:"autoUpdateTime" json:"last_used"`
	CreatedAt      time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
	Status         string          `gorm:"type:varchar(20);default:'active'" json:"status"`
}

func (Target) TableName() string {
	return "targets"
}

// ContentReport tracks copyright infringement reports
// Used for enforcement and dispute resolution
type ContentReport struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	ReporterID    string          `gorm:"type:varchar(100);not null" json:"reporter_id"`
	ClipID        string          `gorm:"type:varchar(255);not null;index" json:"clip_id"`
	Reason        string          `gorm:"type:varchar(500);not null" json:"reason"`
	Evidence      string          `gorm:"type:text" json:"evidence"`
	Status        string          `gorm:"type:varchar(20);default:'pending'" json:"status"`
	Priority      string          `gorm:"type:varchar(20);default:'normal'" json:"priority"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
	ResolvedBy    string          `gorm:"type:varchar(100)" json:"resolved_by"`
	Resolution    string          `gorm:"type:text" json:"resolution"`
}

func (ContentReport) TableName() string {
	return "content_reports"
}
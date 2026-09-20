package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TranscodeJob represents a video transcoding job
type TranscodeJob struct {
	ID           uint           `gorm:"primary_key;auto_increment" json:"-"`
	JobID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"job_id"`
	UploadID     uuid.UUID      `gorm:"type:uuid;not null;index" json:"upload_id"` // Links to upload service
	InputPath    string         `gorm:"size:500" json:"input_path"` // MinIO path to source file
	Status       string         `gorm:"size:20;default:'pending'" json:"status"` // pending, processing, completed, failed, cancelled
	Progress     float64        `gorm:"default:0" json:"progress"` // 0-100%
	CurrentStep  string         `gorm:"size:50" json:"current_step"` // e.g., "downloading", "transcoding_360p", "generating_manifest"
	ErrorMessage string         `gorm:"size:1000" json:"error_message,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	StartedAt    *time.Time     `json:"started_at,omitempty"`
	CompletedAt  *time.Time     `json:"completed_at,omitempty"`
}

// TableName specifies the table name for GORM
func (TranscodeJob) TableName() string {
	return "transcode_jobs"
}

// TranscodeOutput represents a generated output file (e.g., 360p video)
type TranscodeOutput struct {
	ID           uint           `gorm:"primary_key;auto_increment" json:"-"`
	JobID        uuid.UUID      `gorm:"type:uuid;not null;index" json:"job_id"`
	Resolution   string         `gorm:"size:20;not null" json:"resolution"` // e.g., "360p", "480p", "720p", "1080p"
	Format       string         `gorm:"size:20" json:"format"` // e.g., "HLS", "MP4"
	Path         string         `gorm:"size:500" json:"path"` // MinIO path to output
	Bitrate      int            `gorm:"not null" json:"bitrate"` // in kbps
	Framerate    float64        `gorm:"not null" json:"framerate"`
	FileSize     int64          `gorm:"not null" json:"file_size"` // in bytes
	Checksum     string         `gorm:"size:64" json:"checksum"` // SHA-256 for integrity
	CreatedAt    time.Time      `json:"created_at"`
}

// TableName specifies the table name for GORM
func (TranscodeOutput) TableName() string {
	return "transcode_outputs"
}

// TranscodeManifest represents an HLS manifest file
type TranscodeManifest struct {
	ID           uint           `gorm:"primary_key;auto_increment" json:"-"`
	JobID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"job_id"`
	ManifestType string         `gorm:"size:20;not null" json:"manifest_type"` // e.g., "HLS_MAIN", "HLS_360p"
	Path         string         `gorm:"size:500" json:"path"` // MinIO path to manifest
	Content      []byte         `gorm:"type:bytea;not null" json:"-"` // The actual manifest content
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// TableName specifies the table name for GORM
func (TranscodeManifest) TableName() string {
	return "transcode_manifests"
}

// Job status constants
const (
	JobStatusPending    = "pending"
	JobStatusProcessing = "processing"
	JobStatusCompleted  = "completed"
	JobStatusFailed     = "failed"
	JobStatusCancelled  = "cancelled"
)

// Step constants
const (
	StepDownloading    = "downloading"
	StepTranscoding    = "transcoding"
	StepGeneratingManifest = "generating_manifest"
	StepUploading      = "uploading"
	StepCompleted      = "completed"
)

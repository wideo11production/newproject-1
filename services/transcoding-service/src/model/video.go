package model

import (
	"time"

	"github.com/google/uuid"
)

type Video struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID        uint           `gorm:"not null;index" json:"user_id"`
	Title         string         `gorm:"type:text;not null" json:"title"`
	Description   string         `gorm:"type:text" json:"description"`
	Filename      string         `gorm:"type:text" json:"filename"`
	ContentType   string         `gorm:"type:text" json:"content_type"`
	FileSize      int64          `gorm:"not null" json:"file_size"`
	MinioPath     string         `gorm:"type:text" json:"minio_path"`
	Status        string         `gorm:"default:'uploaded'" json:"status"`
	Duration      float64        `json:"duration"`
	Resolution    string         `gorm:"default:'0x0'" json:"resolution"`
	ProcessingJobID string       `gorm:"type:text" json:"processing_job_id"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	PublishedAt   *time.Time     `json:"published_at,omitempty"`
}

func (Video) TableName() string {
	return "videos"
}

type QualityVariant struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	VideoID       uint           `gorm:"not null;index" json:"video_id"`
	Resolution    string         `gorm:"type:text;not null" json:"resolution"`
	Bitrate       int            `gorm:"not null" json:"bitrate"`
	Codec         string         `gorm:"type:text" json:"codec"`
	MinioPath     string         `gorm:"type:text;not null" json:"minio_path"`
	IndexFile     string         `gorm:"type:text" json:"index_file"`
	Status        string         `gorm:"default:'processing'" json:"status"`
	FileSize      int64          `json:"file_size"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (QualityVariant) TableName() string {
	return "quality_variants"
}

type TranscodingJob struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	VideoID       uint           `gorm:"not null;index" json:"video_id"`
	Status        string         `gorm:"default:'queued'" json:"status"`
	Progress      float64        `gorm:"default:0" json:"progress"`
	Error         string         `gorm:"type:text" json:"error,omitempty"`
	StartedAt     *time.Time     `json:"started_at,omitempty"`
	CompletedAt   *time.Time     `json:"completed_at,omitempty"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (TranscodingJob) TableName() string {
	return "transcoding_jobs"
}

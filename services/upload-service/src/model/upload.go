package model

import (
	"time"

	"github.com/google/uuid"
)

type UploadSession struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID      uint           `gorm:"not null;index" json:"user_id"`
	Filename    string         `gorm:"type:text;not null" json:"filename"`
	ContentType string         `gorm:"type:text;not null" json:"content_type"`
	FileSize    int64          `gorm:"not null" json:"file_size"`
	TotalChunks int            `gorm:"not null" json:"total_chunks"`
	UploadedChunks int         `gorm:"default:0" json:"uploaded_chunks"`
	Status      string         `gorm:"default:'pending'" json:"status"`
	UploadURL   string         `gorm:"type:text" json:"upload_url"`
	MinioPath   string         `gorm:"type:text" json:"minio_path"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	ExpiresAt   time.Time       `json:"expires_at"`
}

func (UploadSession) TableName() string {
	return "upload_sessions"
}

type UploadChunk struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	SessionID uint           `gorm:"not null;index" json:"session_id"`
	ChunkNumber int          `gorm:"not null" json:"chunk_number"`
	Size      int64          `gorm:"not null" json:"size"`
	MinioKey  string         `gorm:"type:text;not null" json:"minio_key"`
	UploadedAt time.Time     `gorm:"autoCreateTime" json:"uploaded_at"`
}

func (UploadChunk) TableName() string {
	return "upload_chunks"
}

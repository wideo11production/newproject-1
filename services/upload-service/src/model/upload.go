package model

import (
	"time"

	"github.com/google/uuid"
)

// STORAGE LAW (user directive — Conflict 3 answer): upload
// volume UNLIMITED hai. Schema mein koi hard storage threshold,
// size limit, ya quota column nahi — aur intentionally nahi
// bhi hoga. YouTube model: plans monthly subscription hain,
// storage sell nahi hoti. Channel-creation restriction bhi
// nahi — restriction lage to users naye channels banate hain,
// jisse platform ko koi fayda nahi. (Conflict 3 ka "old quota
// remove" kaam already done hai — remove karne ko koi column
// hi nahi mila.)
//
// CATEGORY LAW (user directive — Aura Engine): verified student
// sirf educational content upload kar sakta hai. Agar non-educational
// content student ne upload kiya to AURA discount permanently revoked
// (25% plan-price penalty). `Category` field se ye check hota hai —
// missing ya "other" category = educational nahi = student ko revoke.
//
// Hinglish: category field zaroori hai interceptor ke liye —
// bina iske student-violation check impossible hai.

// ContentCategory — upload content ka type.
// Hinglish: "educational" = study material / lecture / tutorial.
// Koi bhi dusra = entertainment / gaming / etc.
type ContentCategory string

const (
	// CategoryEducational — study/lecture/tutorial content.
	CategoryEducational ContentCategory = "educational"
	// CategoryEntertainment — general entertainment (music, vlogs, etc).
	CategoryEntertainment ContentCategory = "entertainment"
	// CategoryGaming — gameplay / streams.
	CategoryGaming ContentCategory = "gaming"
	// CategoryOther — unspecified / default.
	CategoryOther ContentCategory = "other"
)

// IsEducational — category educational content hai?
// Student ke liye ye check hota hai: sirf educational allowed.
func (c ContentCategory) IsEducational() bool {
	return c == CategoryEducational
}

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
	// Category — content type for educational-violation check.
	// Student ne non-educational upload kiya to AURA revoke trigger.
	Category    string         `gorm:"size:50;default:'other'" json:"category"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	ExpiresAt   time.Time      `json:"expires_at"`
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

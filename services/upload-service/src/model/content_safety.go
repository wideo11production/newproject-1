// ContentSafety — AURA content safety compliance guard.
//
// Hinglish: ye model open-source FFmpeg + ONNX based content detection
// ka state store karta hai. User directive: "NO paid/third-party APIs".
// Hum FFmpeg se frames nikalte hain, ONNX model se analyze karte hain,
// aur prohibited content detect karte hain.
//
// Prohibited categories (user directive):
//   - Adult content (sexual explicit)
//   - Explicit weapons/firearms
//   - Active smuggling signatures
//   - Illegal contraband
//   - Illicit drug packages
//
// Agar detection threshold breach hota hai:
//   1. Upload session = ABORTED
//   2. File fragments = DELETED (MinIO cleanup)
//   3. User identity = BLACKLISTED
package model

import (
	"time"

	"github.com/google/uuid"
)

// ProhibitedCategory — content safety detection categories.
type ProhibitedCategory string

const (
	ProhibitedAdultContent       ProhibitedCategory = "adult_content"
	ProhibitedExplicitWeapons    ProhibitedCategory = "explicit_weapons"
	ProhibitedActiveSmuggling    ProhibitedCategory = "active_smuggling"
	ProhibitedIllegalContraband  ProhibitedCategory = "illegal_contraband"
	ProhibitedIllicitDrugs       ProhibitedCategory = "illicit_drugs"
)

// AllProhibitedCategories — iteration ke liye.
var AllProhibitedCategories = []ProhibitedCategory{
	ProhibitedAdultContent,
	ProhibitedExplicitWeapons,
	ProhibitedActiveSmuggling,
	ProhibitedIllegalContraband,
	ProhibitedIllicitDrugs,
}

// ContentSafetyResult — ek frame ka detection result.
type ContentSafetyResult struct {
	Category      ProhibitedCategory `json:"category"`
	Confidence    float32            `json:"confidence"`
	FrameIndex    int                `json:"frame_index"`
	TimestampSec  float64            `json:"timestamp_sec"`
	BoundingBox   []float32          `json:"bounding_box,omitempty"` // x, y, w, h (normalized 0-1)
	DetectedAt    time.Time          `json:"detected_at"`
}

// UploadSafetyCheck — ek upload session ka safety check summary.
type UploadSafetyCheck struct {
	ID               uint              `gorm:"primarykey" json:"id"`
	SessionUUID      uuid.UUID         `gorm:"type:uuid;not null;index" json:"session_uuid"`
	UserID           uint              `gorm:"not null;index" json:"user_id"`
	Status           string            `gorm:"size:30;not null" json:"status"` // pending, scanning, clean, flagged, aborted
	TotalFrames      int               `json:"total_frames"`
	ScannedFrames    int               `json:"scanned_frames"`
	DetectionsCount  int               `json:"detections_count"`
	MaxConfidence    float32           `json:"max_confidence"`
	CategoriesFound  string            `gorm:"type:text" json:"categories_found"` // JSON array of ProhibitedCategory
	Details          string            `gorm:"type:text" json:"details,omitempty"` // JSON array of ContentSafetyResult
	CompletedAt      *time.Time        `json:"completed_at,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

func (UploadSafetyCheck) TableName() string {
	return "upload_safety_checks"
}

// BlacklistEntry — user/session jo safety violation ke kaaran blacklist ho gaya.
type BlacklistEntry struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UserID      uint      `gorm:"not null;uniqueIndex:idx_user_session" json:"user_id"`
	SessionUUID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_session" json:"session_uuid"`
	Reason      string    `gorm:"type:text" json:"reason"`
	Category    ProhibitedCategory `gorm:"size:50" json:"category"`
	Confidence  float32   `json:"confidence"`
	Details     string    `gorm:"type:text" json:"details,omitempty"` // JSON detection details
	Active      bool      `gorm:"default:true" json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"` // nil = permanent
}

func (BlacklistEntry) TableName() string {
	return "content_safety_blacklist"
}
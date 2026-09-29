package model

// ============================================================================
// CREATOR DASHBOARD MODELS
// ============================================================================
//
// Ye file creator dashboard ke backend entities define karti hai:
//   - Channel   : user ka apna channel (create + list)
//   - UserSession: ek active login device/session ka view
//
// Migration 005 ne `channels` table, `users.avatar_url` column, aur
// `active_user_sessions` view banaye.
//
// Hinglish comments: har block ka arth

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------
//
// Channel: user ka apna channel. Ek user ke 1 se zyada channels ho sakte hain
// (1:N relationship), isliye ye `users` me column nahi balki apni table hai.
//
// `handle` wahi public identifier hai jo channel URL me dikhta hai.
type Channel struct {
	// ---- Identity ----
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Handle      string    `gorm:"size:30;not null" json:"handle"`
	DisplayName string    `gorm:"size:80;not null" json:"display_name"`
	Description string    `gorm:"size:2000" json:"description"`
	// ---- Media ----
	// Channel ka apna image (user avatar se alag - ek channel ka cover,
	// ek user ki photo)
	ImageURL string `gorm:"size:500" json:"image_url"`
	// ---- State ----
	IsPublic bool `gorm:"default:true" json:"is_public"`
	IsActive bool `gorm:"default:true" json:"is_active"`
	// ---- Timestamps ----
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Channel) TableName() string { return "channels" }

// ---------------------------------------------------------------------------
// UserSession - "kis device par login hai" ke liye
// ---------------------------------------------------------------------------
//
// Ye `sessions` table + `active_user_sessions` VIEW se read hota hai.
// SECURITY: ye sirf authenticated user KI sessions return karta hai - user_id
// filter query me mandatory hai. Koi cross-user leak nahi.
// ActiveDeviceSession - "kis device par login hai" ke liye
//
// NAMING: ye `UserSession` se alag hai JAAN-BOJH kar. `superadmin.go` me ek
// `UserSession` model pehle se hai jo "kitne time online tha" track karta hai
// (started_at / last_seen_at / ended_at / duration_seconds) aur wo ek ALAG
// table map karta hai. Ye naya struct `sessions` table + `active_user_sessions`
// view se padhta hai (auth tokens wali table) - isliye alag naam, warna Go
// me "redeclared in this block" error aata.
type ActiveDeviceSession struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"-"`
	DeviceID  *uuid.UUID `json:"device_id"`
	IPAddress *string    `json:"ip_address"`
	UserAgent *string    `json:"user_agent"`
	// ---- Times ----
	CreatedAt time.Time `json:"created_at"`
	// `last_seen` VIEW me `updated_at` se aata hai (GORM auto-maintains it)
	LastSeen  time.Time `json:"last_seen"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ---------------------------------------------------------------------------
// Profile DTOs
// ---------------------------------------------------------------------------

// UpdateProfileRequest - profile update ke liye (avatar URL).
//
// NOTE: ye sirf `avatar_url` accept karta hai. Naam/username jaise sensitive
// fields jaan-boojh kar nahi rakhe - wo alag verified flows se change hote
// hain (username uniqueness + takedown implications).
type UpdateProfileRequest struct {
	// Avatar: absolute URL ya relative path (MinIO se).
	// Empty string = avatar clear karna (UI initials fallback par laut jayega).
	AvatarURL *string `json:"avatar_url"`
}

// CreateChannelRequest - naya channel banane ke liye.
type CreateChannelRequest struct {
	// Public handle (3-30 chars, lowercase letters/digits/_/./-).
	// Backend ise normalize + validate karta hai (client validation sirf UX hai).
	Handle string `json:"handle"`
	// Display name (1-80 chars)
	DisplayName string `json:"display_name"`
	// Optional description (max 2000)
	Description string `json:"description,omitempty"`
	// Public (default true) ya private
	IsPublic *bool `json:"is_public,omitempty"`
}

// ChannelResponse - create ke baad client ko milta hai.
type ChannelResponse struct {
	ID          uuid.UUID `json:"id"`
	Handle      string    `json:"handle"`
	DisplayName string    `json:"display_name"`
	Description string    `json:"description"`
	ImageURL    string    `json:"image_url"`
	IsPublic    bool      `json:"is_public"`
	CreatedAt   time.Time `json:"created_at"`
	VideoCount  int64     `json:"video_count"`
}

// Errors - channel/profile operations ke liye.
// (Package-level taaki handler `errors.Is` se compare kar sake.)
var (
	// ErrHandleTaken - ye handle already kisi channel ka hai (same user me).
	ErrHandleTaken = errCreator("channel handle already taken")
	// ErrHandleInvalid - handle format galat hai.
	ErrHandleInvalid = errCreator("handle must be 3-30 characters using lowercase letters, numbers, underscore, dot or hyphen")
	// ErrChannelNotFound - channel nahi mila (ya is user ka nahi hai).
	ErrChannelNotFound = errCreator("channel not found")
)

type creatorError string

func (e creatorError) Error() string { return string(e) }

func errCreator(msg string) error { return creatorError(msg) }

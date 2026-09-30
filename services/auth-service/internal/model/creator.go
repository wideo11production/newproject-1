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
	// CoverURL - wide banner (YouTube-style channel header).
	//
	// WHY SEPARATE FROM ImageURL: `image_url` square icon/avatar hai, `cover_url`
	// wide banner hai. Designers inhe alag size me use karte hain; ek hi column
	// me rakhne par ek set karne se doosra chala jayega. Migration 011.
	CoverURL string `gorm:"size:500" json:"cover_url"`
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

// UpdateChannelRequest - channel edit ke liye.
//
// ---- WHY EVERY FIELD IS A POINTER ----
// `nil` = "is field ko chhod de", `false`/`""` = "is field ko VALUE set kar".
//
// Agar ye plain `string`/`bool` hote to PATCH me omitted field aur
// intentionally-emptied field dono ka representation same ho jata. Iska
// matlab: user description khaali karna chahta, aur hum uska description
// chupke se UNCHANGED chhod dete - ya worse, display_name clear karne ki
// request par use hata dete.
//
// Pointer pattern ye ambiguity door karta hai. Ye wahi pattern hai jo
// `UpdateSettingsRequest` me pehle se use ho raha hai.
//
// SECURITY: `handle` YAHAN JAAN-BOJH KAR NAHI HAI. Handle channel ka
// public URL hai (/@handle). Use badalne se purane links, bookmarks aur
// shares toot jaate hain - aur koi redirect mapping nahi hai.
// Handle account lifetime ke liye fixed rehta hai.
type UpdateChannelRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Description *string `json:"description,omitempty"`
	ImageURL    *string `json:"image_url,omitempty"`
	CoverURL    *string `json:"cover_url,omitempty"`
	IsPublic    *bool   `json:"is_public,omitempty"`
	IsActive    *bool   `json:"is_active,omitempty"`
}

// PublicChannelResponse - public channel page ke liye.
//
// SECURITY: ye DTO jaan-boojh kar `UserID` NAHI expose karta. Public
// payload me internal user UUID daalne se koi faida nahi hai, aur wo
// enumeration ke liye ek stable identifier ban jata hai.
type PublicChannelResponse struct {
	ID          uuid.UUID `json:"id"`
	Handle      string    `json:"handle"`
	DisplayName string    `json:"display_name"`
	Description string    `json:"description"`
	ImageURL    string    `json:"image_url"`
	CoverURL    string    `json:"cover_url"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// NOTE: yahan ek `ChannelResponse` DTO kabhi tha, jo create ke baad client
// ko bhejne ke liye tha. Wo DELETE kar diya gaya hai, teen wajahon se:
//
//  1. Koi handler ya service use nahi karta tha - create/get dono raw
//     `*model.Channel` return karte hain. Matlab ye sirf misleading tha.
//  2. `cover_url` isme nahi tha, jabki migration 011 ne wo add kiya - to ye
//     struct definition aur real schema se already drift kar chuka tha.
//  3. `video_count` ka koi counter exist hi nahi karta codebase me.
//
// Apne aap me isse revive mat karo. Response shape ASLI hai raw model, aur
// ise change karna = API contract badalna. Agar future me channel listing
// me extra computed fields chahiye (jaise video_count), tab ek naya DTO
// banao - aur use tabhi add karo jab wo actually use ho.
// ---------------------------------------------------------------------------

// Errors - channel/profile operations ke liye.
// (Package-level taaki handler `errors.Is` se compare kar sake.)
var (
	// ErrHandleTaken - ye handle already kisi channel ka hai (same user me).
	ErrHandleTaken = errCreator("channel handle already taken")
	// ErrHandleInvalid - handle format galat hai.
	ErrHandleInvalid = errCreator("handle must be 3-30 characters using lowercase letters, numbers, underscore, dot or hyphen")
	// ErrChannelNotFound - channel nahi mila (ya is user ka nahi hai).
	ErrChannelNotFound = errCreator("channel not found")
	// ErrDisplayNameInvalid - display name 1-80 chars ke beech nahi hai.
	ErrDisplayNameInvalid = errCreator("display name must be between 1 and 80 characters")
	// ErrDescriptionTooLong - description 2000 chars se bada.
	ErrDescriptionTooLong = errCreator("description must be 2000 characters or fewer")
	// ErrURLTooLong - image/cover URL 500 chars se bada.
	ErrURLTooLong = errCreator("url must be 500 characters or fewer")
	// ErrURLSchemeNotAllowed - javascript:/data:/vbscript: jaise schemes
	// BLOCK hote hain (stored XSS vector). Sirf relative path ya http(s).
	ErrURLSchemeNotAllowed = errCreator("url must be a relative path (starting with /) or an http(s) url")
)

type creatorError string

func (e creatorError) Error() string { return string(e) }

func errCreator(msg string) error { return creatorError(msg) }

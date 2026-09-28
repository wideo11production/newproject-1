package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Email        string    `gorm:"uniqueIndex;size:255;not null" json:"email" validate:"required,email"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	// Username: public handle for the creator (e.g. "aarav").
	//
	// ADDED (migration 003): ye column pehle migration file me defined tha
	// par LIVE DB me nahi tha - schema drift tha. Migration 003 ne column
	// add kiya + existing 9 users ka backfill kiya (email ka local part).
	//
	// NULLABLE rakha hai DB-level par: legacy rows ke liye safety, aur
	// nayi registrations ke liye RegisterRequest validation enforce karti
	// hai (see below). Hard NOT NULL constraint ka rationale migration
	// file ke end me documented hai.
	//
	// UNIQUE: `idx_users_username`. Collision par registration fail hogi
	// (409/500 se handle karna zaroori - dekh service layer).
	Username    string         `gorm:"uniqueIndex;size:100" json:"username"`
	FullName    string         `gorm:"size:255" json:"full_name"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	IsVerified  bool           `gorm:"default:false" json:"is_verified"`
	LastLoginAt *time.Time     `json:"last_login_at"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Sessions []Session `gorm:"foreignKey:UserID" json:"-"`
	Devices  []Device  `gorm:"foreignKey:UserID" json:"-"`
	PINs     []PIN     `gorm:"foreignKey:UserID" json:"-"`
}

func (User) TableName() string {
	return "users"
}

type Session struct {
	ID       uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceID *uuid.UUID `gorm:"type:uuid;index" json:"device_id"`
	// SECURITY FIX: raw JWT store karna DB leak me session hijack deta hai.
	// Ab sirf SHA-256 hash (64 hex chars) store hota hai - size bhi safe.
	// Hinglish: raw token DB me nahi, sirf hash
	AccessToken string `gorm:"size:64;not null" json:"-"`
	// SECURITY FIX: same - raw refresh JWT nahi, sirf hash store hota hai
	RefreshToken string         `gorm:"size:64;not null" json:"-"`
	IPAddress    string         `gorm:"size:45" json:"ip_address"`
	UserAgent    string         `gorm:"size:512" json:"user_agent"`
	ExpiresAt    time.Time      `gorm:"not null;index" json:"expires_at"`
	RevokedAt    *time.Time     `json:"revoked_at"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	User   User    `gorm:"foreignKey:UserID" json:"-"`
	Device *Device `gorm:"foreignKey:DeviceID" json:"-"`
}

func (Session) TableName() string {
	return "sessions"
}

type Device struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceName  string         `gorm:"size:255" json:"device_name"`
	DeviceType  string         `gorm:"size:50" json:"device_type"` // mobile, desktop, tablet
	Platform    string         `gorm:"size:100" json:"platform"`   // iOS, Android, Windows, macOS, Linux
	Browser     string         `gorm:"size:100" json:"browser"`
	Fingerprint string         `gorm:"size:512;uniqueIndex" json:"-"`
	TrustScore  int            `gorm:"default:50" json:"trust_score"` // 0-100
	IsTrusted   bool           `gorm:"default:false" json:"is_trusted"`
	LastSeenAt  *time.Time     `json:"last_seen_at"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (Device) TableName() string {
	return "devices"
}

type PIN struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	PINHash   string         `gorm:"size:255;not null" json:"-"`
	Attempts  int            `gorm:"default:0" json:"attempts"`
	LockedAt  *time.Time     `json:"locked_at"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (PIN) TableName() string {
	return "pins"
}

type RefreshToken struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	TokenHash string     `gorm:"size:512;not null;uniqueIndex" json:"-"`
	ExpiresAt time.Time  `gorm:"not null;index" json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (RefreshToken) TableName() string {
	return "refresh_tokens"
}

type LoginRequest struct {
	Email    string     `json:"email" validate:"required,email"`
	Password string     `json:"password" validate:"required,min=8,max=72"`
	Device   DeviceInfo `json:"device"`
}

type DeviceInfo struct {
	DeviceName  string `json:"device_name"`
	DeviceType  string `json:"device_type"`
	Platform    string `json:"platform"`
	Browser     string `json:"browser"`
	Fingerprint string `json:"fingerprint"`
}

type RegisterRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8,max=72"`
	// FullName OPTIONAL hai ab. Pehle `validate:"required,min=2,max=100"` tha.
	// Register form se ye field hata di gayi thi (compact card), ab phir se
	// optional rakha hai - form me nahi hai, profile me bhara ja sakta hai.
	//
	// NOTE: ye `validate` tags DEAD CODE hain - handler `ShouldBindJSON` use
	// karta hai jo sirf JSON unmarshal karta hai, koi struct-tag validator
	// run nahi hota. Tags documentation ke liye hain. Tab bhi ye accurate
	// rakhna zaroori hai, warna future me koi inhe enforce karne ki koshish
	// kare to galat sochega.
	//
	// `max=100` still rakha hai - agar koi future me naam bhare to limit safe
	// rahegi.
	FullName string `json:"full_name" validate:"omitempty,max=100"`
	// Username: NEW registrations ke liye REQUIRED (3-30 chars, letters/digits/
	// underscore/dot/dash). Ye form me bhi hai, isliye validation tag yahan
	// matter karti hai documentation ke liye - par enforce service layer me
	// hota hai (ye tags dead hain).
	Username string     `json:"username" validate:"required,min=3,max=30"`
	Device   DeviceInfo `json:"device"`
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"` // seconds
	TokenType    string `json:"token_type"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type PINSetupRequest struct {
	PIN string `json:"pin" validate:"required,len=6,numeric"`
}

type PINVerifyRequest struct {
	PIN string `json:"pin" validate:"required,len=6,numeric"`
}

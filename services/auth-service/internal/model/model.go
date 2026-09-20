package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID           uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Email        string         `gorm:"uniqueIndex;size:255;not null" json:"email" validate:"required,email"`
	PasswordHash string         `gorm:"size:255;not null" json:"-"`
	FullName     string         `gorm:"size:255" json:"full_name"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	IsVerified   bool           `gorm:"default:false" json:"is_verified"`
	LastLoginAt  *time.Time     `json:"last_login_at"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Sessions []Session `gorm:"foreignKey:UserID" json:"-"`
	Devices  []Device  `gorm:"foreignKey:UserID" json:"-"`
	PINs     []PIN     `gorm:"foreignKey:UserID" json:"-"`
}

func (User) TableName() string {
	return "users"
}

type Session struct {
	ID           uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID       uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceID     *uuid.UUID     `gorm:"type:uuid;index" json:"device_id"`
	AccessToken  string         `gorm:"size:512;not null" json:"-"`
	RefreshToken string         `gorm:"size:512;not null" json:"-"`
	IPAddress    string         `gorm:"size:45" json:"ip_address"`
	UserAgent    string         `gorm:"size:512" json:"user_agent"`
	ExpiresAt    time.Time      `gorm:"not null;index" json:"expires_at"`
	RevokedAt    *time.Time     `json:"revoked_at"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	User   User   `gorm:"foreignKey:UserID" json:"-"`
	Device *Device `gorm:"foreignKey:DeviceID" json:"-"`
}

func (Session) TableName() string {
	return "sessions"
}

type Device struct {
	ID              uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID          uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceName      string         `gorm:"size:255" json:"device_name"`
	DeviceType      string         `gorm:"size:50" json:"device_type"` // mobile, desktop, tablet
	Platform        string         `gorm:"size:100" json:"platform"`   // iOS, Android, Windows, macOS, Linux
	Browser         string         `gorm:"size:100" json:"browser"`
	Fingerprint     string         `gorm:"size:512;uniqueIndex" json:"-"`
	TrustScore      int            `gorm:"default:50" json:"trust_score"` // 0-100
	IsTrusted       bool           `gorm:"default:false" json:"is_trusted"`
	LastSeenAt      *time.Time     `json:"last_seen_at"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`

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
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	TokenHash string         `gorm:"size:512;not null;uniqueIndex" json:"-"`
	ExpiresAt time.Time      `gorm:"not null;index" json:"expires_at"`
	RevokedAt *time.Time     `json:"revoked_at"`
	CreatedAt time.Time      `json:"created_at"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (RefreshToken) TableName() string {
	return "refresh_tokens"
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8,max=72"`
	Device   DeviceInfo `json:"device"`
}

type DeviceInfo struct {
	DeviceName string `json:"device_name"`
	DeviceType string `json:"device_type"`
	Platform   string `json:"platform"`
	Browser    string `json:"browser"`
	Fingerprint string `json:"fingerprint"`
}

type RegisterRequest struct {
	Email     string `json:"email" validate:"required,email"`
	Password  string `json:"password" validate:"required,min=8,max=72"`
	FullName  string `json:"full_name" validate:"required,min=2,max=100"`
	Device    DeviceInfo `json:"device"`
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
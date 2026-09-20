package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BiometricChallenge stores the challenge data for WebAuthn authentication
type BiometricChallenge struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null" json:"user_id"`
	Challenge []byte         `gorm:"type:varbinary(1024);not null" json:"challenge"` // base64url encoded challenge
	SessionData []byte       `gorm:"type:blob" json:"session_data"` // session data from webauthn library
	ExpiresAt time.Time      `gorm:"not null" json:"expires_at"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

// TableName overrides the table name used by GORM
func (BiometricChallenge) TableName() string {
	return "biometric_challenges"
}

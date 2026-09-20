package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BiometricRegistration stores the public key credential for a user
type BiometricRegistration struct {
	ID           uint           `gorm:"primarykey" json:"-"`
	UserID       uuid.UUID      `gorm:"type:uuid;uniqueIndex:idx_user_id;not null" json:"user_id"`
	CredentialID []byte         `gorm:"type:varbinary(1024);not null" json:"credential_id"` // base64url encoded credential ID
	PublicKey    []byte         `gorm:"type:varbinary(2048);not null" json:"public_key"`    // COSE_Key encoded public key
	SignCount    uint32         `gorm:"not null" json:"sign_count"`
	CredType     string         `gorm:"type:varchar(20);not null;default:'public-key'" json:"cred_type"` // usually "public-key"
	CreatedAt    time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (BiometricRegistration) TableName() string {
	return "biometric_registrations"
}

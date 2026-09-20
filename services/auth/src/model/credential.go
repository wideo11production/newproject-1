package model

import (
	"time"

	"github.com/duo-labs/webauthn/webauthn"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Credential represents a WebAuthn credential (passkey) associated with a user
type Credential struct {
	ID           uint           `gorm:"primary_key;auto_increment" json:"-"`
	UserID       uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	PublicKey    []byte         `gorm:"type:bytea;not null" json:"-"` // The credential public key
	CredentialID []byte         `gorm:"type:bytea;not null;unique" json:"credential_id"` // Credential ID
	SignCount    uint32         `gorm:"not null" json:"sign_count"`   // Signature counter
	CredentialType string       `gorm:"size:20;not null" json:"credential_type"` // Usually "public-key"
	BackedUp     bool           `gorm:"not null" json:"backed_up"`    // Whether credential is backed up
	DeviceType   string         `gorm:"size:50" json:"device_type"`   // e.g., "platform", "cross-platform"
	BackedUpState string       `gorm:"size:20" json:"backed_up_state"` // e.g., "not-backed-up", "unknown"
	Name         string         `gorm:"size:255" json:"name"`         // User-friendly name for the credential
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// TableName specifies the table name for GORM
func (Credential) TableName() string {
	return "webauthn_credentials"
}

// ToCredentialDescriptor converts model to webauthn.CredentialDescriptor
func (c *Credential) ToCredentialDescriptor() webauthn.CredentialDescriptor {
	return webauthn.CredentialDescriptor{
		Type: webauthn.CredentialTypePublicKey,
		ID:   c.CredentialID,
	}
}

// FromCredentialCreateData creates a model from webauthn credential creation data
func FromCredentialCreateData(userID uuid.UUID, data *webauthn.CredentialCreation, name string) *Credential {
	return &Credential{
		UserID:       userID,
		PublicKey:    data.PublicKey,
		CredentialID: data.ID,
		SignCount:    0, // Initial sign count is 0
		CredentialType: string(data.Type),
		BackedUp:     data.Attestation.AuthenticatorData.Flags.BackedUp,
		DeviceType:   getDeviceTypeString(data.Attestation.AuthenticatorData.Flags),
		BackedUpState: getBackedUpStateString(data.Attestation.AuthenticatorData.Flags),
		Name:         name,
	}
}

// FromCredentialGetData creates a model from webauthn credential get data
func FromCredentialGetData(existing *Credential, data *webauthn.CredentialAssertion) *Credential {
	if existing == nil {
		return nil
	}
	existing.SignCount = data.AuthenticatorSignature.Count
	existing.UpdatedAt = time.Now()
	return existing
}

// Helper functions to convert flags to strings
func getDeviceTypeString(flags webauthn.AuthenticatorDataFlags) string {
	if flags.Attachment() == webauthn.AttachmentPlatform {
		return "platform"
	}
	return "cross-platform"
}

func getBackedUpStateString(flags webauthn.AuthenticatorDataFlags) string {
	if flags.BackedUp() {
		return "backed-up"
	}
	return "not-backed-up"
}

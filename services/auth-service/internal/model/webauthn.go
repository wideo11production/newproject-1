package model

import (
	"encoding/base64"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/protocol"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
)

// WebAuthnCredential ek user ke biometric/passkey credential ko store karta hai.
//
// YE HAI "SIGNATURE MODEL": Browser/device ek key pair banata hai -
// private key device me hi rehta hai (kabhi server ko nahi jata), aur public key
// hum yahan store karte hain. Login ke time device private key se ek SIGNATURE
// banata hai, aur hum us signature ko stored public key se verify karte hain.
//
// SECURITY:
//   - Private key server par KABHI nahi aata - sirf device ke secure element me rehta hai
//   - Isliye phishing-resistant hai (password server me leak ho to bhi account safe)
//   - SignCount phishing detection ke liye use hota hai
//
// Hinglish: ye WebAuthn ka signature model hai - public key DB me, private key device me
type WebAuthnCredential struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	// CredentialID: device ka unique credential identifier (base64url encoded)
	// Ye WebAuthn ka primary identifier hai - login ke time isse credential dhoondha jata hai
	CredentialID string `gorm:"size:512;not null;uniqueIndex" json:"credential_id"`

	// PublicKey: device ka public key (PEM format) - signature verify karne ke liye
	PublicKey []byte `gorm:"not null" json:"-"`

	// AttestationType: "none" (most common), "packed", "tpm" etc.
	AttestationType string `gorm:"size:32" json:"attestation_type"`

	// Transport: kaise use hua - "usb", "nfc", "ble", "internal"
	// "internal" ka matlab platform authenticator (fingerprint/face - laptop ka sensor)
	Transport string `gorm:"size:64" json:"transport"`

	// Flags: user-verified (UV) aur user-present (UP) bits.
	//
	// NOTE: library ka "webauthn.CredentialFlags" struct directly use nahi kar sakte -
	// usme ek unexported "raw" field hai, aur GORM use map nahi kar pata:
	//   "invalid field found for struct ... field Flags: define a valid foreign key
	//    for relations or implement the Valuer/Scanner interface"
	// Isliye hum har flag ko alag boolean column me store karte hain - jo cleaner
	// bhi hai aur query karna bhi asaan.
	// Hinglish: flags ko alag columns me rakhte hain, GORM struct ko handle nahi kar paata
	UserPresent bool `gorm:"not null;default:false" json:"-"`
	// UserVerified true hona chahiye - iska matlab user ne fingerprint/face verify kiya
	UserVerified bool `gorm:"not null;default:false" json:"-"`
	// BackupEligible: ye credential cloud backup (passkey sync) me hai ya nahi
	BackupEligible bool `gorm:"not null;default:false" json:"-"`
	// BackupState: backup active hai ya nahi
	BackupState bool `gorm:"not null;default:false" json:"-"`

	// Authenticator AAGUID: authenticator ka unique id (vendor + model)
	AAGUID []byte `gorm:"type:uuid" json:"-"`

	// SignCount: signature counter. Har successful assertion par badhta hai.
	// Agar ye ghat jaye to iska matlab hai credential clone ho gaya hai - alert raise karte hain
	SignCount uint32 `gorm:"default:0" json:"sign_count"`

	// Credential device ka friendly naam (user ne register karte waqt diya)
	Name string `gorm:"size:128" json:"name"`

	// CloneWarning: phishing detection flag
	CloneWarning bool `gorm:"default:false" json:"clone_warning"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (WebAuthnCredential) TableName() string {
	return "webauthn_credentials"
}

// ToWebAuthnCredential DB record ko go-webauthn library ke Credential type me badalta hai.
//
// Ye method model package me hai (WebAuthnCredential ke saath) taaki service package
// ko ye conversion khud na karni pade. Library aur model dono ka import yahan hai.
//
// Hinglish: DB record ko library format me convert karte hain
func (c *WebAuthnCredential) ToWebAuthnCredential() (*webauthn.Credential, error) {
	// CredentialID ko DB se base64url string ke roop me padhte hain, lekin library
	// ko raw []byte chahiye. Isliye decode karna zaroori hai.
	// (v0.18 me Credential.ID ka type []byte hai, string nahi)
	credID, err := base64.RawURLEncoding.DecodeString(c.CredentialID)
	if err != nil {
		return nil, fmt.Errorf("invalid credential id encoding: %w", err)
	}

	cred := &webauthn.Credential{
		ID:              credID,
		PublicKey:       c.PublicKey,
		AttestationType: c.AttestationType,
		// Alag columns se flags wapas banate hain
		Flags: webauthn.CredentialFlags{
			UserPresent:    c.UserPresent,
			UserVerified:   c.UserVerified,
			BackupEligible: c.BackupEligible,
			BackupState:    c.BackupState,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:    c.AAGUID,
			SignCount: c.SignCount,
		},
	}

	// Transport string se slice banata hai (agar stored hai)
	if c.Transport != "" {
		cred.Transport = []protocol.AuthenticatorTransport{
			protocol.AuthenticatorTransport(c.Transport),
		}
	}

	return cred, nil
}

// WebAuthnSession challenges ko store karta hai.
//
// SECURITY: Challenge ek one-time random value hai jo browser ko bhejte hain aur
// wahi wapas mangwaate hain. Ye registration aur login dono flows me replay attacks
// rokta hai - bina sahi challenge ke koi assertion accept nahi hota.
//
// Hinglish: challenge ek one-time token hai jo replay attack rokta hai
type WebAuthnSession struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;index" json:"user_id"`

	// Challenge: hex encoded random bytes
	Challenge string `gorm:"size:255;not null;index" json:"challenge"`

	// SessionData: library ka serialized session data (user handle, allowed creds etc.)
	SessionData []byte `gorm:"not null" json:"-"`

	// Type: "registration" ya "authentication" - taaki ek flow ka challenge
	// doosre flow me use na ho
	Type string `gorm:"size:32;not null" json:"type"`

	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

func (WebAuthnSession) TableName() string {
	return "webauthn_sessions"
}

// WebAuthn session types
const (
	WebAuthnSessionTypeRegistration   = "registration"
	WebAuthnSessionTypeAuthentication = "authentication"
)

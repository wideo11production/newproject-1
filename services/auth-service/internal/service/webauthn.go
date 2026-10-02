package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// WebAuthnService WebAuthn (biometric/passkey) flows implement karta hai.
//
// FLOW 1 - REGISTRATION (naya device enroll karna):
//  1. Client "begin" request karta hai -> hum random challenge banaate hain
//  2. Browser device me key pair banata hai, public key + attestation bhejta hai
//  3. Client "finish" request karta hai -> hum attestation VERIFY karte hain
//  4. Credential (public key) DB me save ho jata hai
//
// FLOW 2 - AUTHENTICATION (login with fingerprint/face):
//  1. Client "begin" -> challenge + allowed credentials bhejte hain
//  2. Device private key se SIGNATURE banata hai
//  3. Client "finish" -> hum signature ko stored public key se verify karte hain
//  4. Verify pass = login successful (password ki zaroorat NAHI)
//
// Hinglish comments: har block ka arth
type WebAuthnService struct {
	db  *gorm.DB
	cfg *config.Config
	// wa library ka main WebAuthn instance (RP ID, origin, etc.)
	wa *webauthn.WebAuthn
	// sessionTimeout challenge validity window
	sessionTimeout time.Duration
}

// NewWebAuthnService WebAuthn service banata hai
func NewWebAuthnService(db *gorm.DB, cfg *config.Config) (*WebAuthnService, error) {
	// RP (Relying Party) settings - ye SSOT config se aati hain
	// NOTE: library ka RPOrigins field []string hai, config me humne comma-separated
	// string rakhi hai (env var me comma dena padta hai). Isliye yahan split karte hain.
	// Hinglish: config me comma separated origins, yahan array me convert
	var origins []string
	for _, origin := range strings.Split(cfg.WebAuthn.RPOrigins, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins = append(origins, origin)
		}
	}

	// Agar koi origin nahi mila to default localhost use karo
	// (bina origin ke WebAuthn browser me reject ho jata hai)
	if len(origins) == 0 {
		origins = []string{"http://localhost:3000"}
	}

	waCfg := &webauthn.Config{
		RPID:          cfg.WebAuthn.RPID,
		RPDisplayName: cfg.WebAuthn.RPDisplayName,
		RPOrigins:     origins,
	}

	wa, err := webauthn.New(waCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize webauthn: %w", err)
	}

	return &WebAuthnService{
		db:             db,
		cfg:            cfg,
		wa:             wa,
		sessionTimeout: 5 * time.Minute,
	}, nil
}

// GetWebAuthn returns the underlying webauthn instance
func (s *WebAuthnService) GetWebAuthn() *webauthn.WebAuthn {
	return s.wa
}

// GetDB returns the database handle
func (s *WebAuthnService) GetDB() *gorm.DB {
	return s.db
}

// sessionTimeoutValue challenge expiry window
func (s *WebAuthnService) sessionTimeoutValue() time.Duration {
	return s.sessionTimeout
}

// ---------------------------------------------------------------------------
// User adapter: WebAuthn library ko user ki identity batata hai
// ---------------------------------------------------------------------------

// webAuthnUser webauthn.User interface implement karta hai (User entity par)
type webAuthnUser struct {
	user *model.User
	db   *gorm.DB
}

// WebAuthnID user ka UUID handle hai (WebAuthn ke liye max 64 bytes)
func (u *webAuthnUser) WebAuthnID() []byte {
	return u.user.ID[:]
}

// WebAuthnName display name - email use karte hain (har account me unique hai)
func (u *webAuthnUser) WebAuthnName() string {
	return u.user.Email
}

// WebAuthnDisplayName human friendly naam
func (u *webAuthnUser) WebAuthnDisplayName() string {
	if u.user.FullName != "" {
		return u.user.FullName
	}
	return u.user.Email
}

// WebAuthnCredentials user ke saare stored credentials laata hai
// NOTE: v0.18 library ka interface me ye method error RETURN NAHI karta
// (pehle maine error return kiya tha jo "does not implement webauthn.User" de raha tha)
func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	var records []model.WebAuthnCredential
	if err := u.db.Where("user_id = ?", u.user.ID).Find(&records).Error; err != nil {
		// DB error pe empty list return karte hain - login fail hoga par crash nahi hoga
		return nil
	}

	creds := make([]webauthn.Credential, 0, len(records))
	for i := range records {
		// ToWebAuthnCredential model package me method hai, isliye pointer lena zaroori hai
		cred, err := records[i].ToWebAuthnCredential()
		if err != nil {
			// Ek corrupt credential se baaki credentials fail nahi hone chahiye
			continue
		}
		creds = append(creds, *cred)
	}
	return creds
}

// NewWebAuthnUser ek user entity se adapter banata hai
func NewWebAuthnUser(user *model.User, db *gorm.DB) *webAuthnUser {
	return &webAuthnUser{user: user, db: db}
}

// LoadUserByWebAuthnID WebAuthn handle se user dhoondta hai
// Ye login flow me use hota hai (challenge generate karne se pehle)
func LoadUserByWebAuthnID(db *gorm.DB, id []byte) (*model.User, error) {
	// WebAuthn user handle 16 bytes ka UUID hota hai
	// (64 bytes ka max hota hai, hum UUID use karte hain)
	if len(id) != 16 {
		return nil, fmt.Errorf("invalid webauthn user handle length: %d", len(id))
	}
	var userID uuid.UUID
	copy(userID[:], id)

	var user model.User
	if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

// ToWebAuthnCredential DB record ko library ke Credential type me badalta hai
// NOTE: ye method model package me define hai (model.WebAuthnCredential ke saath),
// yahan nahi. Pehle yahan define kiya tha jo "undefined: WebAuthnCredential" de raha tha.
func convertCredentialPlaceholder() {}

// ---------------------------------------------------------------------------
// Challenge storage (replay attack protection)
// ---------------------------------------------------------------------------

// SaveSession challenge ko DB me store karta hai
// Hinglish: challenge save karte hain taaki replay attack na ho sake
func (s *WebAuthnService) SaveSession(ctx context.Context, userID *uuid.UUID, sessionType string, challenge string, data []byte) error {
	// Purane expired sessions saaf karo
	s.cleanupExpiredSessions(ctx)

	record := &model.WebAuthnSession{
		Challenge:   challenge,
		SessionData: data,
		Type:        sessionType,
		ExpiresAt:   time.Now().Add(s.sessionTimeout),
	}
	if userID != nil {
		record.UserID = *userID
	}
	return s.db.WithContext(ctx).Create(record).Error
}

// GetSessionByChallenge challenge se session dhoondta hai (type ke saath)
//
// NOTE: ye method table nahi, challenge string se seedha dhoondhta hai.
// Iska reason: WebAuthn "Finish" flow me challenge HTTP header/post form me
// aata hai, aur session ID client ke paas nahi hota. Pehle GetSession()
// separate lookup banayi thi jo bhi isi kaam karti hai.
//
// Hinglish: challenge se session dhoondhte hain - type match bhi zaroori hai
func (s *WebAuthnService) GetSessionByChallenge(ctx context.Context, challenge string, sessionType string) (*model.WebAuthnSession, error) {
	var record model.WebAuthnSession
	err := s.db.WithContext(ctx).
		Where("challenge = ? AND type = ? AND expires_at > ?", challenge, sessionType, time.Now()).
		First(&record).Error

	if err != nil {
		return nil, err
	}
	return &record, nil
}

// DeleteSession challenge consume karne ke baad delete kar deta hai
// ONE-TIME USE: yahi replay attack rokta hai - dobara same challenge use nahi ho sakta
func (s *WebAuthnService) DeleteSession(ctx context.Context, id uuid.UUID) error {
	return s.db.WithContext(ctx).Where("id = ?", id).Delete(&model.WebAuthnSession{}).Error
}

// cleanupExpiredSessions expired challenges hata deta hai
func (s *WebAuthnService) cleanupExpiredSessions(ctx context.Context) {
	s.db.WithContext(ctx).
		Where("expires_at < ?", time.Now()).
		Delete(&model.WebAuthnSession{})
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

// StoreCredential registration ke baad credential save karta hai
func (s *WebAuthnService) StoreCredential(ctx context.Context, userID uuid.UUID, cred *webauthn.Credential, name string) error {
	record := &model.WebAuthnCredential{
		UserID:          userID,
		CredentialID:    base64.RawURLEncoding.EncodeToString(cred.ID),
		PublicKey:       cred.PublicKey,
		AttestationType: cred.AttestationType,
		// Flags ko alag columns me store karte hain (GORM struct map nahi kar sakta)
		UserPresent:    cred.Flags.UserPresent,
		UserVerified:   cred.Flags.UserVerified,
		BackupEligible: cred.Flags.BackupEligible,
		BackupState:    cred.Flags.BackupState,
		AAGUID:         cred.Authenticator.AAGUID,
		SignCount:      cred.Authenticator.SignCount,
		Name:           name,
	}

	// Transport string me store karte hain
	if len(cred.Transport) > 0 {
		record.Transport = string(cred.Transport[0])
	}

	return s.db.WithContext(ctx).Create(record).Error
}

// ListCredentials user ke saare biometric credentials laata hai
func (s *WebAuthnService) ListCredentials(ctx context.Context, userID uuid.UUID) ([]model.WebAuthnCredential, error) {
	var creds []model.WebAuthnCredential
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Find(&creds).Error
	return creds, err
}

// DeleteCredential credential remove karta hai (user ne device unregister kiya)
func (s *WebAuthnService) DeleteCredential(ctx context.Context, userID uuid.UUID, credentialID string) error {
	return s.db.WithContext(ctx).
		Where("user_id = ? AND credential_id = ?", userID, credentialID).
		Delete(&model.WebAuthnCredential{}).Error
}

// GetCredentialByID credential ID se credential dhoondta hai
func (s *WebAuthnService) GetCredentialByID(ctx context.Context, credentialID string) (*model.WebAuthnCredential, error) {
	var cred model.WebAuthnCredential
	err := s.db.WithContext(ctx).Where("credential_id = ?", credentialID).First(&cred).Error
	if err != nil {
		return nil, err
	}
	return &cred, nil
}

// UpdateSignCount sign count update karta hai + clone detection
//
// SECURITY (clone detection): WebAuthn spec ke mutabiq har successful assertion
// par authenticator signCount badhata hai. Agar counter GHTNE lage to iska matlab
// hai ki same credential do jagah use ho raha hai = possible CLONE attack.
// Is case me hum flag set karte hain taaki app alert kar sake.
// Hinglish: sign count ghatne se pata chalta hai ki credential clone hua hai
func (s *WebAuthnService) UpdateSignCount(ctx context.Context, cred *webauthn.Credential) error {
	newCount := cred.Authenticator.SignCount

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record model.WebAuthnCredential
		if err := tx.Where("credential_id = ?", base64.RawURLEncoding.EncodeToString(cred.ID)).First(&record).Error; err != nil {
			return err
		}

		// Counter ghatne se PEHLE check karte hain (0 -> naya enrollment legit hota hai)
		cloneDetected := record.SignCount > 0 && newCount > 0 && newCount <= record.SignCount

		return tx.Model(&model.WebAuthnCredential{}).
			Where("id = ?", record.ID).
			Updates(map[string]any{
				"sign_count":    newCount,
				"clone_warning": cloneDetected,
			}).Error
	})
}

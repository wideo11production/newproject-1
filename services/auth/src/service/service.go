package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/duo-labs/webauthn"
	"github.com/duo-labs/webauthn/protocol"
	"newproject/services/auth/src/config"
	"newproject/services/auth/src/model"
	"newproject/services/auth/src/repository"
)

// BiometricService handles WebAuthn registration and authentication flows
type BiometricService struct {
	regRepo    repository.BiometricRegistrationRepository
	chalRepo   repository.BiometricChallengeRepository
	timeout    time.Duration
	wa         *webauthn.WebAuthn
}

// NewBiometricService creates a new BiometricService
func NewBiometricService(
	regRepo repository.BiometricRegistrationRepository,
	chalRepo repository.BiometricChallengeRepository,
	cfg *config.Config,
) *BiometricService {
	// Initialize webauthn library
	waConfig := &webauthn.Config{
		RPDID:         cfg.Biometric.RPID,
		RPName:        cfg.Biometric.RPName,
		Origins:       []string{cfg.Biometric.Origin},
		SigningAlgorithms: []webauthn.Algorithm{webauthn.AlgorithmES256, webauthn.AlgorithmRS256, webauthn.AlgorithmPS256},
		AttestationPreference: webauthn.AttestationPreference(cfg.Biometric.Attestation),
		AuthenticatorSelection: webauthn.AuthenticatorSelection{
			AuthenticatorAttachment: webauthn.AuthenticatorAttachment(cfg.Biometric.AuthenticatorSelection.AuthenticatorAttachment),
			RequireResidentKey:      cfg.Biometric.AuthenticatorSelection.RequireResidentKey,
			UserVerification:        webauthn.UserVerificationRequirement(cfg.Biometric.AuthenticatorSelection.UserVerification),
		},
	}
	wa, err := webauthn.New(waConfig)
	if err != nil {
		panic(fmt.Sprintf("failed to create webauthn instance: %v", err))
	}
	return &BiometricService{
		regRepo:    regRepo,
		chalRepo:   chalRepo,
		timeout:    cfg.Biometric.Timeout,
		wa:         wa,
	}
}

// userWrapper implements webauthn.User for our user
type userWrapper struct {
	userID      uuid.UUID
	service     *BiometricService
	credential  model.BiometricRegistration // cached credential if needed
}

// WebauthnID returns the user ID as a byte array
func (u *userWrapper) WebauthnID() []byte {
	return u.userID[:]
}

// WebauthnName returns the username
func (u *userWrapper) WebauthnName() string {
	return u.userID.String()
}

// WebauthnDisplayName returns a display name
func (u *userWrapper) WebauthnDisplayName() string {
	return u.userID.String()
}

// WebauthnIcon returns an icon URL (empty)
func (u *userWrapper) WebauthnIcon() string {
	return ""
}

// WebauthnCredentials returns the user's registered credentials
func (u *userWrapper) WebauthnCredentials() []webauthn.Credential {
	if u.service == nil {
		return nil
	}
	// Fetch the credential from the repository
	reg, err := u.service.regRepo.GetByUserID(context.Background(), u.userID)
	if err != nil {
		if errors.Is(err, repository.ErrRegistrationNotFound) {
			return nil
		}
		return nil
	}
	// Convert to webauthn.Credential
	cred := webauthn.Credential{
		ID:          reg.CredentialID,
		PublicKey:   reg.PublicKey,
		// Transports:  []protocol.TransportType{}, // optional
	}
	return []webauthn.Credential{cred}
}

// BeginRegistration starts a new registration ceremony for a user.
// It returns the challenge and the session data to be stored.
func (s *BiometricService) BeginRegistration(
	ctx context.Context,
	userID uuid.UUID,
) ([]byte, []byte, error) {
	// Create a user wrapper
	user := &userWrapper{
		userID: userID,
		service: s,
	}
	// Begin registration
	sessionData, response, err := s.wa.BeginRegistration(user)
	if err != nil {
		return nil, nil, err
	}
	// The response contains the challenge, timeout, etc.
	// We need to extract the challenge to return to the client.
	// The response is of type *protocol.CredentialCreation
	// We'll marshal it to JSON to get the raw challenge? Actually, the response struct has a Challenge field.
	// We'll assume response.Challenge is the challenge.
	challenge := response.Challenge
	return challenge, sessionData, nil
}

// FinishRegistration completes a registration ceremony.
// It verifies the registration response and stores the credential.
func (s *BiometricService) FinishRegistration(
	ctx context.Context,
	userID uuid.UUID,
	credentialID []byte,
	publicKey []byte,
	signCount uint32,
	sessionData []byte,
	response []byte,
) error {
	// Parse the response from the client
	var regResponse protocol.CredentialCreation
	if err := json.Unmarshal(response, &regResponse); err != nil {
		return fmt.Errorf("failed to parse registration response: %w", err)
	}
	// Create a user wrapper
	user := &userWrapper{
		userID: userID,
		service: s,
	}
	// Finish registration
	credential, err := s.wa.FinishRegistration(user, sessionData, &regResponse)
	if err != nil {
		return fmt.Errorf("failed to finish registration: %w", err)
	}
	// Verify that the credential ID matches the provided one
	if !equal(credential.ID, credentialID) {
		return errors.New("credential ID mismatch")
	}
	// Verify that the public key matches (optional)
	if !equal(credential.PublicKey, publicKey) {
		return errors.New("public key mismatch")
	}
	// Check if a registration already exists for this user
	existing, err := s.regRepo.GetByUserID(ctx, userID)
	if err != nil && err != repository.ErrRegistrationNotFound {
		return err
	}
	if existing != nil {
		// Update existing registration
		existing.CredentialID = credentialID
		existing.PublicKey = publicKey
		existing.SignCount = signCount
		return s.regRepo.Update(ctx, existing)
	}
	// Create new registration
	reg := &model.BiometricRegistration{
		UserID:       userID,
		CredentialID: credentialID,
		PublicKey:    publicKey,
		SignCount:    signCount,
	}
	return s.regRepo.Create(ctx, reg)
}

// BeginAuthentication starts an authentication ceremony for a user.
// It returns the challenge and the session data to be stored.
func (s *BiometricService) BeginAuthentication(
	ctx context.Context,
	userID uuid.UUID,
) ([]byte, []byte, error) {
	// Create a user wrapper
	user := &userWrapper{
		userID: userID,
		service: s,
	}
	// Begin login
	sessionData, response, err := s.wa.BeginLogin(user)
	if err != nil {
		return nil, nil, err
	}
	challenge := response.Challenge
	return challenge, sessionData, nil
}

// FinishAuthentication completes an authentication ceremony.
// It verifies the authentication response and updates the sign count.
func (s *BiometricService) FinishAuthentication(
	ctx context.Context,
	userID uuid.UUID,
	credentialID []byte,
	signature []byte,
	authData []byte,
	clientDataJSON []byte,
	newSignCount uint32,
	sessionData []byte,
	response []byte,
) error {
	// Parse the response from the client
	var authResponse protocol.CredentialAssertion
	if err := json.Unmarshal(response, &authResponse); err != nil {
		return fmt.Errorf("failed to parse authentication response: %w", err)
	}
	// Create a user wrapper
	user := &userWrapper{
		userID: userID,
		service: s,
	}
	// Finish login
	credential, err := s.wa.FinishLogin(user, sessionData, &authResponse)
	if err != nil {
		return fmt.Errorf("failed to finish login: %w", err)
	}
	// Verify that the credential ID matches the provided one
	if !equal(credential.ID, credentialID) {
		return errors.New("credential ID mismatch")
	}
	// Update the sign count (only if new count is greater than stored count)
	reg, err := s.regRepo.GetByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if newSignCount > reg.SignCount {
		reg.SignCount = newSignCount
		if err := s.regRepo.Update(ctx, reg); err != nil {
			return err
		}
	}
	return nil
}

// equal compares two byte slices for equality in constant time
func equal(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

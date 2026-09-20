package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"bytes"

	"github.com/duo-labs/webauthn/protocol"
	"github.com/duo-labs/webauthn/webauthn"
	"github.com/google/uuid"
	"newproject/services/auth/src/config"
	"newproject/services/auth/src/model"
	"newproject/services/auth/src/repository"
)

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrCredentialExists   = errors.New("credential already exists for this user")
	ErrInvalidChallenge   = errors.New("invalid or expired challenge")
	ErrCredentialNotFound = errors.New("credential not found")
	ErrInvalidSignature   = errors.New("invalid signature")
)

type BiometricService struct {
	wa         *webauthn.WebAuthn
	regRepo    repository.BiometricRegistrationRepository
	chalRepo   repository.BiometricChallengeRepository
	Timeout    time.Duration
}

func NewBiometricService(
	regRepo repository.BiometricRegistrationRepository,
	chalRepo repository.BiometricChallengeRepository,
	wa *webauthn.WebAuthn,
	cfg *config.Config,
) *BiometricService {
	if wa == nil {
		waConfig := &webauthn.Config{
			RPDisplayName: cfg.Biometric.RPName,
			RPID:          cfg.Biometric.RPID,
			RPOrigin:      cfg.Biometric.Origin,
			RPIcon:        cfg.Biometric.IconURL,
			AttestationPreference: protocol.ConveyancePreference(cfg.Biometric.Attestation),
			AuthenticatorSelection: protocol.AuthenticatorSelection{
				AuthenticatorAttachment: protocol.AuthenticatorAttachment(cfg.Biometric.AuthenticatorSelection.AuthenticatorAttachment),
				RequireResidentKey:    boolPtr(cfg.Biometric.AuthenticatorSelection.RequireResidentKey),
				UserVerification:      protocol.UserVerificationRequirement(cfg.Biometric.AuthenticatorSelection.UserVerification),
			},
			Timeout: 60000,
		}
		var err error
		wa, err = webauthn.New(waConfig)
		if err != nil {
			panic(fmt.Sprintf("failed to create webauthn instance: %v", err))
		}
	}

	return &BiometricService{
		wa:       wa,
		regRepo:  regRepo,
		chalRepo: chalRepo,
		Timeout:   cfg.Biometric.Timeout,
	}
}

func boolPtr(b bool) *bool {
	return &b
}

type userWrapper struct {
	userID uuid.UUID
	wa     *webauthn.WebAuthn
	reg    repository.BiometricRegistrationRepository
}

func (u *userWrapper) WebAuthnID() []byte {
	return u.userID[:]
}

func (u *userWrapper) WebAuthnName() string {
	return u.userID.String()
}

func (u *userWrapper) WebAuthnDisplayName() string {
	return u.userID.String()
}

func (u *userWrapper) WebAuthnIcon() string {
	return ""
}

func (u *userWrapper) WebAuthnCredentials() []webauthn.Credential {
	reg, err := u.reg.GetByUserID(context.Background(), u.userID)
	if err != nil {
		return nil
	}
	return []webauthn.Credential{
		{
			ID:        reg.CredentialID,
			PublicKey: reg.PublicKey,
		},
	}
}

func (s *BiometricService) BeginRegistration(
	ctx context.Context,
	userID uuid.UUID,
) ([]byte, []byte, error) {
	user := &userWrapper{
		userID: userID,
		wa:     s.wa,
		reg:    s.regRepo,
	}

	_, sessionData, err := s.wa.BeginRegistration(user)
	if err != nil {
		return nil, nil, err
	}

	challenge, err := base64.RawURLEncoding.DecodeString(sessionData.Challenge)
	if err != nil {
		return nil, nil, err
	}

	sessionDataBytes, err := json.Marshal(sessionData)
	if err != nil {
		return nil, nil, err
	}

	return challenge, sessionDataBytes, nil
}

func (s *BiometricService) FinishRegistration(
	ctx context.Context,
	userID uuid.UUID,
	credentialID []byte,
	publicKey []byte,
	signCount uint32,
	sessionData []byte,
	rawBody []byte,
) error {
	var sd webauthn.SessionData
	if err := json.Unmarshal(sessionData, &sd); err != nil {
		return ErrInvalidChallenge
	}

	user := &userWrapper{
		userID: userID,
		wa:     s.wa,
		reg:    s.regRepo,
	}

	req := &http.Request{
		Method: "POST",
		Body:   io.NopCloser(bytes.NewReader(rawBody)),
		Header: http.Header{},
	}

	cred, err := s.wa.FinishRegistration(user, sd, req)
	if err != nil {
		return err
	}

	existing, err := s.regRepo.GetByUserID(ctx, userID)
	if err == nil && existing != nil {
		existing.CredentialID = cred.ID
		existing.PublicKey = cred.PublicKey
		existing.SignCount = cred.Authenticator.SignCount
		existing.CredType = "public-key"
		return s.regRepo.Update(ctx, existing)
	}

	reg := &model.BiometricRegistration{
		UserID:       userID,
		CredentialID: cred.ID,
		PublicKey:    cred.PublicKey,
		SignCount:    signCount,
		CredType:     string(cred.AttestationType),
	}
	return s.regRepo.Create(ctx, reg)
}

func (s *BiometricService) BeginAuthentication(
	ctx context.Context,
	userID uuid.UUID,
) ([]byte, []byte, error) {
	user := &userWrapper{
		userID: userID,
		wa:     s.wa,
		reg:    s.regRepo,
	}

	_, sessionData, err := s.wa.BeginLogin(user)
	if err != nil {
		return nil, nil, err
	}

	challenge, err := base64.RawURLEncoding.DecodeString(sessionData.Challenge)
	if err != nil {
		return nil, nil, err
	}

	sessionDataBytes, err := json.Marshal(sessionData)
	if err != nil {
		return nil, nil, err
	}

	return challenge, sessionDataBytes, nil
}

func (s *BiometricService) FinishAuthentication(
	ctx context.Context,
	userID uuid.UUID,
	credentialID []byte,
	signature []byte,
	authData []byte,
	clientDataJSON []byte,
	newSignCount uint32,
	sessionData []byte,
	rawBody []byte,
) error {
	var sd webauthn.SessionData
	if err := json.Unmarshal(sessionData, &sd); err != nil {
		return ErrInvalidChallenge
	}

	user := &userWrapper{
		userID: userID,
		wa:     s.wa,
		reg:    s.regRepo,
	}

	req := &http.Request{
		Method: "POST",
		Body:   io.NopCloser(bytes.NewReader(rawBody)),
		Header: http.Header{},
	}

	cred, err := s.wa.FinishLogin(user, sd, req)
	if err != nil {
		return err
	}

	reg, err := s.regRepo.GetByCredentialID(ctx, cred.ID)
	if err != nil {
		return ErrCredentialNotFound
	}

	if newSignCount > reg.SignCount {
		reg.SignCount = newSignCount
		if err := s.regRepo.Update(ctx, reg); err != nil {
			return err
		}
	}

	return nil
}

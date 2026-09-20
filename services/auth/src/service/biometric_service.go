package service

import (
	"context"
	"errors"
	"time"

	"github.com/duo-labs/webauthn/webauthn"
	"github.com/google/uuid"
	"newproject/services/auth/src/config"
	"newproject/services/auth/src/model"
	"newproject/services/auth/src/repository"
	"newproject/services/auth/src/utils"
)

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrCredentialExists   = errors.New("credential already exists for this user")
	ErrInvalidChallenge   = errors.New("invalid or expired challenge")
	ErrCredentialNotFound = errors.New("credential not found")
	ErrInvalidSignature   = errors.New("invalid signature")
)

type BiometricService struct {
	webauthn    *webauthn.WebAuthn
	userRepo    repository.UserRepository // Assuming this exists from auth-service
	credRepo    repository.CredentialRepository
	challengeStore utils.ChallengeStore
}

// NewBiometricService creates a new biometric service instance
func NewBiometricService(
	webAuthn *webauthn.WebAuthn,
	userRepo repository.UserRepository,
	credRepo repository.CredentialRepository,
	challengeStore utils.ChallengeStore,
) *BiometricService {
	return &BiometricService{
		webauthn:    webAuthn,
		userRepo:    userRepo,
		credRepo:    credRepo,
		challengeStore: challengeStore,
	}
}

// BeginRegistration starts the WebAuthn registration process
// Returns the WebAuthn credential creation options and session data
func (s *BiometricService) BeginRegistration(
	ctx context.Context,
	userID uuid.UUID,
	userName string,
	displayName string,
) (*webauthn.CredentialCreation, *utils.SessionData, error) {
	// Check if user exists
	_, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, nil, ErrUserNotFound
	}

	// Generate a challenge
	challenge := s.challengeStore.GenerateChallenge()

	// Begin WebAuthn registration
	credentialCreationData, sessionData, err := s.webauthn.BeginRegistration(
		userID.String(), // userID as string
		userName,
		displayName,
		[]byte(challenge), // challenge
		webauthn.WithAuthenticatorSelection(webauthn.AuthenticatorSelection{
			RequireResidentKey:  false,
			RequireUserVerification: false,
		}),
		webauthn.WithAttestationPreference(webauthn.AttestationPreferDirect),
	)

	if err != nil {
		return nil, nil, err
	}

	// Store the session data (which includes the challenge) for later verification
	err = s.challengeStore.StoreSessionData(userID.String(), sessionData)
	if err != nil {
		return nil, nil, err
	}

	return credentialCreationData, sessionData, nil
}

// FinishRegistration completes the WebAuthn registration process
// Validates the response and stores the credential
func (s *BiometricService) FinishRegistration(
	ctx context.Context,
	userID uuid.UUID,
	credentialData *webauthn.CredentialCreation,
	responseData *webauthn.CredentialAssertion,
) (*model.Credential, error) {
	// Retrieve the stored session data
	sessionData, err := s.challengeStore.GetSessionData(userID.String())
	if err != nil {
		return nil, ErrInvalidChallenge
	}

	// Validate the registration response
	credential, err := s.webauthn.FinishRegistration(userID.String(), sessionData, credentialData, responseData)
	if err != nil {
		return nil, err
	}

	// Check if credential already exists for this user (optional, depending on policy)
	existingCreds, err := s.credRepo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, cred := range existingCreds {
		if cred.CredentialIDEqual(responseData.ID) {
			return nil, ErrCredentialExists
		}
	}

	// Create the credential model
	newCred := model.FromCredentialCreateData(userID, credentialData, credential.Name)

	// Save to database
	if err := s.credRepo.Create(ctx, newCred); err != nil {
		return nil, err
	}

	return newCred, nil
}

// BeginLogin starts the WebAuthn authentication process
// Returns the WebAuthn credential assertion options and session data
func (s *BiometricService) BeginLogin(
	ctx context.Context,
	userID uuid.UUID,
) (*webauthn.CredentialAssertion, *utils.SessionData, error) {
	// Get user's credentials
	credentials, err := s.credRepo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if len(credentials) == 0 {
		return nil, nil, ErrCredentialNotFound
	}

	// Build allow list of credential IDs
	var allowList []webauthn.CredentialDescriptor
	for _, cred := range credentials {
		allowList = append(allowList, cred.ToCredentialDescriptor())
	}

	// Generate a challenge
	challenge := s.challengeStore.GenerateChallenge()

	// Begin WebAuthn authentication
	credentialAssertionData, sessionData, err := s.webauthn.BeginLogin(
		allowList,
		webauthn.WithChallenge([]byte(challenge)),
	)

	if err != nil {
		return nil, nil, err
	}

	// Store the session data
	err = s.challengeStore.StoreSessionData(userID.String(), sessionData)
	if err != nil {
		return nil, nil, err
	}

	return credentialAssertionData, sessionData, nil
}

// FinishLogin completes the WebAuthn authentication process
// Validates the assertion and updates the credential sign count
func (s *BiometricService) FinishLogin(
	ctx context.Context,
	userID uuid.UUID,
	assertionData *webauthn.CredentialAssertion,
	responseData *webauthn.CredentialAssertion,
) (bool, error) {
	// Retrieve the stored session data
	sessionData, err := s.challengeStore.GetSessionData(userID.String())
	if err != nil {
		return false, ErrInvalidChallenge
	}

	// Validate the authentication response
	credential, err := s.webauthn.FinishLogin(userID.String(), sessionData, assertionData, responseData)
	if err != nil {
		return false, err
	}

	// Find the credential in our database
	storedCred, err := s.credRepo.GetByCredentialID(ctx, responseData.ID)
	if err != nil {
		return false, ErrCredentialNotFound
	}
	if storedCred == nil {
		return false, ErrCredentialNotFound
	}

	// Check if the user matches
	if storedCred.UserID != userID {
		return false, errors.New("credential does not belong to user")
	}

	// Check sign count to prevent replay attacks
	if responseData.AuthenticatorSignature.Count <= storedCred.SignCount {
		return false, errors.New("invalid signature count - possible replay attack")
	}

	// Update the credential with new sign count
	storedCred.SignCount = responseData.AuthenticatorSignature.Count
	storedCred.UpdatedAt = time.Now()

	if err := s.credRepo.Update(ctx, storedCred); err != nil {
		return false, err
	}

	return true, nil
}

// Helper method to check if credential ID matches
func (c *Credential) CredentialIDEqual(id []byte) bool {
	if len(c.CredentialID) != len(id) {
		return false
	}
	for i := range c.CredentialID {
		if c.CredentialID[i] != id[i] {
			return false
		}
	}
	return true
}

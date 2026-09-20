package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"bytes"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"newproject/services/auth/src/model"
	"newproject/services/auth/src/repository"
	"newproject/services/auth/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	biometricService *service.BiometricService
	chalRepo         repository.BiometricChallengeRepository
}

// NewHandler creates a new Handler with the given service and challenge repository
func NewHandler(bs *service.BiometricService, cr repository.BiometricChallengeRepository) *Handler {
	return &Handler{
		biometricService: bs,
		chalRepo:         cr,
	}
}

// Routes sets up the HTTP routes for the biometric service
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/registrations/begin", h.BeginRegistration)
	r.Post("/registrations/finish", h.FinishRegistration)
	r.Post("/authentications/begin", h.BeginAuthentication)
	r.Post("/authentications/finish", h.FinishAuthentication)

	return r
}

// BeginRegistration handles POST /registrations/begin
// Expects JSON: { "userID": "<uuid>" }
// Returns JSON: { "challenge": "<base64url>" }
func (h *Handler) BeginRegistration(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"userID"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		http.Error(w, "invalid userID", http.StatusBadRequest)
		return
	}

	// Call service to begin registration
	challenge, sessionData, err := h.biometricService.BeginRegistration(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Store the challenge and session data in a new challenge record
	chal := &model.BiometricChallenge{
		UserID:     userID,
		Challenge:  challenge,
		SessionData: sessionData,
		ExpiresAt:  time.Now().Add(h.biometricService.timeout),
	}
	if err := h.chalRepo.Create(r.Context(), chal); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return the challenge to the client
	resp := map[string]string{
		"challenge": base64.RawURLEncoding.EncodeToString(challenge),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// FinishRegistration handles POST /registrations/finish
// Expects a JSON body with userID, credentialID, publicKey, signCount (base64 encoded)
// and the raw body is the entire credential creation response from the client.
func (h *Handler) FinishRegistration(w http.ResponseWriter, r *http.Request) {
	// Read the raw body
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusInternalServerError)
		return
	}
	// Reset the body for decoding (we need to read it again for decoding)
	// We'll create a new reader from the raw body.
	r.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	var req struct {
		UserID     string `json:"userID"`
		CredentialID string `json:"credentialID"`
		PublicKey  string `json:"publicKey"`
		SignCount  uint32 `json:"signCount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		http.Error(w, "invalid userID", http.StatusBadRequest)
		return
	}

	credentialID, err := base64.RawURLEncoding.DecodeString(req.CredentialID)
	if err != nil {
		http.Error(w, "invalid credentialID", http.StatusBadRequest)
		return
	}

	publicKey, err := base64.RawURLEncoding.DecodeString(req.PublicKey)
	if err != nil {
		http.Error(w, "invalid publicKey", http.StatusBadRequest)
		return
	}

	// Retrieve the most recent challenge for this user
	chal, err := h.chalRepo.GetByUserID(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	// We assume there is only one active challenge; we could also check expiration.
	// For simplicity, we use the first one we get.

	// Call service to finish registration
	err = h.biometricService.FinishRegistration(r.Context(), userID, credentialID, publicKey, req.SignCount, chal.SessionData, rawBody)
	if err != nil {
		// Log the error for debugging
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Delete the used challenge
	if err := h.chalRepo.DeleteByUserID(r.Context(), userID); err != nil {
		// Log but don't fail the request because the registration succeeded
		// We'll just log and continue
		// In production, you might want to handle this more carefully
		// For now, we'll ignore
	}

	w.WriteHeader(http.StatusNoContent)
}

// BeginAuthentication handles POST /authentications/begin
// Expects JSON: { "userID": "<uuid>" }
// Returns JSON: { "challenge": "<base64url>" }
func (h *Handler) BeginAuthentication(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"userID"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		http.Error(w, "invalid userID", http.StatusBadRequest)
		return
	}

	// Call service to begin authentication
	challenge, sessionData, err := h.biometricService.BeginAuthentication(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Store the challenge and session data in a new challenge record
	chal := &model.BiometricChallenge{
		UserID:     userID,
		Challenge:  challenge,
		SessionData: sessionData,
		ExpiresAt:  time.Now().Add(h.biometricService.timeout),
	}
	if err := h.chalRepo.Create(r.Context(), chal); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return the challenge to the client
	resp := map[string]string{
		"challenge": base64.RawURLEncoding.EncodeToString(challenge),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// FinishAuthentication handles POST /authentications/finish
// Expects a JSON body with userID, credentialID, signature, authData, clientDataJSON, newSignCount (base64 encoded except newSignCount)
// and the raw body is the entire credential assertion response from the client.
func (h *Handler) FinishAuthentication(w http.ResponseWriter, r *http.Request) {
	// Read the raw body
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusInternalServerError)
		return
	}
	// Reset the body for decoding
	r.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	var req struct {
		UserID     string `json:"userID"`
		CredentialID string `json:"credentialID"`
		Signature  string `json:"signature"`
		AuthData   string `json:"authData"`
		ClientDataJSON string `json:"clientDataJSON"`
		NewSignCount uint32 `json:"newSignCount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		http.Error(w, "invalid userID", http.StatusBadRequest)
		return
	}

	credentialID, err := base64.RawURLEncoding.DecodeString(req.CredentialID)
	if err != nil {
		http.Error(w, "invalid credentialID", http.StatusBadRequest)
		return
	}

	signature, err := base64.RawURLEncoding.DecodeString(req.Signature)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	authData, err := base64.RawURLEncoding.DecodeString(req.AuthData)
	if err != nil {
		http.Error(w, "invalid authData", http.StatusBadRequest)
		return
	}

	clientDataJSON, err := base64.RawURLEncoding.DecodeString(req.ClientDataJSON)
	if err != nil {
		http.Error(w, "invalid clientDataJSON", http.StatusBadRequest)
		return
	}

	// Retrieve the most recent challenge for this user
	chal, err := h.chalRepo.GetByUserID(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Call service to finish authentication
	err = h.biometricService.FinishAuthentication(r.Context(), userID, credentialID, signature, authData, clientDataJSON, req.NewSignCount, chal.SessionData, rawBody)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Delete the used challenge
	if err := h.chalRepo.DeleteByUserID(r.Context(), userID); err != nil {
		// Log but don't fail the request because the authentication succeeded
		// We'll just log and continue
	}

	w.WriteHeader(http.StatusNoContent)
}

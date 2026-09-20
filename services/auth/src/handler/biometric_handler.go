package handler

import (
	"context"
	"encoding/base64"
	"net/http"

	"github.com/duo-labs/webauthn/webauthn"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"newproject/services/auth/src/model"
	"newproject/services/auth/src/service"
	"newproject/services/auth/src/utils"
)

// BiometricHandler handles HTTP requests for biometric/WebAuthn operations
type BiometricHandler struct {
	biometricService *service.BiometricService
}

// NewBiometricHandler creates a new biometric handler
func NewBiometricHandler(biometricService *service.BiometricService) *BiometricHandler {
	return &BiometricHandler{biometricService: biometricService}
}

// BeginRegistrationHandler handles the start of WebAuthn registration
func (h *BiometricHandler) BeginRegistrationHandler(c *gin.Context) {
	var req struct {
		UserID    string `json:"user_id" binding:"required,uuid"`
		UserName  string `json:"user_name" binding:"required"`
		DisplayName string `json:"display_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	// Start registration
	credentialCreation, sessionData, err := h.biometricService.BeginRegistration(
		c.Request.Context(),
		userID,
		req.UserName,
		req.DisplayName,
	)
	if err != nil {
		switch err {
		case service.ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start registration"})
		}
		return
	}

	// Encode the credential creation data for client
	response := map[string]interface{}{
		"publicKey": credentialCreation,
		"sessionID": sessionData.SessionID, // Return session ID to client
	}

	c.JSON(http.StatusOK, response)
}

// FinishRegistrationHandler handles the completion of WebAuthn registration
func (h *BiometricHandler) FinishRegistrationHandler(c *gin.Context) {
	var req struct {
		UserID           string                `json:"user_id" binding:"required,uuid"`
		SessionID        string                `json:"session_id" binding:"required"`
		CredentialData   webauthn.CredentialCreation `json:"credential"`
		ResponseData     webauthn.CredentialAssertion `json:"response"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	// Finish registration
	credential, err := h.biometricService.FinishRegistration(
		c.Request.Context(),
		userID,
		&req.CredentialData,
		&req.ResponseData,
	)
	if err != nil {
		switch err {
		case service.ErrInvalidChallenge:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired challenge"})
		case service.ErrCredentialExists:
			c.JSON(http.StatusConflict, gin.H{"error": "credential already exists"})
		case service.ErrCredentialNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "credential not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete registration"})
		}
		return
	}

	// Return success
	c.JSON(http.StatusCreated, gin.H{
		"message": "registration successful",
		"credential_id": base64.RawURLEncoding.EncodeToString(credential.CredentialID),
	})
}

// BeginLoginHandler handles the start of WebAuthn authentication
func (h *BiometricHandler) BeginLoginHandler(c *gin.Context) {
	var req struct {
		UserID string `json:"user_id" binding:"required,uuid"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	// Start login
	credentialAssertion, sessionData, err := h.biometricService.BeginLogin(
		c.Request.Context(),
		userID,
	)
	if err != nil {
		switch err {
		case service.ErrCredentialNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "no credentials found for user"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start authentication"})
		}
		return
	}

	// Encode the credential assertion data for client
	response := map[string]interface{}{
		"publicKey": credentialAssertion,
		"sessionID": sessionData.SessionID, // Return session ID to client
	}

	c.JSON(http.StatusOK, response)
}

// FinishLoginHandler handles the completion of WebAuthn authentication
func (h *BiometricHandler) FinishLoginHandler(c *gin.Context) {
	var req struct {
		UserID           string                `json:"user_id" binding:"required,uuid"`
		SessionID        string                `json:"session_id" binding:"required"`
		AssertionData    webauthn.CredentialAssertion `json:"assertion"`
		ResponseData     webauthn.CredentialAssertion `json:"response"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	// Finish login
	success, err := h.biometricService.FinishLogin(
		c.Request.Context(),
		userID,
		&req.AssertionData,
		&req.ResponseData,
	)
	if err != nil {
		switch err {
		case service.ErrInvalidChallenge:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired challenge"})
		case service.ErrCredentialNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "credential not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete authentication"})
		}
		return
	}

	if !success {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "authentication successful",
	})
}

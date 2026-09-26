package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// WebAuthnHandler biometric/passkey registration aur authentication handle karta hai.
type WebAuthnHandler struct {
	svc *service.WebAuthnService
}

// NewWebAuthnHandler naya handler banata hai
func NewWebAuthnHandler(svc *service.WebAuthnService) *WebAuthnHandler {
	return &WebAuthnHandler{svc: svc}
}

// currentUserID request se authenticated user ka ID nikalta hai
// AuthMiddleware isko context me "user_id" ke naam se rakhta hai
func currentUserID(c *gin.Context) (uuid.UUID, bool) {
	raw, ok := c.Get("user_id")
	if !ok {
		return uuid.Nil, false
	}
	uid, err := uuid.Parse(raw.(string))
	if err != nil {
		return uuid.Nil, false
	}
	return uid, true
}

// loadUser user ko DB se load karta hai
func (h *WebAuthnHandler) loadUser(ctxUserID uuid.UUID) (*model.User, error) {
	var user model.User
	if err := h.svc.GetDB().Where("id = ?", ctxUserID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// ---------------------------------------------------------------------------
// REGISTRATION - naya biometric device enroll karna
// ---------------------------------------------------------------------------

// BeginRegistration registration ka challenge generate karta hai (Step 1/2)
//
// Hinglish: pehla step - challenge bhejte hain, browser device me key pair banayega
func (h *WebAuthnHandler) BeginRegistration(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.loadUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	webAuthnUser := service.NewWebAuthnUser(user, h.svc.GetDB())

	options, sessionData, err := h.svc.GetWebAuthn().BeginRegistration(webAuthnUser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin registration"})
		return
	}

	// Session ko JSON me serialize karke DB me store karte hain
	// (library ka apna Marshal/Unmarshal use karne ke bajay plain JSON use kar rahe hain,
	//  kyunki v0.18 me wo methods unexported package me move ho gaye hain)
	sessionBytes, err := json.Marshal(sessionData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to serialize session"})
		return
	}

	if err := h.svc.SaveSession(c.Request.Context(), &userID,
		model.WebAuthnSessionTypeRegistration, sessionData.Challenge, sessionBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save session"})
		return
	}

	c.JSON(http.StatusOK, options)
}

// FinishRegistration attestation verify karke credential store karta hai (Step 2/2)
//
// *** ATTESTATION VERIFICATION ***
// Ye check karta hai: challenge match, origin sahi, RP ID sahi, attestation valid.
// Iske baad credential (public key) DB me save hota hai - yahi "signature model" hai.
//
// Hinglish: device ka signature verify karke register karte hain
func (h *WebAuthnHandler) FinishRegistration(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.loadUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	// Challenge session se nikalo
	challenge := c.PostForm("challenge")
	if challenge == "" {
		// JSON body me bhi aa sakta hai (content-type ke hisaab se)
		challenge = c.GetHeader("X-Challenge")
	}

	// Session lookup
	session, err := h.svc.GetSessionByChallenge(c.Request.Context(), challenge,
		model.WebAuthnSessionTypeRegistration)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "challenge not found or expired"})
		return
	}

	// Session deserialize karo
	var sessionData webauthn.SessionData
	if err := json.Unmarshal(session.SessionData, &sessionData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session data"})
		return
	}

	webAuthnUser := service.NewWebAuthnUser(user, h.svc.GetDB())

	// *** ATTESTATION VERIFY ***
	// Library raw http.Request leta hai (v0.18 API) - wo khud body parse karta hai
	credential, err := h.svc.GetWebAuthn().FinishRegistration(webAuthnUser, sessionData, c.Request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attestation verification failed"})
		return
	}

	// Credential store karo (public key save hoti hai)
	if err := h.svc.StoreCredential(c.Request.Context(), userID, credential, "New device"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store credential"})
		return
	}

	// Challenge consume karo (one-time use)
	h.svc.DeleteSession(c.Request.Context(), session.ID)

	// Plain English message (user-facing)
	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"message":  "Biometric credential registered successfully.",
	})
}

// ---------------------------------------------------------------------------
// AUTHENTICATION - biometric se login
// ---------------------------------------------------------------------------

// BeginAuthentication login challenge generate karta hai
func (h *WebAuthnHandler) BeginAuthentication(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}

	var user model.User
	if err := h.svc.GetDB().Where("email = ?", req.Email).First(&user).Error; err != nil {
		// Email enumeration rokne ke liye generic error
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	// Is user ke paas credential hai ya nahi
	creds, err := h.svc.ListCredentials(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load credentials"})
		return
	}
	if len(creds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":         "no biometric credential registered for this account",
			"hasCredential": false,
		})
		return
	}

	webAuthnUser := service.NewWebAuthnUser(&user, h.svc.GetDB())

	options, sessionData, err := h.svc.GetWebAuthn().BeginLogin(webAuthnUser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin authentication"})
		return
	}

	sessionBytes, err := json.Marshal(sessionData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to serialize session"})
		return
	}

	if err := h.svc.SaveSession(c.Request.Context(), &user.ID,
		model.WebAuthnSessionTypeAuthentication, sessionData.Challenge, sessionBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save session"})
		return
	}

	c.JSON(http.StatusOK, options)
}

// FinishAuthentication SIGNATURE verify karta hai
//
// *** YE SABSE IMPORTANT HAI ***
// Device ne apni PRIVATE key se signature banaya hai. Hum us signature ko stored
// PUBLIC key se verify karte hain. Match = authenticated.
//
// Private key server par KABHI nahi aata - sirf device ke secure element me rehta hai.
// Isliye ye password se zyada secure aur phishing-resistant hai.
//
// Hinglish: signature verify karte hain - device ki private key se bana hua
func (h *WebAuthnHandler) FinishAuthentication(c *gin.Context) {
	challenge := c.PostForm("challenge")
	if challenge == "" {
		challenge = c.GetHeader("X-Challenge")
	}

	session, err := h.svc.GetSessionByChallenge(c.Request.Context(), challenge,
		model.WebAuthnSessionTypeAuthentication)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "challenge not found or expired"})
		return
	}

	var user model.User
	if err := h.svc.GetDB().Where("id = ?", session.UserID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var sessionData webauthn.SessionData
	if err := json.Unmarshal(session.SessionData, &sessionData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session data"})
		return
	}

	webAuthnUser := service.NewWebAuthnUser(&user, h.svc.GetDB())

	// *** SIGNATURE VERIFICATION ***
	_, err = h.svc.GetWebAuthn().FinishLogin(webAuthnUser, sessionData, c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "signature verification failed"})
		return
	}

	h.svc.DeleteSession(c.Request.Context(), session.ID)

	// Plain English message (user-facing)
	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"email":    user.Email,
		"message":  "Biometric authentication successful.",
	})
}

// ListCredentials user ke registered biometric devices dikhata hai
func (h *WebAuthnHandler) ListCredentials(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	creds, err := h.svc.ListCredentials(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list credentials"})
		return
	}

	// Sirf safe fields bhejo (public key expose nahi karna)
	type credResponse struct {
		ID           string    `json:"id"`
		Name         string    `json:"name"`
		Transport    string    `json:"transport"`
		SignCount    uint32    `json:"sign_count"`
		CloneWarning bool      `json:"clone_warning"`
		CreatedAt    time.Time `json:"created_at"`
	}

	out := make([]credResponse, 0, len(creds))
	for _, cr := range creds {
		out = append(out, credResponse{
			ID:           cr.CredentialID,
			Name:         cr.Name,
			Transport:    cr.Transport,
			SignCount:    cr.SignCount,
			CloneWarning: cr.CloneWarning,
			CreatedAt:    cr.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"credentials": out})
}

// DeleteCredential user apna biometric device unregister kar sakta hai
func (h *WebAuthnHandler) DeleteCredential(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	credentialID := c.Param("id")
	if err := h.svc.DeleteCredential(c.Request.Context(), userID, credentialID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete credential"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Credential removed."})
}

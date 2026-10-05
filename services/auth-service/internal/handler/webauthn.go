package handler

import (
	"context"
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

	// securitySvc evaluates the mandatory PIN/questions/biometric gate.
	// Read-only use: a passkey login must not be able to skip it.
	securitySvc *service.SecurityService

	// authSvc issues the session once a signature is verified.
	//
	// This field is what turned the passkey flow from a dead end into a login
	// method. It is NOT optional and deliberately has no fallback: if the
	// auth service is missing, a verified passkey returns 503 rather than a
	// cheerful `{"verified": true}` that grants nothing. A success response that
	// does not log anybody in is worse than an error, because the client moves
	// on to the password form and nobody learns the passkey path is broken.
	authSvc *service.AuthService
}

// NewWebAuthnHandler naya handler banata hai
func NewWebAuthnHandler(
	svc *service.WebAuthnService,
	authSvc *service.AuthService,
	securitySvc *service.SecurityService,
) *WebAuthnHandler {
	return &WebAuthnHandler{svc: svc, authSvc: authSvc, securitySvc: securitySvc}
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

// deviceInfoFromRequest reads the same headers the password login reads.
//
// One function for both login paths on purpose. It used to be inline in
// `Login`, and when the passkey path needed it the two obvious choices were both
// bad: duplicate the six lines (they drift, and the drift is invisible - the
// session row just has a blank device) or skip it (the passkey session carries
// no fingerprint, so "log out of this device only" cannot match it). Sharing the
// reader means both logins produce comparable device records.
func deviceInfoFromRequest(r *http.Request) model.DeviceInfo {
	return model.DeviceInfo{
		DeviceName:  r.Header.Get("X-Device-Name"),
		DeviceType:  r.Header.Get("X-Device-Type"),
		Platform:    r.Header.Get("X-Platform"),
		Browser:     r.Header.Get("X-Browser"),
		Fingerprint: r.Header.Get("X-Fingerprint"),
	}
}

// securitySetupComplete reports whether the mandatory gate is already satisfied.
//
// Deliberately answers the same question the password login answers, from the
// same source, so a passkey cannot be used to skip the PIN -> questions ->
// biometric flow. A passkey login is a different way to prove WHO you are, not a
// waiver of what the account must have configured.
//
// Returns false whenever the profile cannot be read. A passkey login must never
// be the reason a user reaches the dashboard without a PIN.
func (h *WebAuthnHandler) securitySetupComplete(ctx context.Context, userID uuid.UUID) bool {
	if h.securitySvc == nil {
		// No security service means the gate cannot be evaluated. Fail closed.
		return false
	}
	profile, err := h.securitySvc.GetSetupStatus(ctx, userID)
	if err != nil {
		return false
	}
	return profile.SecuritySetupComplete
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

// FinishAuthentication SIGNATURE verify karta hai AUR SESSION ISSUE karta hai
//
// *** YE SABSE IMPORTANT HAI ***
// Device ne apni PRIVATE key se signature banaya hai. Hum us signature ko stored
// PUBLIC key se verify karte hain. Match = authenticated.
//
// Private key server par KABHI nahi aata - sirf device ke secure element me rehta hai.
// Isliye ye password se zyada secure aur phishing-resistant hai.
//
// Hinglish: signature verify karte hain - device ki private key se bana hua
//
// ----------------------------------------------------------------------------
// PEHLE YE HANDLER DEAD END THA
// ----------------------------------------------------------------------------
//
// It returned `{"verified": true}` and nothing else. No token, no session, no
// cookie - so there was no possible next step. The strongest authentication this
// product supports was performed correctly and then discarded, and a password
// remained the only way to get in. The comment above called it "more secure than
// a password", which was true of the signature and false of the product.
//
// Now a verified assertion produces the SAME session a password login produces:
// same TTL, same revocation, same session_id linkage, same device record, same
// audit event. Issued by `AuthService.LoginWithWebAuthn`, which shares the
// session-creation code with the password path rather than reimplementing it.
func (h *WebAuthnHandler) FinishAuthentication(c *gin.Context) {
	// Fail closed and LOUD. A handler that cannot issue a session has no business
	// reporting success.
	if h.authSvc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "passkey_login_unavailable",
			"message": "Passkey login is not wired on this deployment.",
		})
		return
	}

	challenge := c.PostForm("challenge")
	if challenge == "" {
		challenge = c.GetHeader("X-Challenge")
	}
	if challenge == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "challenge is required"})
		return
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

	// Challenge consume karo (one-time use).
	//
	// Done AFTER verification, and unconditionally on the success path only. A
	// challenge that survives a failed attempt could be replayed, and a challenge
	// consumed before verification would let anyone who knows a user's challenge
	// burn it - a denial of service on that one login.
	h.svc.DeleteSession(c.Request.Context(), session.ID)

	// ---- Issue the session ----
	//
	// Client info goes through the context so the `sessions` row carries the real
	// IP and user-agent. Without it the device panel shows a blank device, which
	// is the same class of bug as "session_id is always uuid.Nil": the row is
	// written, and the one column that identifies which machine it came from is
	// missing.
	loginCtx := service.WithClientInfo(
		c.Request.Context(), clientIP(c.Request), c.Request.UserAgent(),
	)

	issuedUser, tokenPair, err := h.authSvc.LoginWithWebAuthn(loginCtx, &user, deviceInfoFromRequest(c.Request))
	if err != nil {
		// `LoginWithWebAuthn` re-checks IsActive and IsVerified. Both failures map
		// to the same 401 the password path returns for bad credentials, on
		// purpose - a passkey on a deactivated account must not be distinguishable
		// from a passkey on an account that does not exist.
		if err == service.ErrUserInactive || err == service.ErrUserNotVerified {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "passkey not usable for this account",
				"message": "This passkey cannot sign you in right now.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"email":    issuedUser.Email,
		// THE MISSING PIECE. Without this there is no way to become signed in
		// from a verified passkey, which is why the whole flow was a dead end.
		"tokens": tokenPair,
		"user": gin.H{
			"id":          issuedUser.ID,
			"email":       issuedUser.Email,
			"username":    issuedUser.Username,
			"full_name":   issuedUser.FullName,
			"is_active":   issuedUser.IsActive,
			"is_verified": issuedUser.IsVerified,
		},
		// Mirrors the password response's flag so one client can parse both.
		// The mandatory PIN/questions/biometric gate is applied identically -
		// see `security_profiles`, which a passkey login does not bypass.
		"security_setup_required": h.securitySetupComplete(c.Request.Context(), issuedUser.ID),
		"message":                 "Passkey authentication successful.",
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

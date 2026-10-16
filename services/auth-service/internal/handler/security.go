// Security HTTP handlers - PIN, questions, lockout, device limits, audit
//
// Hinglish comments: har block ka arth
package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/src/redis"
)

// SecurityHandler security endpoints handle karta hai
type SecurityHandler struct {
	svc            *service.SecurityService
	authSvc        *service.AuthService
	mfaChallengeStore *redis.MFAChallengeStore
}

// NewSecurityHandler naya handler banata hai
func NewSecurityHandler(svc *service.SecurityService, authSvc *service.AuthService, mfaStore *redis.MFAChallengeStore) *SecurityHandler {
	return &SecurityHandler{svc: svc, authSvc: authSvc, mfaChallengeStore: mfaStore}
}

// SetMFAChallengeStore MFA challenge store set karta hai (post-construction set ke liye)
func (h *SecurityHandler) SetMFAChallengeStore(store *redis.MFAChallengeStore) {
	h.mfaChallengeStore = store
}

// currentUserID middleware se context me rakhta hai
func secUserID(c *gin.Context) (uuid.UUID, bool) {
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

// clientIP request se client IP nikalta hai (proxy aware)
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	return r.RemoteAddr
}

func secEmail(c *gin.Context) string {
	if v, ok := c.Get("email"); ok {
		return v.(string)
	}
	return ""
}

// LockoutStatus GET /api/v1/security/lockout-status?email=...
// PUBLIC endpoint - login screen use karta hai. Check karta hai ki user
// lockout me hai ya nahi, taaki UI sahi prompt dikhaye.
func (h *SecurityHandler) LockoutStatus(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email query param is required"})
		return
	}

	user, err := h.authSvc.GetUserByEmailForSecurity(c.Request.Context(), email)
	if err != nil || user == nil {
		// User exist nahi karta - generic response (enumeration avoid)
		c.JSON(http.StatusOK, gin.H{
			"locked": false,
			"state":  model.LockoutStateNone,
		})
		return
	}

	state, remaining, err := h.svc.GetLockoutStatus(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check lockout"})
		return
	}

	hasPIN, _ := h.svc.HasPIN(c.Request.Context(), user.ID)

	// Kitne attempts bache hain (user ko "2 attempts left" dikhane ke liye)
	profile, _ := h.svc.GetSetupStatus(c.Request.Context(), user.ID)
	attemptsLeft := model.MaxFailedPasswords - profile.FailedPasswordAttempts
	if attemptsLeft < 0 {
		attemptsLeft = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"locked":                state != model.LockoutStateNone,
		"state":                 state,
		"seconds_remaining":     remaining,
		"pin_configured":        hasPIN,
		"max_password_attempts": model.MaxFailedPasswords,
		"attempts_remaining":    attemptsLeft,
		"failed_attempts":       profile.FailedPasswordAttempts,
	})
}

// ---- Setup status (dashboard gate ke liye) ----

// SetupStatus GET /api/v1/security/setup-status
// Frontend isse check karta hai ki dashboard access allowed hai ya nahi
func (h *SecurityHandler) SetupStatus(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	profile, err := h.svc.GetSetupStatus(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load setup status"})
		return
	}

	questions, _ := h.svc.GetSecurityQuestions(c.Request.Context(), userID)
	if questions == nil {
		questions = []string{}
	}

	// Lockout bhi saath me batao (UI countdown dikhata hai)
	lockoutState, remaining, _ := h.svc.GetLockoutStatus(c.Request.Context(), userID)

	// ---- email_verified bhi bhejo ----
	//
	// YE FIELD KYUN ADD KI GAYI: web app ke middleware ko gate ka ORDER decide
	// karna hai, aur wo sirf `setup_complete` dekh raha tha. Usse ye pata hi
	// nahi chalta tha ki user ne email verify ki hai ya nahi.
	//
	// Result: register ke baad auth-service ek valid session token deta hai
	// (jiska `exp` future me hai), to middleware ka JWT check pass ho jata tha,
	// aur user UNVERIFIED hote hue bhi seedha security-setup gate par pahunch
	// jata tha - yaani 6-digit PIN form, email verification ke BINA.
	//
	// Spec order ye hai: email verify -> security setup -> app. Isi liye ye
	// value ab response me hai taaki middleware pehle verification check kar
	// sake, security setup ka nahi.
	//
	// FAIL-CLOSED: user lookup fail ho to `false` bhejte hain (verified maan
	// kar aage badhna secure nahi hota).
	emailVerified := false
	if u, uErr := h.authSvc.GetUserByID(c.Request.Context(), userID); uErr == nil && u != nil {
		emailVerified = u.IsVerified
	}

	// REQUIREMENTS (SPEC):
	//   - pin_configured
	//   - biometric_registered
	//   - security_questions_configured (exactly 3)
	//   - setup_complete = teeno ka AND
	c.JSON(http.StatusOK, gin.H{
		"pin_configured":                profile.PINConfigured,
		"biometric_registered":          profile.BiometricRegistered,
		"security_questions_configured": profile.SecurityQuestionsConfigured,
		"setup_complete":                profile.SecuritySetupComplete,
		"configured_questions":          questions,
		"required_questions":            model.RequiredSecurityQuestions,
		"lockout_state":                 lockoutState,
		"lockout_seconds_remaining":     remaining,
		"email_verified":                emailVerified,
	})
}

// ---- PIN ----

// SetPIN POST /api/v1/security/pin
func (h *SecurityHandler) SetPIN(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		PIN string `json:"pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pin is required"})
		return
	}

	if err := h.svc.SetPIN(c.Request.Context(), userID, req.PIN); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "PIN configured successfully",
		"digits":  model.PINLength,
	})
}

// ChangePIN PUT /api/v1/security/pin
// SPEC: OLD PIN VERIFICATION ZAROORI (double verification ka first vector)
func (h *SecurityHandler) ChangePIN(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		OldPIN string `json:"old_pin"`
		NewPIN string `json:"new_pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "old_pin and new_pin are required"})
		return
	}

	if err := h.svc.ChangePIN(c.Request.Context(), userID, req.OldPIN, req.NewPIN); err != nil {
		switch {
		// Old PIN galat = specific error
		case err == service.ErrOldPINIncorrect:
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "current PIN is incorrect",
				"code":    "OLD_PIN_INCORRECT",
				"message": "Verification failed. PIN was not changed.",
			})
			return
		// Naya PIN purane jaisa = reject
		case err == service.ErrNewPINSameAsOld:
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "same_pin",
				"message": "Your new PIN must be different from your current PIN.",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// ---- SESSION INVALIDATION (security-critical) ----
	// PIN change hone par SAARE sessions revoke kar dete hain - taaki agar
	// purana PIN kisi aur ke haath se chura hua tha (shared device, shoulder
	// surf, lost phone), to uska session bhi mar jaye. Warna attacker ka
	// JWT valid rehta aur PIN change karna bekaar ho jata.
	//
	// NOTE: is caller ka apna session bhi revoke ho jata hai. Isliye response
	// me `reauth_required: true` bhejte hain, taaki frontend user ko turant
	// logout karke naye PIN se dobara login karwaye.
	revoked, err := h.svc.InvalidateAllSessionsForUser(c.Request.Context(), userID)
	if err != nil {
		// PIN change ho chuka hai; sirf session cleanup fail hua.
		// Log karke continue karte hain - user ko galat error mat dikhao
		// kyunki uska PIN actually change ho gaya hai.
		c.Header("X-Session-Invalidation", "failed")
	} else {
		c.Header("X-Sessions-Revoked", strconv.Itoa(revoked))
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "PIN changed successfully",
		"reauth_required":  true,
		"sessions_revoked": revoked,
	})
}

// VerifyPIN POST /api/v1/security/pin/verify
// LOGIN FLOW me use hota hai (lockout recovery).
// Galat PIN -> 3 minute block
func (h *SecurityHandler) VerifyPIN(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
		PIN   string `json:"pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email and pin are required"})
		return
	}

	// User dhoondho
	user, err := h.authSvc.GetUserByEmailForSecurity(c.Request.Context(), req.Email)
	if err != nil || user == nil {
		// Email enumeration avoid karo - generic error
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	ip := clientIP(c.Request)
	ua := c.Request.UserAgent()

	remaining, err := h.svc.VerifyPIN(c.Request.Context(), user.ID, req.PIN, req.Email, ip, ua)

	if err == service.ErrAccountBlocked {
		c.JSON(http.StatusLocked, gin.H{
			"error":             "account blocked",
			"message":           "Warning: Account will be blocked if biometric credentials are not verified within 3 minutes.",
			"seconds_remaining": remaining,
			"blocked":           true,
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid PIN"})
		return
	}

	// Mark MFA as verified for this user so subsequent login doesn't require MFA again
	if h.mfaChallengeStore != nil {
		if err := h.mfaChallengeStore.MarkVerified(c.Request.Context(), user.ID); err != nil {
			log.Printf("[MFA] failed to mark verified for %s: %v", user.Email, err)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"message":  "PIN verified. Please proceed with login.",
	})
}

// ---- Security questions ----

// AvailableQuestions GET /api/v1/security/questions/available
func (h *SecurityHandler) AvailableQuestions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"questions": service.SecurityQuestions,
		"required":  model.RequiredSecurityQuestions,
	})
}

// SetSecurityQuestions PUT /api/v1/security/questions
// SPEC: EXACTLY 3 questions
func (h *SecurityHandler) SetSecurityQuestions(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Questions map[string]string `json:"questions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questions object is required"})
		return
	}

	if err := h.svc.SetSecurityQuestions(c.Request.Context(), userID, req.Questions); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Security questions configured successfully",
		"required": model.RequiredSecurityQuestions,
	})
}

// ---- Biometric ----

// MarkBiometric POST /api/v1/security/biometric/complete
// WebAuthn registration ke baad call hota hai taaki setup gate update ho
func (h *SecurityHandler) MarkBiometric(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	err := h.svc.MarkBiometricRegistered(
		c.Request.Context(), userID, secEmail(c), clientIP(c.Request), c.Request.UserAgent(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	profile, _ := h.svc.GetSetupStatus(c.Request.Context(), userID)
	c.JSON(http.StatusOK, gin.H{
		"message":        "Biometric registered",
		"setup_complete": profile.SecuritySetupComplete,
	})
}

// ---- Audit (Awareness Reports) ----

// SecurityEvents GET /api/v1/security/events
// Superadmin dashboard ka "Awareness Reports" grid isko consume karta hai
func (h *SecurityHandler) SecurityEvents(c *gin.Context) {
	events, err := h.svc.GetSecurityEvents(c.Request.Context(), 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load events"})
		return
	}

	// Tamper indicators alag se nikaalne se UI ko aasan hota hai
	type flagged struct {
		Event     model.SecurityEvent `json:"event"`
		Critical  bool                `json:"critical"`
		Indicator string              `json:"indicator"`
	}

	criticalTypes := map[string]bool{
		model.EventLockoutTriggered:    true,
		model.EventDeviceLimitExceeded: true,
		model.EventConfigTamper:        true,
		model.EventPINFailed:           true,

		// TRIAL_BLOCKED_DEVICE is CRITICAL, and that is a PRODUCT decision rather
		// than a severity judgement.
		//
		// A refused trial means one browser has already collected a free offer. Once
		// is somebody's family member on a shared laptop — the innocent case the cap
		// was specifically designed NOT to punish. Repeatedly is an operation.
		//
		// The attempt COUNT rides in the event detail, because the type alone cannot
		// separate those two, and an operator reading a wall of identical events
		// learns nothing. See `service.TrialBlockedDetail`.
		//
		// Being CRITICAL also means it needed NO new alert machinery: it flows into
		// the superadmin red banner and the acknowledgement list through the existing
		// path. One map entry was the whole feature.
		model.EventTrialBlockedDevice: true,
	}

	var out []flagged
	for _, e := range events {
		out = append(out, flagged{
			Event:     e,
			Critical:  criticalTypes[e.EventType],
			Indicator: indicatorFor(e.EventType),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"total":  len(events),
		"events": out,
	})
}

// indicatorFor event type se warning indicator text banata hai
func indicatorFor(eventType string) string {
	switch eventType {
	case model.EventLockoutTriggered:
		return "ACCOUNT LOCKOUT TRIGGERED"
	case model.EventDeviceLimitExceeded:
		return "DEVICE LIMIT BREACH ATTEMPT"
	case model.EventConfigTamper:
		return "UNAUTHORIZED CONFIG MODIFICATION"
	case model.EventPINFailed:
		return "INCORRECT SECURITY PIN"
	case model.EventLoginFailed:
		return "FAILED LOGIN ATTEMPT"
	case model.EventSecuritySetupCompleted:
		return "SECURITY SETUP COMPLETED"
	case model.EventLoginSuccess:
		return "LOGIN SUCCESS"
	default:
		return strings.ToUpper(strings.ReplaceAll(eventType, "_", " "))
	}
}

// SkipBiometric - user ke EXPLICIT "biometric nahi chahiye" decision ko record karta hai.
//
// ---- YE "MARK AS REGISTERED" NAHI HAI (wo bug tha) ----
// Pehle gate ka skip button `biometric/complete` call karta tha, jo sirf
// recompute karta tha - koi credential CREATE nahi karta. Isliye
// capable device par:
//
//	bioCount = 0, capable = true  ->  complete = false
//
// Frontend optimistically complete set karta tha, par middleware wapas
// security-setup bhej deta tha -> LOOP.
//
// Is endpoint se decision PERSIST hota hai, aur completion rule isko
// "satisfied" maanta hai. Loop khatam.
func (h *SecurityHandler) SkipBiometric(c *gin.Context) {
	userID, ok := secUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if err := h.svc.SkipBiometricSetup(
		c.Request.Context(), userID, secEmail(c), clientIP(c.Request), c.Request.UserAgent(),
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	profile, _ := h.svc.GetSetupStatus(c.Request.Context(), userID)
	c.JSON(http.StatusOK, gin.H{
		"message":             "Biometric setup skipped",
		"biometric_opted_out": true,
		"setup_complete":      profile.SecuritySetupComplete,
	})
}

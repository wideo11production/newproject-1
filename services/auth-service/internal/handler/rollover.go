package handler

// ============================================================================
// SECURITY ROLLOVER HANDLERS  (PIN + Password)
// ============================================================================
//
// Endpoints:
//   PUT /api/v1/auth/security/pin/rollover  - old PIN verify -> new PIN
//   PUT /api/v1/auth/password              - old password -> new password
//
// SECURITY:
//   - current SESSION ID token/session se aata hai (body se nahi) - ye
//     zaroori hai taaki current device logout na ho
//   - old credential VERIFY hota hai pehle (bcrypt) - koi hijacked session
//     apna credential nahi badal sakta
//   - saare DUSRE sessions + refresh tokens marte hain
//
// Hinglish comments: har block ka arth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/service"
)

// sessionIDFromRequest current session ID nikalta hai.
//
// SECURITY: ye hamesha authenticated session se aata hai, body se KABHI
// nahi. Client agar `session_id` bhej ke "is session ko mat maaro" bole,
// to wo ek bypass ho jata - koi apni current session chhuda kar dusri
// (stolen) session ko bacha sakta tha.
//
// NOTE: `c.Set("session_id", ...)` AuthMiddleware me set hota hai
// (Bearer token ke `session_id` claim se).
func sessionIDFromRequest(c *gin.Context) (string, bool) {
	sid, ok := c.Get("session_id")
	if !ok {
		return "", false
	}
	s, ok := sid.(string)
	if !ok || s == "" {
		return "", false
	}
	return s, true
}

// RolloverPIN - old PIN verify karke naya PIN set karta hai
//
// Body: { "old_pin": "123456", "new_pin": "654321" }
func (h *AuthHandler) RolloverPIN(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	sid, ok := sessionIDFromRequest(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "session_context_missing",
			"message": "Could not verify your session. Please log in again.",
		})
		return
	}

	var req struct {
		OldPIN string `json:"old_pin"`
		NewPIN string `json:"new_pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	result, err := h.authService.RolloverSecurityPIN(
		c.Request.Context(), uuidFromString(uid), uuidFromString(sid),
		req.OldPIN, req.NewPIN,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrOldPINIncorrect):
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "old_pin_incorrect",
				"message": "Your current PIN is incorrect. Nothing was changed.",
			})
		case errors.Is(err, service.ErrNewPINSameAsOld):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "same_pin",
				"message": "Your new PIN must be different from the current one.",
			})
		case errors.Is(err, service.ErrPINInvalid):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "no_pin_set",
				"message": "You do not have a security PIN set yet.",
			})
		case errors.Is(err, service.ErrSessionNotProvided):
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "session_context_missing",
				"message": "Could not verify your session.",
			})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Your PIN has been changed",
		"cleanup": result,
	})
}

// ChangePassword - old password verify karke naya set karta hai
//
// Body: { "current_password": "...", "new_password": "..." }
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	sid, ok := sessionIDFromRequest(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "session_context_missing",
			"message": "Could not verify your session. Please log in again.",
		})
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	// Password policy check (existing service method, agar hai to use karo)
	if len(req.NewPassword) < 12 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "weak_password",
			"message": "Your new password must be at least 12 characters.",
		})
		return
	}

	result, err := h.authService.ChangePassword(
		c.Request.Context(), uuidFromString(uid), uuidFromString(sid),
		req.CurrentPassword, req.NewPassword,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "password_change_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Your password has been changed",
		"cleanup": result,
	})
}

// CheckPIN - sirf current PIN VERIFY karta hai, kuch change nahi.
//
// REQUIREMENT: "user jo 6 digit pin sahi dalta ha tabhi change pin wala card
// open karo". Ye endpoint us unlock step ka backend hai.
//
// SECURITY: ye ek credential oracle hai (batata hai PIN sahi hai ya nahi),
// isliye:
//   - ye `/security/*` bucket me hai -> wahi rate limit lagega jo real verify
//     par lagta hai (brute force protected)
//   - isme koi state change NAHI hota - read-only check
//   - final `rollover` call par PIN DOBARA verify hota hai, isliye beech me
//     unlock ho jaye to bhi galat PIN final step me fail hoga
func (h *AuthHandler) CheckPIN(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		PIN string `json:"pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	err := h.authService.VerifyExistingPIN(c.Request.Context(), uuidFromString(uid), req.PIN)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrOldPINIncorrect):
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "old_pin_incorrect",
				"message": "That PIN is not correct.",
			})
		case errors.Is(err, service.ErrLockoutActive):
			c.JSON(http.StatusLocked, gin.H{
				"error":   "account_locked",
				"message": "Too many failed attempts. Try again after the lockout ends.",
			})
		case errors.Is(err, service.ErrPINInvalid):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "no_pin_set",
				"message": "You do not have a security PIN set yet.",
			})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"verified": true, "message": "PIN confirmed"})
}

// CheckPassword - sirf current password VERIFY karta hai, kuch change nahi.
func (h *AuthHandler) CheckPassword(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if err := h.authService.VerifyExistingPassword(
		c.Request.Context(), uuidFromString(uid), req.Password,
	); err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "current_password_incorrect",
			"message": "That password is not correct.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"verified": true, "message": "Password confirmed"})
}

package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
)

type AuthHandler struct {
	authService *service.AuthService
	// securitySvc lockout/PIN/device-limit enforce karta hai.
	// Login me inject hota hai. Nil ho to security features gracefully skip hoti hain.
	securitySvc *service.SecurityService
}

// SetSecurityService security service inject karta hai (circular dep se bachne ke liye
// constructor ke bajaye setter use hota hai)
func (h *AuthHandler) SetSecurityService(svc *service.SecurityService) {
	h.securitySvc = svc
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Extract device info from headers (would normally come from request body in real app)
	deviceInfo := model.DeviceInfo{
		DeviceName:  c.GetHeader("X-Device-Name"),
		DeviceType:  c.GetHeader("X-Device-Type"),
		Platform:    c.GetHeader("X-Platform"),
		Browser:     c.GetHeader("X-Browser"),
		Fingerprint: c.GetHeader("X-Fingerprint"),
	}

	user, tokenPair, err := h.authService.Register(c.Request.Context(), &req, deviceInfo)
	if err != nil {
		switch err {
		case service.ErrUserExists:
			c.JSON(http.StatusConflict, gin.H{"error": "user already exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user": gin.H{
			"id":          user.ID,
			"email":       user.Email,
			"full_name":   user.FullName,
			"is_active":   user.IsActive,
			"is_verified": user.IsVerified,
			"created_at":  user.CreatedAt,
		},
		"tokens": tokenPair,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Extract device info from headers
	deviceInfo := model.DeviceInfo{
		DeviceName:  c.GetHeader("X-Device-Name"),
		DeviceType:  c.GetHeader("X-Device-Type"),
		Platform:    c.GetHeader("X-Platform"),
		Browser:     c.GetHeader("X-Browser"),
		Fingerprint: c.GetHeader("X-Fingerprint"),
	}

	ctx := c.Request.Context()
	ip := clientIP(c.Request)
	ua := c.Request.UserAgent()

	// ---- CHAKRAVYUH DEFENSE: lockout intercept ----
	// Login se PEHLE check karo ki account lockout me hai ya nahi.
	// Agar 3 galat passwords ho chuke hain to password login BLOCKED hai
	// aur user ko 6-digit PIN verify karna padega.
	// Hinglish: login se pehle lockout check - 3 galat password = PIN required
	if h.securitySvc != nil {
		if existing, uErr := h.authService.GetUserByEmailForSecurity(ctx, req.Email); uErr == nil && existing != nil {
			state, remaining, sErr := h.securitySvc.GetLockoutStatus(ctx, existing.ID)
			if sErr == nil {
				switch state {
				case model.LockoutStatePINRequired:
					// IMPORTANT: agar user ne PIN SET nahi kiya hai to
					// PIN demand karna UNFAIR hoga - wo kabhi recover
					// nahi kar paayega. Isliye hum pehle check karte
					// hain ki PIN exist karta hai ya nahi.
					hasPIN, _ := h.securitySvc.HasPIN(ctx, existing.ID)

					if !hasPIN {
						// No PIN -> password retry allowed after expiry
						c.JSON(http.StatusLocked, gin.H{
							"error":             "password_lockout_no_pin",
							"message":           "Too many failed attempts. No security PIN is configured for this account.",
							"lockout_state":     model.LockoutStatePINRequired,
							"pin_required":      false,
							"recovery_hint":     "Wait for the lockout window to expire, or use the account recovery flow.",
							"seconds_remaining": 0,
						})
						return
					}

					// 423 Locked - PIN mangwao
					c.JSON(http.StatusLocked, gin.H{
						"error":             "password_lockout",
						"message":           "Too many failed attempts. Verify your 6-digit security PIN to continue.",
						"lockout_state":     model.LockoutStatePINRequired,
						"pin_required":      true,
						"seconds_remaining": remaining,
					})
					return
				case model.LockoutStateBlocked:
					// 423 Locked - 3 minute countdown
					c.JSON(http.StatusLocked, gin.H{
						"error":             "account_blocked",
						"message":           "Warning: Account will be blocked if biometric credentials are not verified within 3 minutes.",
						"lockout_state":     model.LockoutStateBlocked,
						"blocked":           true,
						"seconds_remaining": remaining,
					})
					return
				}
			}
		}
	}

	// ---- DEVICE LIMIT: max 3 accounts per device ----
	// 4th account banane ki koshish yahin block hoti hai.
	// Hinglish: ek device pe max 3 accounts - 4th pe reject
	if h.securitySvc != nil && deviceInfo.Fingerprint != "" {
		if regErr := h.securitySvc.RegisterDeviceAccount(
			ctx, deviceInfo.Fingerprint, userIDFromEmailOrNil(h, ctx, req.Email), req.Email, ip, ua,
		); regErr == service.ErrDeviceLimitExceeded {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "device_limit_exceeded",
				"message": "This device has reached the maximum number of accounts (3).",
				"limit":   model.MaxAccountsPerDevice,
			})
			return
		}
	}

	user, tokenPair, err := h.authService.Login(ctx, &req, deviceInfo)
	if err != nil {
		switch err {
		case service.ErrInvalidCredentials:
			// ---- Record failed attempt (3 pe lockout) ----
			attemptsLeft := model.MaxFailedPasswords
			lockoutTriggered := false
			if h.securitySvc != nil {
				if existing, uErr := h.authService.GetUserByEmailForSecurity(ctx, req.Email); uErr == nil && existing != nil {
					count, triggered, rErr := h.securitySvc.RecordFailedPassword(ctx, existing.ID, req.Email, ip, ua)
					if rErr == nil {
						attemptsLeft = model.MaxFailedPasswords - count
						lockoutTriggered = triggered
					}
				}
			}

			if lockoutTriggered {
				// Lockout trigger - ab PIN chahiye
				c.JSON(http.StatusLocked, gin.H{
					"error":         "password_lockout",
					"message":       "Too many failed attempts. Verify your 6-digit security PIN to continue.",
					"lockout_state": model.LockoutStatePINRequired,
					"pin_required":  true,
				})
				return
			}

			c.JSON(http.StatusUnauthorized, gin.H{
				"error":              "invalid email or password",
				"attempts_remaining": attemptsLeft,
			})
		case service.ErrUserInactive:
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is inactive"})
		case service.ErrUserNotVerified:
			c.JSON(http.StatusForbidden, gin.H{"error": "please verify your email"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		}
		return
	}

	// ---- SUCCESS: counters clear + setup gate check ----
	// Sahi password -> failed attempts reset
	if h.securitySvc != nil {
		h.securitySvc.ClearFailedPasswords(ctx, user.ID)
		h.securitySvc.LogSecurityEvent(ctx, &user.ID, user.Email,
			model.EventLoginSuccess, "Login successful", ip, ua)
	}

	// ---- MANDATORY SECURITY SETUP GATE ----
	// Spec ke mutabiq dashboard entry BLOCKED hai jab tak PIN + biometric
	// + 3 security questions teeno complete na ho.
	// Hinglish: teeno security cheezein chahiye warna dashboard block
	setupRequired := true
	var setupStatus gin.H
	if h.securitySvc != nil {
		profile, _ := h.securitySvc.GetSetupStatus(ctx, user.ID)
		setupRequired = !profile.SecuritySetupComplete
		setupStatus = gin.H{
			"pin_configured":                profile.PINConfigured,
			"biometric_registered":          profile.BiometricRegistered,
			"security_questions_configured": profile.SecurityQuestionsConfigured,
			"setup_complete":                profile.SecuritySetupComplete,
		}
	} else {
		setupRequired = false
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":            user.ID,
			"email":         user.Email,
			"full_name":     user.FullName,
			"is_active":     user.IsActive,
			"is_verified":   user.IsVerified,
			"last_login_at": user.LastLoginAt,
		},
		"tokens": tokenPair,
		// Frontend isse padhke gate dikhata hai
		"security_setup_required": setupRequired,
		"security_setup":          setupStatus,
	})
}

// userIDFromEmailOrNil - device limit ke liye user ID nikalta hai
// (agar user nahi mila to nil - enforcement skip ho jati hai)
func userIDFromEmailOrNil(h *AuthHandler, ctx context.Context, email string) uuid.UUID {
	if user, err := h.authService.GetUserByEmailForSecurity(ctx, email); err == nil && user != nil {
		return user.ID
	}
	return uuid.Nil
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req model.RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	tokenPair, err := h.authService.RefreshToken(c.Request.Context(), &req)
	if err != nil {
		switch err {
		case service.ErrInvalidCredentials:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		case errors.New("refresh token expired"):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		case errors.New("refresh token not found or revoked"):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token not found or revoked"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token refresh failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tokens": tokenPair,
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	accessToken := c.GetHeader("Authorization")
	if accessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization header"})
		return
	}

	// Remove "Bearer " prefix if present
	if len(accessToken) > 7 && accessToken[:7] == "Bearer " {
		accessToken = accessToken[7:]
	}

	if err := h.authService.Logout(c.Request.Context(), accessToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "logout failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "logged out successfully"})
}

func (h *AuthHandler) SetupPIN(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.PINSetupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.authService.SetupPIN(c.Request.Context(), userID, &req); err != nil {
		switch err {
		case errors.New("PIN already setup"):
			c.JSON(http.StatusConflict, gin.H{"error": "PIN already setup"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PIN setup failed"})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "PIN setup successful"})
}

func (h *AuthHandler) VerifyPIN(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.PINVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.authService.VerifyPIN(c.Request.Context(), userID, &req); err != nil {
		switch err {
		case errors.New("PIN not setup"):
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN not setup"})
		case service.ErrPINLocked:
			c.JSON(http.StatusLocked, gin.H{"error": "PIN is locked due to too many attempts"})
		case service.ErrInvalidPIN:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid PIN"})
		case service.ErrTooManyAttempts:
			c.JSON(http.StatusLocked, gin.H{"error": "too many PIN attempts, account locked"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PIN verification failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "PIN verified successfully"})
}

func (h *AuthHandler) GetProfile(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.authService.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            user.ID,
		"email":         user.Email,
		"full_name":     user.FullName,
		"is_active":     user.IsActive,
		"is_verified":   user.IsVerified,
		"last_login_at": user.LastLoginAt,
		"created_at":    user.CreatedAt,
	})
}

// VerifyEmail handles GET /api/auth/verify?token=...
//
// Ye endpoint verification link click hone par call hota hai. Token valid hua
// to user is_verified=true ho jata hai, warna 400/404 return hota hai.
//
// Hinglish: link click handler - token verify karta hai
func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	plainToken := c.Query("token")
	if plainToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token"})
		return
	}

	user, err := h.authService.VerifyEmail(c.Request.Context(), plainToken)
	if err != nil {
		// Expired ya invalid token - user ko saaf message
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "invalid or expired verification token",
			"verified": false,
		})
		return
	}

	// Success - plain English message (user-facing content, no Hinglish)
	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"email":    user.Email,
		"message":  "Your email address has been verified successfully.",
	})
}

// Middleware to validate access token
func (h *AuthHandler) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		accessToken := c.GetHeader("Authorization")
		if accessToken == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			return
		}

		// Remove "Bearer " prefix if present
		if len(accessToken) > 7 && accessToken[:7] == "Bearer " {
			accessToken = accessToken[7:]
		}

		claims, err := h.authService.ValidateAccessToken(accessToken)
		if err != nil {
			switch err {
			case token.ErrExpiredToken:
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token expired"})
			default:
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			}
			return
		}

		// Check if session is still valid
		// Session ka data yahan use nahi ho raha, sirf existence check karna hai -
		// isliye result discard kar dete hain. Revoked session ho to 401 dete hain.
		// Hinglish: token valid hone ke baad bhi revoked session reject hota hai
		if _, err := h.authService.GetSessionByAccessToken(c.Request.Context(), accessToken); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session not found or revoked"})
			return
		}

		// Check if user is still active
		user, err := h.authService.GetUserByID(c.Request.Context(), claims.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
			return
		}

		if !user.IsActive {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "user account is inactive"})
			return
		}

		// Set user info in context
		c.Set("user_id", claims.UserID.String())
		c.Set("email", claims.Email)
		c.Set("session_id", claims.SessionID.String())
		c.Next()
	}
}

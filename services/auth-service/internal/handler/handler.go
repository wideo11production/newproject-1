package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
)

type AuthHandler struct {
	authService *service.AuthService
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
		DeviceName: c.GetHeader("X-Device-Name"),
		DeviceType: c.GetHeader("X-Device-Type"),
		Platform:   c.GetHeader("X-Platform"),
		Browser:    c.GetHeader("X-Browser"),
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
		DeviceName: c.GetHeader("X-Device-Name"),
		DeviceType: c.GetHeader("X-Device-Type"),
		Platform:   c.GetHeader("X-Platform"),
		Browser:    c.GetHeader("X-Browser"),
		Fingerprint: c.GetHeader("X-Fingerprint"),
	}

	user, tokenPair, err := h.authService.Login(c.Request.Context(), &req, deviceInfo)
	if err != nil {
		switch err {
		case service.ErrInvalidCredentials:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		case service.ErrUserInactive:
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is inactive"})
		case service.ErrUserNotVerified:
			c.JSON(http.StatusForbidden, gin.H{"error": "please verify your email"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":          user.ID,
			"email":       user.Email,
			"full_name":   user.FullName,
			"is_active":   user.IsActive,
			"is_verified": user.IsVerified,
			"last_login_at": user.LastLoginAt,
		},
		"tokens": tokenPair,
	})
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

	user, err := h.authService.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":          user.ID,
		"email":       user.Email,
		"full_name":   user.FullName,
		"is_active":   user.IsActive,
		"is_verified": user.IsVerified,
		"last_login_at": user.LastLoginAt,
		"created_at":  user.CreatedAt,
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

		claims, err := h.authService.tokenService.ValidateAccessToken(accessToken)
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
		session, err := h.authService.sessionRepo.GetByAccessToken(c.Request.Context(), accessToken)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session not found or revoked"})
			return
		}

		// Check if user is still active
		user, err := h.authService.userRepo.GetByID(c.Request.Context(), claims.UserID)
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
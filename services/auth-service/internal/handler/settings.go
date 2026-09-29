package handler

// ============================================================================
// SETTINGS + ROLE HANDLERS
// ============================================================================
//
// Endpoints:
//   GET    /api/v1/auth/settings       - identity + preferences (one call)
//   PATCH  /api/v1/auth/settings       - partial update
//   GET    /api/v1/auth/settings/meta  - allowed themes/accents/languages
//   GET    /api/v1/auth/me             - identity + role
//
// SECURITY:
//   - user_id HAMESHA token se aata hai, body se KABHI nahi (IDOR protection)
//   - accent/theme/language allowlist se validate (blacklist nahi)
//   - role KABHI body se update nahi hota - sirf DB/manual promotion
//
// Hinglish comments: har block ka arth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// userIDFromToken token se user ID nikalta hai.
//
// SECURITY: client se user_id KABHI accept nahi hoti. Agar aisi hoti to
// koi dusre user ki settings padh/change kar sakta (IDOR vulnerability).
func userIDFromToken(c *gin.Context) (string, bool) {
	uid, ok := c.Get("user_id")
	if !ok {
		return "", false
	}
	s, ok := uid.(string)
	if !ok || s == "" {
		return "", false
	}
	return s, true
}

// GetSettings - identity + preferences ek hi response me.
//
// ONE CALL: frontend ko alag se profile fetch karne ki zaroorat nahi.
func (h *AuthHandler) GetSettings(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	resp, err := h.authService.GetSettingsResponse(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load settings"})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// UpdateSettings - partial update (pointers se "bheya vs nahi bheya" pata hai)
func (h *AuthHandler) UpdateSettings(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.UpdateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	updated, err := h.authService.UpdateSettings(
		c.Request.Context(), uuidFromString(uid), &req,
	)
	if err != nil {
		// Validation errors ko clear message ke saath map karo
		switch {
		case errors.Is(err, service.ErrInvalidTheme):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_theme",
				"message": "That theme is not available.",
			})
		case errors.Is(err, service.ErrInvalidAccent):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_accent",
				"message": "That accent colour is not available.",
			})
		case errors.Is(err, service.ErrInvalidLanguage):
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_language",
				"message": "That language is not supported yet.",
			})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update settings"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Settings saved",
		"settings": updated,
	})
}

// GetSettingsMeta - allowed values ka list.
//
// SSOT REASON: frontend hardcode na kare, list backend se aaye. Warna dono
// side drift kar sakte hain (UI me dikhe par backend reject kare).
func (h *AuthHandler) GetSettingsMeta(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"themes":    model.ValidThemes(),
		"accents":   model.ValidAccents(),
		"languages": model.SupportedLanguages(),
	})
}

// GetMe - identity + role.
//
// Client ko apna role batana zaroori hai taki wo superadmin-only UI
// HIDE kar sake. NOTE: ye sirf UI hint hai - actual authorization server
// side (middleware + guards) par hai, client-side hiding security nahi hai.
func (h *AuthHandler) GetMe(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.authService.GetUserByID(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	// Role fallback: DB me khaali hua to 'user' maano (fail CLOSED -
	// admin maanna khatarna ho, user maanna safe hai)
	role := user.Role
	if role == "" {
		role = model.RoleUser
	}

	c.JSON(http.StatusOK, gin.H{
		"id":          user.ID,
		"email":       user.Email,
		"username":    user.Username,
		"full_name":   user.FullName,
		"avatar_url":  user.AvatarURL,
		"role":        role,
		"is_verified": user.IsVerified,
		"created_at":  user.CreatedAt,
	})
}

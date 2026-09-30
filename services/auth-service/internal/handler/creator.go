package handler

// ============================================================================
// CREATOR DASHBOARD HANDLERS
// ============================================================================
//
// Endpoints:
//   GET    /api/v1/profile              - profile + avatar_url
//   PATCH  /api/v1/profile              - avatar update
//   GET    /api/v1/channels             - user ke channels
//   POST   /api/v1/channels             - naya channel
//   GET    /api/v1/auth/sessions        - active devices
//
// SECURITY (sab par):
//   - sab protected hain (AuthMiddleware) - bina token 401
//   - `user_id` HAMESHA token se aata hai, body/client se KABHI nahi.
//     Isse user dusre user ka data access nahi kar sakta (IDOR protection).
//
// Hinglish comments: har block ka arth

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// uuidFromString string ko UUID me convert karta hai.
//
// SECURITY NOTE: invalid string par `uuid.Parse` zero UUID deta hai aur hum
// error IGNORE kar rahe hain. Ye theek hai kyunki upar `creatorUserID` ne
// pehle hi verify kiya hai ki value UUID-shaped string hai (ye `c.Set("user_id", ...)`
// me JWT claim se aata hai, client se nahi). Zero UUID par query kuch nahi
// milega - fail closed.
func uuidFromString(s string) uuid.UUID {
	parsed, _ := uuid.Parse(s)
	return parsed
}

// creatorUserID token se user ID nikalta hai.
//
// SECURITY: ye sirf JWT claims padhta hai. Client se koi user_id KABHI
// accept nahi hoti - warna koi dusre user ka profile/channel dekh lega.
func creatorUserID(c *gin.Context) (string, bool) {
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

// ---------------------------------------------------------------------------
// GET /api/v1/profile
// ---------------------------------------------------------------------------
func (h *AuthHandler) GetProfileV2(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.authService.GetUserByID(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":          user.ID,
		"email":       user.Email,
		"username":    user.Username,
		"full_name":   user.FullName,
		"avatar_url":  user.AvatarURL,
		"is_verified": user.IsVerified,
		"created_at":  user.CreatedAt,
	})
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/profile  (avatar update)
// ---------------------------------------------------------------------------
//
// Body: { "avatar_url": "https://..." }  ya  { "avatar_url": "" }  (clear)
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	// ---- Validate avatar URL shape ----
	// Ye allowed sirf:
	//   - relative path starting with "/"  (apne MinIO se)
	//   - http/https absolute URL
	// `javascript:` / `data:` schemes BLOCK hote hain - wo stored XSS ka
	// vector hain (koi admin panel me img src render kare to script chal
	// sakta hai).
	if req.AvatarURL != nil {
		v := *req.AvatarURL
		if v != "" {
			isRelative := v[0] == '/'
			isHTTP := len(v) >= 7 && (v[:7] == "http://" || (len(v) >= 8 && v[:8] == "https://"))
			if !isRelative && !isHTTP {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "avatar_url must be a relative path (starting with /) or an http(s) URL",
				})
				return
			}
			if len(v) > 500 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "avatar_url is too long"})
				return
			}
		}
	}

	if err := h.authService.UpdateAvatar(c.Request.Context(), uuidFromString(uid), req.AvatarURL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated", "avatar_url": req.AvatarURL})
}

// ---------------------------------------------------------------------------
// GET /api/v1/channels
// ---------------------------------------------------------------------------
func (h *AuthHandler) ListChannels(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channels, err := h.authService.ListChannels(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load channels"})
		return
	}
	if channels == nil {
		channels = []model.Channel{} // null na jaaye, [] jaaye (frontend map kare)
	}

	c.JSON(http.StatusOK, gin.H{"channels": channels})
}

// ---------------------------------------------------------------------------
// POST /api/v1/channels
// ---------------------------------------------------------------------------
func (h *AuthHandler) CreateChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.CreateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	channel, err := h.authService.CreateChannel(
		c.Request.Context(), uuidFromString(uid), &req,
	)
	if err != nil {
		// NOTE: pehle yahan apna alag (partial) error switch tha. Wo
		// `ErrDisplayNameInvalid` handle NAHI karta tha, isliye empty ya 80+
		// character ka display_name par API 500 deta tha - client ki galti
		// server fault ki tarah dikhti thi.
		//
		// `writeChannelError` already poora map karta hai. Do jagah mapping
		// rakhne ka matlab hai: ek copy chupke se peeche reh jaati hai aur
		// wahi bug dobara aata hai. Ek hi mapping rakhi jaati hai.
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"channel": channel})
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/channels/:id   (edit: name / description / visibility / media)
// ---------------------------------------------------------------------------
//
// Body: { "display_name": "...", "is_public": false, "cover_url": "..." }
//
// Har field OPTIONAL hai. Jo field bheji nahi gayi wo UNCHANGED rehti hai.
func (h *AuthHandler) UpdateChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// ---- Channel ID validate ----
	//
	// `uuid.Parse` fail hone par zero UUID milta hai. Zero UUID se koi
	// row match nahi hogi (fail closed), par error message user ke liye
	// useless hoga - isliye PEHLE validate karte hain taaki 400 mile.
	channelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_channel_id",
			"message": "channel id must be a UUID",
		})
		return
	}

	var req model.UpdateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	channel, err := h.authService.UpdateChannel(
		c.Request.Context(), uuidFromString(uid), channelID, &req,
	)
	if err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"channel": channel})
}

// ---------------------------------------------------------------------------
// GET /api/v1/channels/:id   (owner-scoped single channel)
// ---------------------------------------------------------------------------
func (h *AuthHandler) GetChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_channel_id",
			"message": "channel id must be a UUID",
		})
		return
	}

	channel, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	)
	if err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"channel": channel})
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/channels/:id   (soft delete)
// ---------------------------------------------------------------------------
func (h *AuthHandler) DeleteChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_channel_id",
			"message": "channel id must be a UUID",
		})
		return
	}

	if err := h.authService.DeleteChannel(
		c.Request.Context(), uuidFromString(uid), channelID,
	); err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Channel deleted"})
}

// ---------------------------------------------------------------------------
// GET /api/v1/channels/:handle/public   (public channel page - NO auth)
// ---------------------------------------------------------------------------
//
// ---- SECURITY: THIS ROUTE IS INTENTIONALLY UNAUTHENTICATED ----
//
// Ye public channel page hai (jaise youtube.com/@handle). Isliye:
//   - `AuthMiddleware` LAGA HUA NAHI HAI
//   - service layer `is_public AND is_active` filter karta hai
//   - private channel ke liye bhi 404 (403 nahi) - warna attacker handle
//     enumerate kar sakta tha
//
// Response me user_id/is_active/deleted_at JAAN-BOJH KAR nahi jaate -
// sirf `PublicChannelResponse` fields.
func (h *AuthHandler) GetPublicChannel(c *gin.Context) {
	handle := c.Param("handle")

	channel, err := h.authService.GetPublicChannelByHandle(c.Request.Context(), handle)
	if err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"channel": channel})
}

// ---------------------------------------------------------------------------
// GET /api/v1/channels/public   (discovery list - NO auth)
// ---------------------------------------------------------------------------
func (h *AuthHandler) ListPublicChannels(c *gin.Context) {
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		// strconv se parse; invalid/negative par default reh jaata hai
		// (aur service layer phir bhi clamp karta hai).
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}

	channels, err := h.authService.ListPublicChannels(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load channels"})
		return
	}
	if channels == nil {
		channels = []model.PublicChannelResponse{}
	}

	c.JSON(http.StatusOK, gin.H{"channels": channels, "count": len(channels)})
}

// writeChannelError - channel service errors ko HTTP status me map karta hai.
//
// ---- WHY 404 FOR "NOT YOUR CHANNEL" ----
// Agar doosre user ke channel par 403 bhejte, to attacker ko pata chalta
// ki "ye channel EXIST karta hai, bas mera nahi" - usse handle/UUID
// enumerate karne ka oracle mil jata hai. 404 dono cases ke liye SAME hai:
// user ko sirf itna dikhta hai ki "ye resource mere liye available nahi".
func writeChannelError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrChannelNotFound):
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "channel_not_found",
			"message": "Channel not found",
		})
	case errors.Is(err, model.ErrHandleInvalid):
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_handle",
			"message": model.ErrHandleInvalid.Error(),
		})
	case errors.Is(err, model.ErrHandleTaken):
		c.JSON(http.StatusConflict, gin.H{
			"error":   "handle_taken",
			"message": "That handle is already used by one of your channels.",
		})
	case errors.Is(err, model.ErrDisplayNameInvalid):
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_display_name",
			"message": model.ErrDisplayNameInvalid.Error(),
		})
	case errors.Is(err, model.ErrDescriptionTooLong):
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_description",
			"message": model.ErrDescriptionTooLong.Error(),
		})
	case errors.Is(err, model.ErrURLTooLong), errors.Is(err, model.ErrURLSchemeNotAllowed):
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_url",
			"message": err.Error(),
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "channel operation failed"})
	}
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/sessions  (active devices)
// ---------------------------------------------------------------------------
func (h *AuthHandler) ListMySessions(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	sessions, err := h.authService.ListSessions(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load sessions"})
		return
	}
	if sessions == nil {
		sessions = []model.ActiveDeviceSession{}
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": sessions,
		"count":    len(sessions),
	})
}

// compile-time: service package imported hota hai (errors.Is ke liye)
var _ = service.ErrInvalidUsername

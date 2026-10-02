package handler

// ============================================================================
// CHANNEL COVER UPLOAD HANDLERS  -  Phase B1
// ============================================================================
//
// Channel covers ke liye EXACTLY wahi 3-step flow jo avatars ka hai:
//
//  1. POST /api/v1/auth/channels/:id/cover/upload-url
//  2. Browser seedha MinIO me PUT karta hai
//  3. POST /api/v1/auth/channels/:id/cover/finalize
//
// ---- WHY A SEPARATE HANDLER AND NOT A REUSED ONE ----
//
// Yahan `:id` route parameter me CHANNEL ID hai. Ownership check alag hai:
// avatar ka ownership userID prefix se hota hai, cover ka bhi userID prefix
// se hota hai (object key me userID hota hai, channelID nahi) - par VERIFY
// step me ye confirm karna zaroori hai ki ye cover IS user ke channel ka hai,
// warna koi user apne kisi bhi channel par kisi aur ke cover URL laga sakta
// tha. Wo theek nahi hai, par isse asaan ho jata hai, isliye check rakhte hain.
//
// SECURITY: har query me `user_id` filter (IDOR protection) - avatar handler
// ki tarah. Cover kisi aur user ke channel par attach nahi ho sakta.
//
// ---- WHY NOT GENERICIZE WITH THE AVATAR HANDLERS ----
// Dono handlers ke beech sirf 2 line ka fark hai (bucket + final PATCH), par
// unka AUTHORIZATION logic alag hai (channel ownership vs user identity).
// Ek generic handler banane se readability ghatti aur ye risk hota ki future
// me koi ek path me ownership check bhool jaye - jo exactly wahi class of
// bug hai jo updatedtodo.md me documented hai.
//
// Hinglish: same flow, alag authorization - dono jaan-boojh kar alag rakhe

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// coverOwnerChannelID - `:id` se channel ID nikalta hai aur confirm karta hai
// ki channel IS user ka hai.
//
// SECURITY: ye `GetChannelByID` (jo `id AND user_id` dono par filter karta
// hai) ke through jaata hai. Agar channel dusre user ka hua to yahan 404
// aayega - finalize/upload dono ruk jayenge. Bina is check ke koi user
// kisi aur ke channel ID par cover upload kar sakta tha.
func (h *AuthHandler) coverOwnerChannelID(c *gin.Context) (uuid.UUID, bool) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return uuid.Nil, false
	}

	channelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_channel_id",
			"message": "channel id must be a UUID",
		})
		return uuid.Nil, false
	}

	if _, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	); err != nil {
		// 404 (not 403) - see writeChannelError for why: a 403 would confirm
		// the channel exists, which is a handle-enumeration oracle.
		writeChannelError(c, err)
		return uuid.Nil, false
	}

	return channelID, true
}

// CoverUploadURL - step 1: presigned PUT URL do (for EXISTING channel).
func (h *AuthHandler) CoverUploadURL(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	// Upload policy gate - BEFORE the ownership check and before any URL is
	// minted. Gating after the ownership check would turn a policy refusal
	// into a "this channel exists" oracle. See content_policy_gate.go.
	if !h.requireContentUpload(c) {
		return
	}

	// Ownership gate - MUST run before we mint any URL.
	if _, ok := h.coverOwnerChannelID(c); !ok {
		return
	}

	var req struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	ticket, err := h.storage.CreateCoverUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
	)
	if err != nil {
		msg := err.Error()
		status := http.StatusBadRequest
		if strings.Contains(msg, "credentials missing") {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "invalid_upload", "message": msg})
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// CoverUploadURLForCreate - step 1: presigned PUT URL for cover DURING channel creation.
// No channel ID exists yet, so ownership is based on user ID only.
func (h *AuthHandler) CoverUploadURLForCreate(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if !h.requireContentUpload(c) {
		return
	}

	var req struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	ticket, err := h.storage.CreateCoverUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
	)
	if err != nil {
		msg := err.Error()
		status := http.StatusBadRequest
		if strings.Contains(msg, "credentials missing") {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "invalid_upload", "message": msg})
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// CoverFinalize - step 3: server-side verify + save on the channel (for EXISTING channel).
func (h *AuthHandler) CoverFinalize(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	// Re-checked here, not just in step 1. A presigned URL stays valid for
	// STORAGE_PRESIGN_TTL_MINUTES, so mint-then-disable would otherwise still
	// let the upload complete.
	if !h.requireContentUpload(c) {
		return
	}

	channelID, ok := h.coverOwnerChannelID(c)
	if !ok {
		return
	}

	var req struct {
		ObjectKey string `json:"objectKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	// Server-side verification: existence, size, MAGIC BYTES, content-type
	// force. Same code path as avatars - a `.html` file renamed `.png` dies
	// here, not in the browser.
	publicURL, err := h.storage.FinalizeCoverUpload(
		c.Request.Context(), uuidFromString(uid), req.ObjectKey,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "upload_failed",
			"message": err.Error(),
		})
		return
	}

	// ---- Purana cover best-effort delete ----
	// Naya save hone ke BAAD purana delete karte hain, isliye replace fail
	// hone par user ke paas purana cover waise bhi rehta hai. Isme "delete
	// pehle, save baad me" wala data-loss trap nahi hai.
	if existing, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	); err == nil && existing.CoverURL != "" && existing.CoverURL != publicURL {
		h.storage.DeleteCover(c.Request.Context(), existing.CoverURL)
	}

	// ---- Save the verified URL onto the channel ----
	// NOTE: ye PATCH internally bhi `id AND user_id` par scoped hai, so even
	// if the ownership check above were somehow bypassed, the write would
	// affect zero rows.
	cover := publicURL
	if _, err := h.authService.UpdateChannel(
		c.Request.Context(), uuidFromString(uid), channelID,
		&model.UpdateChannelRequest{CoverURL: &cover},
	); err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"publicUrl": publicURL,
		"maxBytes":  config.MaxCoverBytes,
		"channelId": channelID,
	})
}

// CoverFinalizeForCreate - step 3: server-side verify during channel creation.
// Returns the public URL without attaching to a channel (channel doesn't exist yet).
func (h *AuthHandler) CoverFinalizeForCreate(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if !h.requireContentUpload(c) {
		return
	}

	var req struct {
		ObjectKey string `json:"objectKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	// Server-side verification: existence, size, MAGIC BYTES, content-type
	// force. Same code path as avatars - a `.html` file renamed `.png` dies
	// here, not in the browser.
	publicURL, err := h.storage.FinalizeCoverUpload(
		c.Request.Context(), uuidFromString(uid), req.ObjectKey,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "upload_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"publicUrl": publicURL,
		"maxBytes":  config.MaxCoverBytes,
	})
}

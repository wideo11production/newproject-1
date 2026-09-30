package handler

// ============================================================================
// AVATAR UPLOAD HANDLERS
// ============================================================================
//
// 3-step flow (file bytes kabhi app server se nahi guzarte):
//
//  1. POST /api/v1/auth/avatar/upload-url
//        -> { uploadUrl, publicUrl, objectKey, contentType, maxBytes, expiresIn }
//  2. Browser seedha MinIO me PUT karta hai `uploadUrl` par
//  3. POST /api/v1/auth/avatar/finalize { objectKey }
//        -> server magic bytes verify + content-type force
//        -> { publicUrl }
//
// SECURITY NOTES (har step par):
//  - Step 1: extension + content-type allowlist, dono CROSS-CHECK hote hain.
//    Client ke claim par akela bharosa nahi.
//  - Step 2: bytes browser se MinIO jaate hain - app server par koi load nahi.
//  - Step 3: MAGIC BYTES se asli file type verify. Isse ".html ko .png naam
//    dekar upload karna" fail hota hai. Ye client ke Content-Type claim se
//    ZYADA strong check hai.
//
// Hinglish comments: har block ka arth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/config"
)

// AvatarUploadURL - step 1: presigned PUT URL do
func (h *AuthHandler) AvatarUploadURL(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Upload policy gate - BEFORE any URL is minted. See content_policy_gate.go.
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

	// Storage disabled hai (config missing) - clear message, chhupana nahi
	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	ticket, err := h.storage.CreateAvatarUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
	)
	if err != nil {
		// Validation error user ko batana hai (400), infra error nahi (500)
		msg := err.Error()
		status := http.StatusBadRequest
		if strings.Contains(msg, "credentials missing") {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{
			"error":   "invalid_upload",
			"message": msg,
		})
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// AvatarFinalize - step 3: verify + content-type fix + public URL
func (h *AuthHandler) AvatarFinalize(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Re-checked here, not just in step 1. A presigned URL stays valid for
	// STORAGE_PRESIGN_TTL_MINUTES, so a user can mint one, flip the toggle
	// off, and still finalize. Gating only step 1 leaves that window open.
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

	publicURL, err := h.storage.FinalizeAvatarUpload(
		c.Request.Context(), uuidFromString(uid), req.ObjectKey,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "upload_failed",
			"message": err.Error(),
		})
		return
	}

	// NOTE: profile me `avatar_url` save NAHI karte yahan. Wo client
	// alag se PATCH karega - isse frontend ko control milta hai ki
	// verification UI me turant dikhana hai ya nahi.
	c.JSON(http.StatusOK, gin.H{
		"publicUrl": publicURL,
		"maxBytes":  config.MaxAvatarBytes,
	})
}

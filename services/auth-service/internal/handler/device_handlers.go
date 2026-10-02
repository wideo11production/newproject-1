package handler

// Device management for a lifetime plan.
//
// The account screen needs three things and nothing else: which devices are in
// use, whether the allowance applies to this user at all, and a way to remove
// one. Everything else about devices is auth's business.

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ListDevices returns the devices this user has signed in from, plus whether the
// lifetime allowance applies to them.
func (h *AuthHandler) ListDevices(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := uuidFromString(uid)
	ctx := c.Request.Context()

	devices, err := h.deviceSlots.List(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load devices"})
		return
	}

	status, err := h.deviceSlots.Status(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load device status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"devices": devices,
		"status":  status,
	})
}

// RevokeDevice frees ONE device slot.
//
// POST, not DELETE with a body, and deliberately not a path parameter: the
// fingerprint identifies a device, and putting one in a URL puts it in access
// logs, proxy logs and browser history. A fingerprint is a stable hardware-ish
// identifier for a user's device - it should not be sprayed across every log
// line in the stack.
func (h *AuthHandler) RevokeDevice(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Fingerprint string `json:"fingerprint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Fingerprint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fingerprint is required"})
		return
	}

	if err := h.deviceSlots.Revoke(c.Request.Context(), uuidFromString(uid), req.Fingerprint); err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "device_not_found",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"revoked": true, "fingerprint": req.Fingerprint})
}

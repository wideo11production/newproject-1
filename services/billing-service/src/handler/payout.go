// Payout identity HTTP handlers
//
// Ye endpoints user ko UPI/bank/wire add karne dete hain, aur DEDUP enforce
// karte hain - ek identity do accounts se link nahi ho sakti.
//
// Hinglish comments: har block ka arth
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/service"
)

// PayoutHandler payout identity endpoints handle karta hai
type PayoutHandler struct {
	svc *service.PayoutIdentityService
}

// NewPayoutHandler naya handler banata hai
func NewPayoutHandler(svc *service.PayoutIdentityService) *PayoutHandler {
	return &PayoutHandler{svc: svc}
}

// AddPayout naya payout identity add karta hai
//
// SECURITY FIX: user ID ab URL path se NAHI, JWT token se aati hai.
// Pehle `/users/:userId/payouts` tha jahan koi bhi unauthenticated user
// kisi BHI account ki payout add/modify kar sakta tha.
func (h *PayoutHandler) AddPayout(c *gin.Context) {
	// User ID token se (middleware ne set ki hai - "user_id" claim)
	raw, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(raw.(string))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	var req service.PayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	record, err := h.svc.AddPayoutIdentity(c.Request.Context(), userID, req)
	if err != nil {
		// NOTE: errors.Is use hona zaroori hai - service ye errors fmt.Errorf("%w...")
		// se WRAP karta hai, isliye simple "==" comparison fail ho jata tha
		// aur user ko 500 dikhta tha (jabki actual behaviour 409 hona chahiye tha).
		// Hinglish: wrapped errors ke liye errors.Is, "==" nahi
		switch {
		case errors.Is(err, service.ErrPayoutIdentityInUse):
			c.JSON(http.StatusConflict, gin.H{
				"error":   "payout_identity_in_use",
				"message": "This payout identity (UPI/bank account) is already linked to another account. Each payout destination can only be used by one account.",
			})
			return

		case errors.Is(err, service.ErrPayoutLimitReached):
			c.JSON(http.StatusConflict, gin.H{
				"error":   "payout_limit_reached",
				"message": "Maximum payout methods reached for this account.",
			})
			return

		case errors.Is(err, service.ErrInvalidPayoutType),
			errors.Is(err, service.ErrMissingPayoutField):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add payout method"})
		return
	}

	// Response message ab status ke hisaab se dynamic hai.
	// NOTE: pehle ye HAR baar "Verification pending" bolta tha, jo ab GALAT hai -
	// KYC automatic hone se payout turant verify ho jaata hai.
	message := "Payout method added. Verification pending."
	if record.Status == "verified" {
		message = "Payout method verified automatically."
	} else if record.Status == "rejected" {
		message = "Payout method added but verification failed: " + record.KYCReason
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":            record.ID,
		"type":          record.Type,
		"display":       record.DisplayIdentity,
		"status":        record.Status,
		"is_primary":    record.IsPrimary,
		"kyc_provider":  record.KYCProvider,
		"kyc_risk_score": record.KYCRiskScore,
		"kyc_reason":    record.KYCReason,
		"message":       message,
	})
}

// ListPayouts user ke payout methods list karta hai
func (h *PayoutHandler) ListPayouts(c *gin.Context) {
	// User ID token se (URL se nahi - security fix)
	raw, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(raw.(string))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	records, err := h.svc.ListPayouts(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list payouts"})
		return
	}

	// Security: raw account numbers/IFSC kabhi expose nahi hote -
	// sirf masked display identity bhejte hain (json:"-" tags se bhi protected)
	c.JSON(http.StatusOK, gin.H{
		"count":   len(records),
		"payouts": records,
	})
}

// DeletePayout payout method delete karta hai
func (h *PayoutHandler) DeletePayout(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	payoutID, err := uuid.Parse(c.Param("payoutId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payout id"})
		return
	}

	if err := h.svc.DeletePayout(c.Request.Context(), userID, payoutID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Payout method removed"})
}

// VerifyPayout payout verify karta hai (admin action - abhi simple)
func (h *PayoutHandler) VerifyPayout(c *gin.Context) {
	payoutID, err := uuid.Parse(c.Param("payoutId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payout id"})
		return
	}

	record, err := h.svc.VerifyPayoutIdentity(c.Request.Context(), payoutID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "payout method not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":         record.ID,
		"status":     record.Status,
		"verified_at": record.VerifiedAt,
	})
}

// Payout types helper (UI ke liye)
func (h *PayoutHandler) Types(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"types": []string{model.PayoutTypeUPI, model.PayoutTypeBank, model.PayoutTypeWire},
		"max_per_user": model.MaxPayoutIdentityPerUser,
		"dedup":         true,
	})
}

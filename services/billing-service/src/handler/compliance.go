package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"newproject/services/billing-service/src/service"
)

// ComplianceHandler handles compliance violation reporting and enforcement.
//
// Routes are internal/token-gated: auth-service calls POST /compliance/violation
// when a student tier channel uploads non-educational content.
type ComplianceHandler struct {
	svc *service.BillingService
}

func NewComplianceHandler(svc *service.BillingService) *ComplianceHandler {
	return &ComplianceHandler{svc: svc}
}

// ViolationRequest is the body of POST /compliance/violation.
type ViolationRequest struct {
	// UserID - billing-side uint of the violating user.
	UserID uint `json:"user_id" binding:"required"`

	// ChannelID - auth-service channel UUID (optional).
	ChannelID string `json:"channel_id"`

	// ViolationType - 'non_educational_upload' | 'policy_violation' | 'document_fraud'.
	ViolationType string `json:"violation_type" binding:"required"`

	// Details - human-readable violation details.
	Details string `json:"details"`
}

// ReportViolation handles POST /compliance/violation.
//
// auth-service compliance gate calls this when a student tier channel
// attempts a non-educational upload. The engine records the violation
// and enforces Step 1 (warning) or Step 2 (suspension + 25% penalty).
//
// Returns 200 with the enforcement step taken:
//   - {"step": "warning"}      - first violation, warning sent
//   - {"step": "suspension"}   - repeat violation, suspended + penalty
//   - {"step": "already_suspended"} - already suspended, no new action
func (h *ComplianceHandler) ReportViolation(c *gin.Context) {
	var req ViolationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request", "message": err.Error()})
		return
	}

	var channelID *uuid.UUID
	if req.ChannelID != "" {
		parsed, err := uuid.Parse(req.ChannelID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_channel_id", "message": "channel_id must be a UUID"})
			return
		}
		channelID = &parsed
	}

	enforcement := h.svc.ComplianceEnforcement()
	if enforcement == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "enforcement_not_configured"})
		return
	}

	violation, step, err := enforcement.RecordViolation(
		c.Request.Context(), req.UserID, channelID, req.ViolationType, req.Details,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "enforcement_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"step":             step,
		"violation_id":     violation.ID,
		"user_id":          violation.UserID,
		"status":           violation.Status,
		"warning_sent":     violation.WarningSent,
		"wallet_frozen":    violation.WalletFrozen,
		"penalty_amount":   violation.PenaltyAmount.String(),
		"penalty_paid":     violation.PenaltyPaid,
	})
}

// CheckFrozen handles GET /compliance/frozen/:userID.
//
// wallet-service (or any downstream service) calls this to check if a
// user's wallet withdrawals are frozen due to compliance suspension.
func (h *ComplianceHandler) CheckFrozen(c *gin.Context) {
	userIDStr := c.Param("userID")
	userID, err := parseUint(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}

	enforcement := h.svc.ComplianceEnforcement()
	if enforcement == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "enforcement_not_configured"})
		return
	}

	frozen, err := enforcement.IsUserFrozen(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "check_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":   userID,
		"frozen":    frozen,
	})
}

func parseUint(s string) (uint, error) {
	var n uint
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, errInvalidUint
		}
		n = n*10 + uint(ch-'0')
	}
	return n, nil
}

var errInvalidUint = errors.New("invalid uint")

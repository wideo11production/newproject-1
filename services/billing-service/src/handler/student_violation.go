package handler

// ============================================================================
// STUDENT VERIFICATION VIOLATION PENALTY ENDPOINT
// ============================================================================
//
// `POST /internal/student/violation`
//
// WHAT THIS IS
// ------------
// auth-service ke content compliance check (content_compliance.go) student
// tier channel ke non-educational upload ko block karta hai. Jab block hota
// hai, auth-service ye endpoint hit karta hai billing-service par.
//
// THIS endpoint does THREE things:
// 1. Revokes the student verification (discount void, status 'revoked')
// 2. Records the compliance violation via ComplianceEnforcementEngine
//    (Step 1: warning log, Step 2: suspension + wallet freeze + 25% penalty)
// 3. Returns the enforcement result so auth-service can log it
//
// WHO CALLS IT
// ------------
// Only auth-service, authenticated by `RequireServiceToken("auth")`
// (see billing-service/src/middleware/service_token.go). No user session.
//
// WHY BOTH StudentService + EnforcementEngine
// -------------------------------------------
// - StudentService.RevokeForEducationalViolation: revokes the student
//   IDENTITY (discount void, 365-day token cleared). This is the AURA
//   student gate — the discount eligibility engine.
// - ComplianceEnforcementEngine.RecordViolation: handles the PENALTY
//   enforcement loop (warning → suspension + wallet freeze + 25% penalty).
//   This is the broader compliance framework that tracks repeat violations.
//
// Hinglish comments: har block ka arth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"newproject/services/billing-service/src/service"
)

// StudentViolationRequest is the payload from auth-service when a compliance
// violation is detected.
//
// UserID is auth-service's canonical UUID. billing-service resolves it to
// the billing-side uint via the identity adapter (repository.UserIdentityRepository).
type StudentViolationRequest struct {
	// UserID is auth-service's UUID for the violating user.
	// billing-service ke paas identity adapter hai jo UUID -> uint karta hai.
	UserID string `json:"user_id" binding:"required"`
	// Reason is the compliance violation reason from content_compliance.go.
	// e.g. "non_educational_content_blocked_for_student_tier"
	Reason string `json:"reason,omitempty"`
	// ChannelID is the channel that attempted the violation (audit trail).
	ChannelID string `json:"channel_id,omitempty"`
}

// StudentViolationResponse is the response body.
type StudentViolationResponse struct {
	// Revoked indicates whether the student identity was revoked.
	Revoked bool `json:"revoked"`
	// PenaltyAmount is the 25% penalty applied (in minor units, decimal string).
	// Returns "" if no active subscription or this was only a warning (Step 1).
	PenaltyAmount string `json:"penalty_amount,omitempty"`
	// PenaltyApplied indicates whether a penalty was calculated and applied.
	PenaltyApplied bool `json:"penalty_applied"`
	// EnforcementStep is "warning" or "suspension" or "already_suspended".
	EnforcementStep string `json:"enforcement_step"`
	// Message is a human-readable summary.
	Message string `json:"message"`
}

// StudentHandler groups student-verification endpoints.
type StudentHandler struct {
	svc *service.BillingService
}

// NewStudentHandler creates a StudentHandler backed by the billing service.
func NewStudentHandler(svc *service.BillingService) *StudentHandler {
	return &StudentHandler{svc: svc}
}

// RevokeForViolation handles `POST /internal/student/violation`.
//
// Called by auth-service when a student-tier channel attempts a non-educational
// upload. The billing-service:
// 1. Resolves auth UUID → billing uint via identity adapter
// 2. Revokes student identity (status -> 'revoked', token cleared) via StudentService
// 3. Records violation via ComplianceEnforcementEngine (warning or suspension + 25% penalty)
// 4. Returns the enforcement result
//
// The upload is ALREADY blocked by auth-service — this is the cross-service
// penalty/revoke enforcement step.
//
// Hinglish: student violation par revoke + 25% penalty + wallet freeze
func (h *StudentHandler) RevokeForViolation(c *gin.Context) {
	var req StudentViolationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "user_id (auth UUID) is required",
		})
		return
	}

	// Nil-safe: if billing service not configured
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "billing_service_not_configured",
			"message": "Billing service is not configured.",
		})
		return
	}

	ctx := c.Request.Context()

	// ---- Resolve auth UUID -> billing uint ----
	//
	// auth-service keys users by UUID; billing-service keys by uint.
	// The identity adapter resolves this. If the user has never been
	// seen by billing-service, the adapter ALLOCATES a new billing id
	// (on first sight). This is the same pattern the entitlement grant
	// uses.
	authUUID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_user_id",
			"message": "user_id is not a valid UUID",
		})
		return
	}

	billingUserID, rerr := h.svc.IdentityRepo().Resolve(ctx, authUUID)
	if rerr != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "user_not_resolvable",
			"message": "Could not resolve user identity in billing-service.",
			"detail":  rerr.Error(),
		})
		return
	}

	// Parse channel ID for audit trail (optional)
	var channelID *uuid.UUID
	if req.ChannelID != "" {
		if ch, cerr := uuid.Parse(req.ChannelID); cerr == nil {
			channelID = &ch
		}
	}

	resp := StudentViolationResponse{
		Revoked: true,
		Message: "Student identity revoked for educational content violation.",
	}

	// ---- STEP 1: Revoke student verification (discount void) ----
	//
	// RevokeForEducationalViolation calls repo.RevokeByUserID which:
	// - Sets is_verified_student = false
	// - Sets status = 'revoked'
	// - Clears identity_token + identity_token_expires_at
	// Idempotent: double-call succeeds (RowsAffected 0 = nil error)
	if studentSvc := h.svc.StudentService(); studentSvc != nil {
		if err := studentSvc.RevokeForEducationalViolation(ctx, billingUserID); err != nil {
			// Don't fail the whole request - the enforcement engine below
			// may still record the violation + apply the penalty.
			resp.Message += " Student identity revocation encountered an error."
		}
	}

	// ---- STEP 2: Compliance enforcement (warning or suspension + penalty) ----
	//
	// ComplianceEnforcementEngine.RecordViolation implements the two-step
	// enforcement law:
	//   Step 1 (first violation): warning system log
	//   Step 2 (repeat violation): channel SUSPENDED, wallet FREEZED, 25% penalty
	//
	// This is the SYSTEM-PLAN.md R2 money law:
	//   "educational-violation → 'revoked' + 25% penalty"
	if eng := h.svc.ComplianceEnforcement(); eng != nil {
		_, step, verr := eng.RecordViolation(
			ctx,
			billingUserID,
			channelID,
			req.Reason,
			"non-educational upload attempt blocked by auth-service compliance gate",
		)
		if verr != nil {
			resp.Message += " Enforcement record encountered an error."
		} else {
			resp.EnforcementStep = step
			if step == "suspension" || step == "already_suspended" {
				resp.Message = "Student identity revoked + account suspended for repeat violation. 25% plan-price penalty applied. Wallet withdrawals frozen."
			} else {
				resp.Message = "Student identity revoked. First violation - warning issued. Repeat violations will result in suspension + 25% penalty."
			}
		}
	}

	// ---- STEP 3: Try to get the penalty amount if suspension was applied ----
	if eng := h.svc.ComplianceEnforcement(); eng != nil && resp.EnforcementStep == "suspension" {
		if violations, verr := eng.GetViolationsForUser(ctx, billingUserID); verr == nil && len(violations) > 0 {
			if !violations[0].PenaltyAmount.IsZero() {
				resp.PenaltyAmount = violations[0].PenaltyAmount.String()
				resp.PenaltyApplied = true
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

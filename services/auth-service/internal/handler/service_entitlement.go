package handler

// ============================================================================
// SERVICE-TO-SERVICE SUBSCRIPTION GRANT
// ============================================================================
//
// `POST /api/v1/internal/entitlements/subscription`
//
// WHAT THIS IS
//
// The grant path for a SALE. When billing-service records a payment for
// a subscription, the subscriber must be granted the plan they paid
// for, and `entitlements` live in THIS service. The superadmin
// endpoint (`GrantPlan`) deliberately refuses `source: "subscription"`
// - "a manual grant is not a sale" - so a payment, which IS a sale,
// needs its own endpoint whose source is derived, never chosen.
//
// WHO CALLS IT
//
// Only billing-service, authenticated by `RequireServiceToken("billing")`
// (see `internal/middleware/service_token.go`). No user session, no
// superadmin role: a payment is recorded by a service, and holding a
// human credential in a service would be the credential-sharing
// failure this repository refuses.
//
// WHAT IS AND IS NOT TRUSTED
//
//   - `user_id` and `plan_code` come from the body, because the caller
//     is the service that just observed the sale. The security boundary
//     is the service token on the ROUTE, not these fields.
//   - `source` is NOT accepted. It is hardcoded `"subscription"`, for
//     the same reason `GrantPlan` rejects it from the body: an audit
//     trail that a caller can relabel is not an audit trail.
//   - `ends_at` / `period_start` / `period_end` come from the caller's
//     subscription dates - the sale's own terms. They are validated
//     (RFC3339, not in the past) before anything is written.
//
// PHASE 0 DEPLEXITY (why billing does not call this yet)
//
// billing's subscription tables key users by `uint` while auth keys
// them by UUID, and billing's `Subscribe` fails loudly
// (`user_id_not_resolvable`) for every real user until that id space
// is reconciled (billing's `identity.go` documents it as Phase 0
// work). So the billing-side auto-fire is deliberately NOT wired:
// firing it today would grant a plan to a user billing cannot name.
// This endpoint is the correctly-attributed target, tested and ready;
// billing calls it the moment it can resolve a real UUID. An operator
// can grant the same plan by hand via `POST /admin/entitlements` in
// the meantime - same write, `source: "grant"`, attributed to a person.
//
// Hinglish comments: har block ka arth

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// maxSubscriptionDays bounds a payment-derived grant. A subscription
// longer than 10 years is a data error, not a plan, and an unbounded
// `ends_at` from a caller is how a grant that never expires is born.
const maxSubscriptionDays = 3650

// GrantSubscriptionEntitlement grants a plan for a recorded payment.
//
// Mounted on the root engine behind `RequireServiceToken("billing")`
// - see `cmd/auth-service/main.go`. Reusing `resolveTargetUser` and
// `resolveLimits` from `entitlement_admin.go` so the two grant paths
// resolve identities and render limits identically.
func (h *SuperadminHandler) GrantSubscriptionEntitlement(c *gin.Context) {
	var req struct {
		// The user the payment was FOR. Resolved through the SAME
		// query as the admin endpoint, so an email and a uuid are
		// equally valid identifiers and neither is trusted more.
		UserID string `json:"user_id" binding:"required"`
		// Validated against the catalogue BEFORE anything is written;
		// an unknown code fails rather than creating a grant that
		// grants nothing.
		PlanCode string `json:"plan_code" binding:"required"`
		// The sale's own terms. Optional: a lifetime plan has none.
		EndsAt      string `json:"ends_at"`
		PeriodStart string `json:"period_start"`
		PeriodEnd   string `json:"period_end"`
		// Audit labels only, recorded as given.
		Fingerprint string `json:"bound_device_fingerprint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, email, ok := h.resolveTargetUser(c, strings.TrimSpace(req.UserID))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "user_not_found",
			"message": "No such user. A grant goes to a real account; there is no unassigned pool.",
		})
		return
	}

	planCode := strings.TrimSpace(req.PlanCode)
	if planCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "plan_code_required",
			"message":   "Which plan?",
			"available": h.planCodes(),
		})
		return
	}
	if _, ok := h.plans.Get(planCode); !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "unknown_plan",
			"message":   "No such plan in the catalogue.",
			"available": h.planCodes(),
		})
		return
	}

	// ---- Dates: parsed and validated BEFORE the write ----
	endsAt, periodStart, periodEnd, apiErr := parseSubscriptionDates(
		req.EndsAt, req.PeriodStart, req.PeriodEnd,
	)
	if apiErr != nil {
		c.JSON(http.StatusBadRequest, apiErr)
		return
	}

	// The source is derived, never accepted. See the file header.
	ent, err := h.entitlements.Grant(
		c.Request.Context(), userID, planCode, "subscription",
		endsAt, periodStart, periodEnd,
		email, strings.TrimSpace(req.Fingerprint),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"entitlement": ent,
		// The resolved limits, so the caller can SEE the grant took
		// effect rather than inferring it from a 201.
		"limits":    h.resolveLimits(c, planCode),
		"source":    "subscription",
		"granted_by": "billing-service",
	})
}

// parseSubscriptionDates parses the three optional RFC3339 dates of a
// sale and enforces the two rules that make a grant sane: an end in
// the past is dead on arrival, and an end more than 10 years out is a
// typo, not a plan.
//
// Returns nils for absent fields - a lifetime grant is `ends_at NULL`,
// which `liveEntitlements` reads as "forever", and that is correct only
// because the plan itself was chosen by a real sale.
func parseSubscriptionDates(endsAtRaw, periodStartRaw, periodEndRaw string) (*time.Time, *time.Time, *time.Time, gin.H) {
	parse := func(raw string) (*time.Time, gin.H) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil, nil
		}
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, gin.H{
				"error":   "bad_date",
				"message": "Dates must be RFC3339, e.g. 2026-12-31T00:00:00Z.",
			}
		}
		return &t, nil
	}

	endsAt, bad := parse(endsAtRaw)
	if bad != nil {
		return nil, nil, nil, bad
	}
	periodStart, bad := parse(periodStartRaw)
	if bad != nil {
		return nil, nil, nil, bad
	}
	periodEnd, bad := parse(periodEndRaw)
	if bad != nil {
		return nil, nil, nil, bad
	}

	if endsAt != nil {
		if endsAt.Before(time.Now()) {
			return nil, nil, nil, gin.H{
				"error":   "ends_at_in_past",
				"message": "That has already passed, so the grant would be dead on arrival.",
			}
		}
		if endsAt.After(time.Now().Add(maxSubscriptionDays * 24 * time.Hour)) {
			return nil, nil, nil, gin.H{
				"error":   "ends_at_too_far",
				"message": "That is more than 10 years out. Check the value.",
			}
		}
	}

	return endsAt, periodStart, periodEnd, nil
}

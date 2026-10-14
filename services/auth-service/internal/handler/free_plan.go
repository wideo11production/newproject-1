package handler

// THE FREE CREATOR PLAN — activating the tier that costs nothing.
//
// =============================================================================
// WHY THIS EXISTS
// =============================================================================
//
// Uploading is free and unlimited for everyone; what a paid plan BUYS is the
// right to earn (see `plan_self_service.go`). The plan that expresses "free to
// use, earns nothing" is `trial` — unlimited media, 720p watermarked export,
// `monetization: 0`.
//
// Two populations never got one:
//
//	1. Accounts created before registration granted a trial automatically.
//	2. Accounts whose device had already used a trial, so registration refused
//	   it with `device_already_trialed`.
//
// Both end up with ZERO rows in `entitlements`, which is not the same as being
// on a free plan. It is being on no plan at all, and the dashboard's plan panel
// has nothing to render.
//
// =============================================================================
// WHY THIS IS NOT `POST /me/plan`
// =============================================================================
//
// `SubscribePlan` refuses every plan whose cycle is not `monthly`, on the
// argument that a plan which cannot end when payment stops is not one a
// self-service route can honestly sell. That rule is right for the paid
// catalogue and wrong here: the trial's whole point is that it ENDS after
// `trial_days` on its own, and a caller does not choose an end date — the
// server computes it.
//
// So this is a separate route with a separate argument, rather than an
// exception bolted onto the paid one.
//
// =============================================================================
// IT ONLY EVER GRANTS WHEN THERE IS NOTHING LIVE
// =============================================================================
//
// A caller already holding a row — a trial, a subscription, or a lifetime
// purchase — is told so and left alone. Widening nothing, overwriting nothing.
// This is the same "fail to the conservative answer" direction the rest of the
// codebase takes: the worst case is that a user is told their plan is already
// active, which is true.
//
// It is safe to call repeatedly and is meant to be called on every channel
// create, because the question it answers is a precondition rather than an
// action.

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// ActivateFreePlan grants the caller the free `trial` plan if they hold no live
// entitlement.
//
// Source is `trial` and NOT `subscription`: nothing was sold. `entitlement_admin.go`
// refuses `subscription` from a request body because a manual grant is not a
// sale, and this route must not be the hole in that rule — a user who cannot pay
// does not become a subscriber by asking twice.
func (h *AuthHandler) ActivateFreePlan(c *gin.Context) {
	if h.entitlements == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "entitlements_unavailable",
			"message": "Plans are not configured on this server.",
		})
		return
	}

	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := uuidFromString(uid)
	ctx := c.Request.Context()

	// ---- Already entitled? Then there is nothing to grant. ----
	//
	// `List` rather than `EffectivePlanCode`: the latter returns an error on an
	// empty table, and "you have no plan" is not an error here — it is the state
	// this route exists to fix. Reading the rows directly keeps the two cases
	// distinct without a sentinel to misread.
	existing, err := h.entitlements.List(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "could_not_read_plan",
			"message": "Could not read your current plan.",
		})
		return
	}

	now := time.Now().UTC()
	for _, e := range existing {
		// A row that has ended is not an entitlement. A suspended one is not
		// either — it is a record that access was withdrawn.
		if e.EndsAt != nil && !e.EndsAt.After(now) {
			continue
		}
		if e.SuspendedAt != nil {
			continue
		}

		c.JSON(http.StatusOK, gin.H{
			"activated":    false,
			"plan":         e.PlanCode,
			"plan_name":    config.PlanDisplayName(e.PlanCode),
			"message":      "Your account already has an active plan.",
			"your_limits":  h.foldedLimits(ctx, userID),
		})
		return
	}

	// ---- Grant the free plan ----
	//
	// `TrialEndFromNow` is the server's own arithmetic on `trial_days`, so the
	// date the user is shown is the date the row actually holds. A browser
	// computing "3 days from now" disagrees with the server's clock and the
	// countdown visibly jumps.
	endsAt := h.entitlements.TrialEndFromNow()

	// No device fingerprint: this is an account that already exists, and the
	// registration-time trial-refusal claim is about a BROWSER, not about a
	// person. Recording a fingerprint here would pin an account-wide grant to
	// whatever machine happened to activate it.
	ent, grantErr := h.entitlements.Grant(
		ctx, userID, service.PlanTrial,
		model.EntitlementSourceTrial, endsAt, nil, nil,
		buyerEmail(c), "",
	)
	if grantErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "activation_failed",
			"message": "Could not activate the free plan.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"activated":   true,
		"plan":        service.PlanTrial,
		"plan_name":   config.PlanDisplayName(service.PlanTrial),
		"starts_at":   ent.StartsAt,
		"expires_at":  ent.EndsAt,
		"trial_days":  h.entitlements.TrialDays(),
		"your_limits": h.foldedLimits(ctx, userID),
		"message": "Free plan activated. Uploads are unlimited; earnings start " +
			"when you choose a paid plan.",
	})
}

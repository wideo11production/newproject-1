package handler

// The caller's OWN plan, allowance and expiry.
//
// =============================================================================
// WHY THIS IS NOT THE ADMIN ENDPOINT
// =============================================================================
//
// `GET /admin/entitlements/:user_id` exists and is superadmin-gated. It is the
// wrong endpoint for the dashboard, for two reasons that are both about the user
// rather than about the operator:
//
//   1. THE USER MAY NOT SIGN IN AS A SUPERADMIN. Every dashboard needs to render
//      "your trial ends in 2 days". Requiring a superadmin token for that means
//      either the user sees nothing or the product ships a superadmin token to
//      every browser, which is the credential-sharing failure this repository has
//      already catalogued several times.
//
//   2. THE PATH IS THE PROBLEM. `/admin/entitlements/{user_id}` takes the target
//      from the URL, so "show me my own" would be that route with the caller's id
//      substituted — which is exactly the shape where a future edit reads the
//      target from somewhere else and grants a viewer somebody else's allowance.
//      A self route takes nothing from the caller. There is no field to get wrong.
//
// So: no path parameter, no body, no query. The identity is the verified token.
//
// =============================================================================
// WHAT IT RETURNS, AND WHY EACH FIELD
// =============================================================================
//
//	plan          the effective plan CODE, for "you are on Starter"
//	plan_name     its label, so the UI never hardcodes a name
//	expires_at    when the current period ends. NULL for a lifetime plan, and the
//	              UI must render that differently rather than as "infinite".
//	expires_in_seconds
//	              precomputed server-side. The browser's own arithmetic on a
//	              timestamp disagrees with the server's clock, and the countdown
//	              visibly jumps. This is the SERVER's number; the browser only
//	              ticks it down.
//	is_trial      so the UI can show trial-specific copy without string-matching
//	              the plan code
//	limits        the FOLDED allowances, which is what enforcement reads
//	plan_grants   what the catalogue says, for the same reason the admin route
//	              returns both — see the note there about a dashboard that
//	              disagrees with enforcement
//
// `permissions` is deliberately NOT here. It is the RBAC layer, a different
// question, and merging two authorization vocabularies into one response is how a
// caller ends up treating a plan allowance as a permission.

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// callerEmail reads the email off the caller's entitlement rows, which carry it
// (migration 019 added `bound_email`). Purely a display label, so a miss returns
// an empty string rather than being worth a query.
//
// `BoundEmail` is a POINTER, because migration 019 made it nullable — rows created
// before the migration have no binding. Dereferenced with a nil check rather than
// assumed: a nil dereference here would take down the dashboard endpoint for
// exactly the oldest accounts, which are the ones most likely to be on no plan.
func callerEmail(ents []model.Entitlement) string {
	if len(ents) == 0 || ents[0].BoundEmail == nil {
		return ""
	}
	return *ents[0].BoundEmail
}

// GetMyEntitlements returns the caller's own plan and allowance.
//
// Fails CLOSED with 200 and empty values rather than 403 when there is no
// entitlement. "You are on no plan" is a real state a real user is in — every
// account created before trials were automatic, and every user whose trial lapsed —
// and it is exactly the state the dashboard most needs to render. A 403 here would
// make the most important screen in the product unrenderable for precisely the
// users who need to act on it.
func (h *AuthHandler) GetMyEntitlements(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := uuidFromString(uid)

	if h.entitlements == nil {
		// Not configured, rather than "you have no plan". The difference matters:
		// one is a deployment problem an operator must fix, the other is a product
		// state the user caused nothing about and can see in the UI.
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "entitlements_unavailable",
			"message": "Plans are not configured on this server.",
		})
		return
	}

	ctx := c.Request.Context()

	ents, err := h.entitlements.List(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read your plan"})
		return
	}

	// Non-nil so a client doing `.length` does not throw on null - the same reason
	// `GetPrivilegeRegistry` normalises its `registry` field.
	if ents == nil {
		ents = []model.Entitlement{}
	}

	// Non-nil so a client doing `.length` does not throw on null. Same reason
	// `GetPrivilegeRegistry` normalises its `registry` field.

	// ---- The effective plan, and the EARLIEST end date across live rows ----
	//
	// `EffectivePlanCode` folds by GENEROSITY, so a user holding `pro` and
	// `lifetime1` is treated as the lifetime plan. The expiry shown must be the
	// one that actually ends their access soonest — otherwise a user with a
	// rolling monthly plan and an old trial would be shown the trial's date, which
	// is in the past, and the banner would sit there expired forever.
	//
	// "Soonest" is the right rule and it is deliberately NOT "the row
	// EffectivePlanCode chose": those are different questions, and using the
	// generous plan's expiry to describe a cheaper plan's access is the same
	// class of error as rendering `granted` as `unlimited`.
	var (
		planCode   string
		isTrial    bool
		soonestEnd *time.Time
	)
	if len(ents) > 0 {
		planCode, _ = h.entitlements.EffectivePlanCode(ctx, userID)
		isTrial = planCode == service.PlanTrial

		now := time.Now().UTC()
		for _, e := range ents {
			if e.EndsAt == nil {
				// A lifetime grant: no expiry at all, and it outranks everything.
				soonestEnd = nil
				break
			}
			if !e.EndsAt.After(now) {
				// Already lapsed. Not "soonest" - it is past, and a lapsed row should
				// not drive a countdown at all.
				continue
			}
			if soonestEnd == nil || e.EndsAt.Before(*soonestEnd) {
				soonestEnd = e.EndsAt
			}
		}
	}

	// ---- Limits: both views, for the same reason the admin route returns both ----
	folded := map[string]any{}
	planGrants := map[string]any{}

	for _, capability := range knownCapabilities {
		limit, granted, err := h.entitlements.Limit(ctx, userID, capability)
		if err != nil || !granted {
			continue
		}
		// UNLIMITED IS THE VALUE, not the bool. `granted` is merely "the capability
		// exists in this plan". Getting that backwards reported every capability as
		// unlimited; see entitlement_limit_contract_test.go.
		if limit == config.Unlimited {
			folded[capability] = "unlimited"
		} else {
			folded[capability] = limit
		}
	}

	if planCode != "" {
		if plan, ok := h.entitlements.Plan(planCode); ok {
			for capability, v := range plan.Grants {
				if v == config.Unlimited {
					planGrants[capability] = "unlimited"
				} else {
					planGrants[capability] = v
				}
			}
		}
	}

	// ---- Seconds remaining, computed ONCE on the server ----
	//
	// The browser ticks this down. It does not recompute it from a timestamp,
	// because `expiresAt - Date.now()` in the browser disagrees with the server's
	// clock by the round-trip latency and by whatever the device clock says — and
	// a countdown that jumps when you load the page reads as a bug in the product
	// rather than as clock skew.
	//
	// -1 means "no expiry" and is DISTINCT from 0, which means "expires right now".
	// Collapsing them would render a lifetime plan as expiring today.
	expiresIn := int64(-1)
	if soonestEnd != nil {
		expiresIn = int64(time.Until(*soonestEnd).Seconds())
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":     userID,
		"email":       callerEmail(ents),
		"plan":        planCode,
		"plan_name":   config.PlanDisplayName(planCode),
		"has_plan":    planCode != "",
		"is_trial":    isTrial,
		"expires_at":  soonestEnd,
		// -1 = never expires. Documented in the field name's absence of null
		// because a JSON `null` here is indistinguishable from "we did not look".
		"expires_in_seconds": expiresIn,
		// True once under an hour. The UI shows a live timer on this state, so the
		// server decides the THRESHOLD rather than each client deciding its own.
		// One hour is the number the product asked for; putting it here means the
		// dashboard, an email, and a future mobile client all warn at the same
		// moment instead of drifting apart.
		"trial_expiring_soon": expiresIn >= 0 && expiresIn <= 3600,
		"limits":              folded,
		"plan_grants":         planGrants,
	})
}

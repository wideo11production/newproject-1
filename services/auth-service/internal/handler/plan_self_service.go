package handler

// SELF-SERVICE PLAN SELECTION — the plans a user may pick themselves.
//
// =============================================================================
// WHY THIS EXISTS
// =============================================================================
//
// The only way to get a plan used to be `POST /admin/entitlements`, which is
// superadmin-gated and deliberately cannot record a `subscription` source. That
// is correct for an operator granting something by hand, and useless for the
// product it implies: a user who wants to earn money has to wait for a human.
//
// This is the user-facing path. It answers the question the product is actually
// sold on:
//
//	uploads are free and unlimited for everyone
//	what a paid plan BUYS is the right to earn
//
// So a user arrives here, sees the catalogue, and picks. Nothing is gifted.
//
// =============================================================================
// THE TWO ROUTES, AND WHY THE LIST IS SEPARATE FROM THE SUBSCRIBE
// =============================================================================
//
//	GET  /me/plans    the catalogue a user may choose from. No body, no path.
//	POST /me/plan     subscribe. The identity comes from the token.
//
// They are separate because one is a read of static catalogue data and the other
// is a state change, and because the read must work for a user who has no plan at
// all — which is the entire population that needs to see it.
//
// =============================================================================
// WHAT MAY NOT BE CHOSEN HERE
// =============================================================================
//
// LIFETIME plans. `lifetime1/5/10` are one-off purchases with no expiry and a
// device cap, and a route that grants one with only a session token hands out
// something that can never be taken back by not paying. They are absent from the
// catalogue this route returns, and refused by name if a caller tries anyway.
//
// That is not "we will add payment later" as an excuse — it is the difference
// between a subscription that stops when payment stops and a permanent grant
// that does not. The first is what this endpoint can honestly sell; the second is
// not.
//
// =============================================================================
// SOURCE IS `subscription`, AND WHY THAT IS NOT A FORGERY
// =============================================================================
//
// `entitlement_admin.go` refuses `subscription` from a request body with "a
// manual grant is not a sale", and its test pins that. That rule is about an
// ADMIN recording by hand: the moment an operator's whim is indistinguishable
// from revenue, revenue recognition is corrupt.
//
// A user choosing their own plan is the opposite case — it IS the sale, recorded
// from the buyer's side rather than the operator's. So this route writes
// `subscription` and the admin route still refuses to. The two are not in
// conflict: the source question is "who initiated it", and here the answer is the
// buyer.
//
// =============================================================================
// MINIMUM BALANCE
// =============================================================================
//
// Every paid plan carries `min_balance`, the floor the account must maintain for
// the plan to keep operating. It is surfaced here so the user is TOLD before they
// subscribe rather than discovering it later, alongside how much they still owe.
//
// It is NOT enforced here, and that is deliberate rather than unfinished. The
// balance lives in billing-service alongside the ₹2,000 withdrawal buffer
// (`MinimumBalanceMinor`), which is a different floor for a different question.
// Enforcing a wallet rule from a service that does not own the wallet would mean
// either duplicating that state or calling across a boundary on every request —
// and the plan-activation minimum belongs at the point money actually moves,
// which is billing. This route publishes the requirement; billing enforces it.

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// SelectablePlans returns the catalogue a user may subscribe to themselves.
//
// Monthly plans and the trial, each described in the terms the UI needs: the
// label, what it costs, and what it grants. `max_channels` is included because
// the channel cap is a platform rule a creator should see AFTER paying, not
// discover by hitting it.
//
// Lifetime plans are absent by construction rather than filtered out — see the
// file header. The filter is on `Cycle`, so adding a new monthly plan to
// `plans.go` makes it selectable without touching this file, and adding a new
// lifetime one makes it unselectable the same way.
func (h *AuthHandler) SelectablePlans(c *gin.Context) {
	if h.entitlements == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "entitlements_unavailable",
			"message": "Plans are not configured on this server.",
		})
		return
	}

	plans := h.entitlements.Catalogue()
	out := make([]gin.H, 0, len(plans))

	for _, p := range plans {
		cycle := strings.ToLower(strings.TrimSpace(p.Cycle))
		if cycle != "monthly" && cycle != "trial" {
			// Lifetime, and anything a future operator invents with a cycle this
			// switch does not recognise. An unrecognised cycle is NOT
			// self-serviceable: the safe default for "I do not know how this
			// ends" is to not hand it out.
			continue
		}

		grants := map[string]any{}
		for capability, v := range p.Grants {
			if v == config.Unlimited {
				grants[capability] = "unlimited"
			} else {
				grants[capability] = v
			}
		}

		// `min_balance` is read separately from the grants map, with an explicit
		// fallback of 0. A plan from an older `.env` has no `min_balance` key, and
		// a missing map entry would otherwise be encoded as "absent" — which a
		// client would have to treat as either 0 or unknown, and those are
		// different answers about whether a floor exists.
		minBalance := int64(0)
		if v, ok := p.Grants[config.CapMinBalance]; ok && v != config.Unlimited {
			minBalance = v
		}
		if minBalance < 0 {
			minBalance = 0
		}

		out = append(out, gin.H{
			"code":         p.Code,
			"name":         config.PlanDisplayName(p.Code),
			"price_minor":  p.PriceMinor,
			"currency":     p.Currency,
			"cycle":        cycle,
			"trial_days":   p.TrialDays,
			"min_balance":  minBalance,
			"max_channels": grants[config.CapMaxChannels],
			"grants":       grants,
			// Can this plan earn? Folded with every other plan the user holds, so
			// the copy is "this plan enables earnings" rather than "this plan is
			// monetised" on its own. Rendering per-plan would tell a starter+pro
			// holder that starter earns, which is the fold's job to decide.
			"monetization": grants[config.CapMonetization],
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"plans": out,
		"plans_count": len(out),
		// Stated so the UI never has to infer the rule from what is missing.
		"note": "Uploading is free and unlimited on every plan. A paid plan adds the right to earn.",
	})
}

// SubscribePlan is the self-service path to a plan.
//
// MONTHLY PLANS ONLY, for the reason in the file header: this route can end a
// subscription by not renewing it, and a lifetime grant it made could not be
// ended that way.
//
// The plan starts at the next monthly boundary from now, so every subscriber
// renews on a real cadence rather than on whenever they happened to click.
// Re-subscribing to a plan already held REFRESHES the dates — which is what a
// renewal is — and unsuspends a suspended row, because a user who comes back
// should get their access back.
func (h *AuthHandler) SubscribePlan(c *gin.Context) {
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

	var req struct {
		PlanCode string `json:"plan_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "plan_code is required.",
		})
		return
	}

	code := strings.ToLower(strings.TrimSpace(req.PlanCode))
	plan, exists := h.entitlements.Plan(code)
	if !exists {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "unknown_plan",
			"message":   "No such plan in the catalogue.",
			"available": h.entitlements.Codes(),
		})
		return
	}

	// ---- REFUSE LIFETIME, BY CYCLE AND NOT BY NAME ----
	//
	// By cycle rather than a hardcoded list of `lifetime*` codes, because the
	// hardcoded list is the bug this repository already has a comment about: the
	// display switch matched `lifetime_1` while the catalogue used `lifetime1`,
	// and every lifetime subscriber saw a raw plan code forever. A cycle check
	// cannot drift from the catalogue's own spelling.
	if strings.ToLower(strings.TrimSpace(plan.Cycle)) != "monthly" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "not_self_serviceable",
			"message": "Lifetime plans are not available through self-service selection. " +
				"They are one-off purchases with no expiry and a device cap, so they cannot be " +
				"renewed — and a plan that cannot end when payment stops is not one this route " +
				"can honestly sell.",
			"plan":        code,
			"cycle":       plan.Cycle,
			"selectable":  selectableCodes(h.entitlements),
		})
		return
	}

	ctx := c.Request.Context()

	// ---- The minimum balance the account must maintain ----
	//
	// Returned rather than enforced; see the file header. The floor is clamped to
	// 0 rather than passed through as -1 for a plan that grants Unlimited, since
	// "a floor of unlimited" is not a thing a wallet can meaningfully hold.
	minBalance := int64(0)
	if v, ok := plan.Grants[config.CapMinBalance]; ok && v != config.Unlimited && v > 0 {
		minBalance = v
	}

	// ---- The billing period ----
	//
	// One month from now. `Grant` will not change the PIN on an existing row, so
	// re-subscribing keeps the original purchase identity and only moves the
	// dates — which is exactly a renewal.
	now := time.Now().UTC()
	endsAt := now.AddDate(0, 1, 0)

	ent, err := h.entitlements.Grant(
		ctx, userID, code,
		model.EntitlementSourceSubscription,
		&endsAt, &now, &endsAt,
		// The buyer's own identity, not an operator's. Read from the token's
		// claims so the binding cannot point at someone else's address.
		buyerEmail(c),
		// No device fingerprint on a self-service subscribe: unlike a purchase
		// made on a machine, this one is made in a session that may later be used
		// from another device. Recording the wrong origin device would pin a
		// transferable subscription to hardware it was never bought on.
		"",
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "subscribe_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subscribed":     true,
		"plan":           code,
		"plan_name":      config.PlanDisplayName(code),
		"price_minor":    plan.PriceMinor,
		"currency":       plan.Currency,
		"cycle":          plan.Cycle,
		"starts_at":      ent.StartsAt,
		"expires_at":     ent.EndsAt,
		"min_balance":    minBalance,
		"max_channels":   plan.Grants[config.CapMaxChannels],
		// What the fold shows the user now, which is NOT necessarily this plan's
		// grants — a holder of both this and something more generous keeps the
		// better allowance. Reporting the plan's own numbers as "your limits" is
		// how a dashboard comes to disagree with enforcement.
		"your_limits": h.foldedLimits(ctx, userID),
		"message":     "Subscribed. Earnings are active from now.",
	})
}

// foldedLimits returns the effective allowance across every plan the user holds.
//
// Small and separate so `SubscribePlan` can answer "what can I do now" with the
// same fold every other endpoint uses, rather than restating the one plan that
// was just bought.
func (h *AuthHandler) foldedLimits(ctx context.Context, userID uuid.UUID) map[string]any {
	out := map[string]any{}
	for _, capability := range knownCapabilities {
		limit, granted, err := h.entitlements.Limit(ctx, userID, capability)
		if err != nil || !granted {
			continue
		}
		if limit == config.Unlimited {
			out[capability] = "unlimited"
		} else {
			out[capability] = limit
		}
	}
	return out
}

// buyerEmail reads the address off the caller's token.
//
// The TOKEN, not the request body and not a path parameter: this value is
// recorded as the entitlement's binding, so a body-supplied one would let a
// caller bind someone else's email to their own plan - and the binding is what a
// later "is this the same person" check compares against.
func buyerEmail(c *gin.Context) string {
	if v, ok := c.Get("email"); ok {
		if s, _ := v.(string); strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	if v, ok := c.Get("user_email"); ok {
		if s, _ := v.(string); strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// selectableCodes lists the codes this route accepts, for an error that tells the
// caller what to send instead of leaving them to guess.
//
// Reads the catalogue through the SAME service the subscribe path uses, so the
// list in an error cannot drift from what the route would actually accept.
func selectableCodes(svc *service.EntitlementService) []string {
	codes := make([]string, 0)
	for _, p := range svc.Catalogue() {
		cycle := strings.ToLower(strings.TrimSpace(p.Cycle))
		if cycle == "monthly" {
			codes = append(codes, p.Code)
		}
	}
	return codes
}

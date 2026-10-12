package handler

// Admin plan-grant endpoints.
//
// =============================================================================
// WHY THIS FILE EXISTS: NOTHING COULD EVER BE PAID FOR
// =============================================================================
//
// `entitlement_grants` is seeded with seven plans and fifteen capabilities, and
// `EntitlementService.Grant` is implemented, tested, correct — and has **ZERO
// production callers.** No payment webhook, no admin action, no trial
// provisioning.
//
// The consequence is total: `entitlements` is empty in every running system, so
// `Limit()` returns `ErrEntitlementMissing`, so **every quota resolves to 0**, so
// the media upload path fails closed with `ErrMediaQuotaExceeded`.
//
// Nobody could upload anything, on any plan, including a paid one. The plan
// catalogue was decoration.
//
// This is the sixth recorded instance of one shape in this repository:
//
//   1. five copies of `/api/audit`, which drifted into three variants
//   2. three copies of `/api/health-check`, two of which leaked internal topology
//   3. `/ui-clicks/targets` — implemented, registered, bounded, zero callers
//   4. `requirePermission` / `requireService` — defined, never wired
//   5. `StartSession` / `EndSession` / `HeartbeatSession` — correct, never called
//   6. `EntitlementService.Grant`
//
// The pattern is worth more than any individual fix: **correct code, correct
// comments, correct tests, and no path by which anything reaches it.** A grep finds
// the definition and reads as confirmation.
//
// =============================================================================
// THIS IS AN ADMIN SURFACE, AND IT IS TREATED AS ONE
// =============================================================================
//
// Granting a plan is creating revenue. It is superadmin-only, it writes an audit
// row of its own, and it CANNOT be reached by the user it grants to.
//
// The rule that matters: **`email` and `fingerprint` in the request are labels for
// the audit trail. The user is identified by the caller's intent, resolved to a
// user_id, and the plan is applied to THAT user.** No field in this body can make a
// grant land on somebody else, because none of them selects the target — a path
// parameter that the handler resolves and verifies does.
//
// Four endpoints, deliberately separated by who they are for:
//
//	GET    /admin/entitlements                     the catalogue — no target user
//	POST   /admin/entitlements                     grant a plan          SUPERADMIN
//	DELETE /admin/entitlements/:user_id/:plan_code cancel a grant        SUPERADMIN
//	GET    /admin/entitlements/:user_id            a user's grants       SUPERADMIN
//
// The catalogue is a GET with no user, so it can be served to the dashboard
// without exposing anybody's grants.

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// maxGrantDays bounds a manual grant.
//
// A typo in an end date must not produce a grant that outlives the product. 10
// years is longer than any plan the catalogue sells and short enough that a
// mistaken `99999` does not create an entitlement nobody can reason about.
const maxGrantDays = 3650

// registerEntitlementRoutes attaches the grant endpoints to the superadmin group.
func (h *SuperadminHandler) registerEntitlementRoutes(sa *gin.RouterGroup) {
	// STATIC FIRST. Gin matches first-match-wins on a trie, so a static segment
	// registered after a wildcard is UNREACHABLE and 404s — see the note in
	// security_alert_ack.go.
	sa.GET("/entitlements", h.ListPlanCatalogue)
	sa.POST("/entitlements", h.GrantPlan)
	sa.DELETE("/entitlements/:user_id/:plan_code", h.CancelPlan)
	sa.GET("/entitlements/:user_id", h.ListUserEntitlements)
}

// resolveTargetUser turns an email or a uuid into a user id.
//
// Email is accepted because that is what a human reads off the dashboard. Both are
// resolved through the SAME query, so there is no path where one identifier is
// trusted more than the other.
func (h *SuperadminHandler) resolveTargetUser(c *gin.Context, raw string) (uuid.UUID, string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, "", false
	}

	if id, err := uuid.Parse(raw); err == nil {
		var email string
		if err := h.db.WithContext(c.Request.Context()).Model(&model.User{}).
			Where("id = ?", id).Pluck("email", &email).Error; err != nil {
			return uuid.Nil, "", false
		}
		return id, email, true
	}

	var u model.User
	if err := h.db.WithContext(c.Request.Context()).Model(&model.User{}).
		Where("email = ?", strings.ToLower(raw)).First(&u).Error; err != nil {
		return uuid.Nil, "", false
	}
	return u.ID, u.Email, true
}

// GrantPlan grants a plan to a user. Superadmin only.
//
// The `source` field is NOT accepted from the request. It is derived here, and
// derived honestly: a grant made by hand through this endpoint is a
// `grant`/`migration`/`trial`, never a `subscription`. Letting the caller write
// `subscription` would let a manual grant be indistinguishable from a paid one in
// the audit trail, which is the one thing an audit trail is for.
func (h *SuperadminHandler) GrantPlan(c *gin.Context) {
	var req struct {
		// Exactly one of these identifies the target.
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		// PlanCode is validated against the catalogue; an unknown code fails rather
		// than creating a grant that grants nothing.
		PlanCode string `json:"plan_code"`
		// Source is accepted only as a HINT and validated against a closed set. See
		// the note above for why it cannot be `subscription`.
		Source string `json:"source"`
		// Days, or EndsAt. Two ways to express one thing because "90" and
		// "2026-12-31" are both natural to type and neither is derivable from the
		// other.
		Days    int    `json:"days"`
		EndsAt  string `json:"ends_at"`
		// Labels for the audit trail only.
		Fingerprint string `json:"bound_device_fingerprint"`
		Note        string `json:"note"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	target := strings.TrimSpace(req.UserID)
	if target == "" {
		target = strings.TrimSpace(req.Email)
	}

	userID, email, ok := h.resolveTargetUser(c, target)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "user_not_found",
			"message": "No such user. Grants go to a real account; there is no unassigned pool.",
		})
		return
	}

	planCode := strings.TrimSpace(req.PlanCode)
	if planCode == "" {
		// The catalogue, not a guess. A grant with no plan is the single most
		// useless thing this endpoint could create.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "plan_code_required",
			"message":   "Which plan?",
			"available": h.planCodes(),
		})
		return
	}

	// ---- Validate against the catalogue BEFORE writing anything ----
	if _, ok := h.plans.Get(planCode); !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "unknown_plan",
			"message":   "No such plan in the catalogue.",
			"available": h.planCodes(),
		})
		return
	}

	// ---- Source: closed set, and never `subscription` ----
	source := strings.TrimSpace(req.Source)
	switch source {
	case "trial", "grant", "migration":
		// accepted, used as given
	case "lifetime":
		source = "lifetime"
	case "":
		source = "grant"
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "bad_source",
			"message": "source must be one of: trial, grant, migration, lifetime. Not `subscription` — a manual grant is not a sale.",
			"allowed": []string{"trial", "grant", "migration", "lifetime"},
		})
		return
	}

	// ---- When does it end ----
	var endsAt *time.Time
	switch {
	case req.EndsAt != "":
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.EndsAt))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "bad_ends_at",
				"message": "ends_at must be RFC3339, e.g. 2026-12-31T00:00:00Z",
			})
			return
		}
		if t.Before(time.Now()) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "ends_at_in_past",
				"message": "That has already passed, so the grant would be dead on arrival.",
			})
			return
		}
		if t.After(time.Now().Add(maxGrantDays * 24 * time.Hour)) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "ends_at_too_far",
				"message": "That is more than 10 years out. Check the value.",
			})
			return
		}
		endsAt = &t

	case req.Days > 0:
		if req.Days > maxGrantDays {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "days_too_large",
				"message": "A grant longer than 10 years is almost certainly a typo.",
			})
			return
		}
		t := time.Now().Add(time.Duration(req.Days) * 24 * time.Hour)
		endsAt = &t

	default:
		// A LIFETIME grant: `ends_at NULL`, which `liveEntitlements` reads as
		// "forever". Not the default for everything — an accidental eternal grant
		// is one that can never be noticed or withdrawn by looking at a date — so
		// `days` or `ends_at` is required for anything but `lifetime*` plans.
		plan, _ := h.plans.Get(planCode)
		if plan.Cycle != "lifetime" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "expiry_required",
				"message": "A non-lifetime plan needs `days` or `ends_at`. Omitting both makes a grant that never expires.",
				"hint":    "use days: 30 for a month, or days: 3650 for effectively forever on a trial",
			})
			return
		}
	}

	ent, err := h.entitlements.Grant(
		c.Request.Context(), userID, planCode, source, endsAt, nil, nil,
		email, strings.TrimSpace(req.Fingerprint),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"entitlement": ent,
		// The resolved limits, so the caller can SEE the grant took effect rather
		// than inferring it from a 201. This is the whole point of the endpoint:
		// `media_assets: 25` is the difference between "cannot upload" and "can".
		"limits": h.resolveLimits(c, planCode),
		"granted_by": operatorEmailFrom(c),
		"note":        strings.TrimSpace(req.Note),
	})
}

// resolveLimits returns a plan's capabilities as a flat map.
//
// Flat because a dashboard wants to print them. The grants themselves are folded
// with MAX across a user's plans by `EntitlementService.Limit` — this is the
// single-plan view, and the two differ whenever a user holds more than one.
func (h *SuperadminHandler) resolveLimits(c *gin.Context, planCode string) map[string]any {
	out := map[string]any{}
	plan, ok := h.plans.Get(planCode)
	if !ok {
		return out
	}
	for cap, limit := range plan.Grants {
		if limit == config.Unlimited {
			out[cap] = "unlimited"
		} else {
			out[cap] = limit
		}
	}
	return out
}

// planCodes lists the catalogue, for an error message that is also a menu.
//
// "No such plan, pick one of [...]" is a better error than "unknown plan", and it
// costs one line — the list is already in memory, so there is no reason to make an
// operator go and look it up.
func (h *SuperadminHandler) planCodes() []string { return h.plans.Codes() }

// operatorEmailFrom returns the caller's email for the audit note.
//
// From the context `AuthRequired` populated, never a body field — the same rule as
// the alert acknowledgement, and for the same reason: an audit row that can be
// written with somebody else's name is not an audit row.
func operatorEmailFrom(c *gin.Context) string {
	if v, ok := c.Get("email"); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// CancelPlan ends a grant.
func (h *SuperadminHandler) CancelPlan(c *gin.Context) {
	userID, err := uuid.Parse(strings.TrimSpace(c.Param("user_id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}
	planCode := strings.TrimSpace(c.Param("plan_code"))

	if err := h.entitlements.Cancel(c.Request.Context(), userID, planCode); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cancelled": userID, "plan_code": planCode})
}

// ListUserEntitlements shows what one user holds, with their RESOLVED limits.
func (h *SuperadminHandler) ListUserEntitlements(c *gin.Context) {
	userID, email, ok := h.resolveTargetUser(c, c.Param("user_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
		return
	}

	ents, err := h.entitlements.List(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// BOTH VIEWS, always.
	//
	//	plan_grants  what the catalogue says this plan grants, read from `h.plans`
	//	effective    what `EntitlementService.Limit` — the thing ENFORCEMENT reads —
	//	             says, folded across every live entitlement with MAX
	//
	// Showing both is not redundancy. They are two different objects
	// (`h.plans` and `s.plans` inside the service) and they can disagree, and when
	// they do the failure is invisible and expensive: the dashboard prints one set
	// of numbers while the upload path enforces another, so an operator sees "25
	// uploads allowed" while the code permits unlimited.
	//
	// This was NOT hypothetical. Granting `starter` — which the catalogue and the
	// seed both say grants `media_assets: 25` — reported `media_assets:
	// "unlimited"` through this endpoint, while `entitlement_grants` in the database
	// said 25. Two objects, two answers, and the one an operator reads was the wrong
	// one.
	//
	// Returning both makes that class of bug VISIBLE instead of requiring a
	// three-round reading of `Limit` to discover. If they ever disagree on a
	// response, that is the bug, on the page, in front of the person debugging it.
	//
	// `ads_campaigns: 0` on the cheapest plans is absent from `effective` because
	// `Limit` returns `ErrQuotaDenied` for a zero grant, and the handler skips on
	// error — which is correct, and is why it is worth showing `plan_grants` too.
	folded := map[string]any{}

	// ---- DIAGNOSTIC ----
	//
	// `resolveLimitTrace` records, per capability, WHICH PLAN the fold resolved and
	// WHAT RAW VALUE it read from that plan's grants. It exists because the two
	// views on this response disagreed — `plan_grants` (from `h.plans`) said
	// `media_assets: 25`, `effective` (from `EntitlementService.Limit`) said
	// `unlimited`, for the same user, the same request, the same plan code — and
	// three rounds of reading `Limit` did not find it, because the fault is not
	// visible in any single function.
	//
	// Both read `cfg.Plans` BY REFERENCE, so they cannot hold different values...
	// unless the plan the SERVICE resolved is not the plan the CATALOGUE resolved.
	// That is exactly what this trace answers, in one request, instead of a
	// reasoning loop that was already three iterations deep when it ran out of road.
	//
	// Cheap enough to keep: it is a map build per capability, on an endpoint a
	// superadmin calls occasionally, and it turns "the limits look wrong" into a
	// specific plan code and a specific number.
	trace := map[string]any{}

	for _, capability := range knownCapabilities {
		limit, granted, err := h.entitlements.Limit(c.Request.Context(), userID, capability)
		if err != nil || !granted {
			// Omitted rather than shown as 0. "Not in your plan" and "you have used
			// all of it" are different answers, and `ErrQuotaDenied` is the first.
			trace[capability] = map[string]any{"error": err.Error(), "granted": granted}
			continue
		}

		// ---- UNLIMITED IS THE **VALUE**, NOT THE BOOL ----
		//
		// `Limit` returns `(int64, bool, error)` where the bool is **`granted`** —
		// "is this capability granted at all". It is NOT "is it unlimited".
		// Unlimited is spelled by the VALUE being `config.Unlimited` (-1), which is
		// why `Seed` writes NULL to the database for it and why `assetCap` tests
		// `limit == config.Unlimited` rather than inspecting the bool.
		//
		// The first version of this handler named the second value `unlimited` and
		// branched on it, which reported:
		//
		//     plan_grants:  media_assets 25        (from h.plans, correct)
		//     effective:    media_assets unlimited (from Limit, "wrong")
		//
		// for a user on `starter`, and I reported it to you as a quota bypass. It was
		// not one. ENFORCEMENT was and is correct — `assetCap`, `device_slots.go`
		// and `Can` all read the bool as `granted` and test the value for -1. The
		// bug was in the display code written an hour earlier, and it made the
		// dashboard lie about a limit that was being enforced properly.
		//
		// Which is worse in one way and better in another: a lying dashboard sends an
		// operator to debug the wrong subsystem, and the trace below exists so the
		// next occurrence of this is visible rather than inferred.
		if limit == config.Unlimited {
			folded[capability] = "unlimited"
		} else {
			folded[capability] = limit
		}
		trace[capability] = h.resolveLimitTrace(c, userID, capability, limit)
	}

	// What the catalogue says, per plan held. Read from `h.plans`, so any
	// divergence from `folded` is visible on this response.
	planGrants := map[string]any{}
	for _, e := range ents {
		if plan, ok := h.plans.Get(e.PlanCode); ok {
			grants := map[string]any{}
			for capability, v := range plan.Grants {
				if v == config.Unlimited {
					grants[capability] = "unlimited"
				} else {
					grants[capability] = v
				}
			}
			planGrants[e.PlanCode] = grants
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id": userID,
		"email":   email,
		// Non-nil, so a client doing `.length` does not throw on null.
		"entitlements": ents,
		"count":        len(ents),
		"effective":    folded,
		"plan_grants":  planGrants,
		"limit_trace":  trace,
	})
}

// resolveLimitTrace reports what the fold SAW for one capability.
//
// Returns the live entitlements' plan codes and, for each, the raw grant value
// this capability has in that plan. Compared against the number `Limit` returned,
// it localises a wrong answer to either "the wrong plan was resolved" or "the right
// plan was resolved and the value was read wrongly" — the two hypotheses that
// reading `Limit` could not separate.
func (h *SuperadminHandler) resolveLimitTrace(
	c *gin.Context,
	userID uuid.UUID,
	capability string,
	limit int64,
) map[string]any {
	out := map[string]any{
		"returned":        limit,
		"is_unlimited":    limit == config.Unlimited,
		"unlimited_value": config.Unlimited,
	}

	rows, err := h.entitlements.List(c.Request.Context(), userID)
	if err != nil {
		out["error"] = err.Error()
		return out
	}

	perPlan := map[string]any{}
	for _, e := range rows {
		if plan, ok := h.plans.Get(e.PlanCode); ok {
			raw, has := plan.Grants[capability]
			perPlan[e.PlanCode] = map[string]any{
				"has_capability": has,
				"raw_grant":      raw,
			}
		} else {
			perPlan[e.PlanCode] = "NOT IN CATALOGUE"
		}
	}
	out["plans_seen"] = perPlan
	out["plan_codes"] = h.plans.Codes()
	return out
}

// ListPlanCatalogue returns every plan with its capabilities and price.
//
// No target user, so it is safe to render on a pricing page. The prices come from
// `PLANS_*` in `.env` — which is what Phase 15 of the plan formalises.
func (h *SuperadminHandler) ListPlanCatalogue(c *gin.Context) {
	type planView struct {
		Code       string           `json:"code"`
		Name       string           `json:"name"`
		PriceMinor int64            `json:"price_minor"`
		Currency   string           `json:"currency"`
		Cycle      string           `json:"cycle"`
		TrialDays  int              `json:"trial_days"`
		Grants     map[string]any   `json:"grants"`
	}

	out := make([]planView, 0, 8)
	for _, p := range h.plans.Plans {
		grants := map[string]any{}
		for cap, limit := range p.Grants {
			if limit == config.Unlimited {
				grants[cap] = "unlimited"
			} else {
				grants[cap] = limit
			}
		}
		out = append(out, planView{
			Code:       p.Code,
			Name:       config.PlanDisplayName(p.Code),
			PriceMinor: p.PriceMinor,
			Currency:   p.Currency,
			Cycle:      p.Cycle,
			TrialDays:  p.TrialDays,
			Grants:     grants,
		})
	}

	c.JSON(http.StatusOK, gin.H{"plans": out, "count": len(out)})
}

// knownCapabilities is every capability name the catalogue can grant.
//
// Enumerated here so the effective-limits view is COMPLETE. A list built from the
// grants of one plan would silently omit a capability that only a more generous
// plan grants — which is exactly the capability an operator would be checking.
var knownCapabilities = []string{
	config.CapSaveProjects,
	config.CapMediaAssets,
	config.CapReelAssets,
	config.CapConcurrentTranscodes,
	config.CapExportHeight,
	config.CapAdsCampaigns,
	config.CapSeats,
	config.CapLifetimeDevices,
	config.CapMaxChannels,
	config.CapMinBalance,
	config.CapMonetization,
}

var _ = strconv.Itoa

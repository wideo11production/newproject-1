package service

// Trial policy: how long a trial is, and whether one may be had again.
//
// =============================================================================
// WHY THE LENGTH IS IN `.env` AND NOT IN CODE
// =============================================================================
//
// `plans.go` already reads `PLANS_TRIAL_TRIAL_DAYS` from the environment. This
// only makes it reachable: an operator changing the trial length must not need a
// rebuild and a redeploy, and must not find the value in two places.
//
// The fallback is `plans.go`'s value, not a literal here. A second literal would be
// a second number that could disagree with the first — the same duplication that
// let the lifetime plan codes drift (`lifetime_1` versus `lifetime1`), and the same
// one that made `JWT_SECRET_KEY` a published default in three places at once.
//
// =============================================================================
// HOW MANY TRIALS IS ONE PERMITTED TO HAVE
// =============================================================================
//
// The answer here is: **registration grants exactly one, and there is no path that
// grants a second.** That is not a policy decision left open — it is what the
// existing code already does, and it is the right default:
//
//   - `Register` fails with `ErrUserExists` for a duplicate email, so the grant
//     never runs twice for one address.
//   - The grant is not keyed on anything the client can vary, so there is nothing
//     to replay.
//
// THE HONEST LIMIT OF THAT ANSWER
//
// One-per-EMAIL is not one-per-PERSON. Someone with three addresses gets three
// trials, and no amount of code in this file prevents that.
//
// The industry-standard mitigations, in the order they are worth doing:
//
//  1. DEVICE-BOUND TRIALS. `device_ad_revenue` already caps revenue per device
//     fingerprint with a multi-account policy (`MaxAccountsPerDevice: 3`).
//     Applying the same idea to trials is free — the fingerprint is already sent on
//     every registration — and it converts "one per email" into "one per email per
//     device". NOT DONE HERE: it needs a decision about whether the cap should be
//     hard (a legitimate shared-office trial is refused) or a review flag. That is
//     a product call.
//  2. PAYMENT-METHOD FINGERPRINTING. Effective against card testing; needs a
//     payment provider, which the product deliberately has none of.
//  3. RATE LIMITING BY IP. `LimitRegister` already exists on this route. Cheap, and
//     it stops bulk signup — but it does nothing about a careful person, which is
//     the actual abuse case.
//
// WHAT IS DELIBERATELY NOT BUILT
//
// An explicit "request another trial" endpoint. Every implementation of that idea
// is a bypass with extra steps: if the rule lives only in the code path, then
// whoever reaches that path differently gets another trial. Keeping the grant as a
// side effect of ONE code path — registration — means the policy is the shape of
// the code rather than a check somebody can forget.
//
// If a re-request feature is ever wanted, it should be an ADMIN grant through
// `POST /admin/entitlements`, which is already built, already audited, and already
// attributed to a person.

import (
	"time"

	"github.com/wideo11/auth-service/internal/config"
)

// PlanTrial is the catalogue code for the free trial.
//
// A constant HERE rather than inline `"trial"` in three places, because a literal
// repeated is a literal that can drift — and the lifetime codes drifted exactly
// that way (`lifetime_1` in a switch versus `lifetime1` in the catalogue), which
// made every lifetime subscriber see a raw plan code on their billing summary.
//
// It is validated against the catalogue by `TestTrialPlanCodeIsInTheCatalogue`,
// so renaming the plan fails a test instead of silently disabling every new
// account's trial.
const PlanTrial = "trial"

// trialDaysFallback is used when the catalogue is missing or gives no length.
//
// It matches the shipped default in `plans.go`. A second literal would be a second
// number that could disagree with the first, and the fallback exists only for a
// service constructed without a catalogue — which `main.go` treats as fatal at boot.
const trialDaysFallback = 3

// TrialDays is how long a trial runs, from the catalogue.
//
// Read from `plans.go` rather than a literal here, so there is one number. See the
// file header.
func (s *EntitlementService) TrialDays() int {
	if s == nil || s.plans.Plans == nil {
		return trialDaysFallback
	}
	if p, ok := s.plans.Get(PlanTrial); ok && p.TrialDays > 0 {
		return p.TrialDays
	}
	return trialDaysFallback
}

// Plan returns a catalogue entry by code.
//
// Exists so other packages can read the catalogue without reaching into
// `EntitlementService.plans`, which is unexported. The registration handler needs
// it to render a granted plan's capabilities in its response.
//
// Case-insensitive, matching `PlansConfig.Get`, because the code may come from
// storage rather than from a constant.
func (s *EntitlementService) Plan(code string) (config.PlanConfig, bool) {
	if s == nil {
		return config.PlanConfig{}, false
	}
	return s.plans.Get(code)
}

// TrialEndFromNow is when a trial granted now would end.
//
// Never returns nil for a configured length: `nil` means `ends_at NULL` to
// `Grant`, which `liveEntitlements` reads as FOREVER. A zero or negative configured
// length falls back to 3 rather than producing an immortal trial — the difference
// between "misconfigured" and "granted forever" is a whole product.
func (s *EntitlementService) TrialEndFromNow() *time.Time {
	days := s.TrialDays()
	if days <= 0 {
		days = trialDaysFallback
	}
	t := time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour)
	return &t
}


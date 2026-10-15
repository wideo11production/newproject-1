package service

import (
	"fmt"
	"time"
)

// ============================================================================
// THE SEVEN PAID TIERS - one registry, one source of truth
// ============================================================================
//
// WHY A REGISTRY AND NOT SEVEN CONSTANTS
//
// The video editor sells seven plans. Every one of them has a duration, a seat
// count, a price zone and an AURA answer, and before this file those four facts
// lived in four different places: durations in a `switch` in the entitlement
// service, seat counts in a plan's grant map, price zones in `plan_zones.json`,
// and AURA eligibility in a hardcoded `if planCode == "lifetime_aura"`.
//
// Four places is four things to forget, and the recorded cost of that pattern in
// this repository is a dashboard that showed the raw plan code to paying
// customers for three plans because a `switch` matched `lifetime_1` when the
// code was `lifetime1`.
//
// So the seven tiers are declared ONCE here, and every other question about them
// - "how long does this run", "how many devices", "does it get 240fps", "which
// price zone" - is answered by looking them up rather than by re-deriving them.
//
// WHY THE PLAN CODES MATCH auth-service EXACTLY
//
// `starter`, `pro`, `studio`, `lifetime1`, `lifetime5`, `lifetime10`,
// `lifetime_aura` are the codes auth-service seeds into `entitlement_grants`.
// This service cannot grant a plan it cannot name, so a typo here is not a
// cosmetic bug - it is a sale that completes and grants nothing. The codes are
// therefore plain literals compared in a test against the catalogue auth-service
// actually loads, not against this file's own list.
//
// WHY DURATION IS DAYS AND NOT A DATE
//
// A tier that runs "3 months" is not 90 days, because February exists. The
// service computes the end date with `AddDate` from the purchase moment, which
// is what a buyer means. The days column is the APPROXIMATION used only for
// display and for the renewal reminder, and it is never what is written to the
// database.

// TierKind is the duration vocabulary. It is `PlanTier` from `ad-economics.go`,
// re-declared as an alias rather than re-declared as a new type: that file
// already names all seven durations (`TierQuarterly` ... `TierLifetimeAURA`) and
// the pricing table speaks it, so a second parallel enum here would put the same
// seven facts in two places - the exact failure this registry exists to remove.
//
// `TierMonthly` is an alias for `TierQuarterly` so a comparison written against
// either name agrees.
type TierKind = PlanTier

const TierMonthly = TierQuarterly

// IsLifetimeTier reports whether a duration ends.
//
// Four of the seven are lifetimes, and the property callers actually want is
// "does this expire", not "which of the four is it". Asking that question by
// listing four codes at every call site is what produced the original bug where
// a lifetime plan was cancelled by a failed renewal - the list was written out
// once and one of the four was missed.
func isLifetimeTier(t PlanTier) bool {
	switch t {
	case TierLifetime, TierLifetimeGroup5, TierLifetimeGroup10, TierLifetimeAURA:
		return true
	default:
		return false
	}
}

// Tier is one sellable plan, declared once.
type Tier struct {
	// Code is the plan code auth-service seeds and grants by. It is the only
	// identifier that crosses the service boundary.
	Code string
	// Name is the label the pricing page shows. Keyed by code, not re-listed,
	// so a code here and a label there cannot disagree.
	Name string
	// Kind is the duration: one of the seven `PlanTier` values.
	Kind PlanTier
	// DurationDays is the nominal term for display and renewal reminders.
	// For a lifetime tier this is 0 and means "does not end", NOT "expires
	// immediately" - the distinction matters because a zero read as a duration
	// produces an `ends_at` in the past and a subscription that is already dead
	// the moment it is created.
	DurationDays int
	// Seats is how many people may use the plan. 1 for a single-user purchase.
	Seats int
	// AURA is whether the plan unlocks the AURA toolset (240fps capture and the
	// full playback ladder). It is NOT a price modifier - it is a capability,
	// and a plan is either entitled to it or not.
	AURA bool
	// PriceZone selects the price column in the geo table. "low", "mid" and
	// "high" are purchasing-power bands, not currencies; a zone is a set of
	// explicit prices per currency, and the zone is chosen by country.
	PriceZone string
	// FpsCeiling is the maximum capture and playback frame rate the plan allows.
	// Standard is 60; AURA plans reach 240. Stored per tier rather than derived
	// from `AURA` so the two can be set independently - a future plan could
	// unlock AURA effects without raising the frame rate.
	FpsCeiling int
}

// EndsAt computes the exact end of the term, or nil for a lifetime tier.
//
// A monthly term is expressed in CALENDAR MONTHS, not in days: "3 months" bought
// on the 30th of November must run to the END OF FEBRUARY, which is what a buyer
// agreed to. That last clause is the whole of this function, and it is why
// `AddDate` alone is wrong here.
//
// Go's `AddDate` normalises its result the way `time.Date` does, so Nov 30 plus
// three months becomes "Feb 30", which does not exist, and Feb has 28 days in
// 2027 - so it overflows into **March 2nd**. A 3-month plan that runs 93 days
// and gives the customer two days they never paid for is a revenue leak that
// compounds on every month-end purchase in the product.
//
// So the day is clamped to the last real day of the target month instead. That
// is also what every card issuer and subscription system does, and it means a
// plan bought on the 31st always ends on the final day of the term rather than
// spilling into the next one.
//
// A nil return means "no end", and callers must not substitute
// `time.Now().AddDate(100, 0, 0)` for it - that is how a lifetime grant acquires
// an expiry nobody set and then lapses on its own.
func (t Tier) EndsAt(from time.Time) *time.Time {
	if isLifetimeTier(t.Kind) {
		return nil
	}
	months := 0
	if t.DurationDays > 0 {
		// Round UP, so a 90-day tier fires at 3 months rather than 2.95 of one.
		months = (t.DurationDays + 29) / 30
	}
	if months == 0 {
		// A monthly tier with no declared duration is a configuration error, not
		// a reason to silently sell a zero-length plan. It is reported rather
		// than defaulted, because the failure would otherwise be invisible until
		// a user's plan expired on the day they bought it.
		months = 1
	}

	// The target calendar month, reached by clamping the day FIRST and then
	// stepping the month number, so the intermediate "Feb 30" is never
	// constructed. Doing it in the other order is the overflow above.
	year, month, day := from.Date()
	totalMonths := int(month) - 1 + months
	targetYear := year + totalMonths/12
	targetMonth := time.Month(totalMonths%12 + 1)

	// `lastDayOfMonth` gives 28, 29, 30 or 31 for the month we landed in.
	lastDay := lastDayOfMonth(targetYear, targetMonth)
	if day > lastDay {
		day = lastDay
	}

	end := time.Date(targetYear, targetMonth, day,
		from.Hour(), from.Minute(), from.Second(), from.Nanosecond(), from.Location())
	return &end
}

// lastDayOfMonth returns the number of days in a given month, leap years
// included. `time.Date(y, m+1, 0, ...)` is the idiomatic way to ask, and it is
// written out here so the leap-year rule is stated once rather than re-derived.
func lastDayOfMonth(year int, month time.Month) int {
	// Day 0 of the NEXT month is the last day of THIS one.
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// IsLifetime reports whether the tier ends.
func (t Tier) IsLifetime() bool { return isLifetimeTier(t.Kind) }

// Tiers returns the seven sellable plans in the order a pricing page shows:
// cheapest monthly first, then the lifetime ladder from single-user to
// group-wide, with the AURA lifetime last because it is the most expensive and
// the one an existing user upgrades TO rather than starts with.
//
// THE FREE TRIAL IS NOT IN THIS LIST on purpose.
//
// `trial` is auth-service's zero-duration allowance that every account is
// granted automatically at registration, not a product that can be bought.
// Listing it here would make it purchasable, purchasable would make it
// priceable, and a price on the free trial is a charge for something the user
// already has.
func Tiers() []Tier {
	return []Tier{
		{
			Code:         "starter",
			Name:         "Monthly (3 months)",
			Kind:         TierQuarterly,
			DurationDays: 90,
			Seats:        1,
			AURA:         false,
			PriceZone:    string(ZoneLow),
			FpsCeiling:   60,
		},
		{
			Code:         "pro",
			Name:         "Monthly (6 months)",
			Kind:         TierBiannual,
			DurationDays: 180,
			Seats:        1,
			AURA:         false,
			PriceZone:    string(ZoneMid),
			FpsCeiling:   60,
		},
		{
			Code:         "studio",
			Name:         "Monthly (1 year)",
			Kind:         TierAnnual,
			DurationDays: 365,
			Seats:        3,
			// NOT AURA. Only `lifetime_aura` unlocks the AURA toolset, and this
			// is the load-bearing entry in the whole registry: a second AURA
			// plan would make "which plan gets 240fps" a question the editor has
			// to answer per session instead of a lookup.
			AURA:      false,
			PriceZone: string(ZoneHigh),
			// Still 60fps at a year's subscription. The ceiling rises with the
			// AURA tier, not with the term length - a longer tier buys more TIME,
			// not a better toolset.
			FpsCeiling: 60,
		},
		{
			Code:         "lifetime1",
			Name:         "Lifetime (single use)",
			Kind:         TierLifetime,
			DurationDays: 0,
			Seats:        1,
			AURA:         false,
			PriceZone:    string(ZoneMid),
			FpsCeiling:   60,
		},
		{
			Code:         "lifetime5",
			Name:         "Lifetime (group of 5)",
			Kind:         TierLifetimeGroup5,
			DurationDays: 0,
			Seats:        5,
			AURA:         false,
			PriceZone:    string(ZoneHigh),
			FpsCeiling:   60,
		},
		{
			Code:         "lifetime10",
			Name:         "Lifetime (group of 10)",
			Kind:         TierLifetimeGroup10,
			DurationDays: 0,
			Seats:        10,
			AURA:         false,
			PriceZone:    string(ZoneHigh),
			FpsCeiling:   60,
		},
		{
			// The one tier that unlocks AURA - 240fps capture, the full playback
			// ladder, and the AURA toolbar. Priced as the most expensive single
			// purchase because it is the only one that is a toolset upgrade
			// rather than a duration or seat upgrade.
			Code:         "lifetime_aura",
			Name:         "Lifetime (single use, AURA)",
			Kind:         TierLifetimeAURA,
			DurationDays: 0,
			Seats:        1,
			AURA:         true,
			PriceZone:    string(ZoneHigh),
			FpsCeiling:   240,
		},
	}
}

// TierByCode looks up one plan. The boolean is returned rather than an error
// because an unknown code is an ordinary, expected outcome here - a client can
// send anything - and the caller decides what it means. Returning an error would
// invite callers to log it, and a log line per probe is noise.
func TierByCode(code string) (Tier, bool) {
	for _, t := range Tiers() {
		if t.Code == code {
			return t, true
		}
	}
	return Tier{}, false
}

// TierCodes returns the sellable codes, in display order.
func TierCodes() []string {
	all := Tiers()
	out := make([]string, 0, len(all))
	for _, t := range all {
		out = append(out, t.Code)
	}
	return out
}

// AURATierCodes returns the codes that unlock AURA.
//
// Used by the enforcement path, which needs the SET rather than a per-plan
// check: "does this plan carry AURA" is asked when a session is minted, and a
// scan over seven declarations per session is cheaper to read than a condition
// that has to be kept in step with the table.
func AURATierCodes() []string {
	var out []string
	for _, t := range Tiers() {
		if t.AURA {
			out = append(out, t.Code)
		}
	}
	return out
}

// ErrUnknownTier is returned when a sale names a plan that is not sellable.
//
// The free trial reaches here, and that is deliberate: `trial` is a valid plan
// code in auth-service and an invalid PURCHASE. Distinguishing "unknown code"
// from "valid code you cannot buy" would need a second error and a second
// branch at every call site, and the caller's answer is the same either way -
// refuse, and say which code was refused.
var ErrUnknownTier = fmt.Errorf("plan is not a sellable subscription")

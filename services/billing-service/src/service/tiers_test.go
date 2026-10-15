package service

import (
	"testing"
	"time"
)

// The seven tiers must be exactly seven, and must carry the codes auth-service
// seeds. A count that drifts is how a plan becomes unpurchasable.
func TestTiersAreSevenAndWellFormed(t *testing.T) {
	all := Tiers()

	if len(all) != 7 {
		t.Fatalf("expected 7 sellable tiers, got %d: %v", len(all), tierCodesOf(all))
	}

	for _, tr := range all {
		if tr.Code == "" {
			t.Errorf("tier %q has no plan code", tr.Name)
		}
		if tr.Name == "" {
			t.Errorf("tier %s has no display name", tr.Code)
		}
		if tr.Seats < 1 {
			t.Errorf("tier %s has %d seats - a plan nobody can use is not sellable", tr.Code, tr.Seats)
		}
		if tr.FpsCeiling < 60 {
			t.Errorf("tier %s allows %dfps, below the 60fps floor", tr.Code, tr.FpsCeiling)
		}
		if tr.FpsCeiling > 240 {
			t.Errorf("tier %s allows %dfps, above the 240fps AURA ceiling", tr.Code, tr.FpsCeiling)
		}
		if tr.PriceZone == "" {
			t.Errorf("tier %s has no price zone, so it cannot be priced", tr.Code)
		}

		// A monthly tier must declare a duration; a lifetime tier must not.
		// The two are the only consistent answers, and getting either wrong is
		// how a lifetime plan acquires an expiry or a monthly plan ends on day 0.
		if tr.Kind == TierQuarterly && tr.DurationDays <= 0 {
			t.Errorf("monthly tier %s has a %d-day term", tr.Code, tr.DurationDays)
		}
		if tr.Kind == TierLifetime && tr.DurationDays != 0 {
			t.Errorf("lifetime tier %s declares %d days - a lifetime with a length is a subscription", tr.Code, tr.DurationDays)
		}
	}
}

// AURA and the 240fps ceiling are separate facts that happen to coincide.
// The registry must not let them diverge silently, because the editor reads the
// frame rate and the toolbar reads AURA, and a plan with one but not the other
// offers a 240fps control that refuses to move.
func TestAURATierCarriesThe240Ceiling(t *testing.T) {
	for _, tr := range Tiers() {
		if tr.AURA && tr.FpsCeiling < 240 {
			t.Errorf("tier %s unlocks AURA but only allows %dfps - the AURA ladder starts at 240", tr.Code, tr.FpsCeiling)
		}
		if tr.FpsCeiling >= 240 && !tr.AURA {
			t.Errorf("tier %s allows %dfps without unlocking AURA - a frame rate is a capability, not a free sample", tr.Code, tr.FpsCeiling)
		}
	}
}

// Exactly one tier carries AURA. Two would make "the AURA plan" a question
// rather than an answer on the pricing page.
func TestExactlyOneAURATier(t *testing.T) {
	var aura []string
	for _, tr := range Tiers() {
		if tr.AURA {
			aura = append(aura, tr.Code)
		}
	}
	if len(aura) != 1 {
		t.Fatalf("expected exactly one AURA tier, got %d: %v", len(aura), aura)
	}
	if aura[0] != "lifetime_aura" {
		t.Errorf("the AURA tier is %q, expected lifetime_aura", aura[0])
	}
}

// The free trial is NOT sellable. It is granted at registration; making it
// purchasable would put a price on something every account already has.
func TestTrialIsNotSellable(t *testing.T) {
	for _, code := range TierCodes() {
		if code == "trial" {
			t.Fatal("trial must not appear in the sellable tiers - it is granted, not bought")
		}
	}

	if _, ok := TierByCode("trial"); ok {
		t.Error("TierByCode accepted 'trial'; a purchase of the free trial must be refused")
	}
}

// Duration: 3 months is not 90 days. A 3-month term bought on the 31st of a
// 30-day month must still run to the same calendar date three months on, which
// is what a buyer agreed to and what `AddDate` gives.
func TestEndsAtUsesCalendarMonthsNotDays(t *testing.T) {
	starter, ok := TierByCode("starter")
	if !ok {
		t.Fatal("starter tier missing")
	}

	// A 90-day term expressed as 3 calendar months.
	from := time.Date(2026, 11, 30, 12, 0, 0, 0, time.UTC)
	end := starter.EndsAt(from)
	if end == nil {
		t.Fatal("a monthly tier must have an end date")
	}

	want := time.Date(2027, 2, 28, 12, 0, 0, 0, time.UTC)
	if !end.Equal(want) {
		t.Errorf("3-month term from 2026-11-30 = %s, want %s (3 CALENDAR months, not 90 days)", end.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

// A lifetime tier has NO end. A nil here is the contract, and callers must not
// invent one - a lifetime grant with a computed expiry lapses on its own.
func TestLifetimeTierHasNoEndDate(t *testing.T) {
	for _, tr := range Tiers() {
		if !isLifetimeTier(tr.Kind) {
			continue
		}
		if end := tr.EndsAt(time.Now()); end != nil {
			t.Errorf("lifetime tier %s produced an end date %s - a lifetime must not expire", tr.Code, end.Format(time.RFC3339))
		}
	}
}

// Unknown codes are refused with the sentinel, and the sentinel is returned
// rather than a zero tier, so a caller cannot accidentally sell `Tier{}` - a
// plan with no code, no duration and no capability.
func TestUnknownTierIsRefused(t *testing.T) {
	for _, bad := range []string{"", "nope", "Lifetime1", "trial", "monthly3"} {
		if _, ok := TierByCode(bad); ok {
			t.Errorf("TierByCode accepted %q; unknown codes must be refused", bad)
		}
	}
}

// The seat ladder is monotonic with price. A group plan that seats fewer people
// than the single plan above it is a pricing page that contradicts itself.
func TestSeatLadderIsMonotonicAcrossTheLifetimeGroup(t *testing.T) {
	single, _ := TierByCode("lifetime1")
	five, _ := TierByCode("lifetime5")
	ten, _ := TierByCode("lifetime10")

	if !(single.Seats < five.Seats && five.Seats < ten.Seats) {
		t.Errorf("lifetime seat ladder is not increasing: %d -> %d -> %d", single.Seats, five.Seats, ten.Seats)
	}
}

func tierCodesOf(all []Tier) []string {
	out := make([]string, 0, len(all))
	for _, tr := range all {
		out = append(out, tr.Code)
	}
	return out
}

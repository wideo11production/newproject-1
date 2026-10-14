package config

// The frame-rate ceiling is a PLAN capability, and it has exactly one value
// above 60.
//
// =============================================================================
// THE RULE (user directive)
// =============================================================================
//
//   - The LIFETIME AURA plan edits at up to 240fps. 120fps and 240fps are its
//     features, along with the micro-step playback speeds that only make sense
//     at those rates.
//   - EVERY other plan — trial, all three monthly tiers, and the non-AURA
//     lifetime tiers (1 / 5 / 10) — is capped at 60fps and offers the ordinary
//     playback speeds.
//   - The editor's own default is 30fps and 1x, which is a separate decision
//     this file does not make: a ceiling is not a default.
//
// =============================================================================
// WHY THIS IS A CATALOGUE TEST AND NOT AN EDITOR TEST
// =============================================================================
//
// The editor reads the number and builds its list from it, so the editor cannot
// be the thing that decides what the number should be. The decision belongs
// here, where the catalogue is defined, and the failure mode it guards against
// is concrete: somebody adds a plan, copies the neighbouring block, forgets
// `CapMaxFps`, and the editor then reads 0 — which would offer NO frame rates
// at all, because a missing key is the zero value. The editor treats an
// unreadable ceiling as 60 for exactly that reason, but the plan should still
// SAY 60.
//
// The other direction matters just as much: a plan granted 240 by mistake hands
// out the AURA toolchain to a $12 tier, which no refund can take back.

import "testing"

// Every plan in the catalogue must state a frame-rate ceiling. A missing key is
// the zero value, and a ceiling of zero offers no editing at all.
func TestEveryPlanStatesAFrameRateCeiling(t *testing.T) {
	plans := LoadPlans()

	if len(plans.Plans) == 0 {
		t.Fatal("the catalogue is empty; LoadPlans did not populate it")
	}

	for _, p := range plans.Plans {
		v, ok := p.Grants[CapMaxFps]
		if !ok {
			t.Errorf("plan %q grants no %s.\n"+
				"  A missing capability reads as the zero value, and a ceiling of\n"+
				"  0 offers no frame rate at all. State the number explicitly.",
				p.Code, CapMaxFps)
			continue
		}
		if v != 60 && v != 240 {
			t.Errorf("plan %q grants %s = %d, which is neither 60 nor 240.\n"+
				"  The editor's rate list is 24/25/30/50/60/120/240, so a ceiling\n"+
				"  between those values silently hides rates a user may expect.",
				p.Code, CapMaxFps, v)
		}
	}
}

// TestOnlyLifetimeAuraExceedsSixtyFps is the rule itself.
//
// Exactly one plan may hold 240, and it is `lifetime_aura`. A second 240 is a
// second plan selling AURA's toolchain, which is not a thing this catalogue
// does; a 240 on a monthly tier would be a permanent grant of a paid feature
// for as long as the subscription runs.
func TestOnlyLifetimeAuraExceedsSixtyFps(t *testing.T) {
	plans := LoadPlans()

	var high []string
	for _, p := range plans.Plans {
		if p.Grants[CapMaxFps] > 60 {
			high = append(high, p.Code)
		}
	}

	if len(high) != 1 {
		t.Fatalf("plans above 60fps = %v, want exactly [lifetime_aura].\n"+
			"  Zero means the AURA ceiling was lost; more than one means high\n"+
			"  frame rates are being sold on a plan that is not AURA.", high)
	}
	if high[0] != "lifetime_aura" {
		t.Errorf("the plan above 60fps is %q, want \"lifetime_aura\"", high[0])
	}
}

// TestLifetimeAuraCeilingCoversEveryOfferedRate proves the AURA number is not
// merely "high" but actually covers the editor's whole list.
//
// 120 and 240 are the two rates that only AURA offers. If the ceiling were
// anything below 240, the 240 option would disappear while 120 stayed — and a
// user paying for AURA would lose the top rate with nothing in the plan table
// saying so.
func TestLifetimeAuraCeilingCoversEveryOfferedRate(t *testing.T) {
	plans := LoadPlans()

	aura, ok := plans.Get("lifetime_aura")
	if !ok {
		t.Fatal("no `lifetime_aura` plan in the catalogue")
	}

	for _, rate := range []int64{120, 240} {
		if aura.Grants[CapMaxFps] < rate {
			t.Errorf("lifetime_aura grants %s = %d, which does not cover %dfps",
				CapMaxFps, aura.Grants[CapMaxFps], rate)
		}
	}
}

// TestNonAuraLifetimeTiersAreCapped pins the easy one to get wrong.
//
// `lifetime1/5/10` are lifetime purchases and read as "the expensive tier", so
// copying AURA's number onto them is the natural mistake. They are capped at
// 60, and the difference between them and AURA is the frame rate and the
// micro-step playback — nothing else in this file.
func TestNonAuraLifetimeTiersAreCapped(t *testing.T) {
	plans := LoadPlans()

	for _, code := range []string{"lifetime1", "lifetime5", "lifetime10"} {
		p, ok := plans.Get(code)
		if !ok {
			t.Fatalf("no %q plan in the catalogue", code)
		}
		if p.Grants[CapMaxFps] != 60 {
			t.Errorf("%s grants %s = %d, want 60. High frame rates are an AURA\n"+
				"  feature, not a lifetime-plan feature.", code, CapMaxFps, p.Grants[CapMaxFps])
		}
	}
}

// TestTrialAndMonthlyAreCapped is the same rule for the subscription side.
func TestTrialAndMonthlyAreCapped(t *testing.T) {
	plans := LoadPlans()

	for _, code := range []string{"trial", "starter", "pro", "studio"} {
		p, ok := plans.Get(code)
		if !ok {
			t.Fatalf("no %q plan in the catalogue", code)
		}
		if p.Grants[CapMaxFps] != 60 {
			t.Errorf("%s grants %s = %d, want 60.", code, CapMaxFps, p.Grants[CapMaxFps])
		}
	}
}

// TestLifetimeAuraIsSingleSeat guards the shape of the AURA plan.
//
// AURA is single-user. A group tier would put five people behind one
// high-frame-rate ceiling, which is not a limitation anybody can be sold, and
// the device cap is what makes a one-off purchase finite in the first place.
func TestLifetimeAuraIsSingleSeat(t *testing.T) {
	plans := LoadPlans()

	aura, ok := plans.Get("lifetime_aura")
	if !ok {
		t.Fatal("no `lifetime_aura` plan in the catalogue")
	}
	if aura.Cycle != "lifetime" {
		t.Errorf("lifetime_aura cycle = %q, want \"lifetime\"", aura.Cycle)
	}
	if aura.Grants[CapLifetimeDevices] != 1 {
		t.Errorf("lifetime_aura grants %s = %d, want 1",
			CapLifetimeDevices, aura.Grants[CapLifetimeDevices])
	}
	if aura.Grants[CapSeats] != 1 {
		t.Errorf("lifetime_aura grants %s = %d, want 1", CapSeats, aura.Grants[CapSeats])
	}
}

// TestLifetimeAuraIsNotSelfServiceable proves the purchase path stays closed.
//
// `SelectablePlans` filters on cycle and only offers monthly and trial, so a
// lifetime plan is unselectable by construction rather than by a name list that
// has to be updated. This asserts the property holds for the new plan, because
// a self-service route that grants a permanent AURA licence for a session token
// hands out something no non-payment can take back.
func TestLifetimeAuraIsNotSelfServiceable(t *testing.T) {
	plans := LoadPlans()

	aura, _ := plans.Get("lifetime_aura")
	cycle := ""
	for _, p := range plans.Plans {
		if p.Code == "lifetime_aura" {
			cycle = p.Cycle
			break
		}
	}
	if aura.Code != "lifetime_aura" || cycle == "" {
		t.Fatal("lifetime_aura missing from the catalogue")
	}
	if cycle == "monthly" || cycle == "trial" {
		t.Errorf("lifetime_aura cycle = %q, which SelectablePlans would offer for\n"+
			"  self-service subscription. A permanent grant must not be.", cycle)
	}
}

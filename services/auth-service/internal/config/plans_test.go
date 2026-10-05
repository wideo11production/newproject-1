package config

// The plan catalogue, its codes, and its display labels must agree.
//
// -----------------------------------------------------------------------------
// WHY THIS TEST IS ABOUT A MAP AND NOT A SWITCH
// -----------------------------------------------------------------------------
//
// `getPlanDisplayName` in `internal/service/creator.go` used to be a `switch`
// over plan codes, and it listed three that do not exist:
//
//	switch {
//	case "lifetime_1":  return "Lifetime 1 ($199 once)"
//	case "lifetime_5":  return "Lifetime 5 ($599 once)"
//	case "lifetime_10": return "Lifetime 10 ($999 once)"
//	}
//
// The real codes, defined in `LoadPlans`, are `lifetime1`, `lifetime5`,
// `lifetime10`. All three missed the switch and fell through to `default: return
// code`, so **every lifetime subscriber saw the literal string `lifetime1` on
// their billing summary.** Not a rare panel: it is the plan name a paying customer
// looks at to check what they bought.
//
// A `switch` over codes is a SECOND list of codes. Two lists drift, and nothing
// makes them agree except a test — so that is what this is.
//
// It also caught the price. The old strings embedded `$199`, `$599`, `$999`,
// duplicating `PriceMinor` a second time. Change `PLANS_LIFETIME1_PRICE_MINOR` and
// the label keeps claiming $199. That is the same duplication that allowed the
// codes to drift, so `DisplayName` deliberately formats no price at all — Phase 15
// moves pricing to `.env` across three currency regions, and a string built from
// the config survives that while a hardcoded one cannot.
//
// -----------------------------------------------------------------------------
// WHY THE CODES ARE HARD-CODED HERE TOO
// -----------------------------------------------------------------------------
//
// It looks like the duplication this test is about. It is not: this list is
// written against the SPEC (`lifetime1`, no underscore) and the test asserts it
// matches `LoadPlans` — the specification and the implementation, from two
// directions.
//
// `switch` was the implementation listing a third thing that nothing checked.

import "testing"

// specPlan is one expected catalogue entry: the code as written in the spec.
type specPlan struct {
	code string
	// what a user should see, absent the price
	label string
	cycle string
}

// expectedCatalogue is the SPECIFICATION.
//
// If the product decides to add or rename a plan, this list changes FIRST and the
// test then tells you which code strings elsewhere in the tree need updating. That
// is the opposite failure direction from the switch, where the code was changed here
// and nobody noticed the display had not.
var expectedCatalogue = []specPlan{
	{"trial", "Free Trial (3 days)", "trial"},
	{"starter", "Starter", "monthly"},
	{"pro", "Pro", "monthly"},
	{"studio", "Studio", "monthly"},
	{"lifetime1", "Lifetime 1", "lifetime"},
	{"lifetime5", "Lifetime 5", "lifetime"},
	{"lifetime10", "Lifetime 10", "lifetime"},
}

// TestEveryPlanHasACodeAndALabel asserts the catalogue matches the spec.
func TestEveryPlanHasACodeAndALabel(t *testing.T) {
	plans := LoadPlans()

	for _, want := range expectedCatalogue {
		t.Run(want.code, func(t *testing.T) {
			plan, ok := plans.Get(want.code)
			if !ok {
				t.Fatalf("LoadPlans does not contain code %q.\n"+
					"  The spec lists it, so either the plan was removed or its code was\n"+
					"  changed without updating the catalogue.", want.code)
			}

			if plan.Cycle != want.cycle {
				t.Errorf("plan %q cycle = %q, want %q", want.code, plan.Cycle, want.cycle)
			}

			// ---- The assertion that would have caught the real bug ----
			//
			// The label must RESOLVE. Before, a typo'd code silently returned
			// itself, so the only visible symptom was a raw string in the UI — and
			// nothing failed.
			got := PlanDisplayName(want.code)
			if got != want.label {
				t.Errorf("PlanDisplayName(%q) = %q, want %q.\n"+
					"  A code with no label falls through to returning the code itself,\n"+
					"  which is what made this bug invisible: no error, just `lifetime1`\n"+
					"  rendered where `Lifetime 1` belonged.", want.code, got, want.label)
			}
		})
	}
}

// TestNoLabelForAKnownPlanIsMissing is the converse.
//
// The table above could pass while `DefaultPlanNames` had entries for codes that
// no longer exist — an orphaned label reads as correct and shows a plan the
// product does not sell.
func TestNoLabelForAKnownPlanIsMissing(t *testing.T) {
	plans := LoadPlans()

	for code := range DefaultPlanNames {
		if _, ok := plans.Get(code); !ok {
			t.Errorf("DefaultPlanNames has a label for %q, which is not a plan code.\n"+
				"  An orphaned label shows a plan the product does not sell.", code)
		}
	}
}

// TestUnknownCodeIsReturnedVerbatim proves the fallback is honest.
//
// `PlanDisplayName("lifetime_1")` — the WRONG code from the old switch — must
// return the string unchanged, not a lifetime label. A fallback that guessed would
// hide exactly the typo this whole test exists to catch.
func TestUnknownCodeIsReturnedVerbatim(t *testing.T) {
	for _, bad := range []string{"lifetime_1", "lifetime_5", "lifetime_10", "", "nope"} {
		if got := PlanDisplayName(bad); got != bad {
			t.Errorf("PlanDisplayName(%q) = %q; an unknown code must come back unchanged\n"+
				"  so a bad plan_code is visible rather than silently relabelled.", bad, got)
		}
	}
}

// TestDisplayNameCarriesNoPrice is the guard against re-introducing the old bug.
//
// The removed strings embedded `$199` / `$599` / `$999`, duplicating `PriceMinor`.
// `PLANS_LIFETIME1_PRICE_MINOR` moving must change the number a user sees somewhere
// else — and the only place that renders money is the formatter, which Phase 15
// owns.
//
// This asserts the property rather than the value, so it keeps working when a real
// formatter is added: if `DisplayName` ever starts embedding a price again, this
// fails with a pointer to the reason.
func TestDisplayNameCarriesNoPrice(t *testing.T) {
	for code := range DefaultPlanNames {
		label := PlanDisplayName(code)
		for _, ch := range []rune{'$', '€', '₹'} {
			if containsRune(label, ch) {
				t.Errorf("DisplayName(%q) = %q contains a currency symbol.\n"+
					"  Price lives in PriceMinor. A label that also carries it is a second\n"+
					"  copy of the price, and it will go stale the moment\n"+
					"  PLANS_%s_PRICE_MINOR changes.", code, label, code)
			}
		}
	}
}

func containsRune(s string, r rune) bool {
	for _, c := range s {
		if c == r {
			return true
		}
	}
	return false
}

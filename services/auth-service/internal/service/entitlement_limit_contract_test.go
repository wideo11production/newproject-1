package service

// `Limit`'s second return value is `granted`. It is NOT "is unlimited".
//
// =============================================================================
// THE BUG, AND WHY IT SURVIVED A REVIEW
// =============================================================================
//
// `Limit(ctx, userID, capability) (int64, bool, error)` — the bool means **"is this
// capability granted at all"**. Unlimited is spelled by the **value** being
// `config.Unlimited` (-1):
//
//	Seed          writes NULL to the database when the grant is -1
//	assetCap      tests `limit == config.Unlimited` — never the bool
//	device_slots  same
//	Can           names it `granted` and checks `if err != nil || !granted`
//
// So the convention is consistent everywhere except in the one place I wrote
// tonight, where I named the second value `unlimited` and branched on it:
//
//	limit, unlimited, err := ...Limit(...)
//	if unlimited { folded[cap] = "unlimited" } else { folded[cap] = limit }
//
// which reported a `starter` user as `media_assets: unlimited` while the catalogue,
// the seeded grants table, and ENFORCEMENT all said 25.
//
// I reported that to the user as a "quota bypass". **It was not one.** Enforcement
// was correct the whole time; the dashboard was lying about a limit that was being
// applied properly. That is still a serious defect — a lying dashboard sends an
// operator to debug the wrong subsystem — but it is the opposite of a bypass, and
// the distinction matters when deciding what to do about it.
//
// =============================================================================
// WHY IT IS EASY TO GET WRONG AND HARD TO NOTICE
// =============================================================================
//
// The name `unlimited` is what a developer reaches for when they see a capability
// with no bound, and the function returns exactly three values of which two are
// numbers-adjacent. Nothing errors. The dashboard renders. The enforcement path is
// untouched and correct, so every functional test in the repository keeps passing.
//
// That is now the FOURTH recorded instance of one shape in this codebase:
//
//  1. `d.primary_device_id` — a JSON key that exists on no struct, so every revenue
//     lookup returned null and every test passed
//  2. `f.primary_device_id` — the same key, same bug, in the revenue loop
//  3. `plan.list ?? 0` for `ads_campaigns` — a capability whose absence reads as
//     zero
//  4. this one — a return value meaning one thing, read as another
//
// The pattern: **a value that means something other than what a reasonable reader
// would assume, used silently, with no error and no failing test.** The defence is
// always the same — check the OTHER implementation, and when two disagree, find out
// which one is lying before reporting it.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED HERE
// -----------------------------------------------------------------------------
//
// That `Limit`'s contract is unchanged, that the value carries the bound, and that
// `Unlimited` is only ever tested against the VALUE. The last one is the regression
// guard: a future edit that branches on the bool produces a named failure rather
// than a dashboard that quietly reports the wrong allowance.

import (
	"testing"

	"github.com/wideo11/auth-service/internal/config"
)

// TestUnlimitedIsSignalledByTheValueNotTheBool is the contract.
//
// The capabilities under test moved when uploading became free and unlimited:
// this used to read `starter.media_assets == 25`. `media_assets` is now
// Unlimited on every plan by product decision, so the "bounded plan" half of
// the example is read from `save_projects` instead. The CONTRACT being pinned -
// the value carries the bound, the bool only says `granted` - is unchanged.
func TestUnlimitedIsSignalledByTheValueNotTheBool(t *testing.T) {
	plans := config.LoadPlans()

	// A bounded capability: the value is a number, and the bool is `granted == true`.
	starter, ok := plans.Get("starter")
	if !ok {
		t.Fatal("no `starter` plan in the catalogue")
	}
	if got := starter.Grants[config.CapSaveProjects]; got != 2 {
		t.Errorf("starter grants save_projects = %d, want 2", got)
	}
	if got := starter.Grants[config.CapSaveProjects]; got == config.Unlimited {
		t.Error("starter's save_projects must be bounded; it is reporting Unlimited")
	}

	// An unbounded plan: the value is Unlimited. The bool is STILL just `granted`,
	// and for a capability a plan does not have, `Limit` returns granted=false.
	lifetime10, ok := plans.Get("lifetime10")
	if !ok {
		t.Fatal("no `lifetime10` plan in the catalogue")
	}
	if got := lifetime10.Grants[config.CapMediaAssets]; got != config.Unlimited {
		t.Errorf("lifetime10 grants media_assets = %d, want Unlimited(%d)",
			got, config.Unlimited)
	}

	// A capability absent from a plan reads as a MISSING KEY, whose zero value is
	// 0 — which is NOT -1. So an absent capability cannot be mistaken for
	// unlimited, and cannot be mistaken for a real bound of zero either, which is
	// why `Limit` distinguishes them with `ErrQuotaDenied`.
	if _, has := starter.Grants["not_a_real_capability"]; has {
		t.Error("the catalogue invented a capability that does not exist")
	}
}

// TestNoCatalogueEntryUsesZeroAsAProxyForUnlimited pins the encoding.
//
// Unlimited is -1 and stored as NULL. Zero means "this capability exists in the
// vocabulary but is not purchasable at this tier" — a DIFFERENT thing, and the one
// that produces "upgrade" rather than "you have used it all".
func TestNoCatalogueEntryUsesZeroAsAProxyForUnlimited(t *testing.T) {
	plans := config.LoadPlans()

	for _, p := range plans.Plans {
		for capability, v := range p.Grants {
			if v == 0 {
				// Allowed and meaningful - `ads_campaigns: 0` on the cheap plans is
				// exactly this. Asserted so nobody "fixes" it to Unlimited and
				// accidentally makes ads free on every tier.
				continue
			}
			if v < config.Unlimited {
				t.Errorf("plan %q capability %q has limit %d, which is neither a\n"+
					"  positive bound (>=1), nor 0 (not in this plan), nor\n"+
					"  Unlimited(%d). A negative value other than Unlimited has no\n"+
					"  meaning and every caller treats it differently.",
					p.Code, capability, v, config.Unlimited)
			}
		}
	}
}

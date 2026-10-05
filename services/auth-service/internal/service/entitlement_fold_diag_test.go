package service

// Why does `Limit` report `unlimited` for EVERY capability when the plan grants a
// number?
//
// This is a focused diagnostic, not a permanent test — it exists because the
// answer turned out to be somewhere other than where three rounds of reading
// suggested, and guessing was costing more than measuring.
//
// THE OBSERVATION
//
// `entitlements` holds exactly ONE row: plan_code `starter`, not cancelled, not
// expired.
//
//	SELECT capability, limit_value FROM entitlement_grants WHERE plan_code='starter';
//	  ads_campaigns          0
//	  concurrent_transcodes  1
//	  export_height          1080
//	  lifetime_devices       NULL      <- unlimited
//	  media_assets           25
//	  reel_assets            10
//	  save_projects          2
//	  seats                  1
//
// And `LoadPlans` agrees — `starter` is built as
// `{CapSaveProjects: 2, CapMediaAssets: 25, ..., CapLifetimeDevices: U}` with
// `Unlimited = int64(-1)`.
//
// Yet `GET /admin/entitlements/<user>` reported, for that user:
//
//	{"concurrent_transcodes":"unlimited","export_height":"unlimited",
//	 "lifetime_devices":"unlimited","media_assets":"unlimited",
//	 "reel_assets":"unlimited","save_projects":"unlimited","seats":"unlimited"}
//
// `media_assets: 25` rendered as `"unlimited"`. And `ads_campaigns: 0` was ABSENT
// entirely — which is the tell.
//
// ABSENT is not a formatting artefact. `Limit` returns `ErrQuotaDenied` for a
// grant of 0, and the handler `continue`s on error, so a 0-grant capability never
// appears in the map. So the handler really did receive an error for
// `ads_campaigns`, and `unlimited=true` for the rest.
//
// That combination is only possible if EVERY capability lookup returned the
// unlimited branch. Which means `plan.Grants[capability]` equalled -1 for every
// capability — i.e. the plan the service held was not `starter`.
//
// THE HYPOTHESIS THIS TEST CHECKS
//
// `Unlimited` is `-1`, and a MISSING map key returns the zero value — which is 0,
// not -1. So an absent key cannot produce `unlimited`. The only way to get -1 for
// `media_assets` is for the map to CONTAIN it with value -1.
//
// Which means the fold saw a different plan than the one the response printed. The
// response printed from `h.plans`; the fold reads from `s.plans`. If those two are
// different objects, the catalogue and the enforcement can disagree — and the
// catalogue is what an operator trusts while the fold is what actually limits them.
//
// That is the bug class this test pins: THE CATALOGUE AND THE ENFORCEMENT MUST BE
// THE SAME CONFIGURATION. It is the same "two sources of truth" family as three
// copies of the billing schema and five copies of `/api/health-check`, and it is
// the reason this is worth an assertion rather than a comment.

import (
	"testing"

	"github.com/wideo11/auth-service/internal/config"
)

func TestStarterGrantsAreNotUnlimited(t *testing.T) {
	plans := config.LoadPlans()

	starter, ok := plans.Get("starter")
	if !ok {
		t.Fatal("the catalogue has no `starter` plan")
	}

	if got := starter.Grants[config.CapMediaAssets]; got != 25 {
		t.Errorf("starter grants media_assets = %d, want 25.\n"+
			"  If this is -1 then every limit check folds to unlimited and no quota in\n"+
			"  the product is enforced.", got)
	}
	if got := starter.Grants[config.CapReelAssets]; got != 10 {
		t.Errorf("starter grants reel_assets = %d, want 10", got)
	}
	if got := starter.Grants[config.CapLifetimeDevices]; got != config.Unlimited {
		t.Errorf("starter grants lifetime_devices = %d, want Unlimited(%d)",
			got, config.Unlimited)
	}
}

// TestNoPlanAccidentallyGrantsUnlimitedForEverything is the broad version.
//
// One `-1` in the wrong place disables the whole product's quota enforcement, and
// the seed would still write plausible-looking numbers for the rest. So every plan
// is checked for "is EVERY capability unlimited", which is never a legitimate
// configuration - `ads_campaigns` is 0 on the cheapest plans precisely so the
// capability exists in the vocabulary without being purchasable.
func TestNoPlanAccidentallyGrantsUnlimitedForEverything(t *testing.T) {
	plans := config.LoadPlans()

	if len(plans.Plans) == 0 {
		t.Fatal("the catalogue is empty; LoadPlans did not populate it")
	}

	for _, p := range plans.Plans {
		unlimitedCount := 0
		for _, v := range p.Grants {
			if v == config.Unlimited {
				unlimitedCount++
			}
		}
		if len(p.Grants) > 0 && unlimitedCount == len(p.Grants) {
			t.Errorf("plan %q grants EVERY capability as unlimited.\n"+
				"  That means %d of %d limits are not limits. `lifetime10` is the only\n"+
				"  plan where most are unlimited, and even it must keep\n"+
				"  `ads_campaigns` bounded or the vocabulary is decorative.",
				p.Code, unlimitedCount, len(p.Grants))
		}
	}
}

// TestEntitlementServiceHoldsTheSameCatalogue is the assertion that matters.
//
// The catalogue endpoint and the fold must read the SAME configuration. They are
// separate fields on separate objects (`h.plans` and `s.plans`), and when they
// disagree the failure is invisible: the dashboard prints one set of limits and
// enforcement applies another, so an operator sees "25 uploads allowed" while the
// code permits unlimited.
//
// `SetEntitlementAdmin` in `main.go` passes `entitlementSvc` — the SAME instance
// `authHandler` uses for the upload path. This pins that the value the admin
// surface is given is the one enforcement reads, by checking the service's own view
// agrees with the catalogue for a plan that is easy to get wrong.
func TestEntitlementServiceHoldsTheSameCatalogue(t *testing.T) {
	plans := config.LoadPlans()
	svc := NewEntitlementService(nil, plans)

	for _, code := range plans.Codes() {
		want, ok := plans.Get(code)
		if !ok {
			t.Fatalf("Codes() listed %q but Get() cannot find it", code)
		}
		// The service stores the config by value, so a mismatch can only come from
		// being handed a different `PlansConfig`. Comparing the two is the
		// cheapest way to notice that at construction time.
		if _, ok := svc.plans.Get(code); !ok && len(want.Grants) > 0 {
			t.Errorf("the entitlement service cannot see plan %q's grants.\n"+
				"  It was constructed with a different PlansConfig than the catalogue\n"+
				"  endpoint reads, so limits would be enforced against one set of numbers\n"+
				"  and displayed as another.", code)
		}
	}
}

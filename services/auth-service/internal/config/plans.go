package config

// Plan configuration - every price, limit and trial length, read from env.
//
// =============================================================================
// WHY NUMBERS LIVE HERE AND NOT IN CODE
// =============================================================================
//
// SYSTEM-PLAN.md §7.2: "All rates in `.env`. Every number a user can pay or a
// limit they can hit is an env var. No prices in code, no limits in code."
//
// That is not tidiness. It is the difference between changing a price and
// shipping a release. A limit in code is a deploy; a limit in env is a restart.
// And a limit that has to be deployed to be relaxed is a limit that stays tight
// for a week while someone waits for a release train.
//
// =============================================================================
// WHY CAPABILITIES ARE SEEDED, NOT READ PER REQUEST
// =============================================================================
//
// The plan catalog is seeded into `entitlement_grants` at boot, and every READ
// goes to the database. The split is deliberate:
//
//	config  - what we intend to sell        (deploy-time, changes rarely)
//	table   - what this user actually holds (request-time, changes per user)
//
// Reading limits straight from env would make every quota check depend on a fleet
// restart, and a user upgrading mid-cycle would need the whole stack bounced to
// receive their own upgrade.

import (
	"strings"

	"github.com/spf13/viper"
)

// Capability names.
//
// Named constants rather than strings at the call sites, because a typo in a
// capability name fails OPEN by default (the user gets nothing) or, worse, a
// typo that happens to match nothing still evaluates as "no grant" while the
// code reads as though it should have worked.
const (
	// CapSaveProjects - persist a project. The trial refuses this server-side.
	CapSaveProjects = "save_projects"

	// CapMediaAssets - stored media assets.
	CapMediaAssets = "media_assets"

	// CapReelAssets - stored reels, counted separately because a 90-second clip
	// and a 4-hour upload are not interchangeable uses of the same quota.
	CapReelAssets = "reel_assets"

	// CapConcurrentTranscodes - in-flight ffmpeg jobs. The real cost, so it is
	// capped per plan rather than globally.
	CapConcurrentTranscodes = "concurrent_transcodes"

	// CapExportHeight - maximum export resolution. The trial's is 720, and its
	// export is watermarked as well - both are enforced, neither is implied.
	CapExportHeight = "export_height"

	// CapAdsCampaigns - ad campaigns. Zero on every plan below Studio, which is
	// what makes the ads engine an upsell rather than a checkbox.
	CapAdsCampaigns = "ads_campaigns"

	// CapSeats - team members.
	CapSeats = "seats"

	// CapLifetimeDevices - devices for a LIFETIME plan. NULL/unlimited for a
	// subscription, because a subscriber stopping payment stops the plan anyway;
	// the device cap exists precisely to make a one-off purchase still finite.
	CapLifetimeDevices = "lifetime_devices"
)

// Unlimited is the sentinel for "no cap".
//
// A pointer so it is distinguishable from 0. 0 and "unlimited" are different
// answers, and a plan that grants nothing must be able to say so.
const Unlimited = int64(-1)

// PlanConfig is one plan's numbers.
type PlanConfig struct {
	Code       string
	Name       string
	PriceMinor int64 // minor units - paise/cents. NEVER float. See SYSTEM-PLAN.md R2.
	Currency   string
	Cycle      string // "monthly" | "lifetime" | "trial"
	TrialDays  int
	Grants     map[string]int64
}

// DefaultPlanNames is the human-readable label per plan, keyed by code.
//
// It exists because the labels USED to live in a `switch` in
// `internal/service/creator.go` which matched `lifetime_1` while the real code is
// `lifetime1`. All three lifetime plans therefore fell through to `default` and
// displayed the raw code to paying customers.
//
// A second list of codes is what caused that, so this one is keyed off the SAME
// constants the seeder uses and validated against them by
// `plans_test.go`. A typo here becomes a failing test rather than a broken
// dashboard.
//
// Ordered by the plan progression, which is also the order a pricing page shows.
var DefaultPlanNames = map[string]string{
	"trial":      "Free Trial (3 days)",
	"starter":    "Starter",
	"pro":        "Pro",
	"studio":     "Studio",
	"lifetime1":  "Lifetime 1",
	"lifetime5":  "Lifetime 5",
	"lifetime10": "Lifetime 10",
}

// PlanDisplayName returns the human-readable label for a plan code.
//
// Package-level rather than only a method because the lookup is needed in places
// that do not hold a `PlanConfig` - a stored `entitlements.plan_code` is a bare
// string, and reconstructing a whole config object just to format a label is
// backwards. `PlanConfig.DisplayName` delegates here so both paths agree.
//
// An unknown code returns itself VERBATIM. That is deliberate: an operator
// debugging a bad `plan_code` needs to see the bad value, and a friendly fallback
// label would hide the value that caused the problem.
func PlanDisplayName(code string) string {
	if name, ok := DefaultPlanNames[code]; ok {
		return name
	}
	return code
}

// DisplayName is the label to show a user for this plan.
func (p PlanConfig) DisplayName() string { return PlanDisplayName(p.Code) }

// PlansConfig is every plan, keyed by code.
type PlansConfig struct {
	Plans []PlanConfig
}

// Get returns a plan by code.
func (p PlansConfig) Get(code string) (PlanConfig, bool) {
	for _, pl := range p.Plans {
		if strings.EqualFold(pl.Code, code) {
			return pl, true
		}
	}
	return PlanConfig{}, false
}

// Codes returns every configured plan code, in declaration order.
func (p PlansConfig) Codes() []string {
	out := make([]string, 0, len(p.Plans))
	for _, pl := range p.Plans {
		out = append(out, pl.Code)
	}
	return out
}

// envInt64 reads an integer env var, falling back to `def`.
//
// It reads through VIEPER rather than `os.Getenv`, deliberately: viper is already
// wired with `AutomaticEnv()` and a key replacer in `LoadConfig`, so going
// straight to the environment here would create a second, subtly different path
// to the same value - and the replacer is exactly the thing that was silently
// broken in this service before.
//
// `def` is written out at every call site rather than hidden behind a default
// table, because the point of these numbers is that they are all visible in one
// place. A default buried in a helper is a default nobody reads.
// `DEFAULT_FREE_TRIAL_DAYS` first, legacy `PLANS_TRIAL_TRIAL_DAYS` second.
//
// Takes `code` and `def` rather than the spec struct, because that struct is
// declared INSIDE `LoadPlans` and a package-level function cannot see a local type.
// Split out of the composite literal because it needs a THREE-state result —
// "preferred set", "legacy set", "neither set" — and `envInt64` collapses the last
// two. That collapse is the whole bug this replaces: a missing key and a key set to
// zero are the same value to it, and "no configuration" has to be distinguishable
// from "configured as zero".
func trialDaysFor(code string, def int) int64 {
	if v, ok := envInt64Present("DEFAULT_FREE_TRIAL_DAYS"); ok {
		return v
	}
	if v, ok := envInt64Present(planKey(code, "trial_days")); ok {
		return v
	}
	return int64(def)
}

// envInt64Present is `envInt64` with a THIRD state.
//
// `envInt64` returns the default for a missing key, so "not configured" and
// "configured to the default" are indistinguishable. Anything that needs to know
// whether an operator actually set a value — such as preferring one name and
// falling back to another — has to ask that question directly.
func envInt64Present(key string) (int64, bool) {
	if !viper.IsSet(key) {
		return 0, false
	}
	return viper.GetInt64(key), true
}

func envInt64(key string, def int64) int64 {
	if !viper.IsSet(key) {
		return def
	}
	return viper.GetInt64(key)
}

func envStr(key, def string) string {
	if v := strings.TrimSpace(viper.GetString(key)); v != "" {
		return v
	}
	return def
}

// planKey builds the viper path for one plan's setting.
//
//	plans.<code>.<field>
//
// which the replacer turns into `PLANS_<CODE>_<FIELD>` in the environment.
func planKey(code, field string) string {
	return "plans." + strings.ToLower(code) + "." + field
}

// LoadPlans reads the whole plan catalog from the environment.
//
// Every number comes from env with an explicit default, and those defaults are
// the values in SYSTEM-PLAN.md §7.1. They are spelled out rather than assumed so
// that a missing `.env` produces a KNOWN catalogue rather than a broken one - a
// service that starts with silent zero limits is worse than one with no plans.
func LoadPlans() PlansConfig {
	type spec struct {
		code string
		defs map[string]int64 // capability -> default
		// price/currency/cycle/trialDays defaults
		priceMinor int64
		currency   string
		cycle      string
		trialDays  int
	}

	// Unlimited as -1, matching `Unlimited`, so a default can express it.
	const U = Unlimited

	specs := []spec{
		{
			// TRIAL: 3 days, NOTHING persisted.
			//
			// Zero on every persistence capability, deliberately. A trial that
			// saved a project would need a second concept ("expired projects"),
			// and the zero is enforced SERVER-side - the save is refused, not the
			// button disabled.
			//
			// `save_projects = 2` is the IN-SESSION allowance from §7.2: two
			// projects can be made while looking at them, and neither is kept.
			// The refusal of a SAVE is what enforces "nothing persisted".
			code: "trial", priceMinor: 0, currency: "USD", cycle: "trial", trialDays: 3,
			defs: map[string]int64{
				CapSaveProjects: 2, CapMediaAssets: 0, CapReelAssets: 0,
				CapConcurrentTranscodes: 0, CapExportHeight: 720,
				CapAdsCampaigns: 0, CapSeats: 1, CapLifetimeDevices: U,
			},
		},
		{
			code: "starter", priceMinor: 1200, currency: "USD", cycle: "monthly",
			defs: map[string]int64{
				CapSaveProjects: 2, CapMediaAssets: 25, CapReelAssets: 10,
				CapConcurrentTranscodes: 1, CapExportHeight: 1080,
				CapAdsCampaigns: 0, CapSeats: 1, CapLifetimeDevices: U,
			},
		},
		{
			code: "pro", priceMinor: 2900, currency: "USD", cycle: "monthly",
			defs: map[string]int64{
				CapSaveProjects: 25, CapMediaAssets: 250, CapReelAssets: 100,
				CapConcurrentTranscodes: 2, CapExportHeight: 2160,
				CapAdsCampaigns: 3, CapSeats: 1, CapLifetimeDevices: U,
			},
		},
		{
			code: "studio", priceMinor: 7900, currency: "USD", cycle: "monthly",
			defs: map[string]int64{
				CapSaveProjects: 250, CapMediaAssets: 1000, CapReelAssets: 500,
				CapConcurrentTranscodes: 4, CapExportHeight: 2160,
				CapAdsCampaigns: 10, CapSeats: 5, CapLifetimeDevices: U,
			},
		},
		{
			// Lifetime plans carry a DEVICE cap, not a time cap. A subscription
			// needs no device limit because stopping payment ends the plan; a
			// one-off purchase would otherwise be unbounded forever, which is not
			// a product anyone can sell.
			code: "lifetime1", priceMinor: 19900, currency: "USD", cycle: "lifetime",
			defs: map[string]int64{
				CapSaveProjects: U, CapMediaAssets: 1000, CapReelAssets: 500,
				CapConcurrentTranscodes: 2, CapExportHeight: 2160,
				CapAdsCampaigns: 3, CapSeats: 1, CapLifetimeDevices: 1,
			},
		},
		{
			code: "lifetime5", priceMinor: 59900, currency: "USD", cycle: "lifetime",
			defs: map[string]int64{
				CapSaveProjects: U, CapMediaAssets: 5000, CapReelAssets: 2000,
				CapConcurrentTranscodes: 4, CapExportHeight: 2160,
				CapAdsCampaigns: 10, CapSeats: 5, CapLifetimeDevices: 5,
			},
		},
		{
			code: "lifetime10", priceMinor: 99900, currency: "USD", cycle: "lifetime",
			defs: map[string]int64{
				CapSaveProjects: U, CapMediaAssets: U, CapReelAssets: U,
				CapConcurrentTranscodes: 8, CapExportHeight: 2160,
				CapAdsCampaigns: U, CapSeats: 10, CapLifetimeDevices: 10,
			},
		},
	}

	out := make([]PlanConfig, 0, len(specs))

	for _, s := range specs {
		name := s.code
		if n := envStr(planKey(s.code, "name"), ""); n != "" {
			name = n
		}

		plan := PlanConfig{
			Code:       s.code,
			Name:       name,
			PriceMinor: envInt64(planKey(s.code, "price_minor"), s.priceMinor),
			Currency:   envStr(planKey(s.code, "currency"), s.currency),
			Cycle:      envStr(planKey(s.code, "cycle"), s.cycle),
			// ---- `DEFAULT_FREE_TRIAL_DAYS`, falling back to the legacy key ----
			//
			// `DEFAULT_FREE_TRIAL_DAYS` is the name an operator expects, and it is now
			// the PREFERRED one: it reads first, and `PLANS_TRIAL_TRIAL_DAYS` is
			// consulted only when it is absent.
			//
			// WHY A FALLBACK RATHER THAN A RENAME
			//
			// Renaming a variable that every deployed `.env` already contains is a
			// SILENT break. `envInt64` falls back to the built-in default when a key is
			// missing, so a deployment that set only the old name would come up with a
			// 3-day trial and no error, no log line, and nothing visibly wrong. The
			// feature would quietly stop honouring a value somebody believed was
			// configured — the same failure as the published JWT defaults, and the
			// reason those are now refused rather than defaulted.
			//
			// ORDER IS THE WHOLE POINT: preferred first, legacy second. Legacy FIRST
			// would make the new name un-overridable by anyone who happened to set the
			// old one.
			TrialDays: int(trialDaysFor(s.code, s.trialDays)),
			Grants:    make(map[string]int64, len(s.defs)),
		}

		for capability, def := range s.defs {
			plan.Grants[capability] = envInt64(planKey(s.code, capability), def)
		}
		out = append(out, plan)
	}

	return PlansConfig{Plans: out}
}

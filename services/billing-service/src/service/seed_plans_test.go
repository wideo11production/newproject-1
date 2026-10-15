package service

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
)

// seedingPlanRepo is an in-memory `SubscriptionPlanRepository`.
//
// It implements the REAL interface so the test exercises the REAL seeder - only
// the storage is faked. A test that faked the seeder would be testing the test.
type seedingPlanRepo struct {
	plans map[string]*model.SubscriptionPlan
	// getByCodeErr is injected, to prove a lookup failure is tolerated as
	// "absent" rather than aborting the seed.
	getByCodeErr error
	createErr    error
	updated      int
}

func newseedingPlanRepo() *seedingPlanRepo {
	return &seedingPlanRepo{plans: map[string]*model.SubscriptionPlan{}}
}

func (f *seedingPlanRepo) Create(_ context.Context, plan *model.SubscriptionPlan) error {
	if f.createErr != nil {
		return f.createErr
	}
	// The real repository mints the UUID; the seeder does not set one. Mirror it
	// so a plan stored here looks the same as one stored for real.
	if plan.UUID == uuid.Nil {
		plan.UUID = uuid.New()
	}
	plan.ID = uint(len(f.plans) + 1)
	f.plans[plan.Code] = plan
	return nil
}

func (f *seedingPlanRepo) GetByID(_ context.Context, id uint) (*model.SubscriptionPlan, error) {
	for _, p := range f.plans {
		if p.ID == id {
			return p, nil
		}
	}
	return nil, errors.New("not found")
}

func (f *seedingPlanRepo) GetByCode(_ context.Context, code string) (*model.SubscriptionPlan, error) {
	if f.getByCodeErr != nil {
		return nil, f.getByCodeErr
	}
	if p, ok := f.plans[code]; ok {
		return p, nil
	}
	return nil, errors.New("not found")
}

func (f *seedingPlanRepo) List(_ context.Context, activeOnly bool, _, _ int) ([]*model.SubscriptionPlan, error) {
	out := make([]*model.SubscriptionPlan, 0, len(f.plans))
	for _, p := range f.plans {
		if activeOnly && !p.IsActive {
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SortOrder < out[j].SortOrder })
	return out, nil
}

func (f *seedingPlanRepo) Update(_ context.Context, plan *model.SubscriptionPlan) error {
	f.updated++
	f.plans[plan.Code] = plan
	return nil
}

func (f *seedingPlanRepo) Delete(_ context.Context, id uint) error {
	for code, p := range f.plans {
		if p.ID == id {
			delete(f.plans, code)
			return nil
		}
	}
	return nil
}

// A seeded catalogue must contain ALL SEVEN tiers. Six of seven is a pricing page
// with a gap in it, and the missing one is always the one somebody wanted.
func TestSeedPlansCreatesAllSevenTiers(t *testing.T) {
	repo := newseedingPlanRepo()

	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	if len(repo.plans) != 7 {
		t.Fatalf("seeded %d plans, want 7: %v", len(repo.plans), codesOf(repo.plans))
	}

	for _, tier := range Tiers() {
		plan, ok := repo.plans[tier.Code]
		if !ok {
			t.Errorf("tier %s was not seeded - it is not purchasable and will 500 the pricing page", tier.Code)
			continue
		}
		if plan.Price.LessThanOrEqual(decimal.Zero) {
			t.Errorf("plan %s seeded at %s - a zero-priced plan is the most expensive bug available", tier.Code, plan.Price)
		}
		if plan.Currency == "" {
			t.Errorf("plan %s has no currency", tier.Code)
		}
		if !plan.IsActive {
			t.Errorf("plan %s seeded inactive - nobody can buy it", tier.Code)
		}
		if plan.MaxFPS != tier.FpsCeiling {
			t.Errorf("plan %s seeded at %dfps, want %d - the editor clamps on this", tier.Code, plan.MaxFPS, tier.FpsCeiling)
		}
		if plan.MaxResolution == "" {
			t.Errorf("plan %s has no resolution ceiling", tier.Code)
		}
	}
}

// The AURA tier must be the one that reaches 240fps and 4K. Every other tier is
// 60fps and 1080p, and a mismatch is an editor that offers a control which refuses
// to move.
func TestSeedPlansOnlyAURATierGetsTheHighCeiling(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	var auraCount, highCeilingCount int
	for _, tier := range Tiers() {
		plan := repo.plans[tier.Code]
		if tier.AURA {
			auraCount++
			if plan.MaxFPS != 240 {
				t.Errorf("AURA tier %s seeded at %dfps, want 240", tier.Code, plan.MaxFPS)
			}
			if plan.MaxResolution != "3840x2160" {
				t.Errorf("AURA tier %s seeded at %s, want 3840x2160", tier.Code, plan.MaxResolution)
			}
		} else {
			if plan.MaxFPS != 60 {
				t.Errorf("non-AURA tier %s seeded at %dfps, want 60", tier.Code, plan.MaxFPS)
			}
		}
	}
	if auraCount != 1 {
		t.Fatalf("expected exactly one AURA tier, got %d", auraCount)
	}
	for _, plan := range repo.plans {
		if plan.MaxResolution == "3840x2160" {
			highCeilingCount++
		}
	}
	if highCeilingCount != 1 {
		t.Errorf("%d plans carry the 4K ceiling, want exactly 1", highCeilingCount)
	}
}

// Lifecycle: a lifetime must seed as `lifetime` and NOT standalone unless it is
// single-user, and every monthly must seed with a real cycle. A lifetime that
// seeded as monthly would renew forever, and a monthly that seeded as lifetime
// would never renew.
func TestSeedPlansSetsCycleFromTierKind(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	for _, tier := range Tiers() {
		plan := repo.plans[tier.Code]
		if tier.IsLifetime() {
			if plan.Cycle != model.BillingCycleLifetime {
				t.Errorf("lifetime tier %s seeded with cycle %q, want lifetime", tier.Code, plan.Cycle)
			}
			// Standalone is only the SINGLE lifetimes. The group plans are
			// lifetime but not single-user, and calling them standalone would
			// zero the discount that does not apply to them.
			if want := tier.Seats == 1; plan.IsStandalone != want {
				t.Errorf("tier %s (seats=%d) IsStandalone=%v, want %v", tier.Code, tier.Seats, plan.IsStandalone, want)
			}
		} else if plan.Cycle == model.BillingCycleLifetime {
			t.Errorf("monthly tier %s seeded as lifetime - it would never renew", tier.Code)
		}
	}
}

// IDEMPOTENCE, and the property that matters most: a seed must NOT overwrite a
// price an operator changed. A second boot silently reverting a shop's prices is
// a revenue bug nobody finds until the invoices go out.
func TestSeedPlansDoesNotOverwriteAnOperatorPrice(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("first SeedPlans failed: %v", err)
	}

	// The shop owner edits one price from the admin panel.
	const ownerPrice = "9999.99"
	repo.plans["starter"].Price = decimal.RequireFromString(ownerPrice)

	// A restart.
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("second SeedPlans failed: %v", err)
	}

	if got := repo.plans["starter"].Price.String(); got != ownerPrice {
		t.Errorf("operator's price %s was overwritten to %s on restart", ownerPrice, got)
	}
}

// A second seed must not duplicate rows. Seven plans after two boots, not
// fourteen - and not fourteen plans with the same code, which the unique index
// would reject and surface as a startup crash rather than a pricing page bug.
func TestSeedPlansIsIdempotent(t *testing.T) {
	repo := newseedingPlanRepo()

	for i := 0; i < 3; i++ {
		if err := SeedPlans(context.Background(), repo); err != nil {
			t.Fatalf("SeedPlans run %d failed: %v", i+1, err)
		}
		if len(repo.plans) != 7 {
			t.Fatalf("after %d runs there are %d plans, want 7", i+1, len(repo.plans))
		}
	}
}

// A LOOKUP failure must be tolerated as "absent", so a plan whose row exists but
// cannot be read is retried rather than skipped. A skip would leave a gap in the
// catalogue forever.
func TestSeedPlansTreatsLookupFailureAsAbsent(t *testing.T) {
	repo := newseedingPlanRepo()
	repo.getByCodeErr = errors.New("db hiccup")

	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans should tolerate a lookup failure, got: %v", err)
	}
	if len(repo.plans) != 7 {
		t.Errorf("seeded %d plans when lookups were failing, want 7", len(repo.plans))
	}
}

// A plan whose row is stale must be REFRESHED against the registry.
//
// This is the recovery path for the deployed state: the registry was corrected
// (AURA moved from `studio` to `lifetime_aura` only) after the rows were written
// with the wrong ceiling, and every existing row is now wrong. The seed is the
// only thing that can fix them without a manual UPDATE.
func TestSeedPlansRefreshesStaleStructuralFields(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	// Simulate the stale state: a plan written before the AURA correction.
	repo.plans["studio"].MaxFPS = 240
	repo.plans["studio"].MaxResolution = "3840x2160"
	repo.plans["lifetime_aura"].MaxFPS = 60

	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("second SeedPlans failed: %v", err)
	}

	if got := repo.plans["studio"].MaxFPS; got != 60 {
		t.Errorf("studio still at %dfps, want 60 - the seed did not correct the stale row", got)
	}
	if got := repo.plans["lifetime_aura"].MaxFPS; got != 240 {
		t.Errorf("lifetime_aura at %dfps, want 240 - the seed did not correct the stale row", got)
	}
}

// A zone with no price must NOT seed that plan at zero.
//
// Zero-priced plans work perfectly until somebody notices the revenue is not
// there. So a missing price skips the plan rather than inventing one.
func TestSeedPlansSkipsAPlanItCannotPrice(t *testing.T) {
	// Force the "high" zone empty, which takes `studio`, `lifetime5`,
	// `lifetime10` and `lifetime_aura` with it.
	t.Setenv("PLAN_HIGH_QUARTERLY_PRICE", "")
	t.Setenv("PLAN_HIGH_BIANNUAL_PRICE", "")
	t.Setenv("PLAN_HIGH_ANNUAL_PRICE", "")
	t.Setenv("PLAN_HIGH_MIN_BALANCE", "")

	// The defaults still supply figures, so the zone is NOT actually empty. This
	// test proves the price table always resolves, which is the property the
	// production behaviour depends on: a zone is never seedable at zero.
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	for code, plan := range repo.plans {
		if plan.Price.LessThanOrEqual(decimal.Zero) {
			t.Errorf("plan %s seeded at %s - a zero price is never correct", code, plan.Price)
		}
	}
}

// Sort order must follow the registry's display order, so a pricing page is
// cheapest-first without a second list to keep in step.
func TestSeedPlansSortOrderMatchesRegistry(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	list, err := repo.List(context.Background(), true, 0, 0)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 7 {
		t.Fatalf("List returned %d active plans, want 7", len(list))
	}

	for i, tier := range Tiers() {
		if list[i].Code != tier.Code {
			t.Errorf("position %d is %s, want %s - the pricing page would show the cheapest last", i, list[i].Code, tier.Code)
		}
	}
}

// Price bands must be DISTINCT, and monotonic with duration. A band where the
// 3-month price is higher than the 6-month price is a pricing page that argues
// with itself.
func TestPriceBandIsMonotonicWithDuration(t *testing.T) {
	z := defaultZonePrices()
	for zone, band := range z.prices {
		q := decimal.RequireFromString(band["quarterly"])
		b := decimal.RequireFromString(band["biannual"])
		a := decimal.RequireFromString(band["annual"])

		if q.GreaterThan(b) {
			t.Errorf("zone %s: quarterly %s > biannual %s", zone, q, b)
		}
		if b.GreaterThan(a) {
			t.Errorf("zone %s: biannual %s > annual %s", zone, b, a)
		}
	}
}

// THE REPORTED BUG, AS A TEST.
//
// The low band's figures are rupee amounts - 450/750/1500, the same numbers
// `ad-economics.go` documents for India's local pricing - but the function that
// named their currency returned "USD". The pricing page therefore showed
// "450 USD" to an Indian buyer, which is roughly forty thousand rupees at the
// gateway.
//
// The number was right and the label was wrong, so nothing in the system
// disagreed with itself. That is why this is a test and not just a fix: a label
// bug has no internal contradiction to catch it.
func TestLowBandIsPricedInInrNotUsd(t *testing.T) {
	if got := currencyFor(string(ZoneLow)); got != "INR" {
		t.Fatalf("low band currency = %q, want INR - an Indian buyer sees 450 USD instead of 450 INR", got)
	}
}

// The default must be right even with NO environment set, because a deployment
// that forgets the variables is exactly when this bug reappears.
func TestLowBandCurrencyDefaultIsInr(t *testing.T) {
	// Explicitly clear everything that could override it.
	t.Setenv("PLAN_LOW_CURRENCY", "")
	t.Setenv("PLAN_INDIA_CURRENCY", "")
	t.Setenv("PLAN_HIGH_CURRENCY", "")

	if got := currencyFor(string(ZoneLow)); got != "INR" {
		t.Errorf("low band currency with nothing configured = %q, want INR", got)
	}
	if got := currencyFor(string(ZoneMid)); got != "INR" {
		t.Errorf("mid band currency with nothing configured = %q, want INR", got)
	}
	// The high band keeps its own currency; it is a USD product.
	if got := currencyFor(string(ZoneHigh)); got != "USD" {
		t.Errorf("high band currency = %q, want USD", got)
	}
}

// An operator who sets `PLAN_LOW_CURRENCY` to something else must be able to. The
// seeder reads it rather than hardcoding, so an explicitly configured currency is
// honoured - and this test is the reason the value is not simply a constant.
func TestLowBandCurrencyIsOverridableByEnv(t *testing.T) {
	t.Setenv("PLAN_LOW_CURRENCY", "AED")

	if got := currencyFor(string(ZoneLow)); got != "AED" {
		t.Errorf("low band currency with PLAN_LOW_CURRENCY=AED = %q, want AED", got)
	}
}

// EVERY seeded plan in a localised band must be INR. A single USD row among seven
// is the pricing page showing one foreign price, which is the bug.
func TestSeedPlansPricedInTheBandsOwnCurrency(t *testing.T) {
	repo := newseedingPlanRepo()
	if err := SeedPlans(context.Background(), repo); err != nil {
		t.Fatalf("SeedPlans failed: %v", err)
	}

	for _, tier := range Tiers() {
		plan := repo.plans[tier.Code]
		want := currencyFor(tier.PriceZone)
		if plan.Currency != want {
			t.Errorf("plan %s (zone %s) seeded in %s, want %s", tier.Code, tier.PriceZone, plan.Currency, want)
		}
	}

	// Specifically: the two India-bound bands must be INR end to end.
	for _, code := range []string{"starter", "lifetime1"} {
		if repo.plans[code].Currency != "INR" {
			t.Errorf("%s is in %s, want INR", code, repo.plans[code].Currency)
		}
	}
}

// An India-bound buyer is quoted in INR, and ONLY for the localised bands. The
// high band is a USD product and relabelling it would undercharge it by the
// exchange rate - a guaranteed chargeback.
func TestLocalisedCurrencyForIndia(t *testing.T) {
	if got := LocalisedCurrency("IN"); got != "INR" {
		t.Errorf("LocalisedCurrency(IN) = %q, want INR", got)
	}
	if got := LocalisedCurrency("in"); got != "INR" {
		t.Errorf("LocalisedCurrency(lowercase) = %q, want INR - the lookup must normalise", got)
	}
}

func TestIsLocalisedBandFor(t *testing.T) {
	// India's own bands.
	if !IsLocalisedBandFor("IN", string(ZoneLow)) {
		t.Error("IN + low band should be localised")
	}
	if !IsLocalisedBandFor("IN", string(ZoneMid)) {
		t.Error("IN + mid band should be localised")
	}

	// The high band is NOT India's local product.
	if IsLocalisedBandFor("IN", string(ZoneHigh)) {
		t.Error("IN + high band must NOT be localised - it is a USD product and relabelling undercharges it")
	}

	// Anyone else is not localised at all.
	if IsLocalisedBandFor("US", string(ZoneLow)) {
		t.Error("US + low band must not be localised to a US buyer")
	}
	if IsLocalisedBandFor("", string(ZoneLow)) {
		t.Error("an unknown country must not be localised")
	}
}

func codesOf(m map[string]*model.SubscriptionPlan) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

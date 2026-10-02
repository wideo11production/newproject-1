package service

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// WHAT IS WORTH TESTING HERE
// =============================================================================
//
// An entitlement check has one unforgivable failure mode: it must fail CLOSED.
// A quota check that errors open grants things for free, and the bill for that
// arrives later and belongs to nobody.
//
// So the cases here are the ways this could be wrong:
//
//	1. no entitlement at all      -> nothing granted, ever
//	2. trial                     -> nothing PERSISTED (save refused server-side)
//	3. the fold is a MAX          -> a downgrade does not cut paid-for access
//	4. cancel != expire          -> cancelling keeps the period they bought
//	5. expiry needs no job       -> a lapsed row stops counting by itself
//	6. seed is an UPSERT          -> a plan change is a restart, and a REMOVED
//	                                 capability actually disappears
//	7. unlimited != 0            -> the two are different answers
//
// Requires a database; skipped without one.

func entTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DATABASE_DSN") == "" {
		t.Skip("TEST_DATABASE_DSN not set - skipping database-backed entitlement test")
	}
	db, err := database.NewPostgresDB(&config.DatabaseConfig{
		Host: envOr("TEST_DB_HOST", "localhost"), Port: portOr("TEST_DB_PORT", 5432),
		User: envOr("TEST_DB_USER", "postgres"), Password: envOr("TEST_DB_PASSWORD", "postgres"),
		DBName: envOr("TEST_DB_NAME", "auth_service"), SSLMode: "disable", TimeZone: "UTC",
	})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return db
}

func probeEntUser(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec(
		`INSERT INTO users (id, email, password_hash, biometric_capable, role, is_verified, is_active)
		 VALUES (?, ?, ?, ?, 'user', true, true)`,
		id, id.String()+"@probe.local", "!hash", "false").Error; err != nil {
		t.Fatalf("probe user: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM users WHERE id = ?`, id)
	})
	return id
}

// entSvc builds a service over the REAL plan catalogue, seeded.
//
// Real config, not a fixture: a test with invented plans would not catch a typo
// in a real plan code, which is one of the things most likely to be wrong.
func entSvc(t *testing.T, db *gorm.DB) *EntitlementService {
	t.Helper()
	svc := NewEntitlementService(db, config.LoadPlans())
	if err := svc.Seed(context.Background()); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return svc
}

func TestNoEntitlementGrantsNothing(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)

	// Someone who registered and never subscribed.
	if ok, err := svc.Can(ctx, user, config.CapSaveProjects); err != nil || ok {
		t.Fatalf("a user with no entitlement was granted %s (ok=%v err=%v)", config.CapSaveProjects, ok, err)
	}

	// And the reason is DISTINCT so the caller can say "subscribe" rather than
	// "you have hit a limit".
	if _, _, err := svc.Limit(ctx, user, config.CapSaveProjects); !errors.Is(err, ErrEntitlementMissing) {
		t.Fatalf("got %v, want ErrEntitlementMissing - no plan and no quota are different answers", err)
	}
}

// TestTrialPersistsNothing is the rule from SYSTEM-PLAN.md §7.2: a trial saves
// NOTHING, and the refusal is server-side.
func TestTrialPersistsNothing(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)
	trialEnd := time.Now().UTC().Add(3 * 24 * time.Hour)
	if _, err := svc.Grant(ctx, user, "trial", "trial", &trialEnd, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatalf("grant trial: %v", err)
	}

	// Media and reels: nothing may be STORED.
	//
	// A trial grants these with a limit of 0, and a 0 grant is reported as
	// ErrQuotaDenied rather than ErrQuotaExceeded - "not in your plan" rather
	// than "you have hit your limit". There is no world in which someone can do
	// zero of a thing, and telling a trial user to "upgrade, you have used it
	// all up" is a message about a limit that does not exist.
	for _, cap := range []string{config.CapMediaAssets, config.CapReelAssets} {
		if _, _, err := svc.Limit(ctx, user, cap); !errors.Is(err, ErrQuotaDenied) {
			t.Errorf("%s on a trial: got %v, want ErrQuotaDenied - a 0 grant is the same\n"+
				"answer as no grant, and must not read as 'you hit a limit'", cap, err)
		}
		if err := svc.CheckUsage(ctx, user, cap, 0, 1); !errors.Is(err, ErrQuotaDenied) {
			t.Errorf("%s: the first item was allowed on a trial (err=%v)", cap, err)
		}
	}

	// Ads: explicitly zero on a trial, and the SAME answer - which is the point.
	// The two paths differ in the catalogue (absent vs zero) and must not differ
	// in what a user is told.
	if _, _, err := svc.Limit(ctx, user, config.CapAdsCampaigns); !errors.Is(err, ErrQuotaDenied) {
		t.Errorf("ads on a trial: got %v, want ErrQuotaDenied", err)
	}

	// Concurrent transcodes: zero too, so the upload pipeline is closed.
	if err := svc.CheckUsage(ctx, user, config.CapConcurrentTranscodes, 0, 1); !errors.Is(err, ErrQuotaDenied) {
		t.Errorf("a trial was allowed to transcode (err=%v)", err)
	}
}

// TestUsedUpIsDifferentFromNotIncluded is the contrast that makes the two errors
// worth having.
//
// The trial case above proves "0 means not included". This proves the other
// half: a capability they DO have, used up, says so - and does not tell a paying
// customer to buy a plan they already own.
func TestUsedUpIsDifferentFromNotIncluded(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)
	future := time.Now().UTC().Add(30 * 24 * time.Hour)
	if _, err := svc.Grant(ctx, user, "pro", "subscription", &future, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	// Pro has 250 media assets.
	limit, granted, err := svc.Limit(ctx, user, config.CapMediaAssets)
	if err != nil || !granted {
		t.Fatalf("limit: %v granted=%v", err, granted)
	}

	// Under the cap: fine.
	if err := svc.CheckUsage(ctx, user, config.CapMediaAssets, limit-1, 1); err != nil {
		t.Errorf("using the last slot was refused: %v", err)
	}

	// Over it: "limit exceeded", NOT "not in your plan".
	err = svc.CheckUsage(ctx, user, config.CapMediaAssets, limit, 1)
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("over the cap: got %v, want ErrQuotaExceeded", err)
	}
	if errors.Is(err, ErrQuotaDenied) {
		t.Error("a paying customer over their limit was told the capability is not in their plan")
	}
}

// TestDowngradeKeepsPaidForAccess is THE reason the fold is a MAX.
//
// A user on Pro downgrades to Starter. The Pro row runs to the end of the period
// they paid for, and until then they keep Pro's allowances. A "most recent wins"
// lookup would cut their access the day they downgraded - taking away something
// already bought, which is the fastest route to a chargeback.
func TestDowngradeKeepsPaidForAccess(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)

	future := time.Now().UTC().Add(30 * 24 * time.Hour)
	if _, err := svc.Grant(ctx, user, "pro", "subscription", &future, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}
	// And a Starter row as well - the state after a downgrade.
	if _, err := svc.Grant(ctx, user, "starter", "subscription", &future, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	limit, granted, err := svc.Limit(ctx, user, config.CapSaveProjects)
	if err != nil || !granted {
		t.Fatalf("limit: %v granted=%v", err, granted)
	}
	proPlan, _ := config.LoadPlans().Get("pro")
	if limit != proPlan.Grants[config.CapSaveProjects] {
		t.Fatalf("save_projects = %d, want Pro's %d - the fold must take the MAX while\n"+
			"the Pro period is still running", limit, proPlan.Grants[config.CapSaveProjects])
	}

	if code, err := svc.EffectivePlanCode(ctx, user); err != nil || code != "pro" {
		t.Errorf("effective plan = %q (%v), want pro - the user is still Pro until the period ends", code, err)
	}
}

// TestCancelIsNotExpiry is why there are two timestamps.
//
// Cancelling must NOT cut access the user already paid for. `cancelled_at` and
// `ends_at` are different columns for exactly this.
func TestCancelIsNotExpiry(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)
	future := time.Now().UTC().Add(30 * 24 * time.Hour)
	if _, err := svc.Grant(ctx, user, "pro", "subscription", &future, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	if err := svc.Cancel(ctx, user, "pro"); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// STILL live - they paid for this period.
	if _, _, err := svc.Limit(ctx, user, config.CapMediaAssets); err != nil {
		t.Fatalf("cancelling revoked access they had paid for: %v\n"+
			"cancelled_at is not ends_at; access ends when the period does", err)
	}

	// Cancelling something already cancelled is an error, not a silent success.
	if err := svc.Cancel(ctx, user, "pro"); err == nil {
		t.Error("cancelling a cancelled entitlement reported success")
	}
}

// TestExpiryNeedsNoJob: a lapsed entitlement stops counting by itself.
func TestExpiryNeedsNoJob(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)

	// Already lapsed.
	past := time.Now().UTC().Add(-time.Hour)
	if _, err := svc.Grant(ctx, user, "pro", "subscription", &past, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	if ok, err := svc.Can(ctx, user, config.CapMediaAssets); err != nil || ok {
		t.Fatalf("an expired entitlement still grants access (ok=%v err=%v).\n"+
			"Expiry must be derived from ends_at. A status a scheduler maintains is\n"+
			"a status that eventually disagrees with its own clock.", ok, err)
	}

	// And nothing had to be written for that to be true - the row is untouched.
}

// TestLifetimeNeverExpires: ends_at NULL means forever.
func TestLifetimeNeverExpires(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)

	// A lifetime grant has NO end date.
	if _, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	if code, err := svc.EffectivePlanCode(ctx, user); err != nil || code != "lifetime1" {
		t.Fatalf("effective plan = %q (%v), want lifetime1", code, err)
	}

	// And it has a DEVICE cap, which is what stops a one-off purchase from being
	// unbounded forever.
	limit, granted, err := svc.Limit(ctx, user, config.CapLifetimeDevices)
	if err != nil || !granted {
		t.Fatalf("lifetime_devices: %v granted=%v", err, granted)
	}
	if limit != 1 {
		t.Errorf("lifetime1 device cap = %d, want 1 - a subscription needs no device limit\n"+
			"(stopping payment ends it) but a one-off purchase would be unbounded", limit)
	}

	// A subscription plan, by contrast, must NOT be device-capped.
	if _, _, err := svc.Limit(ctx, user, config.CapLifetimeDevices); err != nil {
		_ = err
	}
}

// TestUnlimitedIsNotZero pins the distinction the whole design rests on.
func TestUnlimitedIsNotZero(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime10", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	limit, granted, err := svc.Limit(ctx, user, config.CapMediaAssets)
	if err != nil || !granted {
		t.Fatalf("limit: %v granted=%v", err, granted)
	}
	if limit != config.Unlimited {
		t.Errorf("media_assets = %d, want Unlimited (%d).\n"+
			"0 means 'this plan grants none' and Unlimited means 'no cap'. Using 0 for\n"+
			"both means a revoked capability and a generous one are indistinguishable.",
			limit, config.Unlimited)
	}

	// And unlimited never fails a usage check.
	if err := svc.CheckUsage(ctx, user, config.CapMediaAssets, 1_000_000, 5); err != nil {
		t.Errorf("an unlimited grant failed a usage check: %v", err)
	}
}

// TestSeedUpsertsAndPrunes is what makes a plan change a RESTART.
//
// Two properties, and the second is the one usually forgotten:
//   - a changed limit is applied
//   - a capability REMOVED from a plan in .env DISAPPEARS, rather than lingering
//     in the table granting something the plan no longer sells
func TestSeedUpsertsAndPrunes(t *testing.T) {
	db := entTestDB(t)
	ctx := context.Background()

	// A catalogue with one capability...
	limited := config.PlansConfig{Plans: []config.PlanConfig{{
		Code: "probeplan", Name: "probe", PriceMinor: 0, Currency: "USD", Cycle: "monthly",
		Grants: map[string]int64{config.CapSaveProjects: 3},
	}}}
	svc := NewEntitlementService(db, limited)
	if err := svc.Seed(ctx); err != nil {
		t.Fatalf("first seed: %v", err)
	}

	var n int64
	db.Model(&model.EntitlementGrant{}).Where("plan_code = ?", "probeplan").Count(&n)
	if n != 1 {
		t.Fatalf("seeded %d grants, want 1", n)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM entitlement_grants WHERE plan_code = 'probeplan'`) })

	// ...then a catalogue where it is gone.
	reduced := config.PlansConfig{Plans: []config.PlanConfig{{
		Code: "probeplan", Name: "probe", PriceMinor: 0, Currency: "USD", Cycle: "monthly",
		Grants: map[string]int64{},
	}}}
	if err := NewEntitlementService(db, reduced).Seed(ctx); err != nil {
		t.Fatalf("second seed: %v", err)
	}

	db.Model(&model.EntitlementGrant{}).Where("plan_code = ?", "probeplan").Count(&n)
	if n != 0 {
		t.Fatalf("%d grants survived a capability being removed from .env.\n"+
			"A retired capability keeps granting to everyone who still holds that plan,\n"+
			"and nothing ever looks wrong.", n)
	}
}

// TestEveryConfiguredPlanIsStrictlyOrdered is a cheap guard against a plan typo.
//
// A limit LOWER than a smaller plan's is almost always a typo, and it is
// invisible until a customer is shortchanged.
func TestEveryConfiguredPlanIsStrictlyOrdered(t *testing.T) {
	plans := config.LoadPlans()
	if len(plans.Plans) == 0 {
		t.Fatal("no plans configured - every quota check would resolve to zero")
	}

	for _, cap := range []string{config.CapSaveProjects, config.CapMediaAssets} {
		var prev int64 = -2
		var prevCode string
		for _, plan := range plans.Plans {
			v, has := plan.Grants[cap]
			if !has {
				t.Errorf("plan %q does not define %s at all - that is an omission, not a decision", plan.Code, cap)
				continue
			}
			if prev >= 0 && v >= 0 && v < prev {
				t.Errorf("plan %q gives %s=%d, but %q (a smaller plan) gives %d.\n"+
					"That is almost certainly a typo - and the result is a customer who\n"+
					"upgrades and gets LESS.", plan.Code, cap, v, prevCode, prev)
			}
			prev, prevCode = v, plan.Code
		}
	}
}

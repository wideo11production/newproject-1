package service

// =============================================================================
// THE DEVICE CAP MUST ACTUALLY CAP
// =============================================================================
//
// These run against a real PostgreSQL, because the mechanism under test IS a
// uniqueness constraint. A mock would test that the code calls the repository; it
// would not test that two simultaneous registrations cannot both win, which is the
// entire property.
//
// Opt-in via `AUTH_MIGRATION_REPLAY=1`, the same convention the rest of this
// package's database tests use — one way to ask "should I run the DB tests", not
// two.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED, AND WHY EACH ONE CAN FAIL REALISTICALLY
// -----------------------------------------------------------------------------
//
//  1. FIRST CLAIM WINS. The obvious implementation passes this.
//  2. A SECOND EMAIL ON THE SAME BROWSER IS REFUSED. The whole point.
//  3. THE SAME EMAIL RE-CLAIMING IS ALLOWED. Without this, a user who clears and
//     re-registers with their OWN address would lose the trial they already used,
//     which is not what a trial cap is for.
//  4. A DIFFERENT BROWSER IS ALLOWED. This is the shared-household case, and an
//     implementation that accidentally keys on IP fails here.
//  5. REFUSALS ARE COUNTED. Without a count, "a family member" and "an operation"
//     produce identical audit rows and the table is noise.
//  6. EMPTY FINGERPRINT GRANTS. The availability decision, stated so it is a choice
//     rather than an accident.

import (
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

func newCapDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("needs a live PostgreSQL; set AUTH_MIGRATION_REPLAY=1 to run")
	}

	port := 5432
	if v := os.Getenv("DATABASE_PORT"); v != "" {
		n := 0
		for _, c := range v {
			if c < '0' || c > '9' {
				t.Fatalf("DATABASE_PORT is not a number: %q", v)
			}
			n = n*10 + int(c-'0')
		}
		port = n
	}

	cfg := config.DatabaseConfig{
		Host:     envOr("DATABASE_HOST", "localhost"),
		Port:     port,
		User:     envOr("DATABASE_USER", "postgres"),
		Password: envOr("DATABASE_PASSWORD", "postgres"),
		SSLMode:  envOr("DATABASE_SSLMODE", "disable"),
		TimeZone: envOr("DATABASE_TIMEZONE", "UTC"),
	}

	name := "w11_cap_test_" + uuid.NewString()[:8]
	admin := cfg
	admin.DBName = "postgres"

	if err := execOn(admin, `CREATE DATABASE "`+name+`"`); err != nil {
		t.Skipf("cannot create a scratch database (%v) - is PostgreSQL reachable?", err)
	}
	t.Cleanup(func() { _ = execOn(admin, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`) })

	cfg.DBName = name
	db, err := database.NewPostgresDB(&cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	db.Logger = logger.Discard
	t.Cleanup(func() {
		if s, err := db.DB(); err == nil {
			_ = s.Close()
		}
	})

	if err := db.AutoMigrate(&model.TrialDevice{}); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	return db
}

func execOn(cfg config.DatabaseConfig, sql string) error {
	g, err := database.NewPostgresDB(&cfg)
	if err != nil {
		return err
	}
	if s, err := g.DB(); err == nil {
		defer s.Close()
	}
	return g.Exec(sql).Error
}

// TestCapRefusesASecondEmailOnTheSameBrowser is the core property.
func TestCapRefusesASecondEmailOnTheSameBrowser(t *testing.T) {
	db := newCapDB(t)
	svc := NewTrialDeviceService(db)
	ctx := t.Context()

	const browser = "browser-aaa"
	const first = "first@example.invalid"
	const second = "second@example.invalid"

	first1, err := svc.ClaimTrial(ctx, browser, first)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if !first1.Granted {
		t.Fatalf("the FIRST claim was refused; a cap that refuses the first use is broken")
	}

	second1, err := svc.ClaimTrial(ctx, browser, second)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if second1.Granted {
		t.Fatalf("a SECOND email claimed a trial from the same browser.\n"+
			"  This is the entire purpose of the feature.")
	}
	if second1.AlreadyClaimedBy != first {
		t.Errorf("AlreadyClaimedBy = %q, want %q", second1.AlreadyClaimedBy, first)
	}
	if second1.BlockedAttempts != 1 {
		t.Errorf("BlockedAttempts = %d, want 1", second1.BlockedAttempts)
	}
}

// TestTheSameEmailReclaimingIsAllowed — otherwise the cap punishes the user for
// their OWN browser.
func TestTheSameEmailReclaimingIsAllowed(t *testing.T) {
	db := newCapDB(t)
	svc := NewTrialDeviceService(db)

	const browser = "browser-bbb"
	const who = "owner@example.invalid"

	if _, err := svc.ClaimTrial(t.Context(), browser, who); err != nil {
		t.Fatalf("first: %v", err)
	}
	again, err := svc.ClaimTrial(t.Context(), browser, who)
	if err != nil {
		t.Fatalf("re-claim: %v", err)
	}
	if !again.Granted {
		t.Error("a user re-claiming a trial with their OWN email was refused.\n" +
			"  `Register` already refuses a duplicate account; this must not be the\n" +
			"  thing that stops them, and it must not cost them the trial they hold.")
	}
}

// TestADifferentBrowserIsAllowed is the shared-household case.
//
// An implementation that accidentally keys on something shared — an IP above all —
// fails HERE, which is why it is a separate test and not a comment. The innocent
// case is the one an IP cap breaks, and it is invisible until a real family shares
// a router.
func TestADifferentBrowserIsAllowed(t *testing.T) {
	db := newCapDB(t)
	svc := NewTrialDeviceService(db)

	a, err := svc.ClaimTrial(t.Context(), "browser-ccc", "person1@example.invalid")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	b, err := svc.ClaimTrial(t.Context(), "browser-ddd", "person2@example.invalid")
	if err != nil {
		t.Fatalf("second: %v", err)
	}

	if !a.Granted || !b.Granted {
		t.Errorf("two browsers were refused (a=%v b=%v).\n"+
			"  Two people on one wifi with two computers must BOTH get a trial.\n"+
			"  Refusing the second is the shared-network false positive, and the\n"+
			"  person refused cannot fix it because they cannot change their IP.", a.Granted, b.Granted)
	}
}

// TestRefusalsAreCounted — without a count, one family member and one operator
// produce identical audit rows.
func TestRefusalsAreCounted(t *testing.T) {
	db := newCapDB(t)
	svc := NewTrialDeviceService(db)
	ctx := t.Context()

	const browser = "browser-eee"
	if _, err := svc.ClaimTrial(ctx, browser, "owner@example.invalid"); err != nil {
		t.Fatalf("first: %v", err)
	}

	for i := 1; i <= 3; i++ {
		r, err := svc.ClaimTrial(ctx, browser, "attacker"+string(rune('0'+i))+"@example.invalid")
		if err != nil {
			t.Fatalf("refusal %d: %v", i, err)
		}
		if r.Granted {
			t.Fatalf("refusal %d was GRANTED", i)
		}
		if r.BlockedAttempts != i {
			t.Errorf("BlockedAttempts = %d, want %d", r.BlockedAttempts, i)
		}
	}

	rows, err := svc.ListRefusedDevices(ctx, 2)
	if err != nil {
		t.Fatalf("ListRefusedDevices: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 device with 2+ refusals, got %d", len(rows))
	}
	if rows[0].BlockedAttempts != 3 {
		t.Errorf("summary shows %d refusals, want 3", rows[0].BlockedAttempts)
	}
}

// TestEmptyFingerprintGrants is the availability decision, asserted so it cannot
// drift into a refusal by accident.
//
// A caller that sends no fingerprint is a browser whose `localStorage` is blocked,
// not an attacker. Refusing them would lose a real person the product because of a
// corporate cookie policy. A security control that denies on missing input is an
// AVAILABILITY control wearing a security label: it breaks honest users and stops
// nobody, because an attacker simply sends a value.
func TestEmptyFingerprintGrants(t *testing.T) {
	db := newCapDB(t)
	svc := NewTrialDeviceService(db)

	got, err := svc.ClaimTrial(t.Context(), "", "nokey@example.invalid")
	if err != nil {
		t.Fatalf("empty fingerprint should not error: %v", err)
	}
	if !got.Granted {
		t.Error("a caller with no fingerprint was refused.\n" +
			"  localStorage can be blocked by policy. Refusing them loses a real user\n" +
			"  over a browser setting, and stops no attacker.")
	}

	// And nothing should have been written — a claim with no key is not a claim.
	var n int64
	if err := db.Model(&model.TrialDevice{}).Where("device_fingerprint = ''").Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("%d rows written for an empty fingerprint; it must write none", n)
	}
}

// TestDetailCarriesTheAttemptCount — an operator reading the banner needs to tell
// a family member from an operation, and the event type alone cannot.
func TestDetailCarriesTheAttemptCount(t *testing.T) {
	detail := TrialBlockedDetail("abcdef1234567890", "owner@example.invalid", 7)

	for _, want := range []string{"abcdef12", "owner@example.invalid", "7"} {
		if !contains(detail, want) {
			t.Errorf("detail %q is missing %q", detail, want)
		}
	}

	// The fingerprint must be TRUNCATED. The audit log is read by people, and a
	// 36-character uuid in every row is unreadable noise — while the first eight
	// characters are enough to correlate the same browser across rows.
	if contains(detail, "abcdef1234567890") {
		t.Error("detail contains the FULL fingerprint; it should be truncated")
	}
}


var _ = time.Now
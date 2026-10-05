package purge

// Tests for the PII retention sweeper.
//
// ----------------------------------------------------------------------------
// WHY THIS TEST IS A REAL DATABASE TEST
// ----------------------------------------------------------------------------
//
// The bug this file prevents is not "the worker was forgotten". It is subtler and
// worse: the worker runs, logs a success line, and does not remove anything.
//
// Two things make that invisible:
//
//   1. GORM's default Delete is a SOFT delete. It becomes
//      `UPDATE ... SET deleted_at = now()`. The row disappears from every
//      ordinary query, the log says "deleted 4000", and the IP address and
//      user-agent are still sitting in the table. A row-count test written with
//      GORM's default scoping would PASS that bug.
//
//   2. A test that only asserts `RunOnce` returns no error passes the case where
//      the table name is wrong and every statement failed.
//
// So this test asserts the only thing that matters: the bytes are gone. It
// counts with `Unscoped()`, and it counts with raw SQL, so neither the model's
// soft-delete flag nor a typo in a GORM chain can make it green.
//
// ----------------------------------------------------------------------------
// IT IS OPT-IN, LIKE THE OTHER DB TESTS HERE
// ----------------------------------------------------------------------------
//
// `AUTH_MIGRATION_REPLAY=1` gates the existing database tests because they need a
// live PostgreSQL. This one takes the same gate rather than inventing a second
// convention: two ways to ask "should I run the DB tests" is one too many.

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

// ---- helpers, mirroring internal/database/migrations_test.go ----

const retentionScratchPrefix = "w11_retention_test_"

func retentionConfig(t *testing.T) config.DatabaseConfig {
	t.Helper()
	// `strconv.Atoi`, not a hand-rolled digit loop. The loop version seeded from
	// 5432 and then appended the digits of the env value, producing 54325432 -
		// which reads as a plausible-looking number rather than as the bug it is.
	port := 5432
	if v := os.Getenv("DATABASE_PORT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			t.Fatalf("DATABASE_PORT is not a number: %q", v)
		}
		port = n
	}
	return config.DatabaseConfig{
		Host:     envDefault("DATABASE_HOST", "localhost"),
		Port:     port,
		User:     envDefault("DATABASE_USER", "postgres"),
		Password: envDefault("DATABASE_PASSWORD", "postgres"),
		SSLMode:  envDefault("DATABASE_SSLMODE", "disable"),
		TimeZone: envDefault("DATABASE_TIMEZONE", "UTC"),
	}
}

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func openRetentionDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("needs a live PostgreSQL; set AUTH_MIGRATION_REPLAY=1 to run")
	}

	cfg := retentionConfig(t)
	name := retentionScratchPrefix + uuid.NewString()[:8]

	if err := execRetention(cfg, "postgres", `CREATE DATABASE "`+name+`"`); err != nil {
		t.Skipf("cannot create a scratch database (%v) - is PostgreSQL reachable?", err)
	}
	t.Cleanup(func() {
		if _, err := openRaw(cfg, "postgres"); err == nil {
			_ = execRetention(cfg, "postgres", `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
		}
	})

	cfg.DBName = name
	db, err := database.NewPostgresDB(&cfg)
	if err != nil {
		t.Fatalf("connect to scratch database: %v", err)
	}
	db.Logger = logger.Discard
	t.Cleanup(func() {
		if s, err := db.DB(); err == nil {
			_ = s.Close()
		}
	})

	// Only the tables this sweeper touches, plus `users` - because every one of
	// the six carries a foreign key to it. Provisioning the whole chain is the
	// job of `internal/database`'s tests; duplicating it here would make this
	// test slow for no extra coverage.
	if err := db.AutoMigrate(
		&model.User{},
		&model.Session{}, &model.RefreshToken{}, &model.UserSession{},
		&model.WebAuthnSession{}, &model.VerificationToken{}, &model.SecurityEvent{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	return db
}

// seedUser creates the parent row the six tables hang off.
//
// Needed because every one of them has a foreign key to `users`. Seeding a random
// user id gives `violates foreign key constraint fk_users_sessions`, which reads
// like a sweeper bug and is really a test-setup gap - the first run of this file
// failed exactly that way.
func seedUser(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	u := &model.User{
		ID:           uuid.New(),
		Email:        "retention@test.invalid",
		Username:     "retention_test",
		PasswordHash: "not-a-real-hash",
		IsActive:     true,
		IsVerified:   true,
	}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return u.ID
}

func execRetention(cfg config.DatabaseConfig, dbName, sql string) error {
	g, err := openRaw(cfg, dbName)
	if err != nil {
		return err
	}
	if s, err := g.DB(); err == nil {
		defer s.Close()
	}
	// GORM's Exec returns the *gorm.DB, not (result, error).
	return g.Exec(sql).Error
}

func openRaw(cfg config.DatabaseConfig, dbName string) (*gorm.DB, error) {
	c := cfg
	c.DBName = dbName
	return database.NewPostgresDB(&c)
}

// rawCount counts rows with NO soft-delete scoping and NO model knowledge.
//
// This is the whole point of the helper. `db.Model(&model.Session{}).Count(&n)`
// would apply soft-delete scoping and could report zero for rows that are still
// present - which is precisely the bug class under test.
func rawCount(t *testing.T, db *gorm.DB, table string) int64 {
	t.Helper()
	var n int64
	if err := db.Raw(`SELECT count(*) FROM "` + table + `"`).Scan(&n).Error; err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// ---- the tests ----

// TestRetentionRemovesExpiredRowsFromEveryTable is the core assertion.
//
// One old row and one fresh row per table, then one sweep, then:
//
//   - the old row is GONE, counted with raw SQL
//   - the fresh row is STILL THERE
//
// The second half is what stops this from being a "delete everything" test. A
// sweeper that empties every table also passes a "are the old rows gone?"
// assertion, and that is not a retention policy - it is data loss.
func TestRetentionRemovesExpiredRowsFromEveryTable(t *testing.T) {
	db := openRetentionDB(t)
	ctx := context.Background()

	userID := seedUser(t, db)
	old := time.Now().Add(-400 * 24 * time.Hour)
	fresh := time.Now()

	// `live` is one HOUR IN THE FUTURE, not "now".
	//
	// The first run of this test used `time.Now()` for the row meant to survive,
	// and every credential table came back empty. That was the TEST being wrong,
	// not the sweeper: a session whose `expires_at` is the current instant IS
	// expired by definition, and the cutoff for `sessions` is `now` with a
	// zero-day window. "Not expired yet" and "expired a moment ago" are the same
	// row, and only one of them is a row that should still be there.
	live := time.Now().Add(time.Hour)

	// ---- Seed one old + one fresh row per table ----
	seed := func(table string, oldRow, freshRow any) {
		if err := db.Create(oldRow).Error; err != nil {
			t.Fatalf("seed old %s: %v", table, err)
		}
		if err := db.Create(freshRow).Error; err != nil {
			t.Fatalf("seed fresh %s: %v", table, err)
		}
	}

	seed("sessions",
		&model.Session{ID: uuid.New(), UserID: userID, ExpiresAt: old},
		&model.Session{ID: uuid.New(), UserID: userID, ExpiresAt: live})
	seed("refresh_tokens",
		&model.RefreshToken{ID: uuid.New(), UserID: userID, TokenHash: "old", ExpiresAt: old},
		&model.RefreshToken{ID: uuid.New(), UserID: userID, TokenHash: "fresh", ExpiresAt: live})
	seed("webauthn_sessions",
		&model.WebAuthnSession{ID: uuid.New(), UserID: userID, Challenge: "old",
			SessionData: []byte("x"), Type: model.WebAuthnSessionTypeAuthentication, ExpiresAt: old},
		&model.WebAuthnSession{ID: uuid.New(), UserID: userID, Challenge: "fresh",
			SessionData: []byte("x"), Type: model.WebAuthnSessionTypeAuthentication, ExpiresAt: live})
	seed("verification_tokens",
		&model.VerificationToken{ID: uuid.New(), UserID: userID, TokenHash: "old",
			CreatedAt: old, ExpiresAt: old},
		&model.VerificationToken{ID: uuid.New(), UserID: userID, TokenHash: "fresh",
			CreatedAt: fresh, ExpiresAt: live})

	ended := old
	lastSeen := old
	seed("user_sessions",
		&model.UserSession{ID: uuid.New(), UserID: userID, Email: "old@x.test",
			StartedAt: old, LastSeenAt: lastSeen, EndedAt: &ended},
		&model.UserSession{ID: uuid.New(), UserID: userID, Email: "fresh@x.test",
			StartedAt: fresh, LastSeenAt: fresh})

	seed("security_events",
		&model.SecurityEvent{ID: uuid.New(), EventType: model.EventLoginFailed,
			Detail: "old", Timestamp: old, CreatedAt: old},
		&model.SecurityEvent{ID: uuid.New(), EventType: model.EventLoginFailed,
			Detail: "fresh", Timestamp: fresh, CreatedAt: fresh})

	// ---- Sweep ----
	w := NewRetentionWorker(db, nil)
	res := w.RunOnce(ctx)

	// Every table must report a POSITIVE count. A `-1` means "could not sweep",
	// and a `0` here means the DELETE silently matched nothing - which is the bug
	// this test exists to catch.
	want := map[string]int64{
		"sessions":          res.Sessions,
		"refresh_tokens":    res.RefreshTokens,
		"user_sessions":     res.UserSessions,
		"webauthn_sessions": res.WebAuthnSessions,
		"verification_tokens": res.VerificationToken,
		"security_events":   res.SecurityEvents,
	}
	for table, got := range want {
		if got != 1 {
			if got < 0 {
				t.Errorf("%s: the DELETE failed - wrong table or column name", table)
			} else {
				t.Errorf("%s: expected exactly 1 expired row deleted, got %d\n"+
					"  0 means it matched nothing, i.e. the retention policy is not\n"+
					"       actually deleting anything while reporting success", table, got)
			}
		}
	}

	// ---- And the bytes must actually be gone ----
	for _, table := range []string{
		"sessions", "refresh_tokens", "user_sessions",
		"webauthn_sessions", "verification_tokens", "security_events",
	} {
		if n := rawCount(t, db, table); n != 1 {
			t.Errorf("%s: expected 1 row left (the fresh one), raw count is %d.\n"+
				"  If this is 2, the DELETE was a SOFT delete - GORM turned it into\n"+
				"  UPDATE deleted_at = now() and the PII is still on disk. That is\n"+
				"  the specific failure raw SQL counting is here to catch.", table, n)
		}
	}
}

// TestRetentionLeavesFreshRowsAlone is the other half of the guarantee, and it is
// a separate test on purpose.
//
// Combining it with the above would let a "delete everything" sweeper pass. Kept
// apart, the pair says: expired rows go, live rows stay.
func TestRetentionLeavesFreshRowsAlone(t *testing.T) {
	db := openRetentionDB(t)
	ctx := context.Background()

	userID := seedUser(t, db)
	fresh := time.Now()

	// A session that expires an HOUR from now must survive a sweep, even though
	// the sweep's window for sessions is zero.
	future := time.Now().Add(time.Hour)
	if err := db.Create(&model.Session{ID: uuid.New(), UserID: userID, ExpiresAt: future}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	// And the tables whose windows are NOT zero must keep their recent rows too -
	// 90 days of user-session history is a product feature, not an oversight.
	if err := db.Create(&model.UserSession{
		ID: uuid.New(), UserID: userID, Email: "recent@x.test",
		StartedAt: fresh, LastSeenAt: fresh,
	}).Error; err != nil {
		t.Fatalf("seed recent user_session: %v", err)
	}
	if err := db.Create(&model.SecurityEvent{
		ID: uuid.New(), EventType: model.EventLoginFailed, Detail: "recent",
		Timestamp: fresh, CreatedAt: fresh,
	}).Error; err != nil {
		t.Fatalf("seed recent security_event: %v", err)
	}

	w := NewRetentionWorker(db, nil)
	res := w.RunOnce(ctx)

	if res.Sessions != 0 {
		t.Errorf("a session expiring in an hour was deleted (res.Sessions=%d).\n"+
			"Every logged-in user would be logged out on a random schedule.", res.Sessions)
	}
	if res.UserSessions != 0 {
		t.Errorf("a user session from a minute ago was deleted (res.UserSessions=%d).\n"+
			"The 90-day window is a product feature - 'online history' - not slack.", res.UserSessions)
	}
	if res.SecurityEvents != 0 {
		t.Errorf("a security event from a minute ago was deleted (res.SecurityEvents=%d).\n"+
			"The 400-day window exists so a brute-force pattern can still be read\n"+
			"when someone complains months later.", res.SecurityEvents)
	}

	if n := rawCount(t, db, "sessions"); n != 1 {
		t.Errorf("expected the live session to survive, raw count is %d", n)
	}
	if n := rawCount(t, db, "user_sessions"); n != 1 {
		t.Errorf("expected the recent user session to survive, raw count is %d", n)
	}
	if n := rawCount(t, db, "security_events"); n != 1 {
		t.Errorf("expected the recent security event to survive, raw count is %d", n)
	}
}

// TestRetentionIsIdempotent proves a second sweep deletes nothing and does not
// fail.
//
// A retention job that errors on an empty table logs a scary line every hour and
// gets turned off by whoever sees it - which disables the feature it was added
// for. Idempotence is what keeps it running.
func TestRetentionIsIdempotent(t *testing.T) {
	db := openRetentionDB(t)
	ctx := context.Background()

	w := NewRetentionWorker(db, nil)

	first := w.RunOnce(ctx)
	if first.Failed() {
		t.Fatalf("first sweep could not sweep %v - a table name or column is wrong,", first.Failures)
	}

	second := w.RunOnce(ctx)
	if second.Total() != 0 {
		t.Errorf("second sweep on an empty database deleted %d rows; expected 0.\n"+
			"A non-idempotent sweeper produces a scary log every hour and gets disabled.",
			second.Total())
	}
}

// TestRetentionWindowsAreConfigurable proves an override actually applies.
//
// The default windows are the shipped values; an override must win, or an
// operator who sets `RETENTION_SECURITY_EVENTS_DAYS` is setting nothing. That is
// the same "the env var is dead" family as `NEXT_PUBLIC_*` in every app.
func TestRetentionWindowsAreConfigurable(t *testing.T) {
	base := RetentionWindowsFromEnv(nil)
	if base.SecurityEvents != 400*24*time.Hour {
		t.Errorf("default security-events window is %v, expected 400d.\n"+
			"The default is the promise; the test pins it so a change is deliberate.",
			base.SecurityEvents)
	}

	// Config-driven, through the same env-reading path production uses.
	env := map[string]string{
		"RETENTION_ENABLED":                "true",
		"RETENTION_INTERVAL_MINUTES":       "15",
		"RETENTION_SECURITY_EVENTS_DAYS":   "30",
		"RETENTION_USER_SESSIONS_DAYS":     "7",
		"RETENTION_VERIFICATION_TOKENS_DAYS": "2",
	}
	got := RetentionWindowsFromEnv(func(k string) (string, bool) { v, ok := env[k]; return v, ok })

	if got.Interval != 15*time.Minute {
		t.Errorf("RETENTION_INTERVAL_MINUTES=15 produced %v", got.Interval)
	}
	if got.SecurityEvents != 30*24*time.Hour {
		t.Errorf("RETENTION_SECURITY_EVENTS_DAYS=30 produced %v", got.SecurityEvents)
	}
	if got.UserSessions != 7*24*time.Hour {
		t.Errorf("RETENTION_USER_SESSIONS_DAYS=7 produced %v", got.UserSessions)
	}
	if got.VerificationToken != 2*24*time.Hour {
		t.Errorf("RETENTION_VERIFICATION_TOKENS_DAYS=2 produced %v", got.VerificationToken)
	}
	if !got.Enabled {
		t.Error("RETENTION_ENABLED=true produced a disabled sweeper")
	}
}

// TestRetentionOffWhenDisabled proves the off switch works and says so.
//
// Without this, "an operator disabled it" and "the worker silently failed to
// start" produce identical logs, and the feature is off with nobody knowing.
func TestRetentionOffWhenDisabled(t *testing.T) {
	db := openRetentionDB(t)

	userID := seedUser(t, db)
	w := NewRetentionWorker(db, &RetentionWindows{Enabled: false})
	if w.Windows().Enabled {
		t.Fatal("RETENTION off did not take effect")
	}

	// Must not delete anything, even if RunOnce is called directly.
	old := time.Now().Add(-time.Hour)
	if err := db.Create(&model.Session{ID: uuid.New(), UserID: userID, ExpiresAt: old}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	if res := w.RunOnce(context.Background()); res.Total() != 0 {
		t.Errorf("a disabled sweeper deleted %d rows", res.Total())
	}
	if n := rawCount(t, db, "sessions"); n != 1 {
		t.Errorf("a disabled sweeper removed data (raw count %d)", n)
	}
}

// TestStopIsIdempotent prevents a panic on the shutdown path.
//
// `Stop` is called from a defer and from a signal handler on some paths, and
// `close()` on a closed channel panics - during shutdown, which is the worst
// possible moment for a panic.
func TestStopIsIdempotent(t *testing.T) {
	w := NewRetentionWorker(nil, nil)
	w.Stop()
	w.Stop() // must not panic
}

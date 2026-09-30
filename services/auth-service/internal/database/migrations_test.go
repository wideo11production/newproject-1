// Package database_test verifies that the SQL migration chain in
// ../../migrations replays cleanly and idempotently on PostgreSQL.
//
// WHY THIS EXISTS
//
// This repo has no migration runner. Files are applied by hand with
// `psql -f`, on top of whatever GORM's AutoMigrate already created. That
// combination is easy to break silently: a single file can start failing
// (or, worse, succeed with the wrong shape) and nothing notices until a
// fresh environment is provisioned and the whole chain aborts halfway.
//
// The failure this test was written for: migrations 003, 004, 005, 009 and
// 010 contained SQL Server syntax (IF COL_LENGTH, dbo., CURSOR, GO,
// sys.sp_addextendedproperty, GETDATE()). None of it runs on PostgreSQL.
// Each had been applied by hand years earlier against a SQL Server origin,
// so the files looked fine but had never executed here. A from-scratch
// deploy would have died at 003.
//
// WHAT IT CHECKS
//
//  1. Every .sql file in ../../migrations parses and applies, in filename
//     order, on a database built by AutoMigrate - the same order the
//     service itself uses at startup.
//  2. Applying the whole chain a SECOND time changes nothing. Every file
//     must be idempotent, because re-running `psql -f` is routine here.
//  3. The specific guarantees migrations are supposed to provide survive -
//     the CHECK constraints, the partial index predicate, the trigger, and
//     the NOT NULL column that GORM alone will not create.
//
// HOW TO RUN
//
//	$env:AUTH_MIGRATION_REPLAY = "1"
//	go test ./internal/database/ -run TestMigrationChainReplays -v
//
// It is skipped by default: it needs a live PostgreSQL and it creates and
// drops a scratch database. Set AUTH_MIGRATION_REPLAY=1 to enable it. The
// connection is taken from the same DATABASE_* variables the service uses,
// so CI and local runs configure it identically.
package database_test

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

// scratchDBPrefix marks the throwaway database this test creates. Anything
// without this prefix is refused as a drop target, so a misconfigured
// DATABASE_DBNAME can never cause a real database to be dropped.
const scratchDBPrefix = "auth_migration_replay_"

func TestMigrationChainReplays(t *testing.T) {
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("set AUTH_MIGRATION_REPLAY=1 to run (needs a live PostgreSQL; creates and drops a scratch database)")
	}

	cfg := testConfig(t)
	scratch := scratchDBPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")

	// Cleanups run last-registered-first, so registering the drop before the
	// pool close means the pool is always released before DROP DATABASE runs.
	// DROP DATABASE fails while any session is attached, and GORM keeps
	// connections pooled for the life of the test.
	createScratch(t, cfg, scratch)
	t.Cleanup(func() { dropScratch(t, cfg, scratch) })

	db := connect(t, cfg, scratch)

	// Step 1 - AutoMigrate first. This is the real startup order: the
	// service migrates its GORM models before any .sql file is applied by
	// hand, so the SQL chain is authored against this shape.
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("AutoMigrate on the scratch database: %v", err)
	}

	files := migrationFiles(t)

	// Step 2 - first pass. Every file must apply.
	applyAll(t, db, files)

	// Step 3 - second pass. Every file must be a no-op. A failure here
	// means someone wrote a non-idempotent statement, which is the exact
	// bug class that made this test necessary.
	applyAll(t, db, files)

	// Step 4 - the guarantees must actually be in place.
	assertChainEffects(t, db)
}

func testConfig(t *testing.T) config.DatabaseConfig {
	t.Helper()

	return config.DatabaseConfig{
		Host:     envOr("DATABASE_HOST", "localhost"),
		Port:     envInt("DATABASE_PORT", 5432),
		User:     envOr("DATABASE_USER", "postgres"),
		Password: envOr("DATABASE_PASSWORD", "postgres"),
		SSLMode:  envOr("DATABASE_SSLMODE", "disable"),
		TimeZone: envOr("DATABASE_TIMEZONE", "UTC"),
	}
}

func connect(t *testing.T, cfg config.DatabaseConfig, dbName string) *gorm.DB {
	t.Helper()

	cfg.DBName = dbName
	g, err := database.NewPostgresDB(&cfg)
	if err != nil {
		t.Fatalf("connect to %s/%s: %v", cfg.Host, dbName, err)
	}
	// Migration replay is not a runtime path; keep the log quiet.
	g.Logger = logger.Discard

	t.Cleanup(func() {
		if sqlDB, err := g.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return g
}

func createScratch(t *testing.T, cfg config.DatabaseConfig, name string) {
	t.Helper()
	if !strings.HasPrefix(name, scratchDBPrefix) {
		t.Fatalf("refusing to create %q: missing %q prefix", name, scratchDBPrefix)
	}
	if err := execOn(cfg, "postgres", `CREATE DATABASE `+quoteIdent(name)); err != nil {
		t.Fatalf("create scratch database: %v", err)
	}
}

func dropScratch(t *testing.T, cfg config.DatabaseConfig, name string) {
	t.Helper()
	if !strings.HasPrefix(name, scratchDBPrefix) {
		// Refuse rather than drop. Reaching here means a bug in this file,
		// and a typo'd DATABASE_DBNAME must not be able to destroy data.
		t.Errorf("refusing to drop %q: missing %q prefix", name, scratchDBPrefix)
		return
	}
	if err := execOn(cfg, "postgres", `DROP DATABASE IF EXISTS `+quoteIdent(name)); err != nil {
		t.Errorf("drop scratch database %s: %v", name, err)
	}
}

// execOn runs one statement against a named database over a fresh connection
// that is closed immediately. CREATE DATABASE and DROP DATABASE must not go
// through the shared pool, and DROP in particular must run after the pool is
// gone.
func execOn(cfg config.DatabaseConfig, dbName, stmt string) error {
	cfg.DBName = dbName
	db, err := database.NewPostgresDB(&cfg)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	return db.Exec(stmt).Error
}

func migrationFiles(t *testing.T) []string {
	t.Helper()

	dir := filepath.Join("..", "..", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	if len(files) == 0 {
		t.Fatalf("no .sql files found in %s", dir)
	}

	// Filename order is the apply order - the zero-padded prefix is what
	// makes it unambiguous.
	sort.Strings(files)
	return files
}

func applyAll(t *testing.T, db *gorm.DB, files []string) {
	t.Helper()

	for _, name := range files {
		path := filepath.Join("..", "..", "migrations", name)
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		exec(t, db, string(raw))
	}
}

// assertChainEffects checks the guarantees the chain exists to provide.
//
// GORM's AutoMigrate will not create any of these on its own, so a chain
// that silently stopped applying them would still leave a service that
// starts, passes its unit tests, and is quietly missing its constraints.
func assertChainEffects(t *testing.T, db *gorm.DB) {
	t.Helper()

	// 001 / 011 - updated_at is maintained by a trigger, for every table
	// that has one.
	for _, tc := range []struct{ table, trigger string }{
		{"users", "update_users_updated_at"},
		{"channels", "trg_channels_updated_at"},
	} {
		var n int64
		scanOne(t, db, `SELECT count(*) FROM pg_trigger
		                WHERE tgrelid = ?::regclass AND tgname = ? AND NOT tgisinternal`,
			&n, tc.table, tc.trigger)
		if n != 1 {
			t.Errorf("trigger %s on %s: found %d, want 1", tc.trigger, tc.table, n)
		}
	}

	// 005 / 011 - channel CHECK constraints.
	for _, name := range []string{
		"ch_handle_format",
		"ch_display_name_len",
		"ch_description_len",
		"ch_cover_url_len",
	} {
		var n int64
		scanOne(t, db, `SELECT count(*) FROM pg_constraint
		                WHERE conrelid = 'channels'::regclass AND conname = ?`, &n, name)
		if n != 1 {
			t.Errorf("constraint %s on channels: found %d, want 1", name, n)
		}
	}

	// 011 - the partial index. Asserting the exact predicate matters: an
	// index built on the wrong columns still "exists", so a presence check
	// would pass while the query path it was added for stays slow. The
	// predicate must be booleans and a soft-delete check - NOT `is_deleted`
	// (no such column) and NOT `= 1` (boolean = integer does not exist in
	// PostgreSQL).
	var predicate string
	scanOne(t, db, `SELECT indexdef FROM pg_indexes
	                WHERE schemaname = 'public' AND indexname = 'idx_channels_public_handle'`,
		&predicate)
	switch {
	case predicate == "":
		t.Error("index idx_channels_public_handle: missing")
	case !strings.Contains(predicate, "deleted_at IS NULL"):
		t.Errorf("index idx_channels_public_handle: predicate does not filter soft-deleted rows: %s", predicate)
	case !strings.Contains(predicate, "is_public") || !strings.Contains(predicate, "is_active"):
		t.Errorf("index idx_channels_public_handle: predicate does not filter public+active: %s", predicate)
	case strings.Contains(predicate, "is_deleted"):
		t.Errorf("index idx_channels_public_handle: references is_deleted, which is not a column: %s", predicate)
	}

	// 011 - re-running the file must not rebuild the partial index.
	//
	// This is the failure this guards against. `CREATE INDEX` has no
	// `IF NOT EXISTS` for a PREDICATE, so the obvious implementation is
	// unconditional DROP + CREATE. On a re-run that drops the index and
	// rebuilds it from scratch - and for the duration, every /@handle public
	// page query falls back to a sequential scan because the index does not
	// exist at all. Re-running migrations with `psql -f` is routine in this
	// repo, so "routine" would mean "recurring public-site slowdown".
	//
	// The fix is the predicate guard in 011's step 3. Verified by OID: an
	// OID that survives a re-run is an OID that was never dropped.
	oidBefore := indexOID(t, db)
	applyAll(t, db, []string{"011_channel_management.sql"})
	if after := indexOID(t, db); after != oidBefore {
		t.Errorf("idx_channels_public_handle was rebuilt on re-run: OID %d -> %d. "+
			"011's predicate guard is not matching, so every re-run drops and "+
			"recreates the index, degrading public channel lookups to "+
			"sequential scans for the duration", oidBefore, after)
	}

	// ...and the guard must still REPAIR a wrong predicate. A guard that
	// only ever skips is worse than no guard: it would make a broken index
	// permanent while the file kept reporting success.
	exec(t, db, `DROP INDEX idx_channels_public_handle;
	            CREATE INDEX idx_channels_public_handle ON channels (handle)
	            WHERE is_public AND is_active`)
	applyAll(t, db, []string{"011_channel_management.sql"})
	if def := indexDef(t, db); !strings.Contains(def, "deleted_at IS NULL") {
		t.Errorf("011 did not repair a wrong index predicate: %s", def)
	}

	// 011 - description is NOT NULL, so the frontend never has to handle
	// both null and "".
	var descriptionNotNull string
	scanOne(t, db, `SELECT is_nullable FROM information_schema.columns
	                WHERE table_name = 'channels' AND column_name = 'description'`,
		&descriptionNotNull)
	if descriptionNotNull != "NO" {
		t.Errorf("channels.description is_nullable = %q, want \"NO\"", descriptionNotNull)
	}

	// 011 - cover_url exists and is nullable (NULL means "no cover set").
	var coverRows int64
	scanOne(t, db, `SELECT count(*) FROM information_schema.columns
	                WHERE table_name = 'channels' AND column_name = 'cover_url'
	                  AND is_nullable = 'YES'`, &coverRows)
	if coverRows != 1 {
		t.Error("channels.cover_url: want one nullable text column")
	}

	// 003 - username backfill ran, so the unique index could be created.
	// Any NULL would mean the backfill silently no-op'd.
	var nullUsernames int64
	scanOne(t, db, `SELECT count(*) FROM users WHERE username IS NULL`, &nullUsernames)
	if nullUsernames != 0 {
		t.Errorf("users.username: %d rows are NULL after backfill, want 0", nullUsernames)
	}

	// 006 - role exists, is constrained, and defaults to 'user'.
	var roleInvalid int64
	scanOne(t, db, `SELECT count(*) FROM users WHERE role NOT IN ('user', 'superadmin')`, &roleInvalid)
	if roleInvalid != 0 {
		t.Errorf("users.role: %d rows hold a value outside the allowed set", roleInvalid)
	}

	// 004 / 010 - biometric flags are NOT NULL. A NULL here would make the
	// security-setup gate evaluate unpredictably, and `recomputeSetupComplete`
	// compares booleans that cannot represent "unknown".
	for _, tc := range []struct{ table, column string }{
		{"users", "biometric_capable"},
		{"security_profiles", "biometric_opted_out"},
	} {
		var nullable string
		scanOne(t, db, `SELECT is_nullable FROM information_schema.columns
		                WHERE table_name = ? AND column_name = ?`, &nullable, tc.table, tc.column)
		if nullable != "NO" {
			t.Errorf("%s.%s is_nullable = %q, want \"NO\"", tc.table, tc.column, nullable)
		}
	}

	// 012 - every user-referencing foreign key cascades. The failure this
	// guards against is not subtle: with the default NO ACTION, `DELETE FROM
	// users` is rejected outright once the user has a session, so account
	// deletion cannot complete and orphaned auth material (sessions, refresh
	// tokens, WebAuthn credentials) is stranded indefinitely.
	//
	// Asserted as "no FK is NO ACTION" rather than "these seven exist", so a
	// new table gaining a user FK is covered without editing this test.
	var blocking []string
	rows, err := db.Raw(`
		SELECT c.conname || ' (' || src.relname || ' -> ' || tgt.relname || ')'
		FROM pg_constraint c
		JOIN pg_class src ON src.oid = c.conrelid
		JOIN pg_class tgt ON tgt.oid = c.confrelid
		WHERE c.contype = 'f' AND c.confdeltype <> 'c'
		ORDER BY 1`).Rows()
	if err != nil {
		t.Fatalf("query foreign keys: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan foreign key: %v", err)
		}
		blocking = append(blocking, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate foreign keys: %v", err)
	}
	if len(blocking) > 0 {
		t.Errorf("foreign keys without ON DELETE CASCADE - these block account deletion and "+
			"strand orphaned rows:\n  %v", blocking)
	}
}

// TestAutoMigrateCoversEveryPersistedModel guards a failure mode that is
// easy to miss: a model is added to internal/model and wired into a
// handler, but never registered with AutoMigrate. The service still starts
// and the feature 500s at runtime with "relation does not exist" on the
// first real request.
//
// Channel, UserSettings and UserRegistration are deliberately absent -
// their tables come from migrations 005, 007 and 008, because they carry
// CHECK constraints, partial indexes and triggers that GORM cannot express.
// This test fails if one of them is ever removed from that set without the
// SQL side being updated too, which is the only way the two can drift
// apart silently.
func TestAutoMigrateCoversEveryPersistedModel(t *testing.T) {
	migrated := map[string]bool{}
	for _, m := range database.MigratedModels() {
		tn, ok := m.(tableNamed)
		if !ok {
			t.Fatalf("MigratedModels() entry %T does not implement TableName(); AutoMigrate "+
				"would fall back to a pluralised guess and create the wrong table", m)
		}
		migrated[tn.TableName()] = true
	}

	createdBySQL := database.SQLOnlyTables

	persisted := []struct {
		name  string
		model tableNamed
	}{
		{"User", model.User{}},
		{"Session", model.Session{}},
		{"Device", model.Device{}},
		{"PIN", model.PIN{}},
		{"RefreshToken", model.RefreshToken{}},
		{"VerificationToken", model.VerificationToken{}},
		{"WebAuthnCredential", model.WebAuthnCredential{}},
		{"WebAuthnSession", model.WebAuthnSession{}},
		{"SecurityProfile", model.SecurityProfile{}},
		{"SecurityPIN", model.SecurityPIN{}},
		{"SecurityQuestion", model.SecurityQuestion{}},
		{"DeviceAccount", model.DeviceAccount{}},
		{"SecurityEvent", model.SecurityEvent{}},
		{"SuperadminAccount", model.SuperadminAccount{}},
		{"UserSession", model.UserSession{}},
		{"TestAccountMarker", model.TestAccountMarker{}},
		{"ClickEvent", model.ClickEvent{}},
	}

	for _, p := range persisted {
		if !migrated[p.model.TableName()] {
			t.Errorf("%s (%s) is not registered with AutoMigrate and is not in the "+
				"createdBySQL set - the service will start but every request touching it "+
				"will fail with \"relation does not exist\"", p.name, p.model.TableName())
		}
	}

	for table, source := range createdBySQL {
		if migrated[table] {
			continue // promoted to AutoMigrate - drop it from the map above instead
		}
		found := false
		for _, f := range migrationFiles(t) {
			if f == source {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("table %q is created by SQL but %s is missing from migrations/ - "+
				"nothing will create the table", table, source)
		}
	}
}

// tableNamed is satisfied by every GORM model that declares a TableName().
// Asserting the interface explicitly means a model that forgets TableName()
// fails here, instead of quietly creating a pluralised table that no query
// ever reads.
type tableNamed interface{ TableName() string }

// indexOID returns the OID of the named index, or 0 when it is absent.
// A changed OID across a re-run means the index was dropped and rebuilt;
// an unchanged OID proves it was left alone.
func indexOID(t *testing.T, db *gorm.DB) uint32 {
	t.Helper()
	var oid uint32
	scanOne(t, db, `SELECT COALESCE(
	                 (SELECT oid FROM pg_class
	                   WHERE relname = 'idx_channels_public_handle'
	                     AND relnamespace = 'public'::regnamespace),
	                 0)`, &oid)
	return oid
}

func indexDef(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var def string
	scanOne(t, db, `SELECT COALESCE(indexdef, '') FROM pg_indexes
	                WHERE schemaname = 'public'
	                  AND indexname = 'idx_channels_public_handle'`, &def)
	return def
}

func exec(t *testing.T, db *gorm.DB, stmt string) {
	t.Helper()
	if err := db.Exec(stmt).Error; err != nil {
		t.Fatalf("statement failed: %v\n---\n%s", err, truncate(stmt, 600))
	}
}

// scanOne runs a single-row query and scans its first column into dest.
// A missing row is a failure here, not a soft "no result": every assertion
// below asks about an object that must exist, so a silent zero value would
// turn a missing index or column into a misleading count error.
func scanOne(t *testing.T, db *gorm.DB, query string, dest any, args ...any) {
	t.Helper()
	if err := db.Raw(query, args...).Row().Scan(dest); err != nil {
		t.Fatalf("query failed: %v\n---\n%s", err, query)
	}
}

// quoteIdent renders an identifier that is safe to interpolate. Only
// internally generated names reach it, but a scratch name that somehow
// contained a quote must not become injectable SQL.
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return fmt.Sprintf("%s\n... (%d more bytes)", s[:n], len(s)-n)
}

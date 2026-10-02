// Package database_test verifies that the SQL migration chain in
// ../../migrations replays cleanly and idempotently on PostgreSQL.
//
// # WHY THIS EXISTS
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
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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

	// Step 1 - the REAL startup path: `database.Migrate`, which is what
	// `main.go` calls. Not `AutoMigrate`.
	//
	// This distinction is the whole reason this test had to change. `AutoMigrate`
	// alone cannot provision a fresh database: it creates only the tables GORM
	// knows about, and then it tries to create `privilege_registry`, which reads
	// a table migration 017 creates. So on an empty database it failed with
	//
	//	create view privilege_registry: ERROR: relation "appointments" does not exist
	//
	// and the service could not start at all. A test that called AutoMigrate was
	// therefore testing a path the service does not use, and it could not catch
	// the one failure that made a fresh deploy impossible.
	if err := database.Migrate(db); err != nil {
		t.Fatalf("Migrate on the scratch database: %v", err)
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

	// ---------------------------------------------------------------------------
	// 014 SUPERSEDES 011's partial handle index - so this asserts the REPLACEMENT
	// ---------------------------------------------------------------------------
	//
	// These assertions used to be about `idx_channels_public_handle`, a PARTIAL
	// index from 011:
	//
	//     CREATE INDEX idx_channels_public_handle ON channels (handle)
	//       WHERE is_public AND is_active AND deleted_at IS NULL;
	//
	// Migration 014 dropped it, and correctly:
	//
	//     DROP INDEX IF EXISTS idx_channels_public_handle;
	//     CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_handle_unique
	//         ON channels (lower(handle));
	//
	// An index is not a constraint. The partial one was only ever an ACCELERATION
	// for public lookups and enforced nothing, so two users could both take the
	// same handle and both get 201. `lower(handle)` also fixes "@Foo" and "@foo"
	// being two different channels, which a bare `handle` index could not express
	// at all.
	//
	// So the old assertion was not just stale, it was asserting the WEAKER
	// guarantee - a performance aid that had been deliberately deleted, in place
	// of the correctness guarantee that replaced it. The checks below are about
	// `idx_channels_handle_unique`, and they are stronger:
	//
	//   - it must EXIST (014 ran)
	//   - it must be UNIQUE (this is the part the old index could never give)
	//   - it must cover `lower(handle)`, not `handle`
	//   - it must NOT be partial, because a unique index that skipped
	//     soft-deleted or private rows would let a handle be reused.
	//
	// That last one is the trap in fixing this properly: making the old index
	// unique and keeping its predicate would be WORSE than useless, because
	// uniqueness that skips rows does not stop a collision - it just reports it
	// later, when the soft-deleted row is restored.
	var handleIndex string
	scanOne(t, db, `SELECT indexdef FROM pg_indexes
	                WHERE schemaname = 'public' AND indexname = 'idx_channels_handle_unique'`,
		&handleIndex)
	switch {
	case handleIndex == "":
		t.Error("index idx_channels_handle_unique is missing: migration 014 did not run, " +
			"so channels.handle has no uniqueness enforcement at all - two users can " +
			"claim the same handle")
	case !strings.Contains(strings.ToUpper(handleIndex), "UNIQUE"):
		t.Errorf("idx_channels_handle_unique is not UNIQUE: %s\n"+
			"  A non-unique index on handle enforces nothing, which is exactly the "+
			"problem 014 was written to fix.", handleIndex)
	case !strings.Contains(handleIndex, "lower"):
		t.Errorf("idx_channels_handle_unique does not use lower(handle): %s\n"+
			"  Without it \"@Foo\" and \"@foo\" are two different channels pointing at "+
			"the same person's identity.", handleIndex)
	case strings.Contains(handleIndex, "WHERE"):
		t.Errorf("idx_channels_handle_unique is PARTIAL: %s\n"+
			"  A partial unique index does not prevent a collision - it permits it and "+
			"reports it later, when the excluded row comes back. Uniqueness here must "+
			"be total.", handleIndex)
	}

	// ...and 014 must be re-runnable without rebuilding it. `IF NOT EXISTS` plus a
	// bare `DROP INDEX` in the same file is the pattern to watch: the DROP runs
	// first, so the CREATE always does real work on every boot.
	oidBefore := indexOID(t, db, "idx_channels_handle_unique")
	applyAll(t, db, []string{"014_channel_handle_global_uniqueness.sql"})
	if after := indexOID(t, db, "idx_channels_handle_unique"); after != oidBefore {
		t.Errorf("idx_channels_handle_unique was rebuilt on re-run: OID %d -> %d. "+
			"014 drops and recreates it every time it is applied, which blocks writes "+
			"to channels.handle for the duration", oidBefore, after)
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

	// ---------------------------------------------------------------------------
	// 012 - every foreign key's delete rule matches what the relationship MEANS
	// ---------------------------------------------------------------------------
	//
	// The failure this guards against is not subtle: with the default NO ACTION,
	// `DELETE FROM users` is rejected outright once the user has a session, so
	// account deletion cannot complete and orphaned auth material (sessions,
	// refresh tokens, WebAuthn credentials) is stranded indefinitely.
	//
	// ---------------------------------------------------------------------------
	// "NOT NO ACTION" IS NOT "CASCADE", AND THE DIFFERENCE MATTERS
	// ---------------------------------------------------------------------------
	//
	// An earlier version of this assertion demanded CASCADE everywhere. That was
	// wrong, and it would have destroyed the audit trail:
	//
	//     user_services.granted_by_id   -> users    SET NULL
	//     appointments.appointed_by_id  -> users    SET NULL
	//
	// "Who granted this access" is an AUDIT fact. Cascade it, and deleting an
	// account erases the record of who gave it - the opposite of what an audit
	// column is for. SET NULL keeps the row and loses only the name.
	//
	// So the rule is by MEANING, and it is written out per relationship rather
	// than inferred. Three kinds, and only three:
	//
	//   owned     -> CASCADE. The child row exists only because of the parent.
	//   audit     -> SET NULL, and the column must be NULLABLE.
	//   historical-> RESTRICT. Deleting the parent would destroy history that
	//               somebody has to be able to read.
	//
	// A rule that guesses which columns are audit references will eventually guess
	// wrong, and the cost of guessing wrong is a silently deleted audit trail.
	// Every expectation below is named.

	// (a) Audit references to users: SET NULL, and NULLABLE.
	//
	// `SET NULL` on a NOT NULL column is rejected by PostgreSQL outright, so both
	// halves are asserted - neither is meaningful alone.
	for table, column := range auditReferenceColumns {
		var isNullable string
		scanOne(t, db, `SELECT is_nullable FROM information_schema.columns
		                WHERE table_name = ? AND column_name = ?`, &isNullable, table, column)

		// The column is matched out of `pg_get_constraintdef` rather than by
		// joining `pg_attribute` on `array_length(conkey, 1)`.
		//
		// The join version looks tidier and is wrong in a way that is annoying:
		// `conkey` is a smallint[] of column numbers, and the `pg_attribute`
		// subquery picks exactly one of them. For a two-column foreign key it
		// silently picks the wrong one, and a single-column one reads fine - so
		// the query works on the tables you tested and fails on the next one.
		// Matching the rendered definition against the column name cannot have
		// that failure mode.
		var rule string
		scanOne(t, db, `
			SELECT c.confdeltype::text
			  FROM pg_constraint c
			  JOIN pg_class src ON src.oid = c.conrelid
			 WHERE c.contype = 'f'
			   AND src.relname = ?
			   AND pg_get_constraintdef(c.oid) LIKE '%' || ? || '%'`,
			&rule, table, column)

		if isNullable != "YES" {
			t.Errorf("%s.%s is an AUDIT reference to users and must be NULLABLE, because "+
				"its delete rule is SET NULL. is_nullable = %q - as it stands, PostgreSQL "+
				"rejects the rule outright and the grant has no deletable parent.",
				table, column, isNullable)
		}
		if rule != "n" {
			t.Errorf("%s.%s has foreign key delete rule %q; an audit reference to users "+
				"must be SET NULL ('n'), never CASCADE. Cascade deletes the record of who "+
				"granted access when the account is deleted, which is the one thing an "+
				"audit column must not do.", table, column, rule)
		}
	}

	// (b) Historical references: RESTRICT, named explicitly so the exemption is a
	// decision rather than an oversight.
	//
	// `appointments.role_id` is the only one. Deleting a role that somebody
	// currently holds would silently destroy the evidence of who held it and when,
	// so the database refuses. The correct operation is to retire the role, not to
	// delete it - and RESTRICT is what makes that the only option.
	for _, h := range historicalReferences {
		var rule string
		scanOne(t, db, `
			SELECT c.confdeltype::text
			  FROM pg_constraint c
			  JOIN pg_class src ON src.oid = c.conrelid
			  JOIN pg_class tgt ON tgt.oid = c.confrelid
			 WHERE c.contype = 'f' AND src.relname = ? AND tgt.relname = ?`,
			&rule, h.table, h.parent)
		if rule != "r" {
			t.Errorf("%s -> %s has delete rule %q, want RESTRICT ('r'). %s",
				h.table, h.parent, rule, h.why)
		}
	}

	// (c) Everything else: CASCADE. These are owned rows - they exist only because
	// the parent does, so they must not be left behind as orphans.
	//
	// Checked as "no FK is NO ACTION or RESTRICT except the named historical
	// ones", rather than as an allowlist of owned tables: a new table gaining an
	// owned relationship is then covered without editing this test, which is the
	// only way this check keeps being true.
	var blocking []string
	rows2, err := db.Raw(`
		SELECT c.conname || ' (' || src.relname || ' -> ' || tgt.relname || ')'
		FROM pg_constraint c
		JOIN pg_class src ON src.oid = c.conrelid
		JOIN pg_class tgt ON tgt.oid = c.confrelid
		WHERE c.contype = 'f' AND c.confdeltype IN ('a', 'r')
		ORDER BY 1`).Rows()
	if err != nil {
		t.Fatalf("query restrictive foreign keys: %v", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var name string
		if err := rows2.Scan(&name); err != nil {
			t.Fatalf("scan restrictive foreign key: %v", err)
		}
		blocking = append(blocking, name)
	}
	if err := rows2.Err(); err != nil {
		t.Fatalf("iterate restrictive foreign keys: %v", err)
	}

	expectedHistorical := map[string]bool{}
	for _, h := range historicalReferences {
		expectedHistorical[h.table+"_to_"+h.parent] = true
	}
	var unexpected []string
	for _, b := range blocking {
		keep := false
		for _, h := range historicalReferences {
			if strings.Contains(b, "("+h.table+" -> "+h.parent+")") {
				keep = true
			}
		}
		if !keep {
			unexpected = append(unexpected, b)
		}
	}
	_ = expectedHistorical

	if len(unexpected) > 0 {
		t.Errorf("foreign keys with NO ACTION or RESTRICT that are not declared "+
			"historical. These turn a DELETE into a failure, and they block account "+
			"deletion outright:\n  %v\n"+
			"  Either add the table to historicalReferences with a reason, or give the "+
			"constraint ON DELETE CASCADE if the row is owned rather than a record.",
			unexpected)
	}

	// =============================================================================
	// 017 - service access and RBAC
	// =============================================================================
	//
	// These four tables plus a view are the entire answer to "what may this
	// person do", and they were previously applied by hand only. That is not a
	// style note: the service layer that reads them was fully written and tested,
	// the tables existed, and the seed had never run - so the live database held
	// ZERO permissions and ZERO roles while the code looked complete.
	for _, table := range []string{"user_services", "roles", "permissions", "role_permissions", "appointments"} {
		var n int64
		scanOne(t, db, `SELECT count(*) FROM information_schema.tables
		                WHERE table_schema = 'public' AND table_name = ?`, &n, table)
		if n != 1 {
			t.Errorf("017: table %q is missing on a freshly provisioned database.\n"+
				"It is created only by the SQL chain - AutoMigrate does not own it - "+
				"so anything that provisions a database without running the chain "+
				"gets a service that starts and then 500s on the first authorised "+
				"request.", table)
		}
	}

	// The service slug allowlist is a CHECK, and a CHECK is the point: the
	// application validates too, so this is belt-and-braces against a psql session,
	// a future migration, or a script.
	var badSlug int64
	scanOne(t, db, `SELECT count(*) FROM information_schema.check_constraints
	                WHERE constraint_name = 'chk_user_services_slug'`, &badSlug)
	if badSlug != 1 {
		t.Error("017: constraint chk_user_services_slug is missing - a service slug " +
			"could be invented by any route that does not go through the Go constant")
	}

	// The registry is a VIEW and must be queryable, because a superadmin's whole
	// "who may do what" screen reads from it.
	var registryRows int64
	if err := db.Raw(`SELECT count(*) FROM privilege_registry`).Scan(&registryRows).Error; err != nil {
		t.Errorf("017: privilege_registry is not queryable: %v", err)
	}

	// =============================================================================
	// 022 - channel setup step 2
	// =============================================================================
	//
	// The brand colour is the security-relevant one, and its guarantee is a
	// CONSTRAINT rather than a convention: an out-of-range hue must be refused by
	// the database, because that value is interpolated into an inline style.
	for _, tc := range []struct {
		constraint string
		why        string
	}{
		{"chk_channel_brand_hue", "an out-of-range hue would reach a style attribute"},
		{"chk_channel_visibility", "an unknown visibility would decide who can see a channel"},
		{"chk_channel_visibility_agrees_with_is_public",
			"`visibility` and `is_public` answering differently about the same channel"},
		{"chk_channel_comment_policy", "an unknown policy would decide who may comment"},
	} {
		var n int64
		scanOne(t, db, `SELECT count(*) FROM information_schema.check_constraints
		                WHERE constraint_name = ?`, &n, tc.constraint)
		if n != 1 {
			t.Errorf("022: constraint %s is missing - %s", tc.constraint, tc.why)
		}
	}

	// The constraint must actually reject, not merely exist. A CHECK that is
	// present and unenforced is the worst of both worlds: it reads like a
	// guarantee and provides none.
	assertBrandHueRejected(t, db)

	// `setup_step2_at` defaults to NULL, and NULL must mean "not finished".
	// A default of now() would mark every channel as set up at creation and the
	// gate would never fire.
	//
	// `sql.NullString` because "no default" IS the value under test, and scanning
	// a SQL NULL into a `string` is an error rather than an empty string - so the
	// first version of this failed with
	//
	//	Scan error on column index 0: converting NULL to string is unsupported
	//
	// while asserting, correctly, that there is no default.
	var setupDefault sql.NullString
	scanOne(t, db, `SELECT column_default FROM information_schema.columns
	                WHERE table_name = 'channels' AND column_name = 'setup_step2_at'`,
		&setupDefault)
	if setupDefault.Valid && setupDefault.String != "NULL" {
		t.Errorf("022: channels.setup_step2_at has default %q; it must have NO default "+
			"so a new channel reads as unfinished", setupDefault.String)
	}
}

// assertBrandHueRejected proves the hue CHECK bites, by trying to violate it.
//
// An existence check is not evidence. The constraint could be present, correctly
// named, and not enforced by anything - and a colour that reaches a style
// attribute unvalidated is a stored-XSS vector on every visitor's page.
//
// The user is created through the GORM model rather than a hand-written INSERT,
// because the first version of this used raw SQL listing a few columns and the
// insert silently failed on a NOT NULL column nobody had mentioned. The error was
// swallowed with `db.Exec(...)` and the only symptom was a confusing
// `channels_user_id_fkey` violation two statements later - a foreign key error
// that had nothing to do with foreign keys.
func assertBrandHueRejected(t *testing.T, db *gorm.DB) {
	t.Helper()

	user := model.User{
		ID:           uuid.New(),
		Email:        "hue-" + uuid.NewString() + "@wideo11.test",
		Username:     "hue_" + uuid.NewString()[:8],
		PasswordHash: "not-a-real-hash-this-row-is-never-logged-into",
		IsVerified:   true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("could not create the user this assertion needs: %v", err)
	}

	newChannel := func(hue int) error {
		return db.Exec(
			`INSERT INTO channels (id, user_id, handle, display_name, description, brand_hue, created_at, updated_at)
			 VALUES (?, ?, ?, 'x', '', ?, now(), now())`,
			uuid.New(), user.ID, "h"+uuid.NewString()[:10], hue,
		).Error
	}

	for _, hue := range []int{-1, 360, 4000} {
		if err := newChannel(hue); err == nil {
			t.Errorf("022: brand_hue = %d was ACCEPTED. It must be rejected by "+
				"chk_channel_brand_hue - that value is interpolated into an inline "+
				"style, so the database is the last place it can be caught", hue)
		}
	}

	// And the valid range must still be accepted, or the constraint is simply
	// rejecting everything and the feature is broken in the other direction.
	if err := newChannel(206); err != nil {
		t.Errorf("022: brand_hue = 206 was rejected: %v", err)
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
		// `ClickEvent` used to be asserted here. It is gone from this list on
		// purpose, and the absence is itself part of what this test proves: the
		// ledger moved to `analytics-service.ui_click_events`.
		//
		// Re-registering the model here would make `AutoMigrate` recreate
		// `click_events` on every boot, so the table would never actually go away
		// and you would have two ledgers with no way to tell which is read.
		//
		// `UserRegistration` stays below - it shared a source file with ClickEvent,
		// but a permanent registration audit record is not click tracking.
		{"UserRegistration", model.UserRegistration{}},
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

// TestEveryTableNameIsProvisioned closes the hole the list above has.
//
// `TestAutoMigrateCoversEveryPersistedModel` enumerates models BY HAND, and that
// is the whole problem: adding a model to `internal/model` does not add it to the
// test, so the test keeps passing while a table exists in code and in no
// migration.
//
// That is not hypothetical. `media_assets` had a model, was read by
// `media_upload.go`, `media.go` and `creator_channels.go`, was in neither
// `MigratedModels()` nor `SQLOnlyTables`, and was created by no .sql file. It
// existed only because someone had made it by hand on a live database. On a fresh
// database, migration 020's `ALTER TABLE media_assets ADD COLUMN channel_id`
// could not run - so media upload was unreachable from an empty schema, and the
// service would have failed to provision at all.
//
// So this test DISCOVERS the tables instead of listing them: it reads the model
// package's source for every `TableName()` literal and requires each one to be
// accounted for. Adding a model now fails here rather than in production.
func TestEveryTableNameIsProvisioned(t *testing.T) {
	// Reflected over MigratedModels so the two cannot disagree about which
	// tables AutoMigrate owns.
	migrated := map[string]bool{}
	for _, m := range database.MigratedModels() {
		if tn, ok := m.(tableNamed); ok {
			migrated[tn.TableName()] = true
		} else {
			t.Errorf("MigratedModels contains %T, which has no TableName() - "+
				"a model without one is a model whose table name is a guess", m)
		}
	}

	declared := scanTableNameLiterals(t)
	if len(declared) == 0 {
		t.Fatal("found no TableName() declarations - the scan is broken, and a " +
			"test that passes because it found nothing is worse than no test")
	}

	for table, where := range declared {
		switch {
		case migrated[table]:
			// Owned by AutoMigrate.
		case database.SQLOnlyTables[table] != "":
			// Owned by a migration, and TestAutoMigrateCoversEveryPersistedModel
			// checks that the named migration exists.
		case database.RetiredTables[table] != "":
			// Deliberately gone. The reason is in the map; a retirement that
			// cannot be looked up is indistinguishable from an oversight.
		default:
			t.Errorf("%s declares TableName() %q, but no provisioner claims that table.\n"+
				"  It is not in MigratedModels() (AutoMigrate will not create it), not "+
				"in SQLOnlyTables (no migration owns it), and not in RetiredTables "+
				"(nothing documents it as gone).\n"+
				"  The service will start and then fail every request that touches "+
				"this table with \"relation %q does not exist\".\n"+
				"  Fix: add &model.X{} to MigratedModels, add the table to "+
				"SQLOnlyTables with the migration that creates it, or move it to "+
				"RetiredTables with the reason it went away.", where, table, table)
		}
	}

	// And the other direction: a retired table that has quietly come back would
	// mean two ledgers with no way to tell which is read.
	for table := range migrated {
		if why := database.RetiredTables[table]; why != "" {
			t.Errorf("table %q is registered with AutoMigrate AND listed as retired (%s). "+
				"It will be recreated on every boot while the ledger it replaced still "+
				"exists.", table, why)
		}
	}
}

// scanTableNameLiterals reads `internal/model/*.go` and returns every table name
// a `TableName()` method declares, with the file and line it came from.
//
// Source-parsing rather than reflection because Go cannot enumerate a package's
// types at run time from inside itself, and a second hand-written list is exactly
// the thing that failed here.
//
// MULTI-LINE on purpose. Nineteen of the declarations are one-liners
// (`func (Channel) TableName() string { return "channels" }`) and eleven are not
// - so a single-line pattern silently covers 63% of the tables, and the ones it
// misses are exactly the ones nobody would think to check by hand.
func scanTableNameLiterals(t *testing.T) map[string]string {
	t.Helper()

	files, err := filepath.Glob(filepath.Join("..", "model", "*.go"))
	if err != nil || len(files) == 0 {
		t.Fatalf("could not list the model package: %v", err)
	}

	// func (X) TableName() string { return "name" }
	// with newlines and tabs tolerated between every token.
	re := regexp.MustCompile(
		`func\s+\(\s*\w*\s*\*?\w+\s*\)\s+TableName\(\)\s+string\s*\{\s*return\s+"([a-z_0-9]+)"`,
	)

	out := map[string]string{}
	for _, f := range files {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		for i, line := range strings.Split(string(body), "\n") {
			m := re.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			table := m[1]
			where := fmt.Sprintf("%s:%d", filepath.Base(f), i+1)
			if prev, dup := out[table]; dup {
				t.Errorf("two models declare TableName() %q (%s and %s). One table, one "+
					"model - two declarations mean AutoMigrate and the code disagree "+
					"about which shape is authoritative.", table, prev, where)
			}
			out[table] = where
		}
	}
	return out
}

// auditReferenceFKs are the foreign keys that record WHO did something, and must
// therefore survive the deletion of that person.
//
// `ON DELETE SET NULL`, never CASCADE: "who granted this access" is the evidence,
// and deleting an account must not delete the record of who handed out the
// access in the first place. The row survives with the name gone, which is the
// correct trade - the grant's existence and dates are still answerable.
//
// Every one is declared in migration 017 with `ON DELETE SET NULL`, and the
// paired column is NULLABLE. Both halves matter: `SET NULL` on a NOT NULL column
// is rejected by PostgreSQL outright.
var auditReferenceFKs = []string{
	"user_services_granted_by_fkey",
	"user_services_revoked_by_fkey",
	"appointments_appointed_by_fkey",
	"appointments_revoked_by_fkey",
}

// auditReferenceColumns maps each audit table to the column carrying the FK, so
// the test can assert the column is NULLABLE as well as the rule being SET NULL.
//
// One entry per table rather than four per table, because the rule is the same
// for every FK out of a table - asserting it once against a single FK would let
// the other three drift. The representative column is the `*_by` one, which is
// never NULL-by-omission the way `role_id` is.
var auditReferenceColumns = map[string]string{
	"user_services": "granted_by",
	"appointments":  "appointed_by",
}

// historicalReferences are the foreign keys that must REFUSE a delete, because
// deleting the parent would destroy history somebody has to be able to read.
//
// `appointments.role_id` is the only one. Deleting a role that somebody currently
// holds would erase the evidence of who held it and when. The correct operation is
// to retire the role, not to delete it, and RESTRICT is what makes that the only
// option - a constraint that permitted the delete would permit the loss.
var historicalReferences = []struct {
	table  string
	parent string
	why    string
}{
	{
		"appointments", "roles",
		"an appointment is the record of who held a role and when; cascading it away " +
			"on role deletion would destroy the audit trail, so deletion must be refused",
	},
}

// tableNamed is satisfied by every GORM model that declares a TableName().
// Asserting the interface explicitly means a model that forgets TableName()
// fails here, instead of quietly creating a pluralised table that no query
// ever reads.
type tableNamed interface{ TableName() string }

// indexOID returns the OID of the named index, or 0 when it is absent.
// A changed OID across a re-run means the index was dropped and rebuilt;
// an unchanged OID proves it was left alone.
//
// Takes the index name rather than hardcoding one, because which index matters
// changes: this originally read `idx_channels_public_handle`, and after migration
// 014 the handle index that enforces uniqueness is `idx_channels_handle_unique`.
// A helper with a baked-in name silently keeps checking the thing that was
// deleted.
func indexOID(t *testing.T, db *gorm.DB, name string) uint32 {
	t.Helper()
	// The name is interpolated rather than bound because it is an identifier and
	// cannot be a bind parameter. It comes from this file's own literals.
	var oid uint32
	scanOne(t, db, `SELECT COALESCE(
	                 (SELECT oid FROM pg_class
	                   WHERE relname = '`+name+`'
	                     AND relnamespace = 'public'::regnamespace),
	                 0)`, &oid)
	return oid
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

package database

// The migration runner: the SQL chain applied automatically, in order, with a
// ledger that records what has run.
//
// =============================================================================
// WHY THIS FILE EXISTS
// =============================================================================
//
// Migrations 001-021 used to be applied by hand, with `psql -f`, on top of
// whatever GORM's AutoMigrate happened to have left behind. That has three
// failure modes, and all three are the reason a from-scratch deploy was
// impossible in this repo:
//
//  1. NOTHING APPLIED THEM. AutoMigrate creates the GORM models; the SQL chain
//     was simply absent on a new database. `channels`, `user_settings`,
//     `media_assets`, `user_services`, `appointments`, every view - all missing.
//     The service starts healthy and 500s on first real use.
//  2. NO LEDGER. `tools/apply-sql.mjs` is a convenience, not a record. Nothing
//     knew which files had run, so files got applied twice, out of order, or
//     skipped, and the schema quietly depended on somebody's shell history.
//  3. THE TWO MECHANISMS COULD NOT AGREE. Half the chain still carried SQL
//     Server syntax (`sys.sp_addextendedproperty`, `IF COL_LENGTH(...) BEGIN`,
//     `bit`, `GO`, `DATALENGTH`, `COLLATE`), so it aborted halfway and left a
//     rolled-back transaction behind it.
//
// Verified against the live database before this was written: with the chain
// unrun, `AutoMigrate` itself FAILED at boot with
//
//	create view privilege_registry: ERROR: relation "appointments" does not exist
//
// because the view is created after AutoMigrate and reads a table migration 017
// creates. So the service could not start on an empty database at all - not
// degraded, not partially: not started.
//
// =============================================================================
// WHAT THIS DOES
// =============================================================================
//
//   * Embeds the .sql files, so the binary that serves traffic is the binary
//     that knows its schema. "Which migrations have run" stops being a question
//     about a person's shell.
//   * Applies them in filename order, each in its own transaction. PostgreSQL
//     DDL is transactional, so a file that fails leaves nothing behind - which
//     is what makes the next attempt safe rather than a manual repair.
//   * Records version + checksum per file. An EDITED migration that has already
//     run is reported loudly and NOT re-applied: re-running a file whose
//     meaning changed is a human decision, not something a deploy should do.
//   * Takes a session advisory lock, so N replicas starting at once cannot
//     both apply the same file.
//
// =============================================================================
// WHY A MISSING LEDGER IS SAFE
// =============================================================================
//
// Every existing deployment has tables but an EMPTY ledger, because the chain
// was applied by hand. This runner therefore re-applies all 21 files on the
// first boot after deploying it. That is safe precisely because the whole chain
// was made idempotent - `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
// `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, and DROP-then-ADD for
// constraints. `TestMigrationChainReplays` is the test that holds that property,
// and it applies the chain twice on purpose.
//
// A non-idempotent statement in this chain is therefore not a style nit: it is
// a file that will break the first boot of every existing deployment.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/migrations"
)

// advisoryLockKey namespaces the lock across every database in one Postgres
// instance. `hashtext` is a built-in, so this needs no extension.
//
// Session-scoped (not transaction-scoped) because the lock must survive across
// the per-file transactions.
const advisoryLockKey = "wideo11_auth_service_migrations"

type appliedMigration struct {
	Version   string    `gorm:"primaryKey"`
	Checksum  string    `gorm:"not null"`
	AppliedAt time.Time `gorm:"not null"`
}

func (appliedMigration) TableName() string { return "schema_migrations" }

// MigrationResult reports what a run did, for logging and for the test.
type MigrationResult struct {
	Applied []string
	Skipped []string
	Drifted []string
}

func (r MigrationResult) String() string {
	return fmt.Sprintf("applied=%d skipped=%d drifted=%d",
		len(r.Applied), len(r.Skipped), len(r.Drifted))
}

// Migrate brings the schema up to date.
//
// The order is load-bearing and is the whole reason this is one function rather
// than three calls sprinkled through main.go:
//
//  1. Drop the views that would block an ALTER.
//  2. AutoMigrate the GORM models.
//  3. Apply the SQL chain (once, per the ledger).
//  4. Recreate the views - EVERY boot, not once.
//  5. Verify each one exists and is queryable.
//
// Step 1 before step 2 because PostgreSQL refuses to alter a column any view
// depends on - `cannot alter type of a column used by a view or rule` - and
// AutoMigrate cannot know which views read which columns.
//
// Step 3 after step 2 because the SQL chain is authored against the GORM shape:
// 001's `users` table does not have `biometric_capable`, `role` or
// `security_profiles`, and those come from AutoMigrate. Running the chain first
// also fails outright, because 017 creates a view over `superadmin_accounts`,
// which is a GORM model and therefore does not exist yet on a fresh database.
//
// -----------------------------------------------------------------------------
// WHY STEP 4 IS NOT GOVERNED BY THE LEDGER
// -----------------------------------------------------------------------------
//
// Because step 1 destroyed the views, and only step 4 can bring them back.
//
// An intermediate version of this let the chain own every view. That worked on
// boot 1 and broke on boot 2:
//
//	boot 1  drop views -> chain applies all 22 files -> views recreated
//	boot 2  drop views -> chain SKIPS all 22 (already in the ledger) -> gone
//
// The views then stayed gone for the life of the deployment. `verifyExpectedViews`
// is what caught it, which is the argument for step 5 existing at all: without a
// check, a missing view is not a crash - it is a channel page showing zero videos
// and a superadmin registry showing an empty list, with nothing in any log.
//
// So views are dropped every boot and recreated every boot, from Go. The chain
// keeps its own `CREATE OR REPLACE VIEW` for the case where the database is built
// from SQL with no service running. `TestViewDefinitionsAgree` compares the two.
func Migrate(db *gorm.DB) error {
	if err := AutoMigrate(db); err != nil {
		return err
	}

	res, err := RunMigrations(db)
	if err != nil {
		return err
	}
	log.Info().
		Str("result", res.String()).
		Int("applied", len(res.Applied)).
		Int("skipped", len(res.Skipped)).
		Int("drifted", len(res.Drifted)).
		Msg("SQL migrations up to date")

	for _, d := range res.Drifted {
		// An ERROR, not a warning. Someone edited a migration that has already
		// run, which means the database and the repository now describe
		// different schemas and nobody can tell which one is authoritative.
		// Re-applying it is NOT the answer: the file's meaning changed, so its
		// idempotency guarantees are unknown.
		log.Error().
			Str("migration", d).
			Msg("[MIGRATIONS] an already-applied migration file has been EDITED. " +
				"It was skipped on purpose. Write a NEW migration for the change - " +
				"re-running an edited file is a decision a deploy must not make for you.")
	}

	for _, v := range ownedViews {
		if err := db.Exec(v.Create).Error; err != nil {
			return fmt.Errorf("recreate view %s: %w", v.Name, err)
		}
	}
	log.Info().Int("views", len(ownedViews)).Msg("Views recreated")

	return verifyExpectedViews(db)
}

// verifyExpectedViews fails the boot if a view the service needs is missing or
// unqueryable.
//
// A boot failure is the right severity, and deliberately so. Every caller of these
// views treats a missing view as "no results": a channel page would render `0`
// videos and a superadmin registry would render an empty list, with no error
// anywhere. An empty count is indistinguishable from a real one, and it is far
// more dangerous - a broken view at least shows up in a log.
//
// "Exists but unqueryable" is checked too, and it is the more likely of the two:
// a view whose underlying column was dropped or renamed still exists in
// `information_schema.views` and fails only when a page reads it.
func verifyExpectedViews(db *gorm.DB) error {
	var problems []string
	for _, name := range expectedViews {
		var exists bool
		if err := db.Raw(
			`SELECT EXISTS (SELECT 1 FROM information_schema.views
			                WHERE table_schema = 'public' AND table_name = ?)`,
			name,
		).Scan(&exists).Error; err != nil {
			return fmt.Errorf("check view %s: %w", name, err)
		}
		if !exists {
			problems = append(problems, name+" (missing)")
			continue
		}
		if err := db.Raw(`SELECT count(*) FROM "` + name + `"`).Error; err != nil {
			problems = append(problems, name+" (not queryable: "+err.Error()+")")
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf(
			"views are not usable after migrating: %v. "+
				"A view in viewsBlockingAlter with no entry in ownedViews is dropped on "+
				"every boot and never recreated - which is invisible, because a missing "+
				"view reads as 'no results' rather than as an error", problems)
	}
	log.Info().Int("views", len(expectedViews)).Msg("All expected views present and queryable")
	return nil
}

// RunMigrations applies every pending .sql file, in filename order.
func RunMigrations(db *gorm.DB) (MigrationResult, error) {
	var res MigrationResult

	if err := ensureLedger(db); err != nil {
		return res, err
	}

	names, err := migrationNames()
	if err != nil {
		return res, err
	}

	// Take the lock on a dedicated connection.
	//
	// NOT through the pool: a session advisory lock is released when the
	// SESSION ends, and a pooled connection returns to the pool holding it -
	// which would keep the lock alive for connections nobody is using, and
	// release it early if that connection is recycled mid-run. Either way the
	// lock stops meaning "a migration is running".
	conn, err := db.DB()
	if err != nil {
		return res, fmt.Errorf("sql.DB: %w", err)
	}
	sqlDB := conn
	if err := sqlDB.Ping(); err != nil {
		return res, fmt.Errorf("migrations: database not reachable: %w", err)
	}

	// A bounded wait rather than an infinite one: a deploy that hangs forever on
	// a lock is harder to diagnose than one that says "another instance is
	// migrating, try again".
	//
	// `pg_try_advisory_lock` rather than `pg_advisory_lock`, because the blocking
	// form cannot be given a timeout: it waits as long as the holder keeps the
	// session open, which for a crashed replica is forever.
	const lockTimeout = 60 * time.Second
	deadline := time.Now().Add(lockTimeout)
	for {
		var held bool
		err := sqlDB.QueryRow("SELECT pg_try_advisory_lock(hashtext($1))", advisoryLockKey).Scan(&held)
		if err != nil {
			return res, fmt.Errorf("try migration lock: %w", err)
		}
		if held {
			break
		}
		if time.Now().After(deadline) {
			return res, fmt.Errorf("another instance held the migration lock for %s", lockTimeout)
		}
		time.Sleep(500 * time.Millisecond)
	}
	defer func() {
		// Returning the connection to the pool while it still holds a session lock
		// would leak that lock to whatever borrows the connection next. This unlock
		// is what prevents it; the error is deliberately ignored because the
		// connection returns to the pool either way.
		_, _ = sqlDB.Exec("SELECT pg_advisory_unlock(hashtext($1))", advisoryLockKey)
	}()

	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			return res, fmt.Errorf("read embedded migration %s: %w", name, err)
		}
		sum := checksum(raw)

		var prior appliedMigration
		err = db.Where("version = ?", name).Take(&prior).Error
		switch {
		case err == nil:
			if prior.Checksum != sum {
				res.Drifted = append(res.Drifted, name)
				continue
			}
			res.Skipped = append(res.Skipped, name)
			continue
		case err != gorm.ErrRecordNotFound:
			return res, fmt.Errorf("read migration ledger: %w", err)
		}

		if err := applyOne(db, name, string(raw), sum); err != nil {
			return res, err
		}
		res.Applied = append(res.Applied, name)
		log.Info().Str("migration", name).Msg("[MIGRATIONS] applied")
	}

	return res, nil
}

// applyOne runs one file in its own transaction and records it.
//
// The file's own `BEGIN;` / `COMMIT;` are stripped first. That is not
// cosmetic: these files were authored to be run by `psql`, which treats a bare
// `BEGIN` as starting a new transaction and, mid-script, prints
// "WARNING: there is already a transaction in progress" and then lets the
// inner `COMMIT` commit the OUTER one. GORM's `Transaction` would then have its
// commit taken away from underneath it, and a rollback after the inner COMMIT
// would report success having rolled back nothing.
func applyOne(db *gorm.DB, name, body, sum string) error {
	stmt := StripTransactionControl(body)

	return db.Transaction(func(tx *gorm.DB) error {
		if strings.TrimSpace(stmt) != "" {
			if err := tx.Exec(stmt).Error; err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
		row := appliedMigration{Version: name, Checksum: sum, AppliedAt: time.Now().UTC()}
		return tx.Create(&row).Error
	})
}

// StripTransactionControl removes the file-level BEGIN / COMMIT / ROLLBACK.
//
// =============================================================================
// EXPORTED, AND THE DUPLICATE THAT WAS HERE FIRST IS THE LESSON
// =============================================================================
//
// It was unexported, and the audit test then wrote its OWN copy. That copy
// stripped any line trimming to `END`, which broke migration 001's plpgsql
// trigger function, and the audit reported seven files as failing to execute -
// all seven of them fake, and all seven of them files that the replay test had
// already applied successfully.
//
// A second implementation of a subtle function is not a test fixture; it is a
// second answer to the same question, and this time the two disagreed. The
// lesson from `stripTransactionControl` beating plpgsql applies to the helper
// itself: one implementation, and the auditor calls it.
//
// # WHY IT IS NEEDED
//
// These files were authored to be run by `psql`, where a bare `BEGIN` starts a
// transaction and a mid-script `BEGIN` prints
//
//	WARNING: there is already a transaction in progress
//
// and then lets the inner `COMMIT` commit the OUTER one. GORM's `Transaction`
// would have its commit taken away from underneath it, and a rollback after the
// inner COMMIT would report success having rolled back nothing.
//
// ---------------------------------------------------------------------------
// WHY THIS IS DOLLAR-QUOTE AWARE, AND WHAT HAPPENED WITHOUT IT
// ---------------------------------------------------------------------------
//
// The first version of this function matched any line that trimmed to `END` -
// and migration 001 creates a plpgsql trigger function:
//
//	CREATE OR REPLACE FUNCTION update_updated_at_column()
//	RETURNS TRIGGER AS $$
//	BEGIN
//	    NEW.updated_at = NOW();
//
// //	    RETURN NEW;
//
//	END;
//	$$ language 'plpgsql';
//
// That `END;` is a plpgsql block terminator, not transaction control. Blanking it
// left `NEW.updated_at := ...; RETURN NEW; $$ language 'plpgsql'` and the file
// died with
//
//	001_create_users_table.sql: ERROR: syntax error at or near "NEW.updated_at"
//
// So the scan has to know whether it is inside a `$$ ... $$` block, and treat
// BEGIN/END inside one as part of a function body.
//
// ---------------------------------------------------------------------------
// WHY IT IS LINE-BASED AND NOT A REGEXP OVER THE WHOLE FILE
// ---------------------------------------------------------------------------
//
// A whole-file regexp cannot tell the `END;` that closes a plpgsql function from
// the `END;` that closes a transaction - and this chain has both. Line-based
// scanning with an explicit dollar-quote state can.
//
// Blank rather than delete, so byte offsets stay stable and an error message that
// quotes the file still lines up with what is on disk.
func StripTransactionControl(body string) string {
	lines := strings.Split(body, "\n")
	out := make([]string, len(lines))

	// The open dollar-quote tag, or "" when we are not inside one.
	// A tag is `$` followed by an optional identifier and then `$`, so `$fn$` and
	// `$$` both work. `$1` (a positional parameter) is NOT a tag and must not be
	// treated as one.
	var dollarTag string

	for i, raw := range lines {
		if dollarTag != "" {
			// Inside a body: copy verbatim, and notice the closing tag.
			out[i] = raw
			if idx := strings.Index(raw, dollarTag); idx >= 0 {
				dollarTag = ""
			}
			continue
		}

		// Outside a body. Find a tag opening on THIS line.
		// Scanning left to right, tracking whether we are inside the tag, so a
		// line like `$$ language plpgsql;` (which opens and never closes) does
		// not get mistaken for a complete body.
		rest := raw
		for {
			open := findDollarTag(rest)
			if open == nil {
				break
			}
			after := rest[open.end:]
			if close := strings.Index(after, open.tag); close >= 0 {
				// A complete body on one line: nothing to strip from it.
				rest = ""
				break
			}
			// An opening tag with no close on this line.
			dollarTag = open.tag
			rest = ""
			break
		}

		t := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), ";"))
		switch strings.ToUpper(t) {
		case "BEGIN", "START TRANSACTION", "COMMIT", "ROLLBACK":
			out[i] = ""
		default:
			out[i] = raw
		}
	}
	return strings.Join(out, "\n")
}

type dollarTagMatch struct {
	tag string
	end int // index just past the opening tag
}

// findDollarTag returns the first dollar-quote opener at or after `s`'s start.
func findDollarTag(s string) *dollarTagMatch {
	for i := 0; i < len(s); i++ {
		if s[i] != '$' {
			continue
		}
		j := i + 1
		for j < len(s) && (s[j] == '_' ||
			(s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z') ||
			(j > i+1 && s[j] >= '0' && s[j] <= '9')) {
			j++
		}
		// A tag must END with `$`. `$1` and a bare `$` are not openers.
		if j < len(s) && s[j] == '$' {
			return &dollarTagMatch{tag: s[i : j+1], end: j + 1}
		}
	}
	return nil
}

func ensureLedger(db *gorm.DB) error {
	// `CREATE TABLE IF NOT EXISTS` rather than AutoMigrate: the ledger is
	// infrastructure for the migrator itself, so it must exist before anything
	// that might itself need migrating.
	return db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			checksum   TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`).Error
}

// migrationNames lists the embedded .sql files in apply order.
//
// Sorted, because the zero-padded numeric prefix is the ordering, and a
// directory listing is not sorted by anything in particular.
func migrationNames() ([]string, error) {
	entries, err := migrations.FS.ReadDir(migrations.Dir)
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("no embedded migrations found")
	}
	sort.Strings(names)
	return names, nil
}

func checksum(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

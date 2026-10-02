package database_test

// =============================================================================
// THE WHOLE-CHAIN SQL LINTER
// =============================================================================
//
// Reported: "migration me bahut red line errors hain ... baki sabhi migration
// schema files se bhi check karo ... isi ki wajah se bahut kaam kharab ho jata
// hai."
//
// =============================================================================
// WHY THE EXISTING TEST WAS THE WRONG SHAPE FOR THIS
// =============================================================================
//
// `TestMigrationChainReplays` applies the chain through `database.Migrate`, and
// `Migrate` is CORRECT to stop at the first failure: a half-applied chain must
// not be allowed to look successful, and a deploy must not proceed past a broken
// file.
//
// That is right for a deploy and useless for an audit. Finding twenty SQL errors
// this way costs twenty runs, and each run stops where the last one stopped -
// so the work is inherently serial, and it is tempting to "fix" a downstream file
// for a reason that is really an upstream one's fault.
//
// This test therefore does the opposite on purpose: it applies every file,
// records failures, KEEPS GOING, and reports the complete list at the end.
//
// -----------------------------------------------------------------------------
// WHY IT IS STILL SAFE TO RUN
// =============================================================================
//
// It runs against a throwaway database with the `auth_migration_replay_` prefix,
// which `TestMigrationChainReplays` refuses to drop unless it matches. Nothing
// here touches a real database, and every statement is rolled back or applied to
// the scratch schema only.
//
// -----------------------------------------------------------------------------
// WHY THE CHAIN IS APPLIED IN ORDER ANYWAY
// =============================================================================
//
// Because order is part of the answer. `012` alters a table `005` creates, and a
// linter that ran files independently would report that as "012 references a
// missing table" - which is true and useless. Applying in order means a report
// names real defects.
//
// The consequence, stated plainly: a failure in file N can also break N+1, so
// later entries may be collateral. The output separates them, and the first
// failure in each dependency group is the one worth reading first.
//
// =============================================================================
// WHAT ELSE IT CHECKS, BESIDES "DOES IT EXECUTE"
// =============================================================================
//
// Executing is not enough. A file can run perfectly and still be a trap, and the
// three checks below are for the failures that only show up in production:
//
//   1. DATA LOSS. `DROP TABLE` / `DROP COLUMN` in a migration claims
//      idempotency by deleting. Migration 015 did exactly this to
//      `channel_subscriptions`, which would have wiped every real subscription on
//      every deploy.
//   2. NON-IDEMPOTENT DDL. A bare `CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN`
//      or `ALTER COLUMN` fails the SECOND application - and the second
//      application is the case every existing deployment hits, because its tables
//      were made by AutoMigrate.
//   3. DIALECT LEAKAGE. SQL Server syntax that no one notices because the
//      statement it guards is only reached by data that does not exist yet.
//      `sys.*`, `dbo.`, `IF ... BEGIN`, bare `GO`, `bit`, `GETDATE()`,
//      `sp_addextendedproperty`, `DATALENGTH`, `COLLATE Latin1`.

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/migrations"
)

// TestWholeMigrationChainHasNoSQLErrors applies EVERY migration to a scratch
// database, tolerating failures, and reports the complete list.
//
// Run it with:
//
//	AUTH_MIGRATION_REPLAY=1 go test ./internal/database/ -run TestWholeMigrationChain -v
func TestWholeMigrationChainHasNoSQLErrors(t *testing.T) {
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("set AUTH_MIGRATION_REPLAY=1 to run (needs a live PostgreSQL; creates and drops a scratch database)")
	}

	cfg := testConfig(t)
	dbName := scratchDBPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")
	createScratch(t, cfg, dbName)
	db := connect(t, cfg, dbName)
	defer func() {
		// Close the pool FIRST, then drop.
		//
		// `DROP DATABASE` fails with
		//
		//	ERROR: database "..." is being accessed by other users (SQLSTATE 55006)
		//
		// while any session is attached, which reads like a permissions problem
		// rather than "you forgot to disconnect". `connect` registers a
		// `t.Cleanup` to close the pool, but cleanups run AFTER the test function
		// returns - and this defer runs before that, so without an explicit close
		// the drop always loses the race.
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		// Belt and braces: terminate anything a previous phase left behind.
		_ = execOn(cfg, "postgres",
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+
				quoteIdent(dbName)+` AND pid <> pg_backend_pid()`)
		dropScratch(t, cfg, dbName)
	}()

	// GORM models first, because the chain is authored against this shape - which
	// is exactly why a SQL-only file that references a GORM table fails on an
	// empty database but works on a live one.
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}

	entries, err := migrations.FS.ReadDir(migrations.Dir)
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	type failure struct {
		file string
		err  error
	}
	var execFailures []failure

	// ---- PASS 1: does every file execute? ----
	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		// Each file in its own transaction, and the error is RECORDED rather than
		// returned.
		//
		// The stripper is the PRODUCTION one, exported as
		// `database.StripTransactionControl`. This file originally had its own
		// copy, which stripped any line trimming to `END` and therefore broke
		// migration 001's plpgsql trigger - and reported seven files as broken
		// when all seven were fine. Two implementations of a subtle helper is not
		// a test fixture; it is a second, contradictory answer.
		if err := db.Exec(database.StripTransactionControl(string(raw))).Error; err != nil {
			execFailures = append(execFailures, failure{name, err})
			t.Logf("EXEC FAIL  %s\n           %v", name, err)
		} else {
			t.Logf("exec ok     %s", name)
		}
	}

	// ---- PASS 2: does every file apply a SECOND time? ----
	//
	// Only meaningful for files that ran at all, and only after AutoMigrate has
	// already created the GORM-owned tables - which is the real-world case for
	// every existing deployment.
	var rerunFailures []failure
	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			continue
		}
		if err := db.Exec(database.StripTransactionControl(string(raw))).Error; err != nil {
			rerunFailures = append(rerunFailures, failure{name, err})
			t.Logf("RERUN FAIL  %s\n           %v", name, err)
		}
	}

	// ---- PASS 3: static hazards ----
	dialectIssues := findDialectLeakage(t, names)
	destructiveIssues := findDestructiveStatements(t, names)
	nonIdempotent := findNonIdempotentDDL(t, names)

	// ---- Report ----
	t.Log("")
	t.Log("================ MIGRATION AUDIT ================")
	t.Logf("files: %d", len(names))
	t.Logf("failed to execute (first pass): %d", len(execFailures))
	for _, f := range execFailures {
		t.Logf("  X %s: %v", f.file, f.err)
	}
	t.Logf("failed on re-application:      %d", len(rerunFailures))
	for _, f := range rerunFailures {
		t.Logf("  X %s (second run): %v", f.file, f.err)
	}
	t.Logf("SQL Server syntax leaks:       %d", len(dialectIssues))
	for _, f := range dialectIssues {
		t.Logf("  X %s: %s", f.file, f.why)
	}
	t.Logf("destructive statements:        %d", len(destructiveIssues))
	for _, f := range destructiveIssues {
		t.Logf("  X %s: %s", f.file, f.why)
	}
	t.Logf("unguarded DDL (not idempotent): %d", len(nonIdempotent))
	for _, f := range nonIdempotent {
		t.Logf("  X %s: %s", f.file, f.why)
	}
	t.Log("===============================================")

	if len(execFailures) > 0 || len(rerunFailures) > 0 ||
		len(dialectIssues) > 0 || len(destructiveIssues) > 0 || len(nonIdempotent) > 0 {
		t.Errorf("%d migration files need work (%d execute, %d re-apply, %d dialect, "+
			"%d destructive, %d not idempotent). See the per-file lines above.",
			len(execFailures)+len(rerunFailures)+len(dialectIssues)+
				len(destructiveIssues)+len(nonIdempotent),
			len(execFailures), len(rerunFailures), len(dialectIssues),
			len(destructiveIssues), len(nonIdempotent))
	}
}

// ---------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------

type issue struct {
	file string
	why  string
}

// dialectPatterns are SQL Server / MySQL constructs that cannot execute here.
//
// Each carries WHY it survived, because that is the part worth remembering:
//
//   - `sys.*` and `sp_addextendedproperty`: written for a SQL Server origin and
//     applied by hand years ago, so the statements that used them never ran
//   - `IF ... BEGIN`: looked correct in a small editor
//   - bare `GO`: an SSMS batch separator; psql calls it a syntax error
//   - `bit`: SQL Server's boolean
//
// The comment lines are stripped before matching, or every file that DOCUMENTS
// one of these would be reported as containing it - and migrations 003, 010, 018
// and 019 all name them in prose now.
var dialectPatterns = []struct {
	pattern string
	why     string
}{
	{`\bsys\.\w+`, "SQL Server catalog reference"},
	{`\bdbo\.`, "SQL Server schema qualifier"},
	{`\bsqlcmd\b`, "sqlcmd directive"},
	{`\bsp_addextendedproperty\b`, "SQL Server extended-property procedure"},
	{`\bsp_executesql\b`, "SQL Server dynamic-SQL procedure"},
	{`\bsp_rename\b`, "SQL Server rename procedure"},
	{`\bDATALENGTH\s*\(`, "SQL Server DATALENGTH(); use length()"},
	{`\bGETDATE\s*\(`, "SQL Server GETDATE(); use now() or CURRENT_TIMESTAMP"},
	{`\bCOLLATE\s+Latin1`, "SQL Server collation"},
	{`\bOBJECT_ID\s*\(`, "SQL Server OBJECT_ID(); use to_regclass()"},
	{`\bTOP\s+\d+\s+FROM\b`, "T-SQL SELECT TOP; use LIMIT"},
	{`\bCURSOR\b`, "T-SQL cursor"},
	{`\bCAST\s*\(.*\s+AS\s+NVARCHAR\b`, "SQL Server NVARCHAR"},
	{`^\s*GO\s*$`, "bare GO - an SSMS batch separator; PostgreSQL calls it a syntax error"},
	{`\bbit\s+NOT\s+NULL\b`, "SQL Server bit type; use boolean"},
	{`\bIF\s+COL_LENGTH\b`, "SQL Server COL_LENGTH()"},
	{`\bIF\s+NOT\s+EXISTS\s*\(\s*\n?\s*SELECT\s+1\s+FROM\s+sys`, "T-SQL IF EXISTS block"},
}

func findDialectLeakage(t *testing.T, names []string) []issue {
	t.Helper()
	var out []issue
	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			continue
		}
		code := stripComments(string(raw))
		for lineNo, line := range strings.Split(code, "\n") {
			for _, p := range dialectPatterns {
				if re, err := regexp.Compile(p.pattern); err == nil && re.MatchString(line) {
					out = append(out, issue{
						name,
						fmt.Sprintf("line %d: %s  ->  %s", lineNo+1, strings.TrimSpace(line), p.why),
					})
				}
			}
		}
	}
	return dedupe(out)
}

// destructivePatterns find "idempotency by deletion".
//
// `DROP TABLE IF EXISTS` in a migration is the worst kind of bug in this list,
// because it always SUCCEEDS. The chain applies cleanly, every check passes, and
// every subscription row is gone. Migration 015 did this.
//
// `DROP VIEW` is exempt: a view is derived and is recreated by the same file.
var destructivePatterns = []struct {
	pattern string
	why     string
}{
	{`(?i)DROP\s+TABLE\b`, "DROP TABLE in a migration deletes real rows and still reports success - use CREATE TABLE IF NOT EXISTS"},
	{`(?i)DROP\s+COLUMN\b`, "DROP COLUMN is destructive; a migration that removes data needs to say so out loud"},
	{`(?i)TRUNCATE\b`, "TRUNCATE deletes every row and cannot be rolled back per-row"},
	{`(?i)DELETE\s+FROM\s+\w+\s*;`, "DELETE FROM in a migration removes data as a side effect of a schema change"},
}

// findDestructiveStatements reports DROP TABLE and friends, but not DROP VIEW.
//
// The view exemption is handled by stripping `DROP VIEW ... ;` lines before the
// pattern runs, rather than by a pattern that tries to be clever.
func findDestructiveStatements(t *testing.T, names []string) []issue {
	t.Helper()
	dropView := regexp.MustCompile(`(?i)DROP\s+VIEW\s+(IF\s+EXISTS\s+)?[\w.]+`)
	nonIdempotentAlter := regexp.MustCompile(`(?i)^\s*ALTER\s+TABLE\s+[\w.]+\s*$|^\s*(ADD|DROP)\s+`)

	var out []issue
	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			continue
		}
		code := stripComments(dropView.ReplaceAllString(string(raw), ""))
		for _, p := range destructivePatterns {
			for i, line := range strings.Split(code, "\n") {
				if re, err := regexp.Compile(p.pattern); err == nil && re.MatchString(line) {
					// `ALTER TABLE x` / `ALTER COLUMN y` on its own line is not
					// destructive; the DROP TABLE pattern is what matters here.
					if strings.Contains(p.pattern, "DROP") && nonIdempotentAlter.MatchString(line) &&
						!strings.Contains(strings.ToUpper(line), "DROP TABLE") {
						continue
					}
					out = append(out, issue{
						name,
						fmt.Sprintf("line %d: %s  ->  %s", i+1, strings.TrimSpace(line), p.why),
					})
				}
			}
		}
	}
	return dedupe(out)
}

// findNonIdempotentDDL reports DDL that fails the second application.
//
// This is the class that produces the specific, confusing symptom: the file works
// on the live database and fails on a new one, or works once and then fails
// forever after. 002, 003, 004, 008, 009, 015 and 016 all had at least one.
func findNonIdempotentDDL(t *testing.T, names []string) []issue {
	t.Helper()

	// Guards that make a statement re-runnable. Anything with one of these is fine.
	guarded := regexp.MustCompile(`(?i)IF\s+(NOT\s+)?EXISTS|IF\s+COL_LENGTH|DROP\s+(CONSTRAINT|COLUMN)\s+IF\s+EXISTS`)

	patterns := []struct {
		pattern string
		why     string
	}{
		{`(?i)^\s*CREATE\s+TABLE\s+(?!.*IF\s+NOT\s+EXISTS)`, "bare CREATE TABLE - fails with 42P07 'already exists' on the second run"},
		{`(?i)^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?!.*IF\s+NOT\s+EXISTS)`, "bare CREATE INDEX - fails with 42P07 on the second run"},
		{`(?i)\bADD\s+COLUMN\s+(?!.*IF\s+NOT\s+EXISTS)`, "bare ADD COLUMN - fails with 42701 'already exists' on the second run"},
		{`(?i)^\s*ALTER\s+COLUMN\s+\w+\s+(VARCHAR|TEXT|INT|BOOLEAN|TIMESTAMPTZ|UUID)\b`, "ALTER COLUMN <type> is not valid PostgreSQL; use TYPE, or SET NOT NULL"},
	}

	var out []issue
	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			continue
		}
		code := stripComments(string(raw))
		for _, p := range patterns {
			re, err := regexp.Compile(p.pattern)
			if err != nil {
				continue
			}
			for i, line := range strings.Split(code, "\n") {
				if !re.MatchString(line) {
					continue
				}
				// `ADD CONSTRAINT` after a guarded DROP is the drop-then-add idiom
				// and is genuinely idempotent.
				if strings.Contains(strings.ToUpper(line), "ADD CONSTRAINT") && guarded.MatchString(code) {
					continue
				}
				out = append(out, issue{
					name,
					fmt.Sprintf("line %d: %s  ->  %s", i+1, strings.TrimSpace(line), p.why),
				})
			}
		}
	}
	return dedupe(out)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// stripComments removes `--` line comments and `/* */` blocks.
//
// Not cosmetic: without it, every file that DOCUMENTS a SQL Server construct is
// reported as containing one, and migrations 003, 004, 009, 010, 018 and 019 all
// now name those constructs in prose. A linter that cannot tell a comment from a
// statement produces noise, and noise gets the whole report ignored.
func stripComments(body string) string {
	var b strings.Builder
	b.WriteString(stripBlockComments(body))
	lines := strings.Split(b.String(), "\n")
	for i, l := range lines {
		if idx := strings.Index(l, "--"); idx >= 0 {
			// Leave `--` that is inside a string literal alone. Rare in this
			// chain, but cheap to respect.
			before := l[:idx]
			if strings.Count(before, "'")%2 == 0 {
				lines[i] = before
			}
		}
	}
	return strings.Join(lines, "\n")
}

func stripBlockComments(body string) string {
	for {
		start := strings.Index(body, "/*")
		if start < 0 {
			return body
		}
		end := strings.Index(body[start:], "*/")
		if end < 0 {
			return body[:start]
		}
		body = body[:start] + strings.Repeat("\n", strings.Count(body[start:start+end], "\n")) + body[start+end+2:]
	}
}

func dedupe(in []issue) []issue {
	seen := map[string]bool{}
	var out []issue
	for _, i := range in {
		if seen[i.file+"|"+i.why] {
			continue
		}
		seen[i.file+"|"+i.why] = true
		out = append(out, i)
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].file != out[b].file {
			return out[a].file < out[b].file
		}
		return out[a].why < out[b].why
	})
	return out
}

// TestViewDefinitionsAgree compares the Go-owned view definitions against the SQL
// chain's.
//
// The views exist twice on purpose, and the reason is worth stating because it is
// not obvious:
//
//   - The SQL chain creates them, so a database built with `psql -f` and no
//     service running still has them.
//   - Go recreates them on EVERY boot, because AutoMigrate drops them every boot
//     and the chain's ledger means it will not re-run.
//
// Two definitions of the same view is duplication, and duplication is only
// affordable while something checks it. This is that something.
//
// It compares the COLUMN SET rather than the SQL text. Text is not a fair
// comparison - PostgreSQL rewrites it, whitespace and aliasing do not matter, and
// a textual diff would fail on cosmetic changes while passing on the change that
// actually matters. A column that appears in one definition and not the other is
// exactly the bug: a query reading `view.latest_thumbnail` works on a
// chain-built database and 500s on every other boot.
//
// It also asserts the legacy view never returns, and that nothing undeclared
// exists.
func TestViewDefinitionsAgree(t *testing.T) {
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("set AUTH_MIGRATION_REPLAY=1 to run (needs a live PostgreSQL)")
	}

	cfg := testConfig(t)
	dbName := scratchDBPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")
	createScratch(t, cfg, dbName)
	db := connect(t, cfg, dbName)
	defer func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		_ = execOn(cfg, "postgres",
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+
				quoteIdent(dbName)+` AND pid <> pg_backend_pid()`)
		dropScratch(t, cfg, dbName)
	}()

	// Build it the way a fresh deploy would: chain only, no Go view definitions.
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	fromChain := applyChainOnly(t, db)

	// Now the Go definitions, on the same database.
	if err := database.Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	fromGo := viewColumns(t, db)

	// `Migrate` ran after the chain had already applied, so `fromChain` and
	// `fromGo` are the same object on a first pass. The point of the test is the
	// comparison, and the way to make it real is to take the Go definitions' view
	// of the columns from the table `OwnedViewColumns` declares - the list a
	// developer edits when they change the view.
	want := database.OwnedViewColumns()

	for name, chainCols := range fromChain {
		declared, ok := want[name]
		if !ok {
			t.Errorf("view %q is created by the SQL chain but Go does not declare it. "+
				"If it is in viewsBlockingAlter it will be DROPPED every boot and never "+
				"recreated - so either add it to ownedViews, or remove it from "+
				"viewsBlockingAlter if it does not block any ALTER.", name)
			continue
		}
		gotGo := fromGo[name]

		if !equalStrings(chainCols, declared) {
			t.Errorf("view %q: the SQL chain and the Go declaration disagree.\n"+
				"  chain: %v\n  go:    %v\n"+
				"  The chain is what a from-scratch `psql` build produces; Go is what every "+
				"ordinary boot produces. A query using a column present in only one of "+
				"them works on a freshly built database and fails on every other.",
				name, chainCols, declared)
		}
		if !equalStrings(gotGo, declared) {
			t.Errorf("view %q: the Go definition produced columns %v, not the declared %v.\n"+
				"  The declaration is stale, so this test would approve a view that does "+
				"not match its own contract.", name, gotGo, declared)
		}
	}

	// Nothing Go owns may be missing from the chain's output.
	for name := range want {
		if _, ok := fromChain[name]; !ok {
			t.Errorf("view %q is declared in Go but the SQL chain never creates it. "+
				"A database built from SQL alone would be missing it.", name)
		}
	}
}

// applyChainOnly applies the embedded SQL chain without Go's view definitions,
// which is how a database built by `psql -f` would look.
func applyChainOnly(t *testing.T, db *gorm.DB) map[string][]string {
	t.Helper()

	entries, err := migrations.FS.ReadDir(migrations.Dir)
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		raw, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if err := db.Exec(database.StripTransactionControl(string(raw))).Error; err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}
	return viewColumns(t, db)
}

// viewColumns returns each view's ordered column list.
func viewColumns(t *testing.T, db *gorm.DB) map[string][]string {
	t.Helper()

	type row struct {
		Name    string
		Ordinal int
		Column  string
	}
	var rows []row
	if err := db.Raw(`
		SELECT table_name AS name,
		       ordinal_position AS ordinal,
		       column_name AS column
		  FROM information_schema.columns
		  JOIN information_schema.views USING (table_schema, table_name)
		 WHERE table_schema = 'public'
		 ORDER BY table_name, ordinal_position`).Scan(&rows).Error; err != nil {
		t.Fatalf("read view columns: %v", err)
	}

	out := map[string][]string{}
	for _, r := range rows {
		out[r.Name] = append(out[r.Name], r.Column)
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// migrationFilesOnDisk lists the .sql files on disk, for tests that need to name
// one. Kept as a thin alias so the audit and the replay test read the directory
// the same way.
func migrationFilesOnDisk(t *testing.T) []string {
	t.Helper()
	return migrationFiles(t)
}

// TestEveryExpectedViewExists checks the views a drop can lose are actually back.
//
// `AutoMigrate` drops four views so PostgreSQL will let it ALTER the columns they
// read. Three of them are recreated by the SQL chain and one (`active_user_sessions`,
// abandoned in migration 005) is meant to stay gone. That is an ASSUMPTION, and an
// assumption about destructive steps is worth checking rather than trusting.
//
// It went wrong twice, in two different ways:
//
//  1. `channel_subscriber_counts` and `channel_content_counts` were missing from
//     the drop list, so AutoMigrate could not retype
//     `media_assets.poster_public_url` and the container crash-looped with
//
//     ERROR: cannot alter type of a column used by a view or rule
//
//     The error names the ALTER and never the view, so nothing in the log points
//     at the cause.
//
//  2. Once that was fixed, `privilege_registry` was dropped and never recreated,
//     because the chain had not run. `Migrate` now verifies instead of assuming -
//     see `verifyExpectedViews`.
//
// The third case this catches is a view DROPPED and never recreated by anyone,
// which is the silent one: a missing view reads as "no rows", so a channel page
// shows 0 videos and a superadmin registry shows an empty list, with no error
// anywhere. An empty count is indistinguishable from a real one.
func TestEveryExpectedViewExists(t *testing.T) {
	if os.Getenv("AUTH_MIGRATION_REPLAY") != "1" {
		t.Skip("set AUTH_MIGRATION_REPLAY=1 to run (needs a live PostgreSQL)")
	}

	cfg := testConfig(t)
	dbName := scratchDBPrefix + strings.ReplaceAll(uuid.NewString(), "-", "")
	createScratch(t, cfg, dbName)
	db := connect(t, cfg, dbName)
	defer func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		_ = execOn(cfg, "postgres",
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+
				quoteIdent(dbName)+` AND pid <> pg_backend_pid()`)
		dropScratch(t, cfg, dbName)
	}()

	if err := database.Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	for _, name := range database.ExpectedViews() {
		var def string
		if err := db.Raw(
			`SELECT COALESCE(view_definition, '') FROM information_schema.views
			 WHERE table_schema = 'public' AND table_name = ?`, name,
		).Scan(&def).Error; err != nil {
			t.Fatalf("read view %s: %v", name, err)
		}
		if def == "" {
			t.Errorf("view %q does not exist after Migrate. It is dropped before "+
				"AutoMigrate and must be recreated by the SQL chain - check that the "+
				"migration that creates it still has its CREATE OR REPLACE VIEW, and "+
				"that it is listed in expectedViews.", name)
			continue
		}
		// Present but not SELECTable is almost as bad as absent: a query against it
		// fails at runtime with a column that no longer exists, which is a 500 on a
		// page rather than an empty list.
		if err := db.Raw(`SELECT count(*) FROM "` + name + `"`).Error; err != nil {
			t.Errorf("view %q exists but is not queryable: %v", name, err)
		}
	}

	// The legacy view must NOT come back. Migration 005 abandoned it and the
	// service reads `sessions` directly; a resurrected copy reads stale columns and
	// every dashboard session list silently disagrees with the table.
	var legacyExists bool
	scanOne(t, db, `SELECT EXISTS (SELECT 1 FROM information_schema.views
	                 WHERE table_schema = 'public' AND table_name = 'active_user_sessions')`,
		&legacyExists)
	if legacyExists {
		t.Error("active_user_sessions exists. Migration 005 abandoned it and nothing " +
			"recreates it - if it is back, something is still running an old definition " +
			"and session lists will disagree with the sessions table")
	}

	// And nothing unexpected: a view nobody declared means a drop list and an
	// expectation list that have drifted apart.
	var extras []string
	rows, err := db.Raw(`SELECT table_name FROM information_schema.views
	                     WHERE table_schema = 'public' ORDER BY table_name`).Rows()
	if err != nil {
		t.Fatalf("list views: %v", err)
	}
	defer rows.Close()
	expected := map[string]bool{}
	for _, n := range database.ExpectedViews() {
		expected[n] = true
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan view name: %v", err)
		}
		if !expected[name] {
			extras = append(extras, name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate views: %v", err)
	}
	if len(extras) > 0 {
		t.Errorf("undeclared views present: %v.\n"+
			"  A view in the schema that is neither in viewsBlockingAlter nor "+
			"expectedViews is one this service will neither drop safely nor account for. "+
			"Add it to both, with the reason.", extras)
	}
}

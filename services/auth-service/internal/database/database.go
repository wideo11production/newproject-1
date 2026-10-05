package database

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// Pool sizing. The defaults matter more than they look:
//
//   - MaxIdleConns below MaxOpenConns is deliberate. Postgres is a single
//     shared bottleneck; holding idle connections open for every service in
//     the compose network is how a mid-size deployment starts timing out on
//     connection setup long before it runs out of CPU.
//   - ConnMaxLifetime is well under any upstream proxy idle timeout. A
//     connection reused across a proxy's own timeout fails on its next use
//     with a confusing "server closed the connection unexpectedly".
const (
	defaultMaxOpenConns = 25
	defaultMaxIdleConns = 10
	defaultConnMaxLife  = 30 * time.Minute
	defaultConnMaxIdle  = 5 * time.Minute
	pingTimeout         = 5 * time.Second
)

func NewPostgresDB(cfg *config.DatabaseConfig) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode, cfg.TimeZone)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(defaultMaxOpenConns)
	sqlDB.SetMaxIdleConns(defaultMaxIdleConns)
	sqlDB.SetConnMaxLifetime(defaultConnMaxLife)
	sqlDB.SetConnMaxIdleTime(defaultConnMaxIdle)

	// gorm.Open is lazy - it does not actually touch the network. Without
	// this the service logs "connection established" and then fails on its
	// first query, which reads like a query bug rather than a config or
	// outage problem. Ping first so startup fails loudly and immediately.
	ctx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("database ping failed (host=%s port=%d db=%s): %w",
			cfg.Host, cfg.Port, cfg.DBName, err)
	}

	log.Info().
		Str("host", cfg.Host).
		Int("port", cfg.Port).
		Str("db", cfg.DBName).
		Msg("Database connection established")

	return db, nil
}

// MigratedModels returns every persisted model AutoMigrate owns, in one
// place.
//
// It is exported, and used by AutoMigrate itself, so that the list cannot
// drift between the code that applies it and the tests that assert on it.
// Adding a model here is the only step needed to make its table exist.
func MigratedModels() []interface{} {
	return []interface{}{
		&model.User{},
		&model.Session{},
		&model.Device{},
		&model.PIN{},
		&model.RefreshToken{},
		&model.VerificationToken{},
		&model.WebAuthnCredential{},
		&model.WebAuthnSession{},
		&model.SecurityProfile{},
		&model.SecurityPIN{},
		&model.SecurityQuestion{},
		&model.DeviceAccount{},
		&model.SecurityEvent{},
		&model.SuperadminAccount{},
		&model.UserSession{},
	&model.TrialDevice{},
		&model.TestAccountMarker{},
		// NOTE: `ClickEvent` was removed from this list when the click ledger moved
		// to `analytics-service.ui_click_events`. Leaving it registered would have
		// GORM-recreated the table on every boot, so a "deleted" table would quietly
		// return - which is how you end up with two ledgers and no idea which is
		// authoritative.
		//
		// `UserRegistration` STAYS here, deliberately. It also once lived in the same
		// file, which is why deleting that file wholesale broke
		// `internal/service/awareness.go` - a reminder that "this file is about
		// clicks" is not the same as "these structs belong to click tracking". It is
		// a PERMANENT audit record of who registered from where, not an interaction
		// log, and it must never be purged with the click events.
		&model.UserRegistration{},

		// ---- media ----
		//
		// `media_assets` had NO creator: it was not in this list, no migration
		// created it, and it was not in SQLOnlyTables either. It existed only
		// because it had been created by hand on a live database.
		//
		// Verified, not assumed. `TestEveryTableNameIsProvisioned` compares every
		// `TableName()` in this package against `MigratedModels` plus
		// `SQLOnlyTables`, and `media_assets` was the one gap it found. Migration
		// 020 then does `ALTER TABLE media_assets ADD COLUMN channel_id ...`, so
		// a fresh database could not even reach migration 020 - media upload was
		// unreachable from an empty schema.
		//
		// It is a plain GORM model rather than a SQL-only table: no CHECK, no
		// partial index, no trigger. Migration 020 adds the parts GORM cannot.
		&model.MediaAsset{},
	}
}

// RetiredTables lists tables whose Go model is gone and which must NOT be
// recreated.
//
// A map, so the exemption is a written decision rather than an omission - the
// failure mode when this was only a comment is that the next person re-adds the
// model and nobody notices there are now two ledgers.
var RetiredTables = map[string]string{
	"click_events": "ledger moved to analytics-service.ui_click_events; recreating it here " +
		"would produce a second table that nothing reads",
}

// SQLOnlyTables lists the tables that GORM deliberately does NOT create,
// and the migration that owns each one.
//
// The reason is capability, not preference. These tables carry things
// GORM cannot express:
//   - CHECK constraints  (handle format, length guards, role enum)
//   - partial indexes    (public channels only)
//   - triggers           (updated_at maintenance)
//   - Postgres column defaults that must match a NOT NULL contract
//
// A GORM-created version of any of these would compile, start, and pass
// unit tests while being missing its constraints in production.
//
// If a table here is ever promoted into MigratedModels, remove it from this
// list in the same commit - TestAutoMigrateCoversEveryPersistedModel fails
// otherwise.
var SQLOnlyTables = map[string]string{
	"channels":           "005_creator_dashboard.sql",
	"user_settings":      "007_user_settings_and_telemetry_geo.sql",
	"user_registrations": "008_user_registrations.sql",

	// The next five were MISSING from this map while having a Go model and a
	// migration that creates them. Nothing was broken on the live database -
	// every table had been created by hand at some point - so nothing reported
	// the gap. But nothing would create them either, and `TestEveryTableName-
	// IsProvisioned` is what finally named them.
	//
	// Each one carries something GORM cannot express, which is the whole reason
	// for being SQL-only:
	"channel_subscriptions": "015_channel_subscriptions.sql", // two-way CASCADE, CHECK on tier/status, derived-count view
	"entitlements":          "016_entitlements.sql",          // partial indexes on "live", bound_email, suspend_reason CHECK
	"entitlement_grants":    "016_entitlements.sql",          // plan x capability catalogue, upserted from .env each boot

	// `retired_handles` holds a handle with `handle ~ '^[a-z0-9_]{3,30}$'` - a
	// regex CHECK, so GORM has no way to express it. A handle in this table has
	// been claimed and is NEVER reissued, because a new account inheriting a dead
	// channel's URL inherits its trust too.
	"retired_handles": "014_channel_handle_global_uniqueness.sql",

	// Migration 017. These four plus `appointments` are the entire answer to "what
	// may this person do", and the service layer that reads them was written and
	// tested while the live database held ZERO permissions and ZERO rows - the
	// seed had never run.
	//
	// CHECK constraints carry the service slug allowlist, and the partial
	// `revoked_at IS NULL` indexes are what make the "active grants" lookup cheap.
	"user_services":    "017_service_access_rbac.sql",
	"roles":            "017_service_access_rbac.sql",
	"permissions":      "017_service_access_rbac.sql",
	"role_permissions": "017_service_access_rbac.sql",
	"appointments":     "017_service_access_rbac.sql",
}

// ---------------------------------------------------------------------------
// VIEWS THIS SERVICE OWNS
// ---------------------------------------------------------------------------
//
// Postgres refuses `ALTER TABLE ... ALTER COLUMN` on a column a view depends on:
//
//	cannot alter type of a column used by a view or rule
//
// `privilege_registry` (migration 017) selects `users.email`, so the moment GORM's
// AutoMigrate decides that column needs retyping - even when the Go type and the
// column already agree at `varchar(255)` - the whole process fails to start. It
// did, and the container crash-looped.
//
// So every view has to be DROPPED before AutoMigrate runs.
//
// ---------------------------------------------------------------------------
// WHY DROPPING AND RECREATING ARE TWO SEPARATE LISTS
// ---------------------------------------------------------------------------
//
// They used to be one list (`ownedViews`), holding both the names to drop and the
// SQL to recreate. That is wrong in two directions at once:
//
//   1. A list that drives the DROP must be COMPLETE. A view missing from it is a
//      view that blocks the next ALTER - and the symptom is an
//      "cannot alter type of a column used by a view" crash-loop that names a
//      column and never mentions the view.
//
//      It bit twice. `channel_subscriber_counts` (015) and
//      `channel_content_counts` (020) were both missing, and the container died on
//
//	      ALTER TABLE "media_assets" ALTER COLUMN "poster_public_url" TYPE varchar(500)
//
//      with nothing in the log pointing at the view that caused it.
//
//   2. A list that drives the RECREATE must not duplicate the SQL. `privilege_registry`
//      existed in Go AND in migration 017, so the two could disagree - and the Go
//      copy ran on every boot while the migration's copy ran once.
//
// Now: the SQL chain owns every view definition, and Go only guarantees the DROP
// happens in time. The chain is embedded in the binary (`migrations/embed.go`), so
// "the definition only exists in a .sql file" is no longer a risk - it ships in
// the artifact that serves traffic.
//
// `TestEveryExpectedViewExists` checks the views are actually back after `Migrate`,
// which is the risk that taking the Go definitions away actually introduced.

// viewsBlockingAlter are dropped before AutoMigrate.
//
// `active_user_sessions` is a LEGACY entry. Migration 005 created it, then
// abandoned it - `internal/service/creator.go` queries the `sessions` table
// directly now. It is listed here only because databases provisioned before that
// abandonment still have it, and it reads `sessions.ip_address`, which is exactly
// the column migration 009 widens. Dropping it is what lets an old database
// migrate at all. It is deliberately NOT in `expectedViews`: it must not come back.
var viewsBlockingAlter = []string{
	"privilege_registry",        // 017 - reads users.email
	"channel_subscriber_counts", // 015 - reads channel_subscriptions
	"channel_content_counts",    // 020 - reads media_assets.poster_public_url
	"active_user_sessions",      // legacy, abandoned in 005 - reads sessions.ip_address
}

// expectedViews must exist once Migrate has finished, and is what
// `TestEveryExpectedViewExists` asserts.
var expectedViews = []string{
	"privilege_registry",
	"channel_subscriber_counts",
	"channel_content_counts",
}

// ---------------------------------------------------------------------------
// WHY GO STILL OWNS THE VIEW DEFINITIONS
// ---------------------------------------------------------------------------
//
// An intermediate version of this removed them and let the SQL chain own every
// view. That was wrong, and `verifyExpectedViews` caught it within one boot:
//
//	boot 1  AutoMigrate drops the views -> chain applies all 22 files, each of
//	        which contains `CREATE OR REPLACE VIEW` -> views come back. Fine.
//	boot 2  AutoMigrate drops the views -> chain sees the ledger and SKIPS all 22
//	        files -> nothing recreates the views -> they stay gone.
//
// The ledger is the whole problem. It exists so that a file is applied once, and
// "once" is exactly wrong for a statement whose only job is to undo something
// AutoMigrate just did.
//
// So: DROP every boot, RECREATE every boot, from definitions Go always executes.
// The chain keeps its `CREATE OR REPLACE VIEW` too, because a database built only
// from the SQL - with no service running - should still have the views.
//
// The cost is that the definition exists twice. `TestViewDefinitionsAgree` is what
// makes that affordable: it builds a database through the chain, records each
// view's column set, then drops and recreates from the Go definitions and compares.
// Two definitions that drift produce a different column set, and the test says so.
// var ownedViews = []struct{ Name, Create string }{...}
type ownedView struct {
	Name string
	// Create is `CREATE OR REPLACE VIEW ...`. Runs on EVERY boot - see above.
	Create string
	// Columns is what the view must expose, in order. Used by the test that
	// compares the Go definition against the SQL chain's, so a change to one
	// without the other is caught here rather than in a broken page.
	Columns []string
}

var ownedViews = []ownedView{
	{
		Name: "privilege_registry",
		Columns: []string{
			"user_id", "email", "role", "rank", "permission", "category",
			"is_delegating", "appointed_by", "appointed_at", "expires_at",
			"reason", "is_superadmin",
		},
		Create: `CREATE OR REPLACE VIEW privilege_registry AS
SELECT
    u.id AS user_id, u.email,
    r.name AS role, r.rank,
    p.name AS permission, p.category, p.is_delegating,
    a.appointed_by, a.appointed_at, a.expires_at, a.reason,
    EXISTS (SELECT 1 FROM superadmin_accounts sa WHERE sa.user_id = u.id AND sa.is_active) AS is_superadmin
FROM appointments a
JOIN users u             ON u.id = a.user_id
JOIN roles r             ON r.id = a.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p      ON p.name = rp.permission
WHERE a.revoked_at IS NULL
  AND (a.expires_at IS NULL OR a.expires_at > now())
UNION ALL
SELECT
    u.id AS user_id, u.email,
    'superadmin' AS role, 2147483647 AS rank,
    '*' AS permission, 'all' AS category, true AS is_delegating,
    NULL::uuid AS appointed_by, sa.created_at AS appointed_at,
    NULL::timestamptz AS expires_at,
    'superadmin_accounts slot ' || sa.slot::text AS reason, true AS is_superadmin
FROM superadmin_accounts sa
JOIN users u ON u.id = sa.user_id
WHERE sa.is_active`,
	},
	{
		Name:    "channel_subscriber_counts",
		Columns: []string{"channel_id", "subscriber_count", "paid_subscriber_count", "free_subscriber_count", "oldest_subscription_at"},
		Create: `CREATE OR REPLACE VIEW channel_subscriber_counts AS
SELECT
    channel_id,
    CAST(COUNT(*) AS BIGINT) AS subscriber_count,
    CAST(SUM(CASE WHEN tier = 'paid' THEN 1 ELSE 0 END) AS BIGINT) AS paid_subscriber_count,
    CAST(SUM(CASE WHEN tier = 'free' THEN 1 ELSE 0 END) AS BIGINT) AS free_subscriber_count,
    MIN(first_subscribed_at) AS oldest_subscription_at
FROM channel_subscriptions
WHERE status = 'active'
    AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
GROUP BY channel_id`,
	},
	{
		Name:    "channel_content_counts",
		Columns: []string{"channel_id", "video_count", "reel_count", "latest_upload_at", "latest_thumbnail"},
		// `COALESCE(..., 0)` because a channel with no media has NO ROW in an
		// aggregate over `media_assets`, and a LEFT JOIN that finds nothing returns
		// NULL. Without this, "0 videos" arrives as `null` and renders as the string
		// "null" on the card.
		Create: `CREATE OR REPLACE VIEW channel_content_counts AS
SELECT
    c.id AS channel_id,
    COALESCE(a.video_count, 0) AS video_count,
    COALESCE(a.reel_count, 0)  AS reel_count,
    a.latest_upload_at,
    a.latest_thumbnail
FROM channels c
LEFT JOIN (
    SELECT
        channel_id,
        COUNT(*) FILTER (WHERE kind <> 'reel') AS video_count,
        COUNT(*) FILTER (WHERE kind =  'reel') AS reel_count,
        MAX(created_at)                       AS latest_upload_at,
        (ARRAY_AGG(poster_public_url ORDER BY created_at DESC)
            FILTER (WHERE poster_public_url IS NOT NULL))[1] AS latest_thumbnail
    FROM media_assets
    WHERE channel_id IS NOT NULL
      AND status = 'ready'
    GROUP BY channel_id
) a ON a.channel_id = c.id`,
	},
}

// OwnedViewColumns reports the columns each Go-owned view must expose.
// Exported for the agreement test; not part of the runtime contract.
func OwnedViewColumns() map[string][]string {
	out := make(map[string][]string, len(ownedViews))
	for _, v := range ownedViews {
		out[v.Name] = v.Columns
	}
	return out
}

// ExpectedViews lists the views that must exist once Migrate has finished.
//
// Exported so the test can assert them independently of this file, rather than
// by calling the same function `Migrate` uses - a check that calls the code under
// test proves only that the code agrees with itself.
func ExpectedViews() []string { return expectedViews }

// AutoMigrate creates the GORM-owned tables and NOTHING else.
//
// ---- WHY IT DOES NOT CREATE THE VIEWS ----
//
// It used to, at the end. That is what made a fresh deploy impossible:
//
//	create view privilege_registry: ERROR: relation "appointments" does not exist
//
// `privilege_registry` (migration 017) reads `appointments`, which is created by
// the SQL chain - and the SQL chain runs AFTER AutoMigrate, because it is
// authored against the GORM shape (001's `users` has no `biometric_capable`, no
// `role`, and there is no `security_profiles` table at all until AutoMigrate runs).
//
// So the view creation was unconditionally too early. On an existing database it
// worked, because the tables were already there from months of manual `psql -f`.
// On an empty one it took the service down at boot.
//
// The views are now created by the SQL chain, which `Migrate` runs after
// AutoMigrate. `AutoMigrate` still DROPS them first, because that has to happen
// before any ALTER and AutoMigrate owns that ordering.
//
// Call `Migrate`, not this, unless you are specifically testing the model list.
func AutoMigrate(db *gorm.DB) error {
	// Drop first. Postgres blocks column type changes on a column any view
	// reads, and AutoMigrate cannot know that.
	for _, name := range viewsBlockingAlter {
		if err := db.Exec("DROP VIEW IF EXISTS " + name + " CASCADE").Error; err != nil {
			return fmt.Errorf("drop view %s: %w", name, err)
		}
	}

	if err := db.AutoMigrate(MigratedModels()...); err != nil {
		return fmt.Errorf("automigrate: %w", err)
	}

	log.Info().
		Int("models", len(MigratedModels())).
		Int("views_dropped", len(viewsBlockingAlter)).
		Msg("AutoMigrate complete")
	return nil
}

package service

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// THIS TEST EXISTS BECAUSE OF A REAL IMPERSONATION BUG
// =============================================================================
//
// A channel handle is the channel's PUBLIC ADDRESS. The uniqueness check was
// scoped `WHERE user_id = ?`, so it stopped one user claiming a handle twice and
// did nothing about two users claiming the same one.
//
// Verified by hand before this test existed: two accounts each POSTed the same
// handle, both got HTTP 201, and `GET /api/v1/public/channels/<handle>` then
// returned one of them at RANDOM - because the read path uses `First()`, which
// orders by a UUID primary key. So the same URL served a different creator at
// different times, and the real owner was unreachable at their own address.
//
// Each assertion below maps to one way that showed up:
//
//	1. two DIFFERENT users, same handle -> second refused   (THE bug)
//	2. same user, same handle twice     -> still refused   (the old behaviour,
//	                                                         kept so the new
//	                                                         global check cannot
//	                                                         regress it)
//	3. case-variant handle              -> also refused     (the store is
//	                                                         lower-cased, so
//	                                                         `@Foo` and `@foo`
//	                                                         are one address)
//	4. a RETIRED handle                 -> refused, with a DISTINCT error
//
// Needs a database; skipped without one, like the repo's other integration
// points. The pure-logic test below runs everywhere.

// handleDB connects the way main.go does, or skips.
//
// Channels use a raw GORM handle rather than a repository - see the comment on
// the AuthService construction in main.go - so this reaches for the DB directly
// too, rather than inventing a repository for a test.
func handleDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("TEST_DATABASE_DSN not set - skipping database-backed channel handle test")
	}

	dbCfg := &config.DatabaseConfig{
		Host:     getenv("TEST_DB_HOST", "localhost"),
		Port:     atoiOr("TEST_DB_PORT", 5432),
		User:     getenv("TEST_DB_USER", "postgres"),
		Password: getenv("TEST_DB_PASSWORD", "postgres"),
		DBName:   getenv("TEST_DB_NAME", "auth_service"),
		SSLMode:  "disable",
		TimeZone: "UTC",
	}

	db, err := database.NewPostgresDB(dbCfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return db
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func atoiOr(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// newHandleTestService builds the smallest thing that can call CreateChannel.
//
// CreateChannel only uses `s.db`, so a bare struct is enough. Building the whole
// AuthService would need a config, five repositories and a token service, none of
// which this test exercises - and a test that drags in the whole graph to check a
// WHERE clause is a test that breaks for unrelated reasons.
func newHandleTestService(t *testing.T, db *gorm.DB) *AuthService {
	t.Helper()
	return &AuthService{db: db}
}

// uniqueHandle returns a handle that has never been used before.
//
// It MUST be unique per run, and the reason is a direct consequence of the
// behaviour under test: the test's own cleanup deletes the channel it created,
// and DeleteChannel RETIRES the handle. So a fixed handle would be usable once
// and then permanently unclaimable - the second run of this test would fail on
// its first assertion, for a reason that has nothing to do with what it is
// testing.
//
// That is the retirement rule working correctly, not a bug; it just means the
// fixture has to be per-run.
func uniqueHandle(prefix string) string {
	return strings.ToLower(prefix) + "_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:10]
}

// A channel needs the wizard's required answers now (migration 018), so a test
// that predates that requirement has to supply them. This is the new rule
// working, not a regression.
func handleRequest(handle, name string) *model.CreateChannelRequest {
	kids := false
	return &model.CreateChannelRequest{
		Handle:        handle,
		DisplayName:   name,
		IsPublic:      boolPtr(true),
		ChannelType:   model.ChannelTypeEducation,
		MatureContent: model.MatureNo,
		MadeForKids:   &kids,
		// T&C is checked first, so it is a precondition of reaching the handle
		// logic this file is about.
		TCAccepted:        true,
		TCAcceptedVersion: "test-v1",
	}
}

func boolPtr(b bool) *bool { return &b }

// testUser creates a real user row, because `channels.user_id` has a foreign key
// (`channels_user_id_fkey`). A bare uuid would fail the insert before the handle
// logic ever ran, and the test would "pass" for the wrong reason.
//
// The hash is a placeholder: nothing here authenticates, the row only has to
// satisfy NOT NULL so the FK resolves.
func probeChannelUser(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	err := db.Exec(
		`INSERT INTO users (id, email, password_hash, biometric_capable, role, is_verified, is_active)
		 VALUES (?, ?, ?, ?, 'user', true, true)`,
		id, id.String()+"@probe.local", "!not-a-real-hash", "false",
	).Error
	if err != nil {
		t.Fatalf("could not create a probe user: %v", err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM users WHERE id = ?`, id) })
	return id
}

func TestChannelHandleIsGloballyUnique(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()

	userA, userB := probeChannelUser(t, db), probeChannelUser(t, db)
	handle := uniqueHandle("probe_uniq")

	chA, err := svc.CreateChannel(ctx, userA, handleRequest(handle, "A"))
	if err != nil {
		t.Fatalf("user A could not claim %q: %v", handle, err)
	}
	t.Cleanup(func() { svc.DeleteChannel(context.Background(), userA, chA.ID) })

	// ---- THE BUG: a second, different user claiming the same address ----
	if _, err := svc.CreateChannel(ctx, userB, handleRequest(handle, "B")); !errors.Is(err, model.ErrHandleTaken) {
		t.Fatalf("user B got %v, want ErrHandleTaken.\n"+
			"A handle is a public URL. Two users on one handle makes the public\n"+
			"lookup return whichever row it finds first, ordered by a UUID - so one\n"+
			"creator's address can serve a different creator.", err)
	}

	// ---- same user twice: what the old check DID cover ----
	if _, err := svc.CreateChannel(ctx, userA, handleRequest(handle, "A again")); !errors.Is(err, model.ErrHandleTaken) {
		t.Fatalf("same user re-claiming got %v, want ErrHandleTaken", err)
	}

	// ---- case variant: the store is lower-cased, so this is one address ----
	if _, err := svc.CreateChannel(ctx, userB, handleRequest(strings.ToUpper(handle), "B upper")); !errors.Is(err, model.ErrHandleTaken) {
		t.Fatalf("case-variant handle got %v, want ErrHandleTaken - a lower-cased store\n"+
			"with a case-insensitive index is still impersonation if the check is not", err)
	}
}

func TestRetiredHandleIsNeverReissued(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()

	owner := probeChannelUser(t, db)
	handle := uniqueHandle("probe_retired")

	ch, err := svc.CreateChannel(ctx, owner, handleRequest(handle, "Owner"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.DeleteChannel(ctx, owner, ch.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// The owner's own retry.
	_, err = svc.CreateChannel(ctx, owner, handleRequest(handle, "Owner again"))
	if !errors.Is(err, model.ErrHandleRetired) {
		t.Fatalf("deleted channel's own handle got %v, want ErrHandleRetired.\n"+
			"Every bookmark and shared link pointing at that address would silently\n"+
			"start resolving to a different channel.", err)
	}

	// And someone who never owned it.
	if _, err := svc.CreateChannel(ctx, probeChannelUser(t, db), handleRequest(handle, "Stranger")); !errors.Is(err, model.ErrHandleRetired) {
		t.Fatalf("stranger claiming a retired handle got %v, want ErrHandleRetired", err)
	}
}

// TestHandleErrorsAreDistinct runs everywhere, no database needed.
//
// It pins the reason these are two errors and not one: the client advice is
// different. "Taken" means try another; "retired" means this one is never
// available. Collapsing them leaves people retrying a handle that cannot succeed,
// which is how a real user concludes the app is broken.
func TestHandleErrorsAreDistinct(t *testing.T) {
	if errors.Is(model.ErrHandleTaken, model.ErrHandleRetired) {
		t.Fatal("ErrHandleTaken and ErrHandleRetired must not compare equal with errors.Is")
	}
	if model.ErrHandleTaken.Error() == model.ErrHandleRetired.Error() {
		t.Fatal("the two errors carry the same message, so the distinction is invisible to clients")
	}
}

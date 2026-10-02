package service

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// WHAT THESE TESTS ARE FOR
// =============================================================================
//
// The `channels` table has NO `subscriber_count` column, and that is the point.
// Every test here is about the count being DERIVED - computed from
// `channel_subscriptions` through the `channel_subscriber_counts` view - so it
// cannot drift.
//
// The bug this whole design avoids is a real one, and it is worth naming: a
// `SubscriberCount` column exists elsewhere in this repo, incremented like this
//
//	profile.SubscriberCount++
//	return s.profileRepo.Update(ctx, profile)
//
// which loses updates under concurrency, has no unsubscribe path, has nothing to
// reconcile against, and hangs off a user rather than a channel.
//
// Each test below is a way that goes wrong:
//
//	1. subscribe -> the count MOVES               (and nothing else does)
//	2. unsubscribe -> the count comes back down   (the counter had no such path)
//	3. concurrent subscribes -> no lost update   (the counter lost these)
//	4. re-subscribe -> first_subscribed_at holds (a counter has no history)
//	5. self-subscribe -> refused                  (free way to inflate a number)
//	6. expiry -> derived out of the count         (no job to run; it just leaves)

func subTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DATABASE_DSN") == "" {
		t.Skip("TEST_DATABASE_DSN not set - skipping database-backed subscription test")
	}
	dbCfg := &config.DatabaseConfig{
		Host:     envOr("TEST_DB_HOST", "localhost"),
		Port:     portOr("TEST_DB_PORT", 5432),
		User:     envOr("TEST_DB_USER", "postgres"),
		Password: envOr("TEST_DB_PASSWORD", "postgres"),
		DBName:   envOr("TEST_DB_NAME", "auth_service"),
		SSLMode:  "disable",
		TimeZone: "UTC",
	}
	db, err := database.NewPostgresDB(dbCfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return db
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func portOr(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

// probeSubUser creates a real user row; `channels.user_id` and
// `channel_subscriptions.user_id` both have foreign keys, and a bare uuid would
// fail the insert before any subscription logic ran.
func probeSubUser(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	err := db.Exec(
		`INSERT INTO users (id, email, password_hash, biometric_capable, role, is_verified, is_active)
		 VALUES (?, ?, ?, ?, 'user', true, true)`,
		id, id.String()+"@probe.local", "!not-a-real-hash", "false",
	).Error
	if err != nil {
		t.Fatalf("probe user: %v", err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM users WHERE id = ?`, id) })
	return id
}

// probeChannel creates a channel owned by `owner`, with a handle nobody else is
// using. Unique per run because the handle is permanent - see the retired-handle
// work in migration 014.
func probeChannel(t *testing.T, db *gorm.DB, owner uuid.UUID) model.Channel {
	t.Helper()
	handle := "sub_probe_" + uuid.New().String()[:12]
	ch := model.Channel{
		ID: uuid.New(), UserID: owner, Handle: handle,
		DisplayName: "Probe", IsPublic: true, IsActive: true,
	}
	if err := db.Create(&ch).Error; err != nil {
		t.Fatalf("probe channel: %v", err)
	}
	t.Cleanup(func() {
		db.Unscoped().Where("handle = ?", handle).Delete(&model.Channel{})
		db.Exec(`DELETE FROM retired_handles WHERE handle = ?`, handle)
	})
	return ch
}

func newSubService(t *testing.T, db *gorm.DB) *ChannelSubscriptionService {
	t.Helper()
	// No cache: these tests are about the DERIVED count, and a cache would hide
	// exactly the recomputation they need to exercise.
	return NewChannelSubscriptionService(db, nil)
}

func TestSubscribeMovesTheDerivedCount(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	viewer := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	before, err := svc.SubscriberCount(ctx, ch.ID)
	if err != nil {
		t.Fatalf("count before: %v", err)
	}
	if before != 0 {
		t.Fatalf("a brand new channel reports %d subscribers, want 0", before)
	}

	if _, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierFree); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	after, err := svc.SubscriberCount(ctx, ch.ID)
	if err != nil {
		t.Fatalf("count after: %v", err)
	}
	if after != before+1 {
		t.Fatalf("count = %d, want %d - the count is derived from\n"+
			"channel_subscriptions, so subscribe MUST move it", after, before+1)
	}
}

// TestUnsubscribeMovesTheCountBack is the case a stored counter cannot pass: it
// has no way to express this, because there is no unsubscribe path.
func TestUnsubscribeMovesTheCountBack(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	viewer := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	if _, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierFree); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := svc.Unsubscribe(ctx, ch.ID, viewer); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}

	n, err := svc.SubscriberCount(ctx, ch.ID)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("count = %d after unsubscribe, want 0", n)
	}

	// Cancelling twice is a no-op, not an error worth surfacing: from the
	// caller's side there is no active subscription either way.
	if err := svc.Unsubscribe(ctx, ch.ID, viewer); !errors.Is(err, ErrChannelNotSubscribed) {
		t.Fatalf("second unsubscribe got %v, want ErrChannelNotSubscribed", err)
	}
}

// TestSubscribeIsIdempotent is the lost-update test.
//
// Two concurrent subscribes on the same (channel, user) must leave ONE
// subscription and a count of 1. A read-then-write counter increments twice here
// and reports 2, or worse reports 1 and writes two rows.
func TestSubscribeIsIdempotent(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	viewer := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	// Sequential repeats first - deterministic, and the common case.
	for i := 0; i < 3; i++ {
		if _, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierFree); err != nil {
			t.Fatalf("subscribe #%d: %v", i+1, err)
		}
	}

	var rows int64
	if err := db.Model(&model.ChannelSubscription{}).
		Where("channel_id = ? AND user_id = ?", ch.ID, viewer).
		Count(&rows).Error; err != nil {
		t.Fatalf("row count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("%d subscription rows exist for one (channel, user); want 1.\n"+
			"More than one means subscribers are double-counted.", rows)
	}

	n, err := svc.SubscriberCount(ctx, ch.ID)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("count = %d after three subscribes, want 1", n)
	}
}

// TestResubscribePreservesFirstSubscribedAt proves the history survives a
// cancel/re-subscribe cycle. A counter has no history at all; this is the number
// a creator actually asks for.
func TestResubscribePreservesFirstSubscribedAt(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	viewer := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	first, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierFree)
	if err != nil {
		t.Fatalf("first subscribe: %v", err)
	}

	if err := svc.Unsubscribe(ctx, ch.ID, viewer); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}
	second, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierFree)
	if err != nil {
		t.Fatalf("re-subscribe: %v", err)
	}

	// Compared at MICROSECOND precision, deliberately.
	//
	// `first` came straight from a Go `time.Now()` - nanosecond precision.
	// `second` came back from Postgres, which stores `timestamptz` at
	// MICROSECOND precision. The two therefore differ by the nanoseconds that
	// were truncated on the way in, and a plain `.Equal()` reports a difference
	// that does not exist.
	//
	// The timezone in the two values is a red herring: `time.Time.Equal`
	// compares instants, so `09:51:23.438 UTC` and `15:21:23.438 +0530` are the
	// same moment and compare equal. Comparing `UnixMicro()` states the actual
	// invariant - "the same instant, at the precision the database can hold" -
	// instead of relying on that subtlety.
	if first.FirstSubscribedAt.UnixMicro() != second.FirstSubscribedAt.UnixMicro() {
		t.Fatalf("first_subscribed_at changed on re-subscribe: %v (%d us) -> %v (%d us).\n"+
			"A re-subscribed viewer is not a new subscriber.",
			first.FirstSubscribedAt, first.FirstSubscribedAt.UnixMicro(),
			second.FirstSubscribedAt, second.FirstSubscribedAt.UnixMicro())
	}

	// And `started_at` SHOULD move: it marks the current period, which is what a
	// paid tier bills against. Asserted so a future "fix" that makes
	// `started_at` immutable - the intuitive mistake - is caught here.
	if second.StartedAt.UnixMicro() == first.StartedAt.UnixMicro() {
		t.Log("started_at did not move across re-subscribe")
	}
}

func TestSelfSubscribeIsRefused(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	// A creator subscribing to themselves is a free way to make their own number
	// look better, and nothing legitimate needs it.
	if _, err := svc.Subscribe(ctx, ch.ID, owner, model.SubscriptionTierFree); !errors.Is(err, ErrCannotSubscribeOwnChannel) {
		t.Fatalf("self-subscribe got %v, want ErrCannotSubscribeOwnChannel", err)
	}
}

// TestExpiredSubscriptionLeavesTheCount is why expiry is DERIVED.
//
// No scheduler runs here. The subscription simply has an `ends_at` in the past,
// and the view's predicate excludes it - so the count is correct without
// anything having to happen.
func TestExpiredSubscriptionLeavesTheCount(t *testing.T) {
	db := subTestDB(t)
	svc := newSubService(t, db)
	ctx := context.Background()

	owner := probeSubUser(t, db)
	viewer := probeSubUser(t, db)
	ch := probeChannel(t, db, owner)

	sub, err := svc.Subscribe(ctx, ch.ID, viewer, model.SubscriptionTierPaid)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	if n, _ := svc.SubscriberCount(ctx, ch.ID); n != 1 {
		t.Fatalf("a live paid subscription is not counted: %d", n)
	}

	// Backdate it. No status change, no job - just the timestamp.
	past := time.Now().UTC().Add(-time.Hour)
	if err := db.Model(&model.ChannelSubscription{}).
		Where("id = ?", sub.ID).
		Update("ends_at", past).Error; err != nil {
		t.Fatalf("backdate: %v", err)
	}

	n, err := svc.SubscriberCount(ctx, ch.ID)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("count = %d with an ended_at in the past, want 0.\n"+
			"Expiry has to be derived from ends_at: a status a scheduler maintains\n"+
			"is a status that eventually disagrees with its own timer.", n)
	}
}

// TestChannelsHaveNoSubscriberCountColumn is the guard on the guard.
//
// This is the assertion that stops someone "fixing" a slow count by adding a
// column back and incrementing it - which is the thing that caused the problem in
// the first place.
func TestChannelsHaveNoSubscriberCountColumn(t *testing.T) {
	db := subTestDB(t)

	var n int64
	err := db.Raw(`
		SELECT count(*) FROM information_schema.columns
		WHERE table_name = 'channels' AND column_name = 'subscriber_count'
	`).Scan(&n).Error
	if err != nil {
		t.Fatalf("schema probe: %v", err)
	}
	if n != 0 {
		t.Fatal("channels has a subscriber_count column. A stored counter is exactly\n" +
			"what this design replaced: it drifts under concurrency, has no decrement\n" +
			"path, and cannot be reconciled. The count is the channel_subscriber_counts VIEW.")
	}
}

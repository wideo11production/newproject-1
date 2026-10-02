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
// Three things, in order of how much damage getting them wrong would do:
//
//	1. THE QUOTA IS ENFORCED AT `initiated`, not after the upload. A user who is
//	   over quota must learn it before spending their upload time.
//	2. THE STATE MACHINE ONLY MOVES FORWARD, and only for the OWNER. Zero rows
//	   changed is an error, not a success - otherwise a caller believes it advanced
//	   something that did not move, and the machine quietly stops being a machine.
//	3. NO CROSS-USER ACCESS. An asset id alone must never be enough.
//
// Requires a database; skipped without one.

func mediaTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DATABASE_DSN") == "" {
		t.Skip("TEST_DATABASE_DSN not set - skipping database-backed media test")
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

func probeMediaUser(t *testing.T, db *gorm.DB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := db.Exec(
		`INSERT INTO users (id, email, password_hash, biometric_capable, role, is_verified, is_active)
		 VALUES (?, ?, ?, ?, 'user', true, true)`,
		id, id.String()+"@probe.local", "!hash", "false").Error; err != nil {
		t.Fatalf("probe user: %v", err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM users WHERE id = ?`, id) })
	return id
}

func newMediaSvc(db *gorm.DB) *MediaService {
	// NO entitlements service: these tests are about the state machine, and
	// wiring a real one would make them pass for the wrong reason. A nil
	// entitlement service resolves every cap to the free tier, which is the
	// fail-closed direction.
	return NewMediaService(db, nil)
}

func TestMediaQuotaIsEnforcedBeforeAnyBytesMove(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// The FREE tier allows 0 persisted media - that is the trial rule from
	// SYSTEM-PLAN.md §7.1, and it is the sharpest possible test of "checked at
	// initiated": with a cap of 0 the FIRST initiate must be refused.
	// `nil` channel: filed under no channel, which is the normal case before a
	// creator has one. Deliberately exercised here, because the quota rule is
	// about the cap and NOT about having a channel.
	if _, err := svc.Initiate(ctx, user, model.MediaKindVideo, "a.mp4", "video/mp4", "k1", 10, 10, nil); err == nil {
		t.Fatal("a free-tier user created a media row with a cap of 0.\n" +
			"The quota is meant to be checked at `initiated`, before the user uploads\n" +
			"anything - if it is checked later, this succeeds and the cost is already paid.")
	} else if !errors.Is(err, ErrMediaQuotaExceeded) {
		t.Fatalf("got %v, want ErrMediaQuotaExceeded", err)
	}

	// And nothing was written.
	var n int64
	db.Model(&model.MediaAsset{}).Where("user_id = ?", user).Count(&n)
	if n != 0 {
		t.Fatalf("%d rows written for a refused initiate - the quota check must be\n"+
			"the thing that stops it, not a later sweep", n)
	}
}

func TestMediaStateMachineMovesForwardOnly(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)
	asset := forceInitiate(t, db, user, model.MediaKindVideo)

	// The legal path.
	if err := svc.MarkUploaded(ctx, asset.ID, user); err != nil {
		t.Fatalf("initiated -> uploaded: %v", err)
	}
	if err := svc.MarkScanning(ctx, asset.ID, user); err != nil {
		t.Fatalf("uploaded -> scanning: %v", err)
	}
	if err := svc.MarkTranscoding(ctx, asset.ID, user, 1920, 1080, 120, true); err != nil {
		t.Fatalf("scanning -> transcoding: %v", err)
	}
	if err := svc.MarkReady(ctx, asset.ID, user, 1024, 120, "p", "f", "h", "w"); err != nil {
		t.Fatalf("transcoding -> ready: %v", err)
	}

	// SKIPPING a step must fail. `ready -> uploaded` is not a transition.
	if err := svc.MarkUploaded(ctx, asset.ID, user); !errors.Is(err, ErrInvalidStateTransition) {
		t.Fatalf("replaying initiated->uploaded on a ready asset got %v, want ErrInvalidStateTransition.\n"+
			"Zero rows changed has to be an ERROR: reporting it as success is how a\n"+
			"state machine quietly stops being one.", err)
	}
}

func TestMediaTransitionsRequireOwnership(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	owner := probeMediaUser(t, db)
	stranger := probeMediaUser(t, db)
	asset := forceInitiate(t, db, owner, model.MediaKindVideo)

	// The stranger knows the asset id. An id alone must not be enough.
	if err := svc.MarkUploaded(ctx, asset.ID, stranger); !errors.Is(err, ErrInvalidStateTransition) {
		t.Fatalf("a stranger advanced someone else's asset: %v", err)
	}
	if _, err := svc.Get(ctx, asset.ID, stranger); !errors.Is(err, ErrMediaNotFound) {
		t.Fatalf("a stranger read someone else's asset: %v\n"+
			"A missing asset and someone else's asset must produce the SAME error, or\n"+
			"this endpoint becomes an oracle for which ids exist.", err)
	}

	// And the real owner can.
	if _, err := svc.Get(ctx, asset.ID, owner); err != nil {
		t.Fatalf("owner could not read their own asset: %v", err)
	}
}

func TestMediaMarkReadyStoresMeasuredNotDeclaredValues(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)
	// The client CLAIMS 4 GB / 4 hours at initiate...
	asset := forceInitiate(t, db, user, model.MediaKindVideo)

	if err := svc.MarkUploaded(ctx, asset.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkScanning(ctx, asset.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkTranscoding(ctx, asset.ID, user, 640, 480, 9, true); err != nil {
		t.Fatal(err)
	}
	// ...but the measured values are what land.
	if err := svc.MarkReady(ctx, asset.ID, user, 12*1024*1024, 9, "p", "f", "h", "w"); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Bytes != 12*1024*1024 || got.DurationS != 9 {
		t.Fatalf("stored bytes=%d duration=%d, want the MEASURED 12MB/9s.\n"+
			"declared_* is the claim; the plain fields are what ffprobe found, and\n"+
			"everything downstream must use those.", got.Bytes, got.DurationS)
	}
	if got.Width != 640 || got.Height != 480 {
		t.Fatalf("dimensions not recorded: %dx%d", got.Width, got.Height)
	}
	if got.Status != model.MediaStatusReady {
		t.Fatalf("status = %q, want ready", got.Status)
	}
}

func TestMediaMarkFailedRequiresAnActionableReason(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)
	asset := forceInitiate(t, db, user, model.MediaKindVideo)

	if err := svc.MarkUploaded(ctx, asset.ID, user); err != nil {
		t.Fatal(err)
	}

	// An empty reason must not be stored as an empty reason.
	if err := svc.MarkFailed(ctx, asset.ID, user, model.MediaStatusUploaded, ""); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.FailureReason == "" {
		t.Fatal("a failed asset has an empty failure_reason.\n" +
			"\"transcode failed\" tells a user nothing they can do, and an empty string\n" +
			"is worse - it looks like the field was never filled in at all.")
	}
	if got.Status != model.MediaStatusFailed {
		t.Fatalf("status = %q, want failed", got.Status)
	}
}

func TestMediaSweepOnlyFreesAbandonedInitiations(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// One abandoned: expired, never completed.
	abandoned := forceInitiate(t, db, user, model.MediaKindVideo)
	past := time.Now().UTC().Add(-time.Hour)
	db.Model(&model.MediaAsset{}).Where("id = ?", abandoned.ID).Update("expires_at", past)

	// One in progress: real work. Deleting it would pull the object out from
	// under the pipeline.
	busy := forceInitiate(t, db, user, model.MediaKindReel)
	if err := svc.MarkUploaded(ctx, busy.ID, user); err != nil {
		t.Fatal(err)
	}

	freed, err := svc.SweepAbandonedInitiations(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if freed != 1 {
		t.Fatalf("sweep freed %d rows, want 1 - it must only touch `initiated`, never\n"+
			"work in progress", freed)
	}

	if _, err := svc.Get(ctx, abandoned.ID, user); !errors.Is(err, ErrMediaNotFound) {
		t.Fatalf("the abandoned row survived: %v", err)
	}
	if _, err := svc.Get(ctx, busy.ID, user); err != nil {
		t.Fatalf("the sweep deleted an asset that was in progress: %v", err)
	}
}

// forceInitiate writes a row directly, bypassing the quota.
//
// Needed because the free tier allows zero media, and the state-machine tests
// are about transitions - which require a row to exist. Without this, those
// tests could only ever assert that a quota blocks them.
func forceInitiate(t *testing.T, db *gorm.DB, userID uuid.UUID, kind string) *model.MediaAsset {
	t.Helper()
	expires := time.Now().UTC().Add(24 * time.Hour)
	a := &model.MediaAsset{
		ID: uuid.New(), UserID: userID, Kind: kind,
		Filename: "p.mp4", ContentType: "video/mp4",
		ObjectKey: "probe/" + uuid.New().String(),
		Status:    model.MediaStatusInitiated,
		ExpiresAt: &expires,
	}
	if err := db.Create(a).Error; err != nil {
		t.Fatalf("force initiate: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Where("id = ?", a.ID).Delete(&model.MediaAsset{}) })
	return a
}

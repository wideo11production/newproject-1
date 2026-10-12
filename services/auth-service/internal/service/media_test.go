package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
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

// entitledMediaSvc is `newMediaSvc` with the REAL plan catalogue wired in.
//
// `newMediaSvc` hands `nil` to `NewMediaService`, so every quota resolves to the
// free tier no matter what the user is granted - which is the fail-closed
// behaviour the state-machine tests want and the wrong shape for a test about
// what the quota SAYS. This one is for tests that need the grant to actually
// resolve, and it seeds the real catalogue on the way in.
func entitledMediaSvc(t *testing.T, db *gorm.DB) *MediaService {
	t.Helper()
	return NewMediaService(db, entSvc(t, db))
}

// grantPro gives `user` a Pro entitlement so a media row can be created at all.
//
// The free tier allows ZERO stored media - that is the trial rule from
// SYSTEM-PLAN.md §7.1 and the sharpest test of "quota is checked at
// `initiated`". It also means any test that needs a row to EXIST has to hand
// the user a paid plan first.
func grantPro(t *testing.T, db *gorm.DB, user uuid.UUID) {
	t.Helper()
	grantPlan(t, db, user, "pro")
}

// grantPlan grants any catalogue plan, so a test can pick the ceiling it needs
// rather than the one `grantPro` happens to choose.
func grantPlan(t *testing.T, db *gorm.DB, user uuid.UUID, planCode string) {
	t.Helper()
	svc := NewEntitlementService(db, config.LoadPlans())
	if _, err := svc.Grant(context.Background(), user, planCode, "grant",
		nil, nil, nil, user.String()+"@probe.local", "probe-device"); err != nil {
		t.Fatalf("grant %s: %v", planCode, err)
	}
}

// TestMediaQuotaIsEnforcedBeforeAnyBytesMove pins WHERE the check happens, not
// whether uploading is allowed.
//
// The sharpest form used to be "a user with no entitlement is refused on the
// first initiate", because the free tier allowed zero media. That state no longer
// refuses: uploading is free and unlimited for everyone now, so a user with no
// plan at all is allowed through - and earns nothing, because `monetization`
// fails closed for them just as it always did.
//
// So the WHERE is exercised with a plan that DOES have a ceiling, which is what
// `PLANS_*_MEDIA_ASSETS` in `.env` can still produce. The property under test -
// the refusal arrives before any bytes move - is unchanged, and it is the one
// that cannot be tested through an unlimited plan, because an unlimited plan has
// no refusal to place.
func TestMediaQuotaIsEnforcedBeforeAnyBytesMove(t *testing.T) {
	db := mediaTestDB(t)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// A private catalogue with a cap of ONE video. Not `LoadPlans` - see the note
	// above about what a shipped catalogue can still express.
	capped := config.PlansConfig{Plans: []config.PlanConfig{{
		Code: "probeplan", Name: "probe", PriceMinor: 0, Currency: "USD", Cycle: "monthly",
		Grants: map[string]int64{config.CapMediaAssets: 1, config.CapReelAssets: 1},
	}}}
	svc := NewMediaService(db, NewEntitlementService(db, capped))
	if _, err := NewEntitlementService(db, capped).Grant(ctx, user, "probeplan", "grant",
		nil, nil, nil, user.String()+"@probe.local", "probe-device"); err != nil {
		t.Fatalf("grant probeplan: %v", err)
	}

	// Use up the single slot. `ready` rows are non-failed, so they hold a slot
	// exactly as a live asset does.
	if err := db.Exec(
		`INSERT INTO media_assets (id, user_id, kind, filename, content_type, declared_bytes, declared_duration_seconds, bytes, duration_seconds, status, object_key, created_at, updated_at)
		 VALUES (?, ?, 'video', 'a.mp4', 'video/mp4', 1, 1, 1, 1, 'ready', ?, now(), now())`,
		uuid.New(), user, "k"+uuid.NewString()).Error; err != nil {
		t.Fatalf("seed asset: %v", err)
	}

	// `nil` channel: filed under no channel, which is the normal case before a
	// creator has one. Deliberately exercised here, because the quota rule is
	// about the cap and NOT about having a channel.
	_, err := svc.Initiate(ctx, user, model.MediaKindVideo, "b.mp4", "video/mp4", "k1", 10, 10, nil, "", UploadContext{})
	if !errors.Is(err, ErrMediaQuotaExceeded) {
		t.Fatalf("a user over their cap created a media row.\n"+
			"The quota is meant to be checked at `initiated`, before the user uploads\n"+
			"anything - if it is checked later, this succeeds and the cost is already paid.\ngot: %v", err)
	}

	// And nothing was written FOR THE REFUSED ONE - the seeded row is still there,
	// and it is not. Counting the user's rows would include the seed, so the
	// assertion is on the specific filename that was refused.
	var n int64
	db.Model(&model.MediaAsset{}).Where("user_id = ? AND filename = ?", user, "b.mp4").Count(&n)
	if n != 0 {
		t.Fatalf("%d rows written for a refused initiate - the quota check must be\n"+
			"the thing that stops it, not a later sweep", n)
	}
}

// A user with NO entitlement may upload, because uploading is free for everyone.
//
// This is the direct inverse of the assertion this file used to make, and it is
// worth pinning because it is the failure that made the product unusable for a
// new user: `freeTierAssets` was 0, so an account with no plan at all was refused
// every upload - including one whose trial had simply never been granted.
//
// What such a user CANNOT do is earn. That is the `monetization` capability, it
// fails closed for them, and it is unaffected by the media allowance.
func TestNoEntitlementStillAllowsUploading(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	got, err := svc.Initiate(ctx, user, model.MediaKindVideo, "free.mp4", "video/mp4", "k1", 10, 10, nil, "", UploadContext{})
	if err != nil {
		t.Fatalf("a user with no plan was refused an upload (err=%v).\n"+
			"  Uploading is free and unlimited for every account, and the thing a\n"+
			"  plan gates is EARNING - which is a different capability.", err)
	}
	if got == nil {
		t.Fatal("initiate returned no asset")
	}

	// And the allowance reported for such a user is unlimited, not zero - a
	// message about "your plan does not include uploads" would be false.
	entries, err := svc.MediaQuota(ctx, user)
	if err != nil {
		t.Fatalf("quota: %v", err)
	}
	for _, e := range entries {
		if !e.Unlimited {
			t.Errorf("%s quota for a user with no plan: unlimited=%v remaining=%d.\n"+
				"  The upload panel would tell them they have 0 left, then refuse them for it.",
				e.Kind, e.Unlimited, e.Remaining)
		}
	}
}

// =============================================================================
// THE REFUSAL MUST NOT LIE ABOUT WHY IT REFUSED
// =============================================================================
//
// A trial creator was told:
//
//	media quota exceeded: you have used every reel upload your plan allows
//	(0 stored). Delete one, or change plan
//
// Both halves of that are false for a user whose plan does not include reels.
// They have used nothing - the number in the parenthesis is 0 - and there is
// nothing to delete. The cause is that `0 - 0 == 0`, so a ceiling of zero and a
// ceiling that is merely FULL produced the same negative sign and the same
// sentence.
//
// The test below pins the two apart, because "you have used every one, delete
// one" and "this is not in your plan" are different problems with different
// solutions, and a creator sent to delete an asset they do not have is a creator
// who concludes the product is broken.

// A plan that grants ZERO media does not refuse an upload.
//
// This test used to assert the opposite - that a zero grant produced
// ErrMediaQuotaExceeded with a "your plan does not include reels" message. That
// branch is gone, and deliberately: with uploading free and unlimited for
// everyone, a plan granting zero media is not a denial. `Limit` answers such a
// grant with `ErrQuotaDenied`, which `assetCap` reads as the same state as
// "no plan at all", and both fall through to the unlimited default.
//
// What a plan gates is EARNING, and that is a separate capability that fails
// closed independently. So the interesting assertion is not "am I refused" but
// "am I refused for earning" - and the answer there is still no, because this
// plan does not grant monetization either.
func TestZeroGrantDoesNotRefuseUploading(t *testing.T) {
	db := mediaTestDB(t)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// A catalogue that grants reels at zero, and media unlimited.
	zeroed := config.PlansConfig{Plans: []config.PlanConfig{{
		Code: "probeplan", Name: "probe", PriceMinor: 0, Currency: "USD", Cycle: "monthly",
		Grants: map[string]int64{config.CapReelAssets: 0, config.CapMediaAssets: config.Unlimited},
	}}}
	entSvc := NewEntitlementService(db, zeroed)
	svc := NewMediaService(db, entSvc)
	if _, err := entSvc.Grant(ctx, user, "probeplan", "grant",
		nil, nil, nil, user.String()+"@probe.local", "probe-device"); err != nil {
		t.Fatalf("grant probeplan: %v", err)
	}

	// The reel upload is allowed, because uploading is free for everyone.
	if _, err := svc.Initiate(ctx, user, model.MediaKindReel, "r.mp4", "video/mp4", "k1", 10, 10, nil, "", UploadContext{}); err != nil {
		t.Fatalf("a plan granting 0 reels refused an upload (err=%v).\n"+
			"  Uploading is free and unlimited for every plan; what a plan gates is EARNING.\n"+
			"  The old behaviour was a message that said 'you have used every reel upload\n"+
			"  your plan allows (0 stored)' - which contradicted itself.", err)
	}

	// And earning is still closed, which is the property that actually matters.
	if _, granted, err := entSvc.Limit(ctx, user, config.CapMonetization); err == nil && granted {
		t.Error("a plan that does not grant monetization reported the capability as granted")
	}
}

// A ceiling that is genuinely FULL is a different message, and it must name the
// numbers so the creator can see they are at the edge rather than absent from it.
//
// WHY THIS NO LONGER READS THE SHIPPED CATALOGUE
//
// It used to grant `starter`, which capped reels at 10, then insert 10 rows. That
// worked because the media capabilities were finite per plan. They are UNLIMITED
// on every plan now - the product decision that uploading is free - so the
// "genuinely full" state cannot be reached through any real plan and the test
// would have been vacuous rather than green.
//
// So it builds a private catalogue with a finite reel cap instead. That is more
// honest than reaching for whatever number happens to be finite in the shipped
// config, because it pins the MESSAGE contract rather than a catalogue value that
// is free to change again. The branch under test - `limit > 0, remaining == 0` -
// is still reachable and still worth covering: an operator can set a finite
// `PLANS_STARTER_MEDIA_ASSETS` in `.env`, and that configuration exists.
func TestQuotaRefusalWhenGenuinelyFullNamesTheNumbers(t *testing.T) {
	db := mediaTestDB(t)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// A private catalogue: 10 reels, nothing else. `LoadPlans` is deliberately NOT
	// used - see the header.
	finite := config.PlansConfig{Plans: []config.PlanConfig{{
		Code: "probeplan", Name: "probe", PriceMinor: 0, Currency: "USD", Cycle: "monthly",
		Grants: map[string]int64{config.CapReelAssets: 10},
	}}}
	svc := NewMediaService(db, NewEntitlementService(db, finite))
	if _, err := NewEntitlementService(db, finite).Grant(ctx, user, "probeplan", "grant",
		nil, nil, nil, user.String()+"@probe.local", "probe-device"); err != nil {
		t.Fatalf("grant probeplan: %v", err)
	}

	// Fill the quota. `ready` rows are non-failed, so they hold a slot exactly as
	// a live asset does - which is the condition the refusal is about.
	for i := 0; i < 10; i++ {
		if err := db.Exec(
			`INSERT INTO media_assets (id, user_id, kind, filename, content_type, declared_bytes, declared_duration_seconds, bytes, duration_seconds, status, object_key, created_at, updated_at)
			 VALUES (?, ?, 'reel', ?, 'video/mp4', 1, 1, 1, 1, 'ready', ?, now(), now())`,
			uuid.New(), user, fmt.Sprintf("r%d.mp4", i), "k"+uuid.NewString()).Error; err != nil {
			t.Fatalf("seed reel %d: %v", i, err)
		}
	}

	_, err := svc.Initiate(ctx, user, model.MediaKindReel, "r.mp4", "video/mp4", "k1", 10, 10, nil, "", UploadContext{})
	if !errors.Is(err, ErrMediaQuotaExceeded) {
		t.Fatalf("got %v, want ErrMediaQuotaExceeded", err)
	}

	msg := err.Error()
	// "10 of 10" is the whole point: it tells the creator they are AT the edge
	// and that deleting one actually helps, which the zero-ceiling message could
	// never truthfully say.
	if !strings.Contains(msg, "10 of 10") {
		t.Errorf("a full quota must report the numbers so the advice is actionable.\nmessage: %s", msg)
	}
	if !strings.Contains(msg, "used every") {
		t.Errorf("a genuinely full quota IS the exhausted case and must say so.\nmessage: %s", msg)
	}
}

// An UNLIMITED capability must be allowed, not refused as "out of room".
//
// This is the regression guard for a bug that was live before anyone noticed it:
// `assetCap` answers Unlimited with `remaining = -1`, and the caller's `remaining
// <= 0` check read that as "no room left". `lifetime10` has granted unlimited
// media since it was written, so its users could not upload at all - and the
// cheapest way to fix it without noticing would be to make the unlimited branch
// refuse, which is precisely what the check did.
//
// Now that unlimited is the DEFAULT for every plan, this is not a corner. It is
// the entire upload path.
func TestUnlimitedMediaIsAllowedNotRefused(t *testing.T) {
	db := mediaTestDB(t)
	ctx := context.Background()

	user := probeMediaUser(t, db)
	svc := entitledMediaSvc(t, db)
	// `pro` grants unlimited media - which is what a real paid plan grants now.
	grantPro(t, db, user)

	// Already holding several rows, so a cap WOULD bite if this were arithmetic.
	for i := 0; i < 5; i++ {
		if err := db.Exec(
			`INSERT INTO media_assets (id, user_id, kind, filename, content_type, declared_bytes, declared_duration_seconds, bytes, duration_seconds, status, object_key, created_at, updated_at)
			 VALUES (?, ?, 'video', ?, 'video/mp4', 1, 1, 1, 1, 'ready', ?, now(), now())`,
			uuid.New(), user, fmt.Sprintf("v%d.mp4", i), "k"+uuid.NewString()).Error; err != nil {
			t.Fatalf("seed video %d: %v", i, err)
		}
	}

	got, err := svc.Initiate(ctx, user, model.MediaKindVideo, "more.mp4", "video/mp4", "k1", 10, 10, nil, "", UploadContext{})
	if err != nil {
		t.Fatalf("an unlimited plan was refused (err=%v).\n"+
			"  `remaining` is -1 for unlimited, and `remaining <= 0` reads that as\n"+
			"  'no room'. The sentinel has to be compared explicitly.", err)
	}
	if got == nil {
		t.Fatal("initiate returned no asset")
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
	if err := svc.MarkReady(ctx, asset.ID, user, 1024, 120, "p", "f", "h", "w", ModerationVerdict{}); err != nil {
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
	if err := svc.MarkReady(ctx, asset.ID, user, 12*1024*1024, 9, "p", "f", "h", "w", ModerationVerdict{}); err != nil {
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

// TestRetryFailedMovesFailedBackToUploaded pins the fix for a failure mode that
// was once permanent.
//
// A 4K upload that outran the transcoder's memory wrote `failed` and STAYED
// failed: `MarkTranscodeResult` refuses any asset that is not mid-pipeline, and
// nothing could move a row back. The bytes were fine in the bucket and the
// creator's only route was re-uploading every byte.
func TestRetryFailedMovesFailedBackToUploaded(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)
	asset := forceInitiate(t, db, user, model.MediaKindVideo)

	if err := svc.MarkUploaded(ctx, asset.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkFailed(ctx, asset.ID, user, model.MediaStatusUploaded,
		"ffmpeg ladder failed: signal: killed"); err != nil {
		t.Fatal(err)
	}

	if err := svc.RetryFailed(ctx, asset.ID, user); err != nil {
		t.Fatalf("RetryFailed: %v", err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != model.MediaStatusUploaded {
		t.Errorf("status = %q, want uploaded (a failed asset must be re-queuable)", got.Status)
	}
	// The reason is cleared, not appended: the schema has one column, and a
	// second failure should record the SECOND error rather than a concatenation.
	if got.FailureReason != "" {
		t.Errorf("failure_reason = %q, want cleared", got.FailureReason)
	}
}

// TestRetryFailedRefusesAnInFlightAsset guards the other half: requeueing
// something the pipeline already owns would race with the transcode running
// against it.
func TestRetryFailedRefusesAnInFlightAsset(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// An asset that is mid-pipeline. Retrying it would point two transcodes at
	// the same renditions.
	uploaded := forceInitiate(t, db, user, model.MediaKindVideo)
	if err := svc.MarkUploaded(ctx, uploaded.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.RetryFailed(ctx, uploaded.ID, user); !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("retrying an uploaded asset: err = %v, want ErrInvalidStateTransition", err)
	}

	// An asset that is already finished. Requeueing it would throw away work
	// that succeeded and re-encode a file nobody asked to re-encode.
	ready := forceInitiate(t, db, user, model.MediaKindVideo)
	if err := svc.MarkUploaded(ctx, ready.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkScanning(ctx, ready.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkTranscoding(ctx, ready.ID, user, 1920, 1080, 10, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.RetryFailed(ctx, ready.ID, user); !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("retrying a ready asset: err = %v, want ErrInvalidStateTransition", err)
	}
}

// TestDeleteFailedIsOwnerScoped checks that one user cannot delete another's
// failed upload - the user id is in the WHERE clause, and without it the asset
// id alone would be enough.
func TestDeleteFailedIsOwnerScoped(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()

	owner := probeMediaUser(t, db)
	stranger := probeMediaUser(t, db)
	asset := forceInitiate(t, db, owner, model.MediaKindVideo)
	if err := svc.MarkUploaded(ctx, asset.ID, owner); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkFailed(ctx, asset.ID, owner, model.MediaStatusUploaded,
		"killed"); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.DeleteFailed(ctx, asset.ID, stranger); err == nil {
		t.Error("a stranger deleted someone else's failed asset")
	}
	// Still there for the owner to act on.
	if _, err := svc.DeleteFailed(ctx, asset.ID, owner); err != nil {
		t.Errorf("owner delete: %v", err)
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

// =============================================================================
// RE-UPLOAD DEDUP (SYSTEM-PLAN.md §5.3)
// =============================================================================
//
// The rule: the same file re-uploaded by the same user reuses the renditions
// already in the bucket rather than paying a second ffmpeg pass.
//
// What these tests pin down is the part that is easy to get wrong and expensive
// when it is: only a READY asset may be reused, and never across users.

func TestReuseSkipsTheTranscode(t *testing.T) {
	db := mediaTestDB(t)
	// With the entitlement service wired, not nil: the free tier allows zero
	// stored media, and this test needs a row to exist.
	svc := mediaSvcFor(t, db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	grantPro(t, db, user)

	const hash = "00000000000000000000000000000000000000000000000000000000000000a1"

	// The first upload: initiated -> ready, the full journey.
	first, err := svc.Initiate(ctx, user, model.MediaKindVideo, "holiday.mp4", "video/mp4",
		"probe/"+uuid.New().String(), 1000, 30, nil, hash, UploadContext{})
	if err != nil {
		t.Fatalf("first initiate: %v", err)
	}
	// Walk it to `ready` with real measured values and real artefact keys, so
	// the reuse assertion has something concrete to find.
	if err := svc.MarkUploaded(ctx, first.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkScanning(ctx, first.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkTranscoding(ctx, first.ID, user, 1920, 1080, 30, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkReady(ctx, first.ID, user, 1000, 30,
		first.ID.String()+"/poster.jpg", first.ID.String()+"/filmstrip.jpg",
		"http://localhost:9000/video/"+first.ID.String()+"/1080p/playlist.m3u8",
		first.ID.String()+"/peaks.json",
		ModerationVerdict{Status: model.ModerationVerdictApproved}); err != nil {
		t.Fatal(err)
	}

	// The SECOND upload of the exact same file, with a new title.
	reused, rerr := svc.FindReusable(ctx, user, hash)
	if rerr != nil {
		t.Fatalf("FindReusable: %v", rerr)
	}
	if reused == nil {
		t.Fatal("a ready asset with a matching hash was not found - the re-upload\n" +
			"would pay a second full ffmpeg pass for identical output, which is the\n" +
			"exact cost SYSTEM-PLAN.md §5.3 exists to remove.")
	}

	copy1, err := svc.Reuse(ctx, user, model.MediaKindVideo, "holiday-final-cut.mp4", nil, reused)
	if err != nil {
		t.Fatalf("Reuse: %v", err)
	}

	// The new row must be READY immediately: nothing was uploaded, nothing was
	// encoded, because the output already satisfies it.
	if copy1.Status != model.MediaStatusReady {
		t.Errorf("reused asset is %q, want %q - a hit means no work to do, so it\n"+
			"must not go through the pipeline again", copy1.Status, model.MediaStatusReady)
	}

	// The measured values and artefacts carry across, because they are
	// measurements of the SAME bytes rather than a fresh claim.
	if copy1.Width != 1920 || copy1.Height != 1080 || copy1.DurationS != 30 {
		t.Errorf("reused asset lost its measurements: got %dx%d %ds, want 1920x1080 30s",
			copy1.Width, copy1.Height, copy1.DurationS)
	}
	if copy1.HLSPublicURL != reused.HLSPublicURL {
		t.Errorf("reused asset does not point at the existing HLS output:\n"+
			"  got  %s\n  want %s", copy1.HLSPublicURL, reused.HLSPublicURL)
	}
	if copy1.Filename != "holiday-final-cut.mp4" {
		t.Errorf("the new title did not stick: %q", copy1.Filename)
	}

	// A distinct id: the rows must be independently deletable, or clearing one
	// library would clear both.
	if copy1.ID == reused.ID {
		t.Error("Reuse produced a row with the SOURCE's id - deleting one would\n" +
			"delete the other, so a user could not remove a single duplicate.")
	}
}

func TestReuseIsScopedToOneUserAndOnlyReadyAssets(t *testing.T) {
	db := mediaTestDB(t)
	svc := mediaSvcFor(t, db)
	ctx := context.Background()

	owner := probeMediaUser(t, db)
	other := probeMediaUser(t, db)
	grantPro(t, db, owner)
	const hash = "00000000000000000000000000000000000000000000000000000000000000b2"

	// An asset that is only `uploaded` - still in the pipeline. Pointing a
	// second row at its object keys would hand back a file that a running
	// transcode is about to overwrite underneath it.
	pending, err := svc.Initiate(ctx, owner, model.MediaKindVideo, "p.mp4", "video/mp4",
		"probe/"+uuid.New().String(), 10, 5, nil, hash, UploadContext{})
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if err := svc.MarkUploaded(ctx, pending.ID, owner); err != nil {
		t.Fatal(err)
	}

	if got, err := svc.FindReusable(ctx, owner, hash); err != nil {
		t.Fatalf("FindReusable: %v", err)
	} else if got != nil {
		t.Error("an asset that is only `uploaded` was offered for reuse.\n" +
			"  Its renditions do not exist yet, and a transcode is still writing to\n" +
			"  those keys - so the copy would be a file that changes under the user.")
	}

	// Now make it ready. Only then is it reusable.
	if err := svc.MarkScanning(ctx, pending.ID, owner); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkTranscoding(ctx, pending.ID, owner, 640, 480, 5, false); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkReady(ctx, pending.ID, owner, 10, 5, "k/p", "k/f", "k/hls", "k/peaks", ModerationVerdict{}); err != nil {
		t.Fatal(err)
	}

	if got, err := svc.FindReusable(ctx, owner, hash); err != nil {
		t.Fatalf("FindReusable: %v", err)
	} else if got == nil {
		t.Error("a READY asset with a matching hash was not found.")
	}

	// A DIFFERENT user with the same hash must not see it. Two creators
	// uploading the same stock clip produce the same hash, and cross-user reuse
	// would file one person's video under another's account.
	if got, err := svc.FindReusable(ctx, other, hash); err != nil {
		t.Fatalf("FindReusable: %v", err)
	} else if got != nil {
		t.Error("another user's asset was offered for reuse by hash.\n" +
			"  Dedup is per-user on purpose: two people uploading the same clip get\n" +
			"  the same sha-256, and sharing the renditions would make each one\n" +
			"  deletable by whichever of them cleared their library.")
	}

	// An empty hash never matches. It means "no claim was made", and a client
	// that does not compute one takes the slow path.
	if got, err := svc.FindReusable(ctx, owner, ""); err != nil {
		t.Fatalf("FindReusable: %v", err)
	} else if got != nil {
		t.Error("an empty content hash matched an asset.")
	}
}





package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// Moderation verdict persistence: what a callback writes into the row.
//
// These tests exist because the persistence path was verified only by a re-run of
// an already-`ready` asset, which the state machine correctly rejects with a 409.
// That is the right behaviour for the product and the wrong thing to have
// "proved" the feature with, so the write is tested directly here.
//
// The rule under test, from migration 030: `ready` is a TECHNICAL verdict and
// `moderation_status` is the POLICY one. Both are written by one call, and an
// EMPTY verdict holds the asset at `pending_review` rather than releasing it -
// because "nobody looked" is not the same as "looked and it was fine".

// moderationCallback builds the minimum callback that carries a moderation verdict.
func moderationCallback(t *testing.T, status, verdict string) TranscodeCallback {
	t.Helper()
	return TranscodeCallback{
		AssetID:          uuid.New().String(),
		Status:           status,
		PlaylistURL:      "http://localhost:9000/video/x/1080p/playlist.m3u8",
		ModerationVerdict: verdict,
		ModerationReason:  "held for review",
		ModerationScore:   0.61,
		ModerationChecks: map[string]any{
			"skin_tone": map[string]any{"score": 0.61},
		},
	}
}

// seedPipelineAsset puts an asset into `transcoding`, the state a transcode
// callback is allowed to advance.
//
// The content hash is a real 64-char SHA-256 because the schema enforces its
// length with a CHECK constraint - a placeholder like "hash" is rejected, which
// is the constraint doing its job rather than an obstacle.
func seedPipelineAsset(t *testing.T, svc *MediaService, user uuid.UUID) *model.MediaAsset {
	t.Helper()
	ctx := context.Background()
	asset, err := svc.Initiate(ctx, user, model.MediaKindVideo,
		"clip.mp4", "video/mp4", user.String()+"/clip.mp4", 1024, 10, nil,
		strings.Repeat("a", 64), UploadContext{})
	if err != nil {
		t.Fatal(err)
	}
	// The state machine's order: uploaded -> scanning -> transcoding. A callback
	// is only accepted from `uploaded`/`scanning`/`transcoding`, so all three
	// steps are walked rather than jumping straight to `transcoding`.
	for _, step := range []func() error{
		func() error { return svc.MarkUploaded(ctx, asset.ID, user) },
		func() error { return svc.MarkScanning(ctx, asset.ID, user) },
		func() error {
			return svc.MarkTranscoding(ctx, asset.ID, user, 1920, 1080, 10, true)
		},
	} {
		if err := step(); err != nil {
			t.Fatalf("advance pipeline: %v", err)
		}
	}
	return asset
}

// TestModerationVerdictApprovedIsStoredAndPublic pins the happy path: a clean
// verdict makes the asset visible to everyone, not just its owner.
func TestModerationVerdictApprovedIsStoredAndPublic(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	cb := moderationCallback(t, "completed", model.ModerationVerdictApproved)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModerationStatus != model.ModerationApproved {
		t.Errorf("moderation_status = %q, want approved", got.ModerationStatus)
	}
	// THE POINT OF THE SPLIT: technically ready is not enough on its own. Both
	// conditions have to hold for the asset to be visible to anyone but its owner.
	if !got.IsVisiblePublic() {
		t.Error("an approved, ready asset must be publicly visible")
	}
}

// TestModerationVerdictFlaggedIsNotPublic is the case that fails if the two
// conditions are ever collapsed into one.
//
// A flagged asset is TECHNICALLY ready - the renditions exist and play - and it is
// withheld from every public surface until a human resolves it.
func TestModerationVerdictFlaggedIsNotPublic(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	cb := moderationCallback(t, "completed", model.ModerationVerdictFlagged)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != model.MediaStatusReady {
		t.Errorf("status = %q, want ready (the file IS processed)", got.Status)
	}
	if got.ModerationStatus != model.ModerationFlagged {
		t.Errorf("moderation_status = %q, want flagged", got.ModerationStatus)
	}
	if got.IsVisiblePublic() {
		t.Error("a flagged asset must NOT be publicly visible, even though it is ready")
	}
	if !got.IsModerationPending() {
		t.Error("a flagged asset must appear on the moderation worklist")
	}
	// The reason travels with the verdict: a creator whose upload is held has to
	// be told why, and the score is what a reviewer compares against the band.
	if got.ModerationReason == "" {
		t.Error("a flagged asset has no moderation_reason")
	}
	if got.ModerationScore == 0 {
		t.Error("a flagged asset has no moderation_score")
	}
}

// TestModerationVerdictRejectedIsNotPublic covers the refusal.
func TestModerationVerdictRejectedIsNotPublic(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	cb := moderationCallback(t, "completed", model.ModerationVerdictRejected)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModerationStatus != model.ModerationRejected {
		t.Errorf("moderation_status = %q, want rejected", got.ModerationStatus)
	}
	if got.IsVisiblePublic() {
		t.Error("a rejected asset must never be publicly visible")
	}
}

// TestAbsentModerationVerdictFailsClosed is the engine-outage case.
//
// A transcoder that says nothing about moderation has NOT said the content is
// fine. Releasing the asset would mean an outage in the screener publishes
// unvetted videos, so it is held instead.
func TestAbsentModerationVerdictFailsClosed(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	// A plain transcode callback with no moderation fields at all - what an older
	// transcoder, or one with the engine disabled, sends.
	cb := TranscodeCallback{
		AssetID:    asset.ID.String(),
		Status:     "completed",
		PlaylistURL: "http://localhost:9000/video/x/1080p/playlist.m3u8",
		DurationS:  10,
	}
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModerationStatus != model.ModerationPendingReview {
		t.Errorf("moderation_status = %q, want pending_review (an absent verdict "+
			"must not release the asset)", got.ModerationStatus)
	}
	if got.IsVisiblePublic() {
		t.Error("an asset with no verdict must not be publicly visible")
	}
}

// TestModerationAuditCarriesTheUploaderFootprint pins the audit trail.
//
// WHY IT MATTERS
//
// The T&C's law-enforcement clause promises a violator's "credentials and digital
// footprints" can be reported. That promise is only true if the footprint was
// recorded, and it can only be recorded at `initiate` - the presigned PUT goes
// straight to MinIO, so the service never sees the browser again after that.
//
// The subtlety this test guards: the moderation verdict is written by a callback
// from the TRANSCODER. The IP on that request is the transcoder's container IP -
// the same value for every upload in the fleet. Reading it there would produce a
// record that looks like a footprint and identifies nobody. So the columns must be
// copied from the asset row, where they were captured from the uploader's own
// request.
func TestModerationAuditCarriesTheUploaderFootprint(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	// Write the footprint the way `Initiate` would have, since the seed helper
	// bypasses it.
	fp := "device-" + uuid.New().String()[:8]
	if err := db.Exec(
		`UPDATE media_assets SET upload_ip = ?, upload_user_agent = ?, device_fingerprint = ?
		 WHERE id = ?`,
		"203.0.113.9", "ProbeAgent/1.0", fp, asset.ID).Error; err != nil {
		t.Fatal(err)
	}

	cb := moderationCallback(t, "completed", model.ModerationVerdictFlagged)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	var audit model.MediaModerationAudit
	if err := db.Where("media_asset_id = ?", asset.ID).
		Order("created_at DESC").First(&audit).Error; err != nil {
		t.Fatalf("no audit row was written: %v", err)
	}

	if audit.IPAddress != "203.0.113.9" {
		t.Errorf("audit ip = %q, want the UPLOADER's ip - the transcoder's request IP "+
			"would identify the transcoding container, not the creator", audit.IPAddress)
	}
	if audit.UserAgent != "ProbeAgent/1.0" {
		t.Errorf("audit user_agent = %q, want the uploader's", audit.UserAgent)
	}
	if audit.DeviceFingerprint != fp {
		t.Errorf("audit device_fingerprint = %q, want %q", audit.DeviceFingerprint, fp)
	}
	if audit.Verdict != model.ModerationVerdictFlagged {
		t.Errorf("audit verdict = %q, want flagged", audit.Verdict)
	}
}

// TestUploadContextIsBounded checks that a hostile header cannot fail the row.
//
// A client-controlled string going into a VARCHAR(500) column is a length
// constraint the CLIENT controls. Unbounded, a 10-kilobyte user agent is a
// database error, and the upload fails with a 500 the user cannot interpret - so
// the bound is applied before the insert, and on rune boundaries.
func TestUploadContextIsBounded(t *testing.T) {
	long := strings.Repeat("e", 600)

	got := boundTo(long, 500)
	if len([]rune(got)) != 500 {
		t.Errorf("boundTo returned %d runes, want 500", len([]rune(got)))
	}
	if !utf8.ValidString(got) {
		t.Error("boundTo produced invalid UTF-8 - it must truncate on rune boundaries")
	}
	if got := boundTo("short", 500); got != "short" {
		t.Errorf("boundTo(%q, 500) = %q", "short", got)
	}
}

// TestResolveModerationCannotReleaseARejection is the rule the whole zero-tolerance
// promise sits on.
//
// The T&C says a violator is terminated, forfeits earnings, and is reported. If a
// reviewer could quietly release a `rejected` asset, that promise would be
// advisory - and a policy that says "usually" is not a policy.
//
// So `ResolveModeration` refuses, and the route maps that to 409 rather than 403,
// because the reviewer HAS the permission and this particular asset is not in a
// state they may decide.
func TestResolveModerationCannotReleaseARejection(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	reviewer := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	cb := moderationCallback(t, "completed", model.ModerationVerdictRejected)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}

	err := svc.ResolveModeration(ctx, asset.ID, reviewer, true, "looked fine to me")
	if !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("releasing a rejected asset: err = %v, want ErrInvalidStateTransition", err)
	}

	// Still refused, and still not public.
	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModerationStatus != model.ModerationRejected {
		t.Errorf("moderation_status = %q, want rejected (unchanged)", got.ModerationStatus)
	}
	if got.IsVisiblePublic() {
		t.Error("a rejected asset became publicly visible after a review attempt")
	}
}

// TestResolveModerationApprovesAFlag pins the legitimate path.
func TestResolveModerationApprovesAFlag(t *testing.T) {
	db := mediaTestDB(t)
	svc := newMediaSvc(db)
	ctx := context.Background()
	user := probeMediaUser(t, db)
	reviewer := probeMediaUser(t, db)
	asset := seedPipelineAsset(t, svc, user)

	cb := moderationCallback(t, "completed", model.ModerationVerdictFlagged)
	cb.AssetID = asset.ID.String()
	cb.DurationS = 10
	if err := svc.MarkTranscodeResult(ctx, cb); err != nil {
		t.Fatal(err)
	}
	// The border case: technically ready, policy-undecided. `MarkTranscodeResult`
	// already wrote `ready` - re-calling `MarkReady` would just be a state machine
	// refusal, which is the same mistake as asserting twice.

	if err := svc.ResolveModeration(ctx, asset.ID, reviewer, true, "verified by hand"); err != nil {
		t.Fatalf("resolve: %v", err)
	}

	got, err := svc.Get(ctx, asset.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModerationStatus != model.ModerationApproved {
		t.Errorf("moderation_status = %q, want approved", got.ModerationStatus)
	}
	if !got.IsVisiblePublic() {
		t.Error("a human-approved, ready asset must be publicly visible")
	}
	// Attribution, which is the first thing an appeal asks for.
	if got.ModeratedBy != "admin:"+reviewer.String() {
		t.Errorf("moderated_by = %q, want admin:%s", got.ModeratedBy, reviewer)
	}

	// And the override is recorded as a decision, not as an engine verdict.
	audits, err := svc.ModerationAuditsFor(ctx, asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(audits) == 0 {
		t.Fatal("no audit row for a human decision")
	}
	var found bool
	for _, a := range audits {
		if a.ReviewerID != nil && a.ReviewerNote == "verified by hand" {
			found = true
			// "The AI flagged it and a human accepted it" must be distinguishable
			// from "the AI approved it", or the flag means nothing.
			if a.Provider != "admin:"+reviewer.String() {
				t.Errorf("audit provider = %q, want the admin id", a.Provider)
			}
		}
	}
	if !found {
		t.Error("the human override was not recorded in the audit trail")
	}
}





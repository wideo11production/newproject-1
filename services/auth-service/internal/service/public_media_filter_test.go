package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// The public-facing gate: what a stranger may see on a channel page.
//
// THE BUG THIS PINS
// =================
//
// `ListPublicChannelMedia` filtered on `status = 'ready'` and nothing else. After
// migration 030 introduced `moderation_status`, that meant every video the AI had
// REJECTED was still listed on the creator's public channel page - the pipeline
// recorded a verdict and no public surface read it. The moderation system was, for
// its intended purpose, not connected to anything.
//
// A second leak sat underneath it: `channel_content_counts` (the view behind the
// browse page's channel cards) took its `latest_thumbnail` from the newest
// `ready` poster, so the thumbnail on the browse card could be a frame from a
// rejected video - the refused picture, displayed as the face of the channel.
//
// Both are fixed (the query here, the view in migration 031). Both are asserted,
// because "the query was right" was true in the first case and the video was
// published anyway.

// authSvcFor builds the AuthService under test.
//
// `SetDB` rather than the constructor, because `NewAuthService` takes eight
// repository arguments and `ListPublicChannelMedia` needs none of them - it
// queries channels and media directly through the one database handle. Passing
// eight nils would be honest here and would also mean a future edit that adds a
// repository call to this method fails in a way nobody reads.
func authSvcFor(db *gorm.DB) *AuthService {
	svc := NewAuthService(nil, nil, nil, nil, nil, nil, nil, nil)
	svc.SetDB(db)
	return svc
}

// TestPublicChannelMediaHidesAnythingNotApproved is the regression test for the
// public channel page.
//
// All three non-approved states must be absent: `rejected`, `flagged`, and
// `pending_review`. Only `approved` is public.
func TestPublicChannelMediaHidesAnythingNotApproved(t *testing.T) {
	db := mediaTestDB(t)
	svc := authSvcFor(db)
	ctx := context.Background()

	user := probeMediaUser(t, db)

	// A channel owned by this user, inserted directly. The creator service needs a
	// verified subscription and a T&C acceptance, and neither is what this test is
	// about - what is listed is.
	channelID := uuid.New()
	// A handle the public lookup can find. Unique, because handles are globally
	// unique and a collision with another test's channel would make this assert
	// the wrong thing.
	handle := "probe" + uuid.New().String()[:8]
	if err := db.Exec(
		`INSERT INTO channels (id, user_id, display_name, handle)
		 VALUES (?, ?, 'Probe Channel', ?)`,
		channelID, user, handle).Error; err != nil {
		t.Fatalf("insert channel: %v", err)
	}

	// One asset per terminal moderation state, ALL of them `ready`. That is the
	// whole point: every one of these passes the old filter, so a test that only
	// used `rejected` would not distinguish the fix from a broken insert.
	states := []string{
		model.ModerationApproved,
		model.ModerationRejected,
		model.ModerationFlagged,
		model.ModerationPendingReview,
	}
	for _, st := range states {
		if err := db.Exec(
			`INSERT INTO media_assets
			   (id, user_id, channel_id, kind, status, moderation_status, filename,
			    content_type, object_key, bytes, content_hash)
			 VALUES (?, ?, ?, 'video', 'ready', ?, ?, 'video/mp4', ?, 1000, ?)`,
			uuid.New(), user, channelID, st,
			st+".mp4", user.String()+"/"+st+".mp4",
			// 64 chars, because the schema enforces a SHA-256 length with a CHECK
			// constraint - a placeholder uuid is rejected, which is the constraint
			// doing its job.
			strings.Repeat("a", 64)).Error; err != nil {
			t.Fatalf("insert asset %s: %v", st, err)
		}
	}

	items, total, err := svc.ListPublicChannelMedia(ctx, handle, "", 50, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	// `total` must be 1, not 4. A count that includes withheld items would make
	// the channel page paginate wrongly - a page of 24 would fetch 24 visible
	// rows out of 240 and the user would see 24 on page 1 and fewer later.
	if total != int64(len(states))-3 {
		t.Errorf("total = %d, want %d - a public page must count only what it shows",
			total, len(states)-3)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}

	// And `content_hash`-scoped sanity: the single item must be the approved one.
	// Re-derived from the DB so the assertion is about the row that exists, not
	// about ordering.
	var approvedName string
	if err := db.Raw(
		`SELECT filename FROM media_assets
		 WHERE channel_id = ? AND moderation_status = ?`,
		channelID, model.ModerationApproved).Scan(&approvedName).Error; err != nil {
		t.Fatal(err)
	}
	if items[0].Filename != approvedName {
		t.Errorf("the listed item is %q, want the approved asset %q",
			items[0].Filename, approvedName)
	}
}

// TestContentCountsViewRespectsModeration holds the second leak.
//
// The browse page's channel cards read `channel_content_counts`. Its
// `latest_thumbnail` used to come from the newest `ready` poster with no
// moderation filter, so the picture shown could be from a REJECTED video.
//
// Asserted against the VIEW rather than the Go, because that is where the bug was
// - a test over the query builder would have passed while the view stayed wrong.
func TestContentCountsViewRespectsModeration(t *testing.T) {
	db := mediaTestDB(t)

	user := probeMediaUser(t, db)
	channelID := uuid.New()
	if err := db.Exec(
		`INSERT INTO channels (id, user_id, display_name, handle)
		 VALUES (?, ?, 'Counts Probe', ?)`,
		channelID, user, "cnt"+uuid.New().String()[:8]).Error; err != nil {
		t.Fatalf("insert channel: %v", err)
	}

	// An APPROVED video with a poster, uploaded FIRST, then a REJECTED video with
	// a DIFFERENT poster uploaded second. If the view ignores moderation, the
	// rejected poster is the newer one and becomes the card thumbnail.
	if err := db.Exec(
		`INSERT INTO media_assets
		   (id, user_id, channel_id, kind, status, moderation_status, filename,
		    content_type, object_key, bytes, content_hash, poster_public_url, created_at)
		 VALUES (?, ?, ?, 'video', 'ready', 'approved', 'approved.mp4', 'video/mp4', ?, 10, ?,
		         'approved-poster.jpg', now() - interval '1 hour')`,
		uuid.New(), user, channelID, user.String()+"/a.mp4", strings.Repeat("a", 64)).Error; err != nil {
		t.Fatalf("insert approved: %v", err)
	}
	if err := db.Exec(
		`INSERT INTO media_assets
		   (id, user_id, channel_id, kind, status, moderation_status, filename,
		    content_type, object_key, bytes, content_hash, poster_public_url, created_at)
		 VALUES (?, ?, ?, 'video', 'ready', 'rejected', 'rejected.mp4', 'video/mp4', ?, 10, ?,
		         'REJECTED-poster.jpg', now())`,
		uuid.New(), user, channelID, user.String()+"/r.mp4", strings.Repeat("b", 64)).Error; err != nil {
		t.Fatalf("insert rejected: %v", err)
	}

	var row struct {
		VideoCount      int64   `gorm:"column:video_count"`
		ReelCount       int64   `gorm:"column:reel_count"`
		LatestThumbnail *string `gorm:"column:latest_thumbnail"`
	}
	if err := db.Raw(
		`SELECT video_count, reel_count, latest_thumbnail
		 FROM channel_content_counts WHERE channel_id = ?`, channelID).
		Scan(&row).Error; err != nil {
		t.Fatalf("read view: %v", err)
	}

	if row.VideoCount != 1 {
		t.Errorf("video_count = %d, want 1 - the count must exclude withheld media", row.VideoCount)
	}
	if row.LatestThumbnail == nil {
		t.Fatal("latest_thumbnail is NULL - the approved asset has a poster")
	}
	if *row.LatestThumbnail == "REJECTED-poster.jpg" {
		t.Error("the browse card thumbnail is the REJECTED video's poster - a frame " +
			"the AI refused is displayed as the face of the channel")
	}
	if *row.LatestThumbnail != "approved-poster.jpg" {
		t.Errorf("latest_thumbnail = %q, want the approved asset's poster",
			*row.LatestThumbnail)
	}
}





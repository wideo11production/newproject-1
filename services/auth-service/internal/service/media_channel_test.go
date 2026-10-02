package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/config"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// WHY `channel_id` NEEDS AN OWNERSHIP CHECK
// =============================================================================
//
// A client sends the channel id. Without a check, any user could file their own
// video under somebody else's channel and inflate its PUBLIC count - and the
// channel page would then show a stranger's video as that creator's content.
//
// That is not a theoretical abuse: the whole point of putting the counts on a
// public page is that they are believable, and a counter anyone can increment
// for any channel is worth nothing.
//
// The refusal is deliberately indistinguishable from "no such channel". Saying
// "that channel exists but is not yours" is a free existence oracle for every
// channel id in the system.

func TestMediaCannotBeFiledUnderAnotherUsersChannel(t *testing.T) {
	db := entTestDB(t)
	svc := mediaSvcFor(t, db)
	ctx := context.Background()

	owner := probeEntUser(t, db)
	stranger := probeEntUser(t, db)

	// A channel the stranger does NOT own. Public, so the failure cannot be
	// explained by it being invisible.
	ch := forceOwnedChannel(t, db, owner, "impersonation_probe_ch")

	_, err := svc.Initiate(ctx, stranger, model.MediaKindVideo, "mine.mp4", "video/mp4", "stranger/1.mp4", 1000, 30, &ch.ID)
	if err == nil {
		t.Fatal("a stranger filed media under someone else's channel.\n" +
			"The channel's public video count would then include it, so the count is\n" +
			"attacker-controlled - which makes every count on the browse page a guess.")
	}

	// The wording must not distinguish "not yours" from "does not exist", or the
	// error becomes an oracle.
	if !strings.Contains(strings.ToLower(err.Error()), "not found") {
		t.Errorf("the refusal says %q.\n"+
			"\"not found\" and \"not yours\" must be indistinguishable, or this endpoint\n"+
			"enumerates every channel id in the system.", err)
	}
}

func TestMediaCanBeFiledUnderYourOwnChannel(t *testing.T) {
	db := entTestDB(t)
	svc := mediaSvcFor(t, db)
	ctx := context.Background()

	owner := probeEntUser(t, db)
	ch := forceOwnedChannel(t, db, owner, "own_channel_probe_ch")

	// A plan with room: the free tier allows zero media, so without a grant the
	// quota check refuses first and this test would pass for the wrong reason.
	if _, err := NewEntitlementService(db, config.LoadPlans()).Grant(ctx, owner, "pro", "grant", nil, nil, nil, "p@probe.local", "probe-device"); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Initiate(ctx, owner, model.MediaKindVideo, "mine.mp4", "video/mp4", "owner/1.mp4", 1000, 30, &ch.ID)
	if err != nil {
		t.Fatalf("the owner could not file media under their own channel: %v", err)
	}
	if got.ChannelID == nil || *got.ChannelID != ch.ID {
		t.Errorf("channel_id was not stored: %v", got.ChannelID)
	}
}

// A soft-deleted channel is still a row, so "is it there" is not enough - it has
// to be LIVE too.
func TestMediaCannotBeFiledUnderADeletedChannel(t *testing.T) {
	db := entTestDB(t)
	svc := mediaSvcFor(t, db)
	ctx := context.Background()

	owner := probeEntUser(t, db)
	ch := forceOwnedChannel(t, db, owner, "deleted_channel_probe")

	if err := db.Delete(&model.Channel{}, "id = ?", ch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := NewEntitlementService(db, config.LoadPlans()).Grant(ctx, owner, "pro", "grant", nil, nil, nil, "p@probe.local", "probe-device"); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Initiate(ctx, owner, model.MediaKindVideo, "x.mp4", "video/mp4", "k", 1000, 30, &ch.ID); err == nil {
		t.Fatal("media was filed under a DELETED channel.\n" +
			"The row still exists after a soft delete, so an existence check alone is not\n" +
			"enough - it has to exclude deleted ones, or a removed channel keeps\n" +
			"quietly accepting uploads.")
	}
}

// Media with no channel is the NORMAL case, not an error: a creator uploads
// before creating a channel, and a user who never makes one still needs a
// library.
func TestMediaWithNoChannelIsAllowed(t *testing.T) {
	db := entTestDB(t)
	svc := mediaSvcFor(t, db)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := NewEntitlementService(db, config.LoadPlans()).Grant(ctx, user, "pro", "grant", nil, nil, nil, "p@probe.local", "probe-device"); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Initiate(ctx, user, model.MediaKindVideo, "x.mp4", "video/mp4", "k", 1000, 30, nil)
	if err != nil {
		t.Fatalf("media with no channel was refused: %v\n"+
			"This is the common case - a creator uploads before they have a channel, and a\n"+
			"user who never makes one still needs a library.", err)
	}
	if got.ChannelID != nil {
		t.Errorf("channel_id was invented: %v", got.ChannelID)
	}
}

// The derived counts must exclude everything that is not READY. An upload that
// was authorised, or is still being probed, is not something a viewer can watch -
// and a public count that includes it is a count the creator cannot trust.
func TestChannelCountsOnlyIncludeReadyMedia(t *testing.T) {
	db := entTestDB(t)
	ctx := context.Background()

	owner := probeEntUser(t, db)
	ch := forceOwnedChannel(t, db, owner, "counts_probe_ch")

	// One ready video, one ready reel, one still uploading, one failed.
	insert := func(kind, status string) {
		t.Helper()
		row := model.MediaAsset{
			ID: uuid.New(), UserID: owner, ChannelID: &ch.ID,
			Kind: kind, Filename: kind + ".mp4", ContentType: "video/mp4",
			ObjectKey: "counts/" + kind + "-" + status, Status: status,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatalf("insert %s/%s: %v", kind, status, err)
		}
	}
	insert(model.MediaKindVideo, model.MediaStatusReady)
	insert(model.MediaKindReel, model.MediaStatusReady)
	insert(model.MediaKindVideo, model.MediaStatusUploaded)
	insert(model.MediaKindVideo, model.MediaStatusFailed)

	counts, err := NewChannelSubscriptionService(db, nil).SubscriberCounts(ctx, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if counts.SubscriberCount != 0 {
		t.Errorf("subscriber_count = %d, want 0", counts.SubscriberCount)
	}

	// Read the content rollup directly - it is a VIEW, so this is the real thing
	// the browse page reads.
	var v, r int64
	if err := db.Raw(
		"SELECT video_count, reel_count FROM channel_content_counts WHERE channel_id = ?", ch.ID,
	).Row().Scan(&v, &r); err != nil {
		t.Fatalf("read the content rollup: %v", err)
	}
	if v != 1 || r != 1 {
		t.Errorf("content counts = %d videos / %d reels, want 1/1.\n"+
			"Only status='ready' assets count, so the `uploaded` and `failed` rows must be\n"+
			"excluded - a public count a creator can see inflating with files that cannot\n"+
			"even be played is worse than no count at all.", v, r)
	}
}

// mediaSvcFor builds the MEDIA service over a seeded entitlement service.
//
// `newSubService` returns the SUBSCRIPTION service, which has no `Initiate` -
// the first draft of this file used it for both and would not compile. The two are
// separate bounded contexts: one owns `media_assets`, the other owns
// `channel_subscriptions`.
func mediaSvcFor(t *testing.T, db *gorm.DB) *MediaService {
	t.Helper()
	return NewMediaService(db, NewEntitlementService(db, config.LoadPlans()))
}

// forceOwnedChannel makes a real, public, live channel owned by `owner`.
func forceOwnedChannel(t *testing.T, db *gorm.DB, owner uuid.UUID, handle string) model.Channel {
	t.Helper()
	ch := model.Channel{
		ID: uuid.New(), UserID: owner,
		Handle:      handle,
		DisplayName: "Probe",
		IsPublic:    true, IsActive: true,
	}
	if err := db.Create(&ch).Error; err != nil {
		t.Fatalf("create channel %s: %v", handle, err)
	}
	t.Cleanup(func() {
		db.Unscoped().Exec(`DELETE FROM media_assets WHERE channel_id = ?`, ch.ID)
		db.Unscoped().Where("handle = ?", handle).Delete(&model.Channel{})
		db.Exec(`DELETE FROM retired_handles WHERE handle = ?`, handle)
	})
	return ch
}

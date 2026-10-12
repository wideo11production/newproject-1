package service

// PUBLIC MEDIA PLAYBACK - who may be handed a playable URL, and for what.
//
// =============================================================================
// WHY THIS IS SEPARATE FROM `SignedObjectURL`
// =============================================================================
//
// `SignedObjectURL` signs an object key. It has no opinion about who is asking,
// because the OWNER-scoped handler in front of it does the checking. Opening a
// public route therefore needs its own gate: an anonymous visitor on
// `/channel/@handle` must be able to watch, and must only ever be able to watch
// what the owner would see on that same page.
//
// =============================================================================
// THE GATE, IN ORDER
// =============================================================================
//
// The asset exists                   ->  404 otherwise
// status = ready                     ->  404. `scanning` and `failed` are not
//                                        playable, and distinguishing them
//                                        would leak pipeline state.
// moderation_status = approved        ->  404. A rejected or still-pending
//                                        asset is invisible to the world,
//                                        including its own URL holder.
// channel is_public AND is_active     ->  404. A private channel's video is
//                                        the owner's business, and the same
//                                        404 as a missing asset so the route is
//                                        not an existence oracle.
//
// A 404 for every one of those failures is the point. An "unauthorised" for
// "exists but you may not" turns the endpoint into a way to enumerate ids.
//
// The path is the same traversal-free relative path the owner endpoint takes,
// for the same reason: a caller must not be able to name an object outside the
// asset's own prefix, and the asset prefix is `{assetID}/`.

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// ErrPublicMediaNotFound is returned when an asset may not be played publicly.
//
// Deliberately indistinguishable from "no such asset": the handler maps it to a
// single 404 so the route cannot distinguish "private" from "missing".
var ErrPublicMediaNotFound = fmt.Errorf("media is not publicly available")

// PublicPlayableAsset is the gate: is this asset watchable by a stranger?
//
// It returns the asset only when ALL four conditions hold, and answers with the
// same `ErrPublicMediaNotFound` for every way they can fail - so the caller
// cannot tell "there is no such id" from "that id is private".
//
// Signing is deliberately NOT done here. This method answers a policy question
// and the handler performs the signing, because a service that both decides and
// mints is a service whose decision cannot be unit-tested without a MinIO
// client, and the policy is the part that must be testable.
func (s *MediaService) PublicPlayableAsset(
	ctx context.Context,
	assetID uuid.UUID,
) (model.MediaAsset, error) {
	// ---- the asset, joined to its channel in one read ----
	//
	// The join is not an optimisation. Reading the asset and then its channel
	// would leave a window where the two disagree, and the whole gate depends on
	// them agreeing.
	var row struct {
		model.MediaAsset
		ChannelIsPublic bool `gorm:"column:channel_is_public"`
		ChannelIsActive bool `gorm:"column:channel_is_active"`
		ChannelSet      bool `gorm:"column:channel_set"`
	}
	err := s.db.WithContext(ctx).
		Model(&model.MediaAsset{}).
		Select("media_assets.*, " +
			"COALESCE(channels.is_public, false) AS channel_is_public, " +
			"COALESCE(channels.is_active, false) AS channel_is_active, " +
			"(channels.id IS NOT NULL) AS channel_set").
		Joins("LEFT JOIN channels ON channels.id = media_assets.channel_id").
		Where("media_assets.id = ?", assetID).
		First(&row).Error
	if err != nil {
		return model.MediaAsset{}, ErrPublicMediaNotFound
	}

	// ---- the gate ----
	//
	// `IsVisiblePublic` carries `ready AND approved`; the channel half is here
	// rather than in the model because it is a property of the JOINED row, and a
	// model method cannot see it.
	//
	// An asset with NO channel is not publicly playable either. "Filed under
	// none" means the creator has not published it anywhere, and the browse and
	// channel pages never list it - so a direct URL must not either.
	if !row.IsVisiblePublic() || !row.ChannelSet || !row.ChannelIsPublic || !row.ChannelIsActive {
		return model.MediaAsset{}, ErrPublicMediaNotFound
	}
	return row.MediaAsset, nil
}

// PublicMediaStream opens a publicly visible asset's object for reading.
//
// The two halves are deliberately one call: the gate decides WHICH object may be
// read, and opening it is only safe once that has been decided. A caller that
// ran the gate and then opened the object would be one refactor away from
// skipping the gate - and the whole point of this route is that it is reachable
// without a session.
//
// `relative` is validated as traversal-free here rather than trusted, for the
// same reason.
func (s *MediaService) PublicMediaStream(
	ctx context.Context,
	assetID uuid.UUID,
	relative string,
	offset, length int64,
) (*ReadObject, error) {
	clean, err := publicObjectPath(relative)
	if err != nil {
		return nil, err
	}

	if _, perr := s.PublicPlayableAsset(ctx, assetID); perr != nil {
		return nil, perr
	}

	// The object key is the asset id plus the caller's already-validated path,
	// which is exactly the transcoder's prefix layout.
	return s.storage.OpenVideoObject(ctx, assetID.String()+"/"+clean, offset, length)
}

// OwnerMediaStream opens an asset's object for the OWNER, and for nobody else.
//
// The same reason the public method exists - a server cannot fetch a presigned
// URL - applied to the owner's own library. The difference is the gate: this one
// consults the session's user id, so an owner can watch a draft on a private
// channel that the public route correctly refuses.
func (s *MediaService) OwnerMediaStream(
	ctx context.Context,
	assetID uuid.UUID,
	ownerID uuid.UUID,
	relative string,
	offset, length int64,
) (*ReadObject, error) {
	clean, err := publicObjectPath(relative)
	if err != nil {
		return nil, err
	}

	// Owner-scoped, and a missing asset and someone else's asset answer the SAME
	// way - so this cannot be used to discover that an id exists.
	if _, gerr := s.Get(ctx, assetID, ownerID); gerr != nil {
		return nil, ErrMediaNotFound
	}

	return s.storage.OpenVideoObject(ctx, assetID.String()+"/"+clean, offset, length)
}

// publicObjectPath validates a caller-supplied relative path inside an asset's
// prefix and returns it cleaned.
//
// The same rules the owner endpoint enforces, applied to a route that needs no
// session - which is exactly why they cannot be assumed to have been applied
// upstream.
func publicObjectPath(rel string) (string, error) {
	trimmed := strings.TrimSpace(rel)
	if trimmed == "" {
		return "", fmt.Errorf("no object requested")
	}
	if filepath.IsAbs(trimmed) || strings.HasPrefix(trimmed, "/") {
		return "", fmt.Errorf("object path may not escape the asset prefix")
	}
	for _, seg := range strings.Split(trimmed, "/") {
		if seg == ".." {
			return "", fmt.Errorf("object path may not escape the asset prefix")
		}
	}
	clean := filepath.Clean(trimmed)
	if clean == "." {
		return "", fmt.Errorf("no object requested")
	}
	return clean, nil
}

// PublicMediaStreamTTL is how long a signed playback URL lives.
//
// Short enough that a leaked URL goes stale within the sitting, long enough
// that a full playlist plus its segments can be fetched inside it. A 4 second
// segment times 60 is four minutes; the presign TTL is 15 by default, which
// covers the in-flight request but is best paired with a client that re-resolves
// the playlist rather than caching the URL.
func publicMediaStreamTTL() time.Duration {
	return 15 * time.Minute
}

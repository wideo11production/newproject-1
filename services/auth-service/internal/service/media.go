package service

// MediaService: the `media_assets` rows and the upload state machine.
//
// Separated from `StorageService` on purpose. `StorageService` is MinIO only - it
// has no database handle and should not grow one, because "can this URL be
// signed" and "is this user over quota" are different questions with different
// failure modes. This service owns the rows; the other owns the bytes.
//
// The full plan for Phase 3 lives in `SYSTEM-PLAN.md` §5. This file covers the
// parts that are the service's own concern: quota, the state machine, and the
// `initiated` rows nobody finished.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// Media errors. Distinct types because the client needs to say something
// different for each - "try again" versus "pick a smaller file".
var (
	// ErrMediaQuotaExceeded - the user has too many assets, or an upload that
	// would exceed the byte budget.
	ErrMediaQuotaExceeded = errors.New("media quota exceeded")

	// ErrMediaNotFound - no such asset, OR not yours.
	ErrMediaNotFound = errors.New("media not found")

	// ErrInvalidStateTransition - a transition the state machine does not allow.
	//
	// Its own error because it is a BUG when it happens, not a user mistake: the
	// client follows the state machine, so seeing one means a caller has
	// hardcoded a status string and gone out of order. It is logged loudly for
	// that reason.
	ErrInvalidStateTransition = errors.New("invalid media state transition")
)

// MediaService owns media asset rows.
type MediaService struct {
	db *gorm.DB

	// entitlements answers what may this user do. Every quota check goes through
	// it rather than through a plan string, so the answer comes from the ledger
	// and not from a caller's belief about which plan someone is on.
	//
	// May be nil in tests that never check a quota - assetCap then returns the
	// free tier, which fails CLOSED.
	entitlements *EntitlementService

	// storage opens objects out of the `video` bucket, and exists ONLY for the
	// playback path. A presigned URL cannot be fetched by a server (the Host in
	// its signature makes a public-host URL unreachable from inside the network),
	// so streaming the bytes means opening the object directly.
	//
	// Set by the bootstrap, and nil-safe: a MediaService built without it simply
	// cannot stream, and the route that needs it says so rather than panicking.
	// Keeping it out of `NewMediaService`'s signature means the tests that build a
	// MediaService for quota and state-machine behaviour do not grow a MinIO
	// dependency they do not have.
	storage *StorageService
}

// WithStorage attaches the object store to the media service.
//
// A separate setter rather than a constructor argument, so the many tests that
// build a MediaService for unrelated reasons are untouched.
func (s *MediaService) WithStorage(storage *StorageService) *MediaService {
	s.storage = storage
	return s
}

// NewMediaService builds the service.
func NewMediaService(db *gorm.DB, entitlements *EntitlementService) *MediaService {
	return &MediaService{db: db, entitlements: entitlements}
}

// WHAT A USER WITH NO PLAN MAY STORE.
//
// This used to be `const freeTierAssets = 0`, and the comment above it argued
// the classic fail-closed case: if the lookup fails, give the tightest tier, not
// the most generous. That reasoning is right about TYPOS and WRONG ABOUT THIS
// PRODUCT, and it is the reason a brand-new user could not upload a single file.
//
// The shape of this product is that uploading is FREE and UNLIMITED for
// everyone - including a user with no entitlement at all. What a paid plan buys
// is the right to EARN, which lives behind a different capability
// (`monetization`) and is entirely unaffected by what this constant says. So
// "fail closed on media" was never protecting anyone from anything: it was
// refusing the free product to the people who had not bought the paid one.
//
// A user with no plan, no entitlement service wired, a database error, or a plan
// that does not grant this capability all land on UNLIMITED media now - and
// every one of them still earns nothing, because `monetization` does not appear
// in any of those states either. The failure is closed where it needs to be
// closed (money) and open where the product promises it is open (uploading).
const freeTierAssets = config.Unlimited

// assetCap returns how many more assets the user may hold under `capability`,
// and the plan's CEILING itself.
//
// Both values, because they answer different questions and the caller needs
// both: `remaining` decides whether the upload is allowed, `limit` decides what
// the refusal should SAY. A user whose plan grants 0 reels has exhausted
// nothing, and telling them they have "used every reel upload their plan allows
// (0 stored)" is a sentence that contradicts itself - which is exactly what a
// trial creator was shown, because `0 - 0 == 0` and the message only checked
// the sign of the result.
//
// ---- WHY THERE IS NOW ONLY ONE REFUSAL ----
//
// This used to distinguish two:
//
//	limit > 0, remaining == 0  ->  they used every one; delete one or upgrade
//	limit == 0                 ->  the plan does not include this at all
//
// The second branch is now unreachable, and it is worth knowing why rather than
// leaving it in place to look like coverage. `Limit` answers a 0 grant with
// `ErrQuotaDenied`, and the unhappy paths above fall back to `freeTierAssets`,
// which is `config.Unlimited` - because uploading is free for everyone. So a
// plan that grants 0 media arrives here as UNLIMITED, not as zero. What a paid
// plan gates is EARNING, which is a different capability and is not read here
// at all.
//
// The consequence is the honest one: there is exactly one way to be refused, and
// it is "your plan has a ceiling and you have reached it".
//
// `current` is what they already hold.
//
// The nil check is real and not defensive boilerplate. `EntitlementService` is a
// pointer, and calling a method on a nil one PANICS - and this function is on the
// upload path, so a panic here would take down a request over a missing
// dependency. An earlier version documented "may be nil, returns the free tier"
// and then dereferenced it anyway; the comment was a promise the code did not
// keep, which is worse than having written nothing.
func (s *MediaService) assetCap(
	ctx context.Context, userID uuid.UUID, capability string, current int64,
) (remaining int64, limit int64, err error) {
	if s == nil || s.entitlements == nil {
		return freeTierAssets, freeTierAssets, nil
	}

	limit, granted, err := s.entitlements.Limit(ctx, userID, capability)
	if err != nil || !granted {
		// No live entitlement, no such plan, or the plan grants this at 0. All
		// three mean the same thing for MEDIA: nothing is being denied, because
		// uploading is free. See the header.
		return freeTierAssets, freeTierAssets, nil
	}
	if limit == config.Unlimited {
		return config.Unlimited, config.Unlimited, nil
	}
	return limit - current, limit, nil
}

// FindReusable returns a READY asset this user already holds with the same
// content hash, so its renditions can be reused instead of re-encoded.
//
// SYSTEM-PLAN.md §5.3. The saving is real: without it, a creator who fixes a
// title and re-uploads pays two complete ffmpeg passes for identical output,
// and the storage doubles for the same reason.
//
// Scoped to the SAME USER, deliberately. Two creators uploading the same stock
// clip get the same hash, and reusing across users would file one person's
// video under another's account - and would make the renditions deletable by
// whichever of them cleared their library. Per-user is the cheap, safe version.
//
// Only a `ready` asset can be reused. Anything still in the pipeline is a job
// in flight: pointing a second asset at renditions that a running transcode is
// about to overwrite underneath it would hand back a file that changes. A
// `failed` one has nothing to hand back.
//
// The Newest is returned, so a re-upload after a re-render gets the latest
// output rather than the first pass.
func (s *MediaService) FindReusable(ctx context.Context, userID uuid.UUID, contentHash string) (*model.MediaAsset, error) {
	if contentHash == "" {
		return nil, nil
	}

	var a model.MediaAsset
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND content_hash = ? AND status = ?",
			userID, contentHash, model.MediaStatusReady).
		Order("created_at DESC").
		First(&a).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}

// =============================================================================
// QUOTA, REPORTED INSTEAD OF DISCOVERED
// =============================================================================
//
// A trial user has `media_assets = 0` and `reel_assets = 0`, so nothing can be
// uploaded at all. The only way to learn that used to be to pick a file, let
// the browser hash it, send the initiate request, and read the refusal - whose
// message named a CAPABILITY (`your reel_assets allowance is used up`), which
// means nothing to somebody who just chose a video.
//
// `MediaQuota` surfaces the same server-side answer up front, in the vocabulary
// the creator needs: what they have left, per kind.

// MediaQuotaEntry is one kind's allowance.
type MediaQuotaEntry struct {
	Kind       string `json:"kind"`
	Capability string `json:"capability"`
	Limit      int64  `json:"limit"`
	Used       int64  `json:"used"`
	Remaining  int64  `json:"remaining"`
	Unlimited  bool   `json:"unlimited"`
}

// MediaQuota reports what the caller may still upload.
//
// `Used` counts only ACTIVE assets - `failed` rows are excluded, so a file that
// was refused (a 100-second reel, say) does not keep costing them a slot
// forever. That is the whole reason the count is filtered rather than total:
// a creator whose reel was too long must not be permanently one upload shorter.
func (s *MediaService) MediaQuota(ctx context.Context, userID uuid.UUID) ([]MediaQuotaEntry, error) {
	out := make([]MediaQuotaEntry, 0, 2)

	kinds := []struct {
		kind       string
		capability string
	}{
		{model.MediaKindVideo, config.CapMediaAssets},
		{model.MediaKindReel, config.CapReelAssets},
	}

	for _, k := range kinds {
		used, err := s.countActive(ctx, userID, k.kind)
		if err != nil {
			return nil, err
		}

		// ---- The nil check, which this function did not have ----
		//
		// `MediaQuota` called `s.entitlements.Limit` directly, so a MediaService
		// built without an entitlement service - which `NewMediaService(db, nil)`
		// is a legal and tested construction - took a nil-pointer panic on the
		// quota endpoint rather than returning an answer.
		//
		// `assetCap` has had this check all along; this is the same guard, added
		// where it was missing. A panic here is not a bad response, it is a
		// crashed worker, and the quota endpoint is the one the upload panel
		// polls after every file.
		var limit int64
		granted := false
		if s.entitlements != nil {
			limit, granted, err = s.entitlements.Limit(ctx, userID, k.capability)
			if err != nil {
				limit, granted = 0, false
			}
		}
		if !granted {
			// No live entitlement and no entitlement service: fall back to the same
			// default the upload path uses, so the number reported here is the
			// number the upload is actually checked against. Reporting a generous
			// figure and then refusing would be the worst combination.
			limit, granted = freeTierAssets, true
		}

		entry := MediaQuotaEntry{
			Kind:       k.kind,
			Capability: k.capability,
			Used:       int64(used),
			Limit:      limit,
		}
		if limit == config.Unlimited {
			entry.Unlimited = true
			entry.Remaining = -1
		} else {
			entry.Remaining = limit - int64(used)
			if entry.Remaining < 0 {
				entry.Remaining = 0
			}
		}
		out = append(out, entry)
	}
	return out, nil
}

// Initiate records the intent to upload and returns the row to attach a ticket to.
//
// Order matters here and it is the same lesson as the click ledger: the ROW is
// created BEFORE the presigned URL is handed out.
//
// A URL minted first, with a failed insert after it, leaves a URL that can write
// an object nobody has a record of - an unowned object in the bucket that no
// cleanup job can find, because cleanup reconciles against rows.
// ---------------------------------------------------------------------------
// UploadContext - where an upload came from.
// ---------------------------------------------------------------------------
//
// A struct rather than three more positional parameters, because `Initiate`
// already takes eight and a ninth and tenth positional argument is how a
// `device_fingerprint` ends up passed into a `user_agent` slot. The compiler
// catches a struct field mismatch only if the types differ; a struct with NAMED
// fields catches it at the call site, where the reader can see it.
//
// WHY IT IS CAPTURED AT ALL
//
// The channel T&C (clause 6) promises that a violator's credentials and digital
// footprints can be reported to law enforcement. That promise is only true if the
// footprint was recorded, and the only moment it is knowable is when the upload
// happens - the presigned PUT goes straight to MinIO, so this service never sees
// the browser again after `initiate`.
//
// WHY IT IS NOT IN ANY JSON RESPONSE
//
// `json:"-"` on all three columns. A creator does not need their own IP echoed
// back, and a stranger must never receive someone else's.
type UploadContext struct {
	IP         string
	UserAgent  string
	DeviceFP   string
}

func (s *MediaService) Initiate(
	ctx context.Context,
	userID uuid.UUID,
	kind, filename, contentType, objectKey string,
	declaredBytes int64,
	declaredDurationS int,
	channelID *uuid.UUID,
	contentHash string,
	uploadCtx UploadContext,
) (*model.MediaAsset, error) {
	if kind == "" {
		kind = model.MediaKindVideo
	}
	if kind != model.MediaKindVideo && kind != model.MediaKindReel && kind != model.MediaKindAudio {
		return nil, fmt.Errorf("unknown media kind %q", kind)
	}

	// ---- Quota, BEFORE any bytes move ----
	//
	// Checked here, at `initiated`, and not after the upload finishes. A user who
	// is over quota learns it before spending their upload time rather than after.
	//
	// The capability is chosen per KIND, because a reel and a 4-hour upload are
	// not interchangeable uses of one quota - a single cap would mean either reels
	// get 4-hour budgets or long-form gets 90 seconds.
	capability := config.CapMediaAssets
	if kind == model.MediaKindReel {
		capability = config.CapReelAssets
	}

	// ---- The channel this media is filed under ----
	//
	// OWNERSHIP IS CHECKED, and that is the whole point of taking a channel id
	// from the client: without it, any user could file their video under someone
	// else's channel and inflate its public count. The check is a query, not a
	// comparison, because a channel that is soft-deleted is still a row.
	//
	// A mismatched id is REJECTED rather than ignored. Silently dropping it would
	// file the video in the library instead - which looks like it worked, and the
	// creator discovers on their channel page that it is missing.
	if channelID != nil {
		// A small STRUCT, not a bare `uuid.UUID`.
		//
		// `Take(&owner)` with a bare uuid asks GORM to infer a model from a scalar,
		// and it guesses - which came back as a scan error about a column named
		// "user_id" it had invented. Naming the column we want is both correct and
		// self-documenting.
		var row struct {
			UserID uuid.UUID `gorm:"column:user_id"`
		}
		err := s.db.WithContext(ctx).Model(&model.Channel{}).
			Select("user_id").
			Where("id = ? AND deleted_at IS NULL", *channelID).
			Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("channel not found")
		}
		if err != nil {
			return nil, err
		}
		if row.UserID != userID {
			// Same wording as "not found", deliberately: telling a caller "that
			// channel exists but is not yours" is a free existence oracle for
			// every channel id in the system.
			return nil, fmt.Errorf("channel not found")
		}
	}

	existing, err := s.countActive(ctx, userID, kind)
	if err != nil {
		return nil, err
	}
	remaining, limit, err := s.assetCap(ctx, userID, capability, int64(existing))
	if err != nil {
		return nil, err
	}
	// ---- UNLIMITED MUST NOT READ AS "OUT OF ROOM" ----
	//
	// `assetCap` answers Unlimited with `remaining = config.Unlimited`, which is
	// -1. A bare `remaining <= 0` therefore refuses every unlimited plan - the
	// comparison cannot tell "no ceiling" from "ceiling reached", because both are
	// non-positive and one of them is NEGATIVE for that exact reason.
	//
	// This is not a hypothetical it is worth being careful about: `lifetime10` has
	// granted unlimited media since it was written, so its users have been refused
	// uploads the whole time, and nothing reported it. The bug was invisible only
	// because unlimited was rare. Uploading is unlimited for EVERY plan now, so a
	// check that misreads -1 as "empty" would take the whole product down.
	//
	// So the sentinel is compared explicitly, and the sign check is left to do the
	// job it can actually do.
	if remaining != config.Unlimited && remaining <= 0 {
		// The message names WHAT the creator may do, not which internal capability
		// ran out. `your reel_assets allowance is used up (0 stored)` is precisely
		// what a creator who uploaded a VIDEO used to be told - it named the
		// wrong quota for their action and used a capability string as its
		// vocabulary, so it was both confusing and wrong for them.
		//
		// AND IT NAMED A LIMIT THEY DID NOT HAVE. A user whose plan grants zero
		// reels was refused with "you have used every reel upload your plan allows
		// (0 stored) - delete one" - a sentence whose own parenthesis disproves
		// it, and advice they cannot act on, because they have stored nothing. The
		// cause was `0 - 0 == 0`: a ceiling of zero and a ceiling that is merely
		// full both produce a non-positive result, so one sign check could not
		// tell them apart.
		//
		// That second case is gone now, and it is gone for a reason worth stating:
		// with uploading free for everyone, a plan granting zero media falls
		// through to the unlimited default rather than arriving here at all. So
		// this branch now has exactly one reader - a creator whose plan has a real
		// ceiling they have genuinely reached - and the message below is the
		// number pair that makes the advice actionable.
		//
		// `existing` and `limit` are both read, unlike before: "10 of 10" tells a
		// creator they are AT the edge, and that deleting one really does help.
		// "0 stored" told a creator the opposite of what was true.
		return nil, fmt.Errorf(
			"%w: you have used every %s upload your plan allows (%d of %d stored). Delete one, or change plan",
			ErrMediaQuotaExceeded, kindWord(kind), existing, limit)
	}

	// An `initiated` row that nobody finishes would otherwise hold a quota slot
	// forever. Twenty-four hours is long enough for a large upload on a slow
	// connection and short enough that an abandoned dialog is not a quota change.
	expires := time.Now().UTC().Add(24 * time.Hour)

	asset := &model.MediaAsset{
		ID:                uuid.New(),
		UserID:            userID,
		ChannelID:         channelID,
		Kind:              kind,
		Filename:          filename,
		ContentType:       contentType,
		DeclaredBytes:     declaredBytes,
		DeclaredDurationS: declaredDurationS,
		ObjectKey:         objectKey,
		// The reuse key, stored at `initiated` so the next attempt can find THIS
		// row and skip the encode. An empty claim is stored as NULL, not "" -
		// the column carries a char_length CHECK, and an empty string is a
		// constraint failure rather than "no claim".
		ContentHash: hashOrNil(contentHash),

		// ---- The uploader's footprint, written once and never updated ----
		//
		// Bounded at the same lengths as the columns so an oversized header from a
		// hostile client is a database error rather than a silent truncation into
		// someone else's shape. A client-supplied string is untrusted input, and the
		// audit trail is the wrong place to discover that.
		UploadIP:          boundTo(uploadCtx.IP, 64),
		UploadUserAgent:   boundTo(uploadCtx.UserAgent, 500),
		DeviceFingerprint: boundTo(uploadCtx.DeviceFP, 128),

		// Moderation is held back from the start. A row that begins at `approved`
		// would publish a video nobody screened.
		ModerationStatus:  model.ModerationPendingReview,
		ModerationChecks:  "{}",
		// `initiated`: we have authorised an upload and are waiting for bytes. Not
		// "uploading" - nothing has been sent yet, and a state machine that claims
		// otherwise cannot tell a stuck upload from one that never started.
		Status:    model.MediaStatusInitiated,
		ExpiresAt: &expires,
	}

	if err := s.db.WithContext(ctx).Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

// Reuse creates a new asset that points at the renditions of an existing one,
// skipping the upload and the transcode entirely.
//
// This is the whole point of §5.3: the file is already in the bucket, already
// probed, already encoded, and already has a poster and a filmstrip. Only the
// ROW is new - a different filename, a different channel, a different title.
//
// A COPY rather than a pointer, and that matters: the two rows must remain
// independently deletable. If row B pointed at row A's object keys by reference,
// deleting A would have to either delete B's video too or leave B holding keys
// that no longer exist. Copying the keys means each delete cleans up only its
// own row, and a re-upload never resurrects a deleted video.
//
// The copy is created DIRECTLY in `ready` state. It has not been transcoded
// because it does not need to be - the output that already satisfies this asset
// is sitting in the bucket.
func (s *MediaService) Reuse(
	ctx context.Context,
	userID uuid.UUID,
	kind, filename string,
	channelID *uuid.UUID,
	source *model.MediaAsset,
) (*model.MediaAsset, error) {
	asset := &model.MediaAsset{
		ID:                uuid.New(),
		UserID:            userID,
		ChannelID:         channelID,
		Kind:              kind,
		Filename:          filename,
		ContentType:       source.ContentType,
		ContentHash:       source.ContentHash,
		// Measured values carried across from the source, because they are
		// measurements of the SAME bytes - not a fresh claim.
		DeclaredBytes:     source.Bytes,
		DeclaredDurationS: source.DurationS,
		Bytes:             source.Bytes,
		DurationS:         source.DurationS,
		Width:             source.Width,
		Height:            source.Height,
		HasAudio:          source.HasAudio,
		OccurredAt:        source.OccurredAt,

		// The artefacts. `object_key` points at the source's bytes, which is
		// what makes a re-encode unnecessary - the transcoder reads the source
		// out of the bucket, not out of this row.
		ObjectKey:         source.ObjectKey,
		PublicURL:         source.PublicURL,
		HLSPublicURL:      source.HLSPublicURL,
		PosterKey:         source.PosterKey,
		PosterPublicURL:   source.PosterPublicURL,
		FilmstripKey:      source.FilmstripKey,
		PeaksKey:          source.PeaksKey,

		Status: model.MediaStatusReady,
	}
	if err := s.db.WithContext(ctx).Create(asset).Error; err != nil {
		return nil, err
	}
	return asset, nil
}

// MarkUploaded records that the bytes landed.
//
// This is a CLAIM by the client, not a measurement - which is exactly why the
// next state is `scanning`, where ffprobe measures the file for real. A client
// that POSTs `MarkUploaded` without sending anything gets a row that immediately
// fails verification, rather than one that sits in `ready` forever.
func (s *MediaService) MarkUploaded(ctx context.Context, assetID, userID uuid.UUID) error {
	return s.transition(ctx, assetID, userID, model.MediaStatusInitiated, model.MediaStatusUploaded)
}

// MarkScanning moves an uploaded asset into verification.
func (s *MediaService) MarkScanning(ctx context.Context, assetID, userID uuid.UUID) error {
	return s.transition(ctx, assetID, userID, model.MediaStatusUploaded, model.MediaStatusScanning)
}

// MarkTranscoding moves a verified asset into the pipeline.
//
// NOTE ON THE MAP KEYS: every key in an `Updates` map is a COLUMN NAME, and it
// bypasses the model's `gorm:"column:..."` tags entirely. That is why
// `duration_seconds` is spelled out here even though the Go field is
// `DurationS`. Getting this wrong is not a compile error - it is a runtime
// "column does not exist" the first time the code path runs, which is exactly
// how a rarely-used transition ships broken.
func (s *MediaService) MarkTranscoding(ctx context.Context, assetID, userID uuid.UUID, width, height, durationS int, hasAudio bool) error {
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status = ?", assetID, userID, model.MediaStatusScanning).
		Updates(map[string]any{
			"status":           model.MediaStatusTranscoding,
			"width":            width,
			"height":           height,
			"duration_seconds": durationS,
			"has_audio":        hasAudio,
			"failure_reason":   "",
		})
	return s.expectChange(res, assetID, "scanning -> transcoding")
}

// MarkReady records the finished artefacts.
//
// `bytes` and `duration_s` are the MEASURED values, written here rather than at
// upload, so that everything downstream uses numbers from the file itself. A
// client that claims a 4 GB / 4-hour file and sends a 12 MB / 9-second one gets a
// row that says 12 MB / 9 seconds.
//
// ---- AND THE MODERATION VERDICT ----
//
// `ready` is a TECHNICAL verdict: the file decodes, the renditions exist. It has
// never meant "this may be shown", and after migration 030 it explicitly does
// not - that is `moderation_status`, written in the same update.
//
// The two are written together rather than in two calls because they describe
// one event: the transcoder finishing a job, which is the only moment both
// answers exist. Writing `ready` in one call and the verdict in another would
// leave a window in which the asset is technically finished but has no recorded
// decision - and a public read in that window would have to guess.
//
// `verdict` is mapped by the caller. An EMPTY verdict is the one case this
// method does not decide for the caller: it writes `pending_review`, holding the
// asset back. "Nobody looked" is not the same as "looked and it was fine", and a
// moderation engine that failed to answer must not release its subject.
func (s *MediaService) MarkReady(
	ctx context.Context,
	assetID, userID uuid.UUID,
	bytes int64, durationS int,
	posterKey, filmstripKey, hlsURL, peaksKey string,
	verdict ModerationVerdict,
) error {
	updates := map[string]any{
		"status":           model.MediaStatusReady,
		"bytes":            bytes,
		"duration_seconds": durationS,
		"poster_key":       posterKey,
		"filmstrip_key":    filmstripKey,
		"hls_public_url":   hlsURL,
		"peaks_key":        peaksKey,
		"failure_reason":   "",
		// Cleared: the row is done, so it must stop counting against the
		// abandoned-upload sweep.
		"expires_at": nil,
	}

	// ---- the poster URL, written even when the caller omitted it ----
	//
	// The transcoder writes the poster to a DETERMINISTIC path: `{assetID}/poster.jpg`.
	// So a caller that does not send a poster URL is not saying "there is no poster",
	// it is saying "I did not bother to tell you where I put it" - and the answer is
	// knowable.
	//
	// This is why 78 of 102 ready rows had a NULL `poster_public_url` while the
	// poster file was sitting in the bucket: an earlier version wrote the poster only
	// when the callback carried one. The on-screen result was a grid of grey tiles
	// with filenames, which reads as "the media has no data" to a creator.
	//
	// The path is constructed here rather than trusted from the callback for the
	// same reason `hls_public_url` is: it is the one value that must match what the
	// transcoder actually wrote, and only one side of this call knows that.
	posterPublicURL := strings.TrimSpace(posterKey)
	if posterPublicURL == "" {
		// The canonical shape the transcoder writes. Built from the asset id rather
		// than from a configured host, because `poster_public_url` stores a PATH-like
		// key that `relativeObjectPath` on the client slices the asset id out of -
		// not a browsable URL. The video bucket is private by design, so every read
		// goes through a signed stream route anyway.
		posterPublicURL = fmt.Sprintf("%s/poster.jpg", assetID.String())
	}
	updates["poster_public_url"] = posterPublicURL

	applyModeration(updates, verdict, "", "", nil, "ai:pending")

	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status = ?", assetID, userID, model.MediaStatusTranscoding).
		Updates(updates)
	return s.expectChange(res, assetID, "transcoding -> ready")
}

// MarkFailed records a failure with something a creator can act on.
//
// `reason` is REQUIRED to be non-empty by the caller, not defaulted here. A bare
// "transcode failed" tells a user nothing they can do, and "failed for no
// reason" is worse than the original error.
func (s *MediaService) MarkFailed(ctx context.Context, assetID, userID uuid.UUID, from, reason string) error {
	if reason == "" {
		reason = "unspecified failure"
	}
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status IN ?",
			assetID, userID,
			[]string{
				model.MediaStatusInitiated, model.MediaStatusUploaded,
				model.MediaStatusScanning, model.MediaStatusTranscoding,
			}).
		Updates(map[string]any{
			"status":         model.MediaStatusFailed,
			"failure_reason": reason,
		})
	return s.expectChange(res, assetID, "-> failed")
}

// ---------------------------------------------------------------------------
// RETRY — recovering a failed asset.
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS
// ===============
//
// Without it, `failed` was a terminal state with no exit. A 4K upload that
// outran the transcoder's memory got killed, the row was written `failed`, and
// it stayed failed FOREVER — because `MarkTranscodeResult` refuses to touch any
// asset that is not `uploaded`/`scanning`/`transcoding`, and nothing in the
// product could move it back.
//
// That is a bad state to be in for a reason that is not obvious: the bytes are
// still in the bucket and perfectly good, and the transcode is cheap to redo.
// The creator's only route was to re-upload the whole file — and for a 4 GB 4K
// source, on a home connection, that is a very expensive way to say "try again".
//
// And the FIRST attempt often fails for a reason that is not the file's fault:
// the transcoder was at its memory limit (2 GB, now raised to 8 GB), the machine
// was busy, or a previous job held the only worker slot. Retrying is not an
// escape hatch for a corrupt upload — it is the normal recovery path for a
// transient resource failure.
//
// WHAT RETRY DOES NOT DO
// ======================
//
// It does not reset `failure_reason` in place — the row moves to
// `MediaStatusFailed` -> `MediaStatusUploaded` and clears the reason, so an
// attempt that fails again records the NEW error rather than appending a
// history the schema has nowhere to store.
//
// It does not re-check quota. The user was already counted when the asset was
// first initiated, and `countActive` excludes only `failed` — so moving out of
// `failed` RE-ENTERS the quota count, which is correct: they are about to hold
// this asset again.

// RetryFailed moves a `failed` asset back to `uploaded` so it can be
// transcoded again.
//
// Owner-scoped like every other method here: the user id is in the WHERE, so a
// caller cannot requeue someone else's failed upload.
//
// Only `failed -> uploaded` is allowed. An asset that is mid-pipeline is already
// going somewhere, and requeueing it would race with the transcode that owns it
// — that is what `ErrInvalidStateTransition` is for, and it is why this is not
// written as a general "set status to anything" helper.
func (s *MediaService) RetryFailed(ctx context.Context, assetID, userID uuid.UUID) error {
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status = ?",
			assetID, userID, model.MediaStatusFailed).
		Updates(map[string]any{
			"status":         model.MediaStatusUploaded,
			"failure_reason": "",
		})
	return s.expectChange(res, assetID, "failed -> uploaded")
}

// DeleteFailed removes a `failed` asset and returns the row so the caller can
// clean up its stored bytes.
//
// The BYTES are deleted separately, by the caller that owns the MinIO client —
// this method is a database operation and `MediaService` deliberately has no
// storage handle (see the file header). Deleting the row without the object
// would leak storage; deleting the object without the row would orphan it.
//
// Owner-scoped, and locked to `failed` only. An in-flight upload is being
// written to by its own transcode, and deleting that row out from under the
// pipeline is how a callback ends up resurrecting a deleted asset.
func (s *MediaService) DeleteFailed(ctx context.Context, assetID, userID uuid.UUID) (*model.MediaAsset, error) {
	var asset model.MediaAsset
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ? AND status = ?",
			assetID, userID, model.MediaStatusFailed).
		First(&asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: %s is not a failed asset you own", ErrMediaNotFound, assetID)
		}
		return nil, err
	}
	if err := s.db.WithContext(ctx).Delete(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (s *MediaService) transition(ctx context.Context, assetID, userID uuid.UUID, from, to string) error {
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status = ?", assetID, userID, from).
		Update("status", to)
	return s.expectChange(res, assetID, from+" -> "+to)
}

// expectChange turns "zero rows affected" into a typed error.
//
// Zero rows means one of three things, all of them worth distinguishing from
// success: the asset does not exist, it is not yours, or it is already past this
// state. Reporting any of them as OK is how a state machine quietly stops being
// one - the caller believes it moved something that did not move.
//
// `user_id` is in the WHERE clause on purpose: an asset id alone would let any
// caller advance anyone's upload.
func (s *MediaService) expectChange(res *gorm.DB, assetID uuid.UUID, desc string) error {
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("%w: %s on %s", ErrInvalidStateTransition, desc, assetID)
	}
	return nil
}

// kindWord is the plain word for a media kind, used in quota messages.
//
// A capability name (`reel_assets`) is the internal vocabulary of the ledger and
// means nothing to the person it is shown to. This is the one place that
// translation happens, so every quota message reads the same way.
func kindWord(kind string) string {
	switch kind {
	case model.MediaKindReel:
		return "reel"
	case model.MediaKindAudio:
		return "audio"
	default:
		return "video"
	}
}

// hashOrNil turns an empty hash into nil.//
// The column carries a `char_length = 64` CHECK, and GORM writes the zero value
// of a string as "" rather than NULL - so an absent claim stored as "" is a
// constraint violation that fails EVERY normal upload. NULL is what "no claim
// was made" is supposed to look like.
func hashOrNil(h string) *string {
	if h == "" {
		return nil
	}
	return &h
}

// boundTo truncates s to n RUNES, not bytes.
//
// Byte-truncating a UTF-8 string can cut a multi-byte character in half and
// produce an invalid sequence, which is what actually gets stored and later shown
// to a moderator. Rune-truncation drops whole characters instead, so the result
// is always valid text.
//
// The lengths come from the column definitions, so this is a bound and not a
// transform - a caller who wants a longer value is asking for a migration.
func boundTo(s string, n int) string {
	if s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}

// Get returns an asset, scoped to its owner.
//
// A missing asset and someone else's asset produce the SAME error, so a caller
// cannot use this to discover that an id exists.
func (s *MediaService) Get(ctx context.Context, assetID, userID uuid.UUID) (*model.MediaAsset, error) {
	var a model.MediaAsset
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", assetID, userID).
		First(&a).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMediaNotFound
		}
		return nil, err
	}
	return &a, nil
}

// MarkPublished records that the owner chose to put this asset live.
//
// Owner-scoped in the WHERE clause, not in a preceding read. A two-step
// "check then update" leaves a window where the check passes and the update lands
// on someone else's row, and an ownership check that is not enforced by the query
// that uses it is not enforced. So the user id is part of the UPDATE itself.
//
// Idempotent: the same call twice sets the same column, which is the correct
// behaviour for a double-tapped Publish button.
func (s *MediaService) MarkPublished(
	ctx context.Context,
	assetID, userID uuid.UUID,
	at time.Time,
) error {
	return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ?", assetID, userID).
		Update("published_at", at).Error
}

// countActive counts assets that hold a quota slot.
//
// `initiated` counts, because an authorisation that has not been used is still a
// slot reserved - otherwise opening four upload dialogs and abandoning three
// would leave the quota at one usable upload.
func (s *MediaService) countActive(ctx context.Context, userID uuid.UUID, kind string) (int, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("user_id = ? AND kind = ? AND status NOT IN ?",
			userID, kind,
			[]string{model.MediaStatusFailed}).
		Count(&n).Error
	return int(n), err
}

// List returns a user's assets, newest first.
//
// Bounded, always: this table is unbounded and an unpaginated list is a denial of
// service with a JSON body.
func (s *MediaService) List(ctx context.Context, userID uuid.UUID, kind string, limit, offset int) ([]model.MediaAsset, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := s.db.WithContext(ctx).Model(&model.MediaAsset{}).Where("user_id = ?", userID)
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	rows := make([]model.MediaAsset, 0, limit)
	err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

// ReelFacts are the ONLY fields a public readiness check is given.
//
// Deliberately not a `*model.MediaAsset`. The readiness endpoint is public - it
// describes a FILE, and there is nothing to enumerate in it - but returning the
// full asset would hand out `user_id`, `object_key` and every declared field. A
// struct that cannot carry the owner is a stronger guarantee than a struct where
// the code is trusted not to read the owner.
//
// Only MEASURED values, never `DeclaredBytes` / `DeclaredDurationS`: a readiness
// verdict computed from a client's own claim is not a readiness verdict.
type ReelFacts struct {
	ID        uuid.UUID
	Kind      string
	Status    string
	Width     int
	Height    int
	DurationS int
	Bytes     int64
	HasAudio  bool
	Filename  string
	PublicURL string
}

// ReelFactsFor reads the readiness inputs for an asset, without owner scoping.
//
// Returns ErrMediaNotFound when there is no such asset. There is deliberately
// NO "not yours" branch, because this path does not know who is asking - which is
// exactly why it returns so little.
func (s *MediaService) ReelFactsFor(ctx context.Context, assetID uuid.UUID) (*ReelFacts, error) {
	var a model.MediaAsset
	err := s.db.WithContext(ctx).
		Select("id", "kind", "status", "width", "height", "duration_seconds", "bytes",
			"has_audio", "filename", "public_url").
		Where("id = ?", assetID).
		First(&a).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMediaNotFound
		}
		return nil, err
	}
	return &ReelFacts{
		ID: a.ID, Kind: a.Kind, Status: a.Status,
		Width: a.Width, Height: a.Height, DurationS: a.DurationS,
		Bytes: a.Bytes, HasAudio: a.HasAudio,
		Filename: a.Filename, PublicURL: a.PublicURL,
	}, nil
}

// InternalObjectURL is the INTERNAL MinIO address of a stored object.
//
// Used only for the hand-off to `transcoding-service`, and the internal one on
// purpose:
//
//   - a PRESIGNED url would work, and would put a credential into a job payload,
//     the transcoder's logs, and anything reading them later.
//   - the transcoder authenticates to MinIO with its OWN bucket-scoped account
//     (`MINIO_TRANSCODE_*`), so it has no need for ours - and has no business
//     holding it.
//
// The result is a stable internal path that contains no secret, which is what a
// job record should hold anyway: a presigned URL in a stored row is a credential
// with an expiry date that nobody remembers.
func (s *MediaService) InternalObjectURL(asset *model.MediaAsset) string {
	if asset == nil || asset.ObjectKey == "" {
		return ""
	}
	base := os.Getenv("MINIO_INTERNAL_ENDPOINT")
	if base == "" {
		base = "http://minio:9000"
	}
	bucket := os.Getenv("MINIO_VIDEO_BUCKET")
	if bucket == "" {
		bucket = "video"
	}
	return strings.TrimSuffix(base, "/") + "/" + bucket + "/" + asset.ObjectKey
}

// SweepAbandonedInitiations clears expired `initiated` rows.
//
// Returns how many were freed. Exposed so the caller can log it - a sweep that
// silently stops is indistinguishable from a product nobody uses.
//
// Only `initiated` rows are swept. An asset in `scanning` or `transcoding` is
// real work in progress, and deleting it would pull the object out from under
// the pipeline.
func (s *MediaService) SweepAbandonedInitiations(ctx context.Context) (int64, error) {
	res := s.db.WithContext(ctx).
		Where("status = ? AND expires_at IS NOT NULL AND expires_at < ?",
			model.MediaStatusInitiated, time.Now().UTC()).
		Delete(&model.MediaAsset{})
	return res.RowsAffected, res.Error
}

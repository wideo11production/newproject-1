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
}

// NewMediaService builds the service.
func NewMediaService(db *gorm.DB, entitlements *EntitlementService) *MediaService {
	return &MediaService{db: db, entitlements: entitlements}
}

// MaxAssetsPerKind is how many assets of one kind a user may hold.
//
// REMOVED in favour of the entitlement ledger. It used to be a hardcoded switch
// keyed on a plan string, which meant TWO independent copies of the answer to
// "what does Pro include" - this one and `entitlement_grants`. They would
// drift, and the drift would be silent: a quota change would apply to one path
// and not the other.
//
// Also, it took a PLAN STRING and not a user. That is the more serious problem:
// a caller passing "pro" because it believed the user was on Pro is asking the
// database to confirm something the database already knows. Entitlements are
// resolved per USER, always.
//
// What it did get right, and is kept as a default: a free user gets 0. If the
// lookup fails, the answer is the tightest tier rather than the most generous.
// Defaulting a typo'd plan code to Pro grants a thousand uploads silently.
const freeTierAssets = 0

// assetCap returns how many more assets the user may hold under `capability`.
//
// `current` is what they already hold.
//
// FAILS CLOSED on every unhappy path: no entitlement service wired, no live
// entitlement, a plan that does not include this capability, a database error.
// All of them return the free tier.
//
// The nil check is real and not defensive boilerplate. `EntitlementService` is a
// pointer, and calling a method on a nil one PANICS - and this function is on
// the upload path, so a panic here would take down a request over a missing
// dependency. An earlier version documented "may be nil, returns the free tier"
// and then dereferenced it anyway; the comment was a promise the code did not
// keep, which is worse than having written nothing.
func (s *MediaService) assetCap(ctx context.Context, userID uuid.UUID, capability string, current int64) (int64, error) {
	if s == nil || s.entitlements == nil {
		return freeTierAssets, nil
	}
	limit, granted, err := s.entitlements.Limit(ctx, userID, capability)
	if err != nil || !granted {
		return freeTierAssets, nil
	}
	if limit == config.Unlimited {
		return config.Unlimited, nil
	}
	return limit - current, nil
}

// Initiate records the intent to upload and returns the row to attach a ticket to.
//
// Order matters here and it is the same lesson as the click ledger: the ROW is
// created BEFORE the presigned URL is handed out.
//
// A URL minted first, with a failed insert after it, leaves a URL that can write
// an object nobody has a record of - an unowned object in the bucket that no
// cleanup job can find, because cleanup reconciles against rows.
func (s *MediaService) Initiate(
	ctx context.Context,
	userID uuid.UUID,
	kind, filename, contentType, objectKey string,
	declaredBytes int64,
	declaredDurationS int,
	channelID *uuid.UUID,
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
	remaining, err := s.assetCap(ctx, userID, capability, int64(existing))
	if err != nil {
		return nil, err
	}
	if remaining <= 0 {
		return nil, fmt.Errorf(
			"%w: your %s allowance is used up (%d stored)", ErrMediaQuotaExceeded, capability, existing)
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
func (s *MediaService) MarkReady(
	ctx context.Context,
	assetID, userID uuid.UUID,
	bytes int64, durationS int,
	posterKey, filmstripKey, hlsURL, peaksKey string,
) error {
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND user_id = ? AND status = ?", assetID, userID, model.MediaStatusTranscoding).
		Updates(map[string]any{
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
		})
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

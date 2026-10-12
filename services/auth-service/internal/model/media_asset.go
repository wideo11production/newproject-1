// Media assets: the state machine for an uploaded file.
//
// =============================================================================
// WHY A STATE MACHINE AND NOT A BOOLEAN
// =============================================================================
//
// "Uploaded" has six meanings in this product: authorised but nothing sent,
// bytes in flight, bytes landed but unverified, being probed, being transcoded,
// or ready to use. A boolean collapses them, and the collapse is what makes a
// stuck upload indistinguishable from one that never started.
//
// Every state here answers a different question the UI needs to ask:
//   initiated  -> what have I let the user start?
//   uploaded   -> did the bytes actually arrive?
//   scanning   -> is this even a decodable video?
//   transcoding-> are the renditions being made?
//   ready      -> can it be used?
//   failed     -> what went wrong, and can they retry?
//
// =============================================================================
// WHY TWO TIMESTAMPS, AND WHICH ONE RETENTION USES
// =============================================================================
//
// `OccurredAt` is when the file was made. `UploadedAt` is when the server
// accepted it. Retention keys on the server's own timestamp: a client that
// backdates a video by two years must not be able to have it silently deleted
// on the next sweep, or - more usefully - to make itself immortal by claiming
// a far-future date.

package model

import (
	"time"

	"github.com/google/uuid"
)

// Media kinds.
//
// `reel` is NOT a separate asset type: it is an asset with a different kind, and
// therefore a different budget (90s, 512 MB, 9:16 only). One upload path, one
// transcode pass, one player. A second parallel pipeline for reels would be a
// second set of bugs for no gain.
const (
	MediaKindVideo = "video"
	MediaKindReel  = "reel"
	MediaKindAudio = "audio"
)

// Media states. See the file header for why these are separate values.
const (
	// Authorised: quota passed and a presigned URL was minted. Nothing has been
	// sent yet - so a row sitting here for hours means the client walked away,
	// which is worth knowing.
	MediaStatusInitiated = "initiated"

	// Bytes landed in the bucket, before any verification.
	MediaStatusUploaded = "uploaded"

	// Probing with ffprobe. This is where a file whose claimed type was a lie
	// gets caught - see `validateMediaUpload`'s comment on claims vs content.
	MediaStatusScanning = "scanning"

	// Handed to transcoding-service for HLS renditions.
	MediaStatusTranscoding = "transcoding"

	MediaStatusReady  = "ready"
	MediaStatusFailed = "failed"
)

// Moderation states. A SEPARATE state machine from `status` above, because
// "is this decodable" and "may this be shown" are different questions.
//
// Public visibility requires BOTH:
//
//	status == 'ready'  AND  moderation_status == 'approved'
//
// Kept as two columns rather than merged into one ladder, because merging them
// forces a single column to answer two questions and produces states like
// "ready_approved" that no single site can check correctly. See migration 030.
const (
	// ModerationNotRequired - technical assets (audio stems, posters, peaks).
	// Not policy content, so it is never gated. Also the column DEFAULT, so a
	// row that predates the upload path is not accidentally hidden.
	ModerationNotRequired = "not_required"

	// ModerationPendingReview - uploaded, awaiting the AI scan. YELLOW badge.
	// The user can see it in their library; nobody else can.
	ModerationPendingReview = "pending_review"

	// ModerationApproved - every check passed. GREEN badge, publicly visible.
	ModerationApproved = "approved"

	// ModerationRejected - a check crossed its hard threshold. RED badge, never
	// public, no auto-appeal. The reason is stored for the creator to read.
	ModerationRejected = "rejected"

	// ModerationFlagged - a check landed in the borderline band. ORANGE badge,
	// never public until a human moderator decides. This is the state that
	// exists precisely because a classifier's confidence is not a verdict.
	ModerationFlagged = "flagged"
)

// IsVisiblePublic reports whether an asset may be shown to anyone but its owner.
//
// This is the ONE place the rule lives, and every public surface (browse, the
// channel page, public media lists) calls it. A second copy of the two-condition
// check anywhere is a copy that can drift, and the drift is always in the
// direction of publishing something it should not.
func (a MediaAsset) IsVisiblePublic() bool {
	return a.Status == MediaStatusReady && a.ModerationStatus == ModerationApproved
}

// IsModerationPending reports whether a verdict is still outstanding.
//
// Used by the worklist and by the sweep that escalates a job that never
// reported back - a video stuck at `pending_review` forever is invisible to its
// creator and to everyone else, with nothing saying why.
func (a MediaAsset) IsModerationPending() bool {
	return a.ModerationStatus == ModerationPendingReview ||
		a.ModerationStatus == ModerationFlagged
}

// MediaAsset is one uploaded file.
type MediaAsset struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	// ChannelID files the media under a channel, which is what makes it show up
	// on that channel's public page and in its counts.
	//
	// A POINTER, and nullable in the schema, because a creator uploads before
	// they have a channel. NULL means "filed under none", which is normal and not
	// an error - so the browse page counts only what is filed, and the owner's
	// library can show the rest.
	ChannelID *uuid.UUID `gorm:"type:uuid;index" json:"channel_id,omitempty"`

	Kind        string `gorm:"size:16;not null;default:'video'" json:"kind"`
	Filename    string `gorm:"size:500;not null" json:"filename"`
	ContentType string `gorm:"size:120;not null" json:"content_type"`

	// ---- What the client claimed, and what we found ----
	//
	// Kept BOTH, and the difference between them is the point. `declared_*` is the
	// client's claim, recorded at `initiated` so the quota check does not have to
	// trust the claim later. The unprefixed fields are MEASURED after scanning,
	// and they are the ones that count for anything: a file that claims 4 GB and
	// decodes to 12 seconds of video is neither, and only the measurement is
	// useful.
	//
	// Explicit column names because GORM's default would turn `DurationS` into
	// `duration_s`, which is unreadable in SQL. The Go name stays short for
	// call sites; the column spells the unit out.
	DeclaredBytes     int64 `gorm:"column:declared_bytes;not null;default:0" json:"declared_bytes"`
	DeclaredDurationS int   `gorm:"column:declared_duration_seconds;not null;default:0" json:"declared_duration_seconds"`

	Bytes     int64 `gorm:"column:bytes;not null;default:0" json:"bytes"`
	DurationS int   `gorm:"column:duration_seconds;not null;default:0" json:"duration_seconds"`
	Width     int   `gorm:"column:width;not null;default:0" json:"width"`
	Height    int   `gorm:"column:height;not null;default:0" json:"height"`
	HasAudio  bool  `gorm:"column:has_audio;not null;default:false" json:"has_audio"`

	// Where the bytes are, and where they are SERVED from.
	//
	// `object_key` is the private bucket path. `public_url` is what a client may
	// be handed, and it is a presigned or CDN URL, never a bare bucket path -
	// R6 in the plan: no bucket is public, and every read is a short-lived
	// signed URL.
	ObjectKey string `gorm:"column:object_key;size:500;not null" json:"-"`
	PublicURL string `gorm:"column:public_url;size:500" json:"public_url,omitempty"`

	// ---- Derived artefacts ----
	//
	// Populated as the pipeline produces them. All optional because they arrive at
	// different times, and a missing poster is normal for an asset that is still
	// `scanning`.
	PosterKey    string `gorm:"size:500" json:"-"`
	FilmstripKey string `gorm:"size:500" json:"-"`
	HLSPublicURL string `gorm:"size:500" json:"hls_url,omitempty"`
	PeaksKey     string `gorm:"size:500" json:"-"`

	// PosterPublicURL is the SERVED poster, as opposed to PosterKey which is the
	// private bucket path.
	//
	// A browse page cannot render PosterKey: an <img> needs a fetchable url, and
	// producing one means signing it per card per view, with an expiry - so the
	// images would break again an hour later. The transcode stores the served url
	// once, when it knows it.
	//
	// NULL until then, and NULL is honest: "no poster yet" is not the same as "a
	// poster that failed".
	PosterPublicURL *string `gorm:"size:500" json:"poster_public_url,omitempty"`

	// ContentHash is the SHA-256 hex of the file bytes, computed in the BROWSER
	// and claimed at `initiated`.
	//
	// It exists for one reason (§5.3): a creator who re-uploads the same file to
	// the same channel - having changed a title, or having abandoned an edit and
	// started again - must not pay a second full ffmpeg pass for identical
	// output. The bytes never reach this service, so the hash is the only thing
	// that can say "this is the file I already have".
	//
	// It is a CLAIM, not a verification, and that is honest: the file goes
	// browser -> MinIO directly on a presigned PUT, so this service cannot have
	// seen it. The worst case of a lying client is a wasted transcode, which is
	// exactly the outcome of having no dedup at all. The measurements that DO get
	// verified are the ffprobe ones, written by `MarkTranscodeResult`.
	//
	// A POINTER so that "no claim was made" is NULL rather than an empty string,
	// because the column carries a `char_length = 64` CHECK and an empty string
	// would violate it - turning every normal upload into a constraint failure.
	// NULL never matches anything, so a client that does not compute a hash takes
	// the slow path and nothing needs backfilling.
	ContentHash *string `gorm:"column:content_hash;size:64;index" json:"content_hash,omitempty"`

	Status string `gorm:"column:status;size:16;not null;default:'initiated';index" json:"status"`

	// ---- Uploader context (migration 030 + 032) ----
	ModerationStatus string  `gorm:"column:moderation_status;size:16;not null;default:'not_required';index" json:"moderation_status"`
	ModerationReason string  `gorm:"column:moderation_reason;size:500" json:"moderation_reason,omitempty"`
	ModerationScore  float64 `gorm:"column:moderation_score;not null;default:0" json:"moderation_score"`
	ModerationChecks string  `gorm:"column:moderation_checks;type:jsonb;not null;default:'{}'" json:"-"`
	ModeratedAt      *time.Time `gorm:"column:moderated_at" json:"moderated_at,omitempty"`
	// Who decided. "ai:<provider>-v<n>" for the automated engine, or
	// "admin:<uuid>" when a human overrode it. Recorded so a verdict can be
	// attributed, which is the first thing an appeal asks.
	ModeratedBy string `gorm:"column:moderated_by;size:120" json:"moderated_by,omitempty"`

	// ---- Who uploaded this, and from where (migration 032) ----
	//
	// Recorded at `initiate` - the only moment the uploader's own request is in
	// hand - because T&C clause 6 promises that a violator's digital footprints
	// can be handed to law enforcement, and a promise about data that was never
	// captured is decoration.
	//
	// NOT exposed in any JSON response: these fields are for the audit trail and
	// for the moderation system. A creator does not need to see their own IP
	// echoed back, and a stranger must never see it.
	UploadIP         string `gorm:"column:upload_ip;size:64" json:"-"`
	UploadUserAgent  string `gorm:"column:upload_user_agent;size:500" json:"-"`
	DeviceFingerprint string `gorm:"column:device_fingerprint;size:128;index:idx_media_assets_device_fp,where:device_fingerprint <> ''" json:"-"`

	// Why it failed, in a form a creator can act on. Empty on success, and never
	// a bare error string - "transcode failed" tells a user nothing they can do.
	FailureReason string `gorm:"column:failure_reason;size:500" json:"failure_reason,omitempty"`

	// ---- When ----
	//
	// Retention keys on UploadedAt / CreatedAt, never on OccurredAt.
	OccurredAt *time.Time `gorm:"column:occurred_at" json:"occurred_at,omitempty"`
	UploadedAt *time.Time `gorm:"column:uploaded_at" json:"uploaded_at,omitempty"`

	// Expiry of an `initiated` row nobody finished. Swept by a cleanup job so an
	// abandoned authorisation does not sit against a user's quota forever - a
	// user who opened four upload dialogs and abandoned three would be capped at
	// one concurrent upload.
	ExpiresAt *time.Time `gorm:"column:expires_at;index" json:"expires_at,omitempty"`

	CreatedAt time.Time `gorm:"autoCreateTime;index" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// PublishedAt is when the OWNER released this asset to the video page.
	//
	// A deliberate second state, not a synonym for `moderation_status == approved`.
	// Moderation answers "did the screening pass"; this answers "did the owner
	// choose to put it out". Collapsing them loses the fact that an approved clip
	// the owner is still editing is not public, and it would make "the owner
	// confirmed, after being told what they were certifying" unrecordable - which
	// is the only proof the platform has that the responsibility was accepted.
	//
	// NULL means never published, which is the correct default: an upload becomes
	// public when its owner says so, not because a scan passed.
	PublishedAt *time.Time `gorm:"column:published_at;index" json:"published_at,omitempty"`
}

func (MediaAsset) TableName() string { return "media_assets" }

// IsReel reports whether this asset is subject to the reel budget.
//
// Derived from `kind` rather than stored as a boolean, for the same reason the
// subscriber count is derived: a flag that has to be kept in step with another
// column is a flag that eventually is not in step with it.
func (a MediaAsset) IsReel() bool { return a.Kind == MediaKindReel }

// IsTerminal reports whether the asset has stopped moving.
//
// Used by cleanup: only a terminal state can be swept, so an in-flight transcode
// is never deleted out from under the pipeline.
func (a MediaAsset) IsTerminal() bool {
	return a.Status == MediaStatusReady || a.Status == MediaStatusFailed
}

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

	Status string `gorm:"column:status;size:16;not null;default:'initiated';index" json:"status"`

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

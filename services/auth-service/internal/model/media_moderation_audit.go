// Content moderation audit trail.
//
// Every verdict the moderation engine writes is also recorded here, with the
// context that the asset row does not carry: who asked, from where, on which
// device, and whether a human later overrode it.
//
// WHY SEPARATE FROM media_assets
// =============================================================================
//
// The asset row holds the CURRENT verdict, and a re-review overwrites it. That
// is correct for the asset and useless for the audit: "what did this video score
// last time, and who looked at it" has to survive the review that replaced it.
//
// So the split is: `media_assets.moderation_*` is state, this table is history.
//
// WHY IP AND DEVICE ARE HERE AND NOT ON THE ASSET
// =============================================================================
//
// The PII retention worker sweeps `sessions.user_agent`/`ip_address` on a
// schedule, and it sweeps them because that data is only legally useful for a
// window. A moderation record is different: it is what a law-enforcement request
// is answered with, and that window is years.
//
// Copying the values here at moderation time is what lets retention delete the
// session rows without destroying the audit trail. The copy is denormalised on
// purpose.
//
// It is also why this table is not swept by retention at all - see the note in
// migration 030 about legal holds.

package model

import (
	"time"

	"github.com/google/uuid"
)

// Moderation verdicts. Mirrors the three terminal moderation states.
const (
	ModerationVerdictApproved = "approved"
	ModerationVerdictRejected = "rejected"
	ModerationVerdictFlagged  = "flagged"
)

// MediaModerationAudit is one moderation verdict, with its context.
type MediaModerationAudit struct {
	ID           uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MediaAssetID uuid.UUID  `gorm:"type:uuid;not null;index" json:"media_asset_id"`
	UserID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`

	// Provider is the engine that produced this verdict: "ai:local-v1",
	// "asr:none", "admin:<uuid>". Recorded because thresholds change and a
	// verdict has to be attributable to the build that made it.
	Provider string `gorm:"size:120;not null" json:"provider"`

	Verdict    string  `gorm:"size:16;not null;index" json:"verdict"`
	Confidence float64 `gorm:"not null;default:0" json:"confidence"`

	// Checks is the per-check breakdown as raw JSON, matching
	// `media_assets.moderation_checks` at the moment this verdict was written.
	// Raw rather than a nested struct so a new check needs no migration here.
	Checks string `gorm:"type:jsonb;not null;default:'{}'" json:"checks"`

	// --- Context for law-enforcement cooperation ---
	IPAddress         string `gorm:"column:ip_address;size:64" json:"ip_address,omitempty"`
	DeviceFingerprint string `gorm:"column:device_fingerprint;size:128" json:"device_fingerprint,omitempty"`
	UserAgent         string `gorm:"column:user_agent;size:500" json:"user_agent,omitempty"`

	// --- Human override ---
	//
	// All NULL/empty on an automated verdict. Populated when a moderator
	// resolves a `flagged` row, so "the AI said flagged, a human accepted anyway"
	// is distinguishable from "the AI approved it".
	ReviewedAt   *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	ReviewerID   *uuid.UUID `gorm:"type:uuid;column:reviewer_id" json:"reviewer_id,omitempty"`
	ReviewerNote string     `gorm:"column:reviewer_note;size:1000" json:"reviewer_note,omitempty"`

	CreatedAt time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}

func (MediaModerationAudit) TableName() string { return "media_moderation_audits" }

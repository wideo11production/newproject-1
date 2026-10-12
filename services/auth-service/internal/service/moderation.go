package service

// Content moderation: mapping a verdict onto an asset, and recording who decided.
//
// This file is deliberately thin on policy. The THRESHOLDS, the checks, and the
// scoring live in the engine that runs them (currently the transcoder, which
// already has the source decoded). What lives here is the part that is easy to
// get quietly wrong: turning a verdict into a database write, and making sure
// that write is also recorded as history.
//
// =============================================================================
// WHY THE MAPPING IS A FUNCTION AND NOT A SWITCH AT THE CALL SITE
// =============================================================================
//
// Three places write moderation state - `MarkReady` (automated), the human
// review endpoint (admin), and a future re-review. Each would otherwise carry
// its own `switch verdict`, and the four states are three lines each: the
// mapper is one definition instead of three that can drift.
//
// More importantly, the DANGEROUS case is the one this makes explicit.
// An EMPTY verdict - the transcoder had nothing to say - is not an error, and it
// is not an approval. It is held at `pending_review`, which is the state where
// nobody can see the video except its owner. Fail-closed is the only safe
// direction: releasing a video because the engine failed to answer would mean
// the engine being down publishes adult content.
//
// =============================================================================
// WHY THE AUDIT ROW IS WRITTEN HERE AND NOT BY THE CALLER
// =============================================================================
//
// Because it must not be forgotten. A verdict in `media_assets` that has no
// matching audit row is indistinguishable from a verdict that was hand-edited
// into the column, and the audit trail is what a legal request is answered with.
// Pairing them in one function means the day someone needs the history, it is
// already there.

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// ModerationVerdict is the engine's decision about one asset.
//
// Kept separate from `model.ModerationApproved` and friends because the type is
// what the VERDICT-CARRING side of the wire speaks, and those constants are what
// the STORED column holds. They are not the same vocabulary: a verdict can be
// "empty" (nothing was said), which is not a value the column may ever take.
type ModerationVerdict struct {
	// Approved | rejected | flagged. Empty when the engine reported nothing.
	Status string
	// Human-readable reason, shown to the creator when not approved.
	Reason string
	// Highest violation confidence, 0.0-1.0.
	Score float64
	// Per-check breakdown, as produced by the engine.
	Checks map[string]any
	// Provider identifier, e.g. "ai:heuristic-v1" or "asr:none".
	Provider string
}

// applyModeration writes a verdict into an `Updates` map.
//
// It mutates the map rather than returning one, because the caller is building a
// multi-column update (status, bytes, renditions) and moderation is one group
// among several. Returning a map would force the caller to merge, and a merge is
// a place where a key is silently overwritten.
//
// `now` is passed rather than read from the clock so the whole write is one
// instant: `moderated_at` should be when the decision was made, not when the
// GORM update reached the database.
func applyModeration(
	updates map[string]any,
	v ModerationVerdict,
	reason, moderatedBy string,
	checks map[string]any,
	defaultProvider string,
) {
	status := strings.ToLower(strings.TrimSpace(v.Status))
	provider := strings.TrimSpace(v.Provider)
	if provider == "" {
		provider = defaultProvider
	}
	if reason == "" {
		reason = strings.TrimSpace(v.Reason)
	}

	switch status {
	case model.ModerationVerdictApproved:
		updates["moderation_status"] = model.ModerationApproved
	case model.ModerationVerdictRejected:
		updates["moderation_status"] = model.ModerationRejected
	case model.ModerationVerdictFlagged:
		updates["moderation_status"] = model.ModerationFlagged
	default:
		// THE FAIL-CLOSED CASE.
		//
		// An unrecognised or absent verdict holds the asset back. This is the
		// branch that makes an engine outage safe: if the engine is unreachable
		// and reports nothing, every video it would have approved instead waits
		// for a human - which is a backlog, not a publication of unvetted content.
		updates["moderation_status"] = model.ModerationPendingReview
		if reason == "" {
			reason = "Awaiting moderation: no verdict was reported."
		}
	}

	if checks == nil {
		checks = v.Checks
	}
	updates["moderation_reason"] = reason
	updates["moderation_score"] = v.Score
	updates["moderated_by"] = moderatedByOrDefault(moderatedBy, provider)
	updates["moderated_at"] = time.Now().UTC()
	if encoded, err := json.Marshal(checks); err == nil {
		updates["moderation_checks"] = string(encoded)
	}
}

// moderatedByOrDefault prefers an explicit actor - a human reviewer's id - over
// the engine's provider string, because "who decided" should name a person when
// one was involved.
func moderatedByOrDefault(explicit, provider string) string {
	if strings.TrimSpace(explicit) != "" {
		return strings.TrimSpace(explicit)
	}
	if provider == "" {
		return "ai:unknown"
	}
	return provider
}

// RecordModerationAudit appends the verdict to the audit trail.
//
// Called by every path that writes a verdict, so the trail cannot be bypassed by
// choosing a different entry point.
//
// A FAILURE HERE DOES NOT FAIL THE VERDICT. That asymmetry has to be stated,
// because it is the wrong-seeming choice: if the audit write fails, the asset
// still carries its status and the upload still resolves. The reason is that a
// broken audit table must not be able to make uploads fail - the security
// control is the STATUS, and the audit is the record of it. Losing the record is
// bad; refusing the upload because of a logging problem is worse.
//
// The error is returned so the CALLER can log it loudly, which is how the gap
// gets noticed rather than silently accumulating.
func (s *MediaService) RecordModerationAudit(
	ctx context.Context,
	audit *model.MediaModerationAudit,
) error {
	if audit.ID == uuid.Nil {
		audit.ID = uuid.New()
	}
	return s.db.WithContext(ctx).Create(audit).Error
}

// ModerationWorklists returns the assets awaiting a decision.
//
// Owner-scoped for the creator's own view ("which of my videos is still being
// checked"), and NOT owner-scoped for the admin queue - the two callers pass
// different filters rather than this method growing a mode.
func (s *MediaService) ModerationWorklist(
	ctx context.Context,
	limit, offset int,
) ([]model.MediaAsset, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("moderation_status IN ?",
			[]string{model.ModerationPendingReview, model.ModerationFlagged})

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]model.MediaAsset, 0, limit)
	// Newest first. A review queue is a worklist, and returning the same first 50
	// forever means the oldest backlog is never reached - while the freshest item
	// is the one most likely to still be worth deciding.
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ModerationAuditsFor returns every verdict ever written for one asset.
//
// The reviewer's second question after "what am I looking at" is "what did the
// engine say, and did anyone already look". `media_assets` carries only the
// CURRENT verdict, so the history lives here - which is the reason the audit table
// exists separately from the columns.
//
// Newest first, because the most recent decision is the one that matters and a
// long history is rare.
func (s *MediaService) ModerationAuditsFor(
	ctx context.Context,
	assetID uuid.UUID,
) ([]model.MediaModerationAudit, error) {
	rows := make([]model.MediaModerationAudit, 0, 8)
	err := s.db.WithContext(ctx).
		Where("media_asset_id = ?", assetID).
		Order("created_at DESC").
		Find(&rows).Error
	return rows, err
}

// ResolveModeration applies a human decision to a `flagged` or `pending_review`
// asset and records the override.
//
// Auto-approved and auto-rejected are NOT reviewable here, and the restriction
// is the point: if a human could release a REJECTED video, the rejection would
// be advisory, and the product's zero-tolerance promise would be false. A human
// may only resolve the cases the engine itself declared uncertain.
func (s *MediaService) ResolveModeration(
	ctx context.Context,
	assetID uuid.UUID,
	reviewerID uuid.UUID,
	approve bool,
	note string,
) error {
	var asset model.MediaAsset
	if err := s.db.WithContext(ctx).Where("id = ?", assetID).First(&asset).Error; err != nil {
		return err
	}
	if !asset.IsModerationPending() {
		return ErrInvalidStateTransition
	}

	next := model.ModerationRejected
	if approve {
		next = model.ModerationApproved
	}

	now := time.Now().UTC()
	res := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ? AND moderation_status IN ?", assetID,
			[]string{model.ModerationPendingReview, model.ModerationFlagged}).
		Updates(map[string]any{
			"moderation_status": next,
			"moderation_reason": "",
			"moderated_by":     "admin:" + reviewerID.String(),
			"moderated_at":     now,
		})
	if err := s.expectChange(res, assetID, "pending -> "+next); err != nil {
		return err
	}

	// The audit row records the override as a decision, with the reviewer's note
	// verbatim. "The AI flagged it and a human accepted it" must be
	// distinguishable from "the AI approved it", or the flag is meaningless.
	return s.RecordModerationAudit(ctx, &model.MediaModerationAudit{
		MediaAssetID: assetID,
		UserID:       asset.UserID,
		Provider:     "admin:" + reviewerID.String(),
		Verdict:      next,
		Confidence:   asset.ModerationScore,
		Checks:       asset.ModerationChecks,
		ReviewedAt:   &now,
		ReviewerID:   &reviewerID,
		ReviewerNote: strings.TrimSpace(note),
	})
}

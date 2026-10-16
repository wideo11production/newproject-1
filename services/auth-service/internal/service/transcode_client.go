package service

// TranscodeClient - the one place in this codebase that talks to
// `transcoding-service`.
//
// =============================================================================
// WHY A CLIENT AND NOT AN HTTP CALL AT THE CALL SITE
// =============================================================================
//
// Three things have to be true of every submission, and a bare `http.Post` at
// each call site would let any one of them be forgotten:
//
//	1. the internal token is attached   - the intake runs ffmpeg per job, so an
//	                                    open endpoint is a CPU-exhaustion vector
//	2. the timeout is generous          - queuing is instant, so a short timeout
//	                                    would report failure for a job that then
//	                                    ran anyway
//	3. a failed enqueue does NOT fail the upload
//
// That third one is the important design decision. An asset that has been
// uploaded and recorded is worth keeping even if the transcode cannot be queued:
// it can be retried, and losing the row means the user has to upload an 8 GB
// file again. So enqueue failures are LOGGED and the asset moves to a state that
// says "stored, not yet transcoded" rather than back to nothing.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// TranscodeClient submits transcode jobs.
type TranscodeClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewTranscodeClient builds the client from the environment.
//
// `TRANSCODING_INTERNAL_URL` is the compose-network address; it must be server
// side only. `TRANSCODE_INTERNAL_TOKEN` is REQUIRED, and an empty one returns an
// error rather than a client that silently submits unauthenticated requests -
// which would fail at the far end anyway, just with a much worse error message.
func NewTranscodeClient() (*TranscodeClient, error) {
	url := os.Getenv("TRANSCODING_INTERNAL_URL")
	if url == "" {
		url = "http://transcoding-service:8083"
	}
	token := os.Getenv("TRANSCODE_INTERNAL_TOKEN")
	if token == "" {
		return nil, fmt.Errorf(
			"TRANSCODE_INTERNAL_TOKEN is empty: transcode submissions would be rejected " +
				"as unauthenticated. Set it rather than starting a client that cannot work")
	}
	return &TranscodeClient{
		baseURL: url,
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// TranscodeRequest is one job submission.
type TranscodeRequest struct {
	// VideoID is the `media_assets.id` this job belongs to. The transcoder echoes
	// it back on completion, which is how a result is matched to a row.
	VideoID string `json:"video_id"`

	// SourceURL is an INTERNAL MinIO address, never a presigned one. The
	// transcoder authenticates to MinIO with its own scoped account, so a
	// presigned URL would work and then leak a credential into a job payload and
	// the transcoder's logs.
	SourceURL string `json:"source_url"`

	// Kind is `video` or `reel`. It tells the transcoder whether this asset is
	// subject to the reel budget (90s, 9:16) and therefore whether the vertical
	// rendition is the one to surface. The ladder is produced either way - one
	// pass, all legs - so this is a LABEL, not a switch on work done.
	Kind string `json:"kind,omitempty"`
}

// TranscodeResult is the accepted-job response.
type TranscodeResult struct {
	JobID   string `json:"job_id"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// Submit queues a transcode job.
//
// Returns an error on transport failure or a non-2xx. The CALLER decides what
// that means for the asset - see the file header.
func (c *TranscodeClient) Submit(ctx context.Context, req TranscodeRequest) (*TranscodeResult, error) {
	if c == nil {
		return nil, fmt.Errorf("transcode client not configured")
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal transcode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+"/api/v1/transcode", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Internal-Token", c.token)

	res, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("transcode intake unreachable: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// Read a little of the body: an auth failure and a validation failure
		// need different responses, and "status 401" alone does not say which.
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("transcode intake returned %d: %s", res.StatusCode, string(bytes.TrimSpace(snippet)))
	}

	var out TranscodeResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode transcode response: %w", err)
	}
	return &out, nil
}

// ============================================================================
// CALLBACK - the transcoder reporting the RESULT of a job
// ============================================================================
//
// The type is named `TranscodeCallback`, not `TranscodeResult`, on purpose.
// `TranscodeResult` above is the response to SUBMITTING a job (job_id, status,
// "queued"); this is the report that arrives when the work is DONE. They look
// similar and mean opposite things at opposite ends of a pipeline, and one
// mistaken match would have a callback writing "queued" over a finished file.

// TranscodeCallback is what the transcoder reports when a job finishes.
type TranscodeCallback struct {
	AssetID string `json:"asset_id"`
	JobID   string `json:"job_id"`
	// "completed" or "failed" - the transcoder's vocabulary, mapped to ours
	// rather than assumed to already match.
	Status   string `json:"status"`
	Progress int    `json:"progress"`

	// The DEFAULT playlist - the highest rendition produced. Never empty on a
	// success; a completion without one is treated as a failure.
	PlaylistURL string `json:"playlist_url"`

	// Every rendition produced, keyed by name (`1080p`/`720p`/`480p`/`reel`/
	// `audio`). Optional: a job that produced only one rendition still works.
	Playlists map[string]string `json:"playlists,omitempty"`

	PosterURL    string `json:"poster_url"`
	FilmstripURL string `json:"filmstrip_url"`
	PeaksURL     string `json:"peaks_url"`

	// MEASURED values from ffprobe, not the client's claim. Written to the asset
	// so everything downstream uses numbers from the file itself.
	DurationS int   `json:"duration_s"`
	Width     int   `json:"width"`
	Height    int   `json:"height"`
	HasAudio  bool  `json:"has_audio"`
	// MeasuredBytes is the real size of the stored object, read off the file the
	// transcoder decoded. `declared_bytes` is the client's claim and is a number
	// nobody should store as fact.
	MeasuredBytes int64 `json:"bytes"`

	// ---- Content moderation verdict (migration 030) ----
	//
	// The transcoder already has the source decoded and a probe of every stream,
	// so it is the one place a moderation scan can run without a second copy of
	// the file and a second set of ffmpeg flags. `ModerationVerdict` is one of
	// approved | rejected | flagged, and empty means the transcoder did not
	// moderate - in which case the asset is held at `pending_review` rather than
	// being released, because "nobody looked" is not the same as "looked and it
	// was fine".
	//
	// Optional on the wire so an older transcoder still works; see
	// `applyModerationVerdict` for what an absent verdict means.
	ModerationVerdict string         `json:"moderation_verdict,omitempty"`
	ModerationReason  string         `json:"moderation_reason,omitempty"`
	ModerationScore   float64        `json:"moderation_score,omitempty"`
	ModerationChecks  map[string]any `json:"moderation_checks,omitempty"`
	ModerationAudio   string         `json:"moderation_audio_verdict,omitempty"`

	Error string `json:"error"`
}

// MarkTranscodeResult advances an asset to `ready` or `failed`.
//
// =============================================================================
// WHY THE ASSET USUALLY SAT AT `uploaded` FOREVER
// =============================================================================
//
// `finalize` marked an asset `uploaded`, the transcoder did the work, and then
// finished SILENTLY. Nothing reported back. The upload looked fine, the file was
// in the bucket, the HLS renditions existed - and the channel showed nothing,
// because the count only includes `ready`.
//
// Invisible in a way that is easy to miss: nothing is red, nothing fails, and a
// creator concludes the product is broken.
//
// The MEASURED values are what get written: bytes, duration, dimensions. A client
// can declare a 4 GB four-hour file and send a 12 MB nine-second one, and only
// the decoder knows the difference - which is the entire reason a state exists
// between `uploaded` and `ready`.
//
// A result for an asset that is NOT in a transcode-able state is REJECTED. The
// asset id alone cannot say "this is still the job we were waiting for", so
// applying one blindly would let a late callback resurrect a failed upload or
// overwrite a newer one.
func (s *MediaService) MarkTranscodeResult(ctx context.Context, cb TranscodeCallback) error {
	id, err := uuid.Parse(cb.AssetID)
	if err != nil {
		return fmt.Errorf("malformed asset id %q: %w", cb.AssetID, err)
	}

	var asset model.MediaAsset
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("%w: %s", ErrMediaNotFound, cb.AssetID)
		}
		return err
	}

	switch asset.Status {
	case model.MediaStatusUploaded, model.MediaStatusScanning, model.MediaStatusTranscoding:
	default:
		return fmt.Errorf("%w: asset %s is %q, so a transcode result cannot be applied",
			ErrInvalidStateTransition, cb.AssetID, asset.Status)
	}

	// ---- failed ----
	if strings.EqualFold(cb.Status, "failed") || strings.EqualFold(cb.Status, "error") {
		reason := strings.TrimSpace(cb.Error)
		if reason == "" {
			// A failure with no reason is worse than a generic one: it cannot be
			// acted on, and it reads as a bug rather than a bad file.
			reason = "the transcode failed for an unrecorded reason"
		}
		if len(reason) > 500 {
			reason = reason[:500]
		}
		return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"status":         model.MediaStatusFailed,
				"failure_reason": reason,
			}).Error
	}

	// ---- completed ----
	//
	// A completion with no playlist is treated as a FAILURE. "It finished" and
	// "it produced something watchable" are different claims, and a `ready` row
	// whose only playback url is empty is a tile that loads forever for every
	// viewer.
	playlist := strings.TrimSpace(cb.PlaylistURL)
	if playlist == "" {
		return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"status":         model.MediaStatusFailed,
				"failure_reason": "the transcode reported success but produced no playlist",
			}).Error
	}

	updates := map[string]any{
		"status":         model.MediaStatusReady,
		"hls_public_url": playlist,
		"failure_reason": "",
		// Cleared: the row is done, so it must stop counting against the abandoned
		// upload sweep.
		"expires_at": nil,
	}
	// MEASURED values come from ffprobe inside the transcoder and are written
	// here, so `duration_seconds`, `width` and `height` describe the file that
	// actually exists rather than the one the client claimed at `initiated`.
	// They only overwrite when the transcoder actually sent them - a zero means
	// "not measured", not "zero duration", and overwriting a real measurement
	// with a zero would be a silent data loss.
	if cb.DurationS > 0 {
		updates["duration_seconds"] = cb.DurationS
	}
	if cb.Width > 0 {
		updates["width"] = cb.Width
	}
	if cb.Height > 0 {
		updates["height"] = cb.Height
	}
	if cb.HasAudio {
		updates["has_audio"] = true
	}

	// The MEASURED size, not `declared_bytes`. The declared number is whatever
	// the client said before uploading; this one came off the object the
	// transcoder actually decoded. Only written when non-zero, so a field a
	// callback omits does not wipe a real measurement with a zero.
	if cb.MeasuredBytes > 0 {
		updates["bytes"] = cb.MeasuredBytes
	}

	// Packaging artefacts. The filmstrip is the scrubber's frame source and the
	// peaks drive the player bar's waveform, so both are stored alongside the
	// poster. Each is only written when present: an absent filmstrip means the
	// scrubber falls back to keyframe seeks, not that the video is broken.
	if poster := strings.TrimSpace(cb.PosterURL); poster != "" {
		updates["poster_public_url"] = poster
		updates["poster_key"] = poster
	}
	if filmstrip := strings.TrimSpace(cb.FilmstripURL); filmstrip != "" {
		updates["filmstrip_key"] = filmstrip
	}
	if peaks := strings.TrimSpace(cb.PeaksURL); peaks != "" {
		updates["peaks_key"] = peaks
	}

	// ---- REEL RULES, AT SCANNING ----
	//
	// SYSTEM-PLAN §6: orientation, duration and size are "enforced at `scanning`,
	// not at publish — fail early". This is `scanning`: the transcoder has just
	// MEASURED the file, so this is the first moment the truth is known.
	//
	// Why not at `initiated`, where the declared values live: those are the
	// CLIENT'S CLAIM. A file renamed `.mp4` could claim any duration and size, and
	// a rule written against the claim is a rule that only honest callers obey.
	// A rule written against ffprobe is a rule, which is what R1 means.
	//
	// Why not at publish: the creator would then finish the edit, go to post, and
	// be told no. The plan's whole point is to find out while it is still cheap.
	if asset.Kind == model.MediaKindReel {
		reason := reelRuleViolation(
			updateOr(updates, "duration_seconds", asset.DurationS),
			updateOr(updates, "width", asset.Width),
			updateOr(updates, "height", asset.Height),
			updateOr64(updates, "bytes", asset.Bytes),
		)
		if reason != "" {
			// The renditions are left in place and the row is marked FAILED with
			// the reason, rather than the object being deleted. A creator who
			// uploaded 500 MB should be told what is wrong with it, not have it
			// vanish and be asked to re-upload to find out.
			return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
				Where("id = ?", id).
				Updates(map[string]any{
					"status":         model.MediaStatusFailed,
					"failure_reason": reason,
				}).Error
		}
	}

	// ---- LONG-FORM DURATION CAP ----
	//
	// Non-reel media is capped at DefaultMaxMediaDurationSeconds (4 hours).
	// Checked against the MEASURED duration from ffprobe, not the client's
	// claim, because the claim is just a claim.
	//
	// A zero measured duration means "not measured", not "zero seconds", so
	// it passes here — the probe simply didn't finish, and that is a different
	// problem than a four-hour file.
	if asset.Kind != model.MediaKindReel {
		measuredDuration := updateOr(updates, "duration_seconds", asset.DurationS)
		if measuredDuration > 0 && measuredDuration > DefaultMaxMediaDurationSeconds {
			return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
				Where("id = ?", id).
				Updates(map[string]any{
					"status":         model.MediaStatusFailed,
					"failure_reason": fmt.Sprintf(
						"this media is %d seconds and long-form is limited to %d — trim it and upload again",
						measuredDuration, DefaultMaxMediaDurationSeconds),
				}).Error
		}
	}

	// ---- THE MODERATION VERDICT ----
	//
	// Written in the SAME update as `status = ready`, and for the reason in
	// `applyModeration`: the two describe one event, and a gap between them would
	// be a window in which an asset is technically finished with no recorded
	// decision about whether it may be shown.
	//
	// An absent verdict is NOT an approval. It resolves to `pending_review`,
	// which holds the asset back from every public surface until a human or a
	// working engine speaks. That direction is deliberate: an engine outage
	// delays uploads, it does not publish unvetted ones.
	verdict := ModerationVerdict{
		Status:   cb.ModerationVerdict,
		Reason:   cb.ModerationReason,
		Score:   cb.ModerationScore,
		Checks:   cb.ModerationChecks,
		Provider: cb.ModerationAudio,
	}
	applyModeration(updates, verdict, "", "", cb.ModerationChecks, "ai:heuristic-v1")

	if err := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		return err
	}

	// ---- THE AUDIT ROW ----
	//
	// Written after the status, deliberately: the asset's verdict is the control
	// and the audit is the record, and a broken audit table must not be able to
	// undo the control. The error is returned so the caller can log it - which
	// is how the gap gets noticed instead of accumulating.
	//
	// The uploader's footprint is COPIED IN from the asset row, not read from this
	// request. That is the point of recording it at `initiate`: the transcoder is
	// what is calling now, so the request's own IP is the transcoder's container IP
	// - the same value for every upload in the fleet. The columns on the asset are
	// the only place the creator's address survives.
	//
	// NOT stored on the path when there is nothing to record: a verdict of
	// `pending_review` still gets an audit row, because "we have no verdict" is
	// exactly the outcome a later review needs to see.
	return s.RecordModerationAudit(ctx, &model.MediaModerationAudit{
		MediaAssetID:      asset.ID,
		UserID:            asset.UserID,
		Provider:          moderatedByOrDefault("", verdictProvider(cb)),
		Verdict:           moderationVerdictName(cb),
		Confidence:        cb.ModerationScore,
		Checks:            mustJSON(cb.ModerationChecks),
		IPAddress:         asset.UploadIP,
		DeviceFingerprint: asset.DeviceFingerprint,
		UserAgent:         asset.UploadUserAgent,
	})
}

// verdictProvider names the engine that produced this callback's verdict.
//
// "asr:none" is a real answer and not a placeholder: it says the audio transcript
// check did not run, which is different from it running and finding nothing. The
// distinction matters to anyone tuning thresholds later.
func verdictProvider(cb TranscodeCallback) string {
	if p := strings.TrimSpace(cb.ModerationAudio); p != "" {
		return p
	}
	return "ai:heuristic-v1"
}

func moderationVerdictName(cb TranscodeCallback) string {
	switch strings.ToLower(strings.TrimSpace(cb.ModerationVerdict)) {
	case model.ModerationVerdictApproved:
		return model.ModerationVerdictApproved
	case model.ModerationVerdictRejected:
		return model.ModerationVerdictRejected
	case model.ModerationVerdictFlagged:
		return model.ModerationVerdictFlagged
	default:
		// Mirrors the fail-closed branch in `applyModeration`, so the audit row
		// and the stored column can never disagree about what happened.
		return model.ModerationVerdictFlagged
	}
}

// mustJSON encodes the checks map for storage, or "{}" if it cannot.
//
// A checks map that fails to marshal is a bug, but it must not take the verdict
// down with it - the status is the control and this is decoration. Returning
// "{}" keeps the column valid and the row writable.
func mustJSON(v map[string]any) string {
	if len(v) == 0 {
		return "{}"
	}
	if b, err := json.Marshal(v); err == nil {
		return string(b)
	}
	return "{}"
}

// updateOr reads a value already written into `updates`, falling back to the
// asset's existing value.
//
// A reel's rules are judged against the MEASURED values, which this call is in
// the middle of writing. Reading only the pre-transcode asset would judge the
// client's claim instead - exactly what the rule exists to avoid - and reading
// only `updates` would judge nothing at all for a callback that omitted a field.
func updateOr(updates map[string]any, key string, fallback int) int {
	if v, ok := updates[key]; ok {
		if n, ok := v.(int); ok && n > 0 {
			return n
		}
	}
	return fallback
}

func updateOr64(updates map[string]any, key string, fallback int64) int64 {
	if v, ok := updates[key]; ok {
		if n, ok := v.(int64); ok && n > 0 {
			return n
		}
	}
	return fallback
}

// reelRuleViolation returns "" when a reel satisfies every platform rule, or a
// single sentence naming the first rule it breaks.
//
// One reason, not a list: the creator's next action is to fix the clip and
// re-upload, and a single actionable sentence beats a report. The full
// per-platform breakdown is a different concern, served by the readiness grid.
//
// The message is written to be understood by somebody who just spent two hours
// editing, so it says what to DO rather than what failed.
func reelRuleViolation(durationS, width, height int, bytes int64) string {
	if durationS > 0 && durationS > ReelMaxSeconds {
		return fmt.Sprintf(
			"this reel is %d seconds and reels are limited to %d — trim it and upload again",
			durationS, ReelMaxSeconds)
	}
	if bytes > 0 && bytes > ReelMaxBytes {
		return fmt.Sprintf(
			"this reel is %.1f MB and the limit is %d MB — export at a lower bitrate and upload again",
			float64(bytes)/1024/1024, ReelMaxBytes/1024/1024)
	}
	// Orientation, and only when it is measurable. A zero width means the probe
	// sent nothing, and refusing a file for a measurement nobody took would be a
	// false failure.
	if width > 0 && height > 0 && !isPortraitNineSixteen(width, height) {
		return fmt.Sprintf(
			"this reel is %dx%d (that is %s) and reels must be vertical 9:16 — crop it and upload again",
			width, height, aspect(width, height))
	}
	return ""
}

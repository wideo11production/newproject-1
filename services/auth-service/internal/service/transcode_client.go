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

	// Profile - "480p" | "720p" | "1080p". Empty lets the transcoder default.
	Profile string `json:"profile,omitempty"`
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
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	PlaylistURL string `json:"playlist_url"`
	PosterURL   string `json:"poster_url"`
	Error       string `json:"error"`
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
		"status":           model.MediaStatusReady,
		"hls_public_url":   playlist,
		"failure_reason":   "",
		"bytes":            asset.Bytes,
		"duration_seconds": asset.DurationS,
		"width":            asset.Width,
		"height":           asset.Height,
		"has_audio":        asset.HasAudio,
		// Cleared: the row is done, so it must stop counting against the abandoned
		// upload sweep.
		"expires_at": nil,
	}
	if poster := strings.TrimSpace(cb.PosterURL); poster != "" {
		updates["poster_public_url"] = poster
	}

	return s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("id = ?", id).
		Updates(updates).Error
}

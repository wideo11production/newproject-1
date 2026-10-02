package handler

// Media mutation endpoints: the upload lifecycle.
//
// The flow, and which step enforces what:
//
//	POST /media/initiate   ->  entitlement checked HERE, before any bytes move
//	(presigned PUT)        ->  bytes go browser -> MinIO directly; this service
//	                          never sees them
//	POST /media/:id/finalize -> marks `uploaded` and hands off to the pipeline
//	GET  /media             -> the caller's own assets, bounded
//	GET  /media/:id         -> one asset, owner-scoped
//
// The quota check lives at `initiate` and NOT at finalize, which is the whole
// point: a user who is over quota learns it before spending their upload time,
// and before the storage cost is incurred.

import (
	"crypto/subtle"
	"errors"
	"log"
	"strings"

	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"

	"github.com/wideo11/auth-service/internal/service"
)

type mediaRequest struct {
	Kind              string `json:"kind"`
	Filename          string `json:"filename"`
	ContentType       string `json:"content_type"`
	DeclaredBytes     int64  `json:"declared_bytes"`
	DeclaredDurationS int    `json:"declared_duration_seconds"`
	Size              int64  `json:"size"`
	// ChannelID files the media under a channel so it appears on that channel's
	// page and in its counts. Optional: a creator uploads before they have a
	// channel, and ownership is checked server-side.
	ChannelID string `json:"channel_id"`
}

// InitMedia records the intent to upload and mints the presigned PUT.
//
// Order is deliberate and load-bearing: the entitlement/quota check and the row
// both happen BEFORE a URL is handed out. A URL minted first, with the row
// insert failing afterwards, leaves a URL that can write an object nobody has a
// record of - and a cleanup job reconciles against rows, so it would never be
// found.
func (h *AuthHandler) InitMedia(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req mediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.Filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "filename is required"})
		return
	}

	declared := req.DeclaredBytes
	if req.Size > 0 {
		declared = req.Size
	}

	// The ticket mints the key AND the URL, and validates the content claim. It
	// is the same code path the avatar and cover uploads use, with the same
	// bucket rules and the same presign TTL.
	ticket, err := h.storage.CreateMediaUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid media", "message": err.Error()})
		return
	}

	// Which channel to file this under, if any. Optional on purpose - a creator
	// uploads before they have a channel, and a user who never makes one still
	// needs a library. Ownership is verified in the service, so a mismatched id
	// is refused rather than silently filed elsewhere.
	var channelID *uuid.UUID
	if raw := strings.TrimSpace(req.ChannelID); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_channel_id",
				"message": "channel_id must be a UUID.",
			})
			return
		}
		channelID = &parsed
	}

	// Quota + the row. A refusal here means no URL is ever returned, so the
	// user cannot start an upload they were never entitled to.
	asset, err := h.media.Initiate(
		c.Request.Context(), uuidFromString(uid),
		req.Kind, req.Filename, req.ContentType, ticket.ObjectKey,
		declared, req.DeclaredDurationS, channelID,
	)
	if err != nil {
		// The object key is unclaimed now - no row exists, so nothing will ever
		// clean it up. Best-effort removal, and the refusal is returned either
		// way: a user over quota must not be told "try again" because cleanup
		// hiccuped.
		h.storage.DeleteCover(c.Request.Context(), ticket.PublicURL)
		writeMediaError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"asset": asset,
		"upload": gin.H{
			"object_key":         ticket.ObjectKey,
			"upload_url":         ticket.UploadURL,
			"method":             ticket.Method,
			"content_type":       ticket.ContentType,
			"expires_in_seconds": ticket.ExpiresInSeconds,
		},
	})
}

// FinalizeMedia marks the bytes as landed and hands the asset to the pipeline.
//
// This is a CLAIM, not a measurement. The next state is `scanning`, where
// ffprobe measures the file - so a client that calls finalize without uploading
// anything gets a row that immediately fails verification rather than one that
// sits in `ready` forever.
func (h *AuthHandler) FinalizeMedia(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	if err := h.media.MarkUploaded(c.Request.Context(), assetID, uuidFromString(uid)); err != nil {
		writeMediaError(c, err)
		return
	}

	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}

	// Hand off to the transcoder, but a failure here does NOT fail the request.
	//
	// The asset is stored and recorded; only the transcode could not be queued. It
	// can be retried, whereas telling the user their upload failed means an 8 GB
	// re-upload. The asset stays `uploaded` so it is visibly unfinished rather
	// than silently complete.
	queued := false
	jobID := ""
	if h.transcode != nil {
		if res, terr := h.transcode.Submit(c.Request.Context(), service.TranscodeRequest{
			VideoID:   asset.ID.String(),
			SourceURL: h.media.InternalObjectURL(asset),
			Profile:   "",
		}); terr == nil {
			queued, jobID = true, res.JobID
		} else {
			log.Printf("[MEDIA] transcode enqueue FAILED for asset %s: %v", asset.ID, terr)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"asset":            asset,
		"transcode_queued": queued,
		"transcode_job_id": jobID,
		"note": "Upload recorded. If the transcode could not be queued it will be " +
			"retried - the asset is stored either way.",
	})
}

// TranscodeCallback receives the transcoder's report that a job finished.
//
// INTERNAL, and token-gated. It is service-to-service on the compose network,
// and it WRITES to a media row - so an open endpoint here would let anyone mark
// anyone's video `ready` (or `failed`) with a URL of their choosing, which is a
// stored-XSS and an impersonation vector in one.
//
// It is deliberately NOT under `/media/:id`, so it cannot be confused with a
// user-facing route, and the asset id arrives in the BODY rather than the path -
// this is a report about an asset, not a request for one.
func (h *AuthHandler) TranscodeCallback(c *gin.Context) {
	// Constant-time compare: the token gates writes to media rows, and a `==`
	// comparison leaks it byte by byte under load.
	expected := getenvStr("TRANSCODE_INTERNAL_TOKEN", "")
	if expected == "" {
		// Failing CLOSED, and loudly. An unset token must never mean "no auth
		// required", or the deployment is silently open.
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "not_configured",
			"message": "This service has no callback token configured, so it cannot accept one.",
		})
		return
	}
	if subtle.ConstantTimeCompare([]byte(c.GetHeader("X-Internal-Token")), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_internal_token"})
		return
	}

	var cb service.TranscodeCallback
	if err := c.ShouldBindJSON(&cb); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload", "message": err.Error()})
		return
	}
	if cb.AssetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "asset_id is required"})
		return
	}

	if err := h.media.MarkTranscodeResult(c.Request.Context(), cb); err != nil {
		// 409 for a state we refuse to apply it to, 404 for an asset that is not
		// there, 500 for anything real. A transcoder that retries gets the same
		// answer rather than a generic failure it would keep retrying forever.
		if errors.Is(err, service.ErrInvalidStateTransition) {
			c.JSON(http.StatusConflict, gin.H{"error": "invalid_state", "message": err.Error()})
			return
		}
		if errors.Is(err, service.ErrMediaNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found", "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not apply the transcode result"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "asset_id": cb.AssetID, "status": cb.Status})
}

// MediaStatus returns an asset's current state.
//
// Public? NO - it is owner-scoped, because `failure_reason` and `object_key` are
// not things to hand to a stranger. A caller that only needs "is this ready yet"
// should poll the owner's own asset list.
func (h *AuthHandler) MediaStatus(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	// `uuidFromString` returns ONE value, so a two-value form would not compile.
	// A malformed id and a missing asset answer the SAME way, so this cannot be
	// used to tell real ids from invented ones.
	assetID := uuidFromString(c.Param("id"))
	if assetID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}
	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":            asset.ID,
		"status":        asset.Status,
		"kind":          asset.Kind,
		"failure":       asset.FailureReason,
		"progress_hint": progressHint(asset.Status),
	})
}

// progressHint is a plain-language stage name for the client.
//
// The alternative is a progress NUMBER, and a number cannot say which stage is
// slow. "Scanning" and "Transcoding" can - and a number that jumps from 10 to 90
// is what made an earlier version of this feel broken when it was working.
func progressHint(status string) string {
	switch status {
	case model.MediaStatusInitiated:
		return "waiting for your upload to start"
	case model.MediaStatusUploaded:
		return "checking the file"
	case model.MediaStatusScanning:
		return "reading the video"
	case model.MediaStatusTranscoding:
		return "making the streaming versions"
	case model.MediaStatusReady:
		return "ready to publish"
	case model.MediaStatusFailed:
		return "failed"
	default:
		return "working"
	}
}

// Bounded, always. This table is unbounded and an unpaginated list is a denial
// of service with a JSON body.
func (h *AuthHandler) ListMedia(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}

	rows, total, err := h.media.List(
		c.Request.Context(), uuidFromString(uid), c.Query("kind"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not list media"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assets": rows, "total": total})
}

// GetMedia returns one asset, owner-scoped.
func (h *AuthHandler) GetMedia(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}
	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"asset": asset})
}

func writeMediaError(c *gin.Context, err error) {
	switch {
	case isErr(err, service.ErrMediaQuotaExceeded):
		// 409, not 403. The user is allowed to upload in principle and is out of
		// allowance in fact - "upgrade" is the next step, not "you are forbidden".
		c.JSON(http.StatusConflict, gin.H{
			"error":   "quota_exceeded",
			"message": err.Error(),
		})
	case isErr(err, service.ErrMediaNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
	case isErr(err, service.ErrInvalidStateTransition):
		// 409 with the description. This is a BUG when a user hits it - the
		// client follows the state machine - so the response says what was
		// attempted.
		c.JSON(http.StatusConflict, gin.H{
			"error":   "invalid_state",
			"message": err.Error(),
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "media operation failed"})
	}
}

// isErr keeps `errors.Is` out of every branch above, and keeps the switch
// readable as a policy rather than as a comparison chain.
func isErr(err, target error) bool { return errors.Is(err, target) }

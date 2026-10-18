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
	"fmt"
	"io"
	"log"
	"net"
	"strings"

	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"

	"github.com/wideo11/auth-service/internal/service"
)

// MediaQuota reports what this caller may still upload, per kind.
//
// The point is to answer the question BEFORE a file is chosen. A trial user has
// zero of everything, and finding that out after picking a file - and waiting for
// its SHA-256 - is a bad trade for somebody who just wanted to post a video.
//
// The numbers come from the same ledger the upload path enforces, so this can
// never be more optimistic than the refusal. A read failure here is not fatal:
// the creator still sees the uploader, and the server still refuses an
// over-quota upload authoritatively.
func (h *AuthHandler) MediaQuota(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	quotas, err := h.media.MediaQuota(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "quota_unavailable",
			"message": "Could not read your upload allowance. You can still upload.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"quotas": quotas})
}

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
	// ContentCategory - 'educational' or 'general'. Required when channel_id
	// is provided and channel is student_tier=true (educational-only enforcement).
	ContentCategory string `json:"content_category"`
	// ContentHash is the browser-computed SHA-256 of the file bytes. It exists so
	// a re-upload of the SAME file reuses the renditions already in the bucket
	// instead of paying a second ffmpeg pass (SYSTEM-PLAN §5.3). A claim, not a
	// verification - the bytes never reach this service.
	ContentHash string `json:"content_hash"`
}

// InitMedia records the intent to upload and mints the presigned PUT.
//
// Order is deliberate and load-bearing: the entitlement/quota check and the row
// both happen BEFORE a URL is handed out. A URL minted first, with the row
// insert failing afterwards, leaves a URL that can write an object nobody has a
// record of - and a cleanup job reconciles against rows, so it would never be
// found.
//
// ---- AND IDENTITY COMES BEFORE ALL OF IT ----
//
// A creator must be a VERIFIED person before they may put anything on the
// platform. That check is the first gate here rather than a later one, because
// everything downstream of a presigned PUT is irreversible: the bytes land in the
// bucket, the transcode runs, the moderation scan runs - and each of those costs
// real money on a 4 GB 4K file. Refusing an unverified upload AFTER the upload
// means having paid for the compute on content from an account nobody can trace.
//
// It is also what makes the T&C enforceable. Clause 6 of the channel terms
// promises that a violator's "credentials and digital footprints" can be reported
// to law enforcement, and that promise is only true if the uploader was required
// to prove an identity before uploading. An anonymous upload path makes the
// whole legal section decoration.
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

	// ---- KYC gate: a verified, active account before any upload ----
	//
	// Refused here rather than at `finalize`, and that ordering is the whole
	// point. By `finalize` the bytes are already in the bucket, the row exists,
	// and the transcode is running; the only thing a late refusal achieves is
	// having paid for the compute.
	//
	// The logic already existed - `RequireContentUpload` + `StatusCodeForDecision`
	// in `service/content_policy.go`, written for exactly this call site with the
	// comment "Isko upload handler ke SABSE PEHLE call karna hai". It had no
	// caller. That is the same unreachability pattern the file has met before: a
	// complete, documented, tested control that nothing invokes.
	//
	// The message names what to do, because "forbidden" sends a creator to look
	// at their account settings rather than at their inbox.
	decision, derr := h.authService.RequireContentUpload(
		c.Request.Context(), uuidFromString(uid))
	if derr != nil {
		// Fail closed, with the same generic message the service chose. A caller
		// must not be able to tell "the database is down" from "you are not
		// allowed", because that distinction is an infrastructure fingerprint.
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": decision.Message,
			"reason":  decision.Reason,
		})
		return
	}
	if !decision.Allowed {
		c.JSON(service.StatusCodeForDecision(*decision), gin.H{
			"error":   "forbidden",
			"message": decision.Message,
			"reason":  decision.Reason,
		})
		return
	}

	declared := req.DeclaredBytes
	if req.Size > 0 {
		declared = req.Size
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

	// ---- Student content compliance gate (Phase 1) ----
	//
	// Jab channel student_tier=true ho, to uske uploads sirf educational content_category ke allowed hain. Non-educational upload block kar diya jaata hai aur compliance violation billing-service enforcement loop ko jaata hai (penalty + suspension pipeline).
	//
	// Fail-closed: DB error -> upload blocked (generic message).
	if channelID != nil {
		category := strings.TrimSpace(req.ContentCategory)
		if category == "" {
			category = "general"
		}
		complianceDecision, cerr := h.authService.RequireStudentContentCompliance(
			c.Request.Context(), *channelID, category)
		if cerr != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": "Could not verify content compliance. Please try again.", "reason": "compliance_check_unavailable"})
			return
		}
		if complianceDecision != nil && !complianceDecision.Allowed {
			// ---- Student violation penalty: notify billing-service ----
			//
			// Content compliance violation detected on a student-tier channel.
			// auth-service blocks the upload (403 below); billing-service
			// applies the 25% revocation penalty + verification revocation.
			//
			// This call is BEST-EFFORT: the upload is ALREADY blocked.
			// A billing-service outage or client-not-configured must NOT
			// change the 403 response — the block is the enforcement, the
			// penalty is the consequence. Failures are logged, not returned.
			//
			// Hinglish: compliance violation par billing-service penalty call
			userID := c.GetString("user_id")
			if h.billingClient != nil && userID != "" {
				violationReq := service.StudentViolationRequest{
					UserID:    userID,
					Reason:    complianceDecision.Reason,
					ChannelID: channelID.String(),
				}
				if result, verr := h.billingClient.ReportStudentViolation(c.Request.Context(), violationReq); verr != nil {
					log.Printf("[STUDENT-GATE] penalty notification failed for user %s: %v", userID, verr)
				} else {
					log.Printf("[STUDENT-GATE] violation penalty %s for user %s (revoked=%v, penalty=%s, applied=%v)",
						complianceDecision.Reason, userID, result.Revoked, result.PenaltyAmount, result.PenaltyApplied)
				}
			} else if h.billingClient == nil {
				log.Printf("[STUDENT-GATE] violation detected for user %s but billing client not configured - upload blocked, penalty not forwarded", userID)
			}
			// The upload IS blocked regardless of billing-service status.
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": complianceDecision.Message, "reason": complianceDecision.Reason})
			return
		}
	}

	// ---- Re-upload dedup (5.3) ----
	//
	// Checked FIRST, before the quota and before any URL is minted, because a hit
	// means no bytes move at all: the file is already in the bucket, already
	// probed, already encoded. That is the entire saving - a creator who fixes a
	// title and re-uploads should not pay a second ffmpeg pass for identical
	// output, and should not be handed a URL they have no use for.
	//
	// The hash is a CLAIM from the browser (the bytes go straight to MinIO on a
	// presigned PUT, so this service never sees them). The worst case of a lying
	// client is a wasted transcode, which is exactly what having no dedup costs.
	hash := strings.ToLower(strings.TrimSpace(req.ContentHash))
	if hash != "" {
		reusable, rerr := h.media.FindReusable(c.Request.Context(), uuidFromString(uid), hash)
		if rerr != nil {
			// A failed lookup is not a reason to refuse the upload. The slow
			// path is always correct, just more expensive.
			log.Printf("[MEDIA] dedup lookup failed for %s: %v", uid, rerr)
		}
		if reusable != nil {
			asset, err := h.media.Reuse(
				c.Request.Context(), uuidFromString(uid),
				req.Kind, req.Filename, channelID, reusable,
			)
			if err != nil {
				writeMediaError(c, err)
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"asset":       asset,
				"reused":      true,
				"reused_from": reusable.ID,
				"note": "This exact file is already stored and encoded under your " +
					"account, so nothing was re-uploaded.",
			})
			return
		}
	}

	// The ticket mints the key AND the URL, and validates the content claim. It
	// is the same code path the avatar and cover uploads use, with the same
	// bucket rules and the same presign TTL.
	ticket, err := h.storage.CreateMediaUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
		req.Size, req.Kind,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid media", "message": err.Error()})
		return
	}

	// Quota + the row. A refusal here means no URL is ever returned, so the
	// user cannot start an upload they were never entitled to.
	//
	// The uploader context is captured HERE, from this request, and nowhere else:
	// the file goes straight to MinIO on a presigned PUT, so this service never
	// sees the browser again after `initiate`. T&C clause 6 promises a violator's
	// footprint can be handed to law enforcement, and this is the only moment that
	// promise can be kept.
	asset, err := h.media.Initiate(
		c.Request.Context(), uuidFromString(uid),
		req.Kind, req.Filename, req.ContentType, ticket.ObjectKey,
		declared, req.DeclaredDurationS, channelID, hash,
		uploadContextFrom(c),
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
			Kind:      asset.Kind,
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

// RetryMedia re-queues a FAILED asset's transcode without re-uploading.
//
// This is the fix for a failure mode that was once permanent. A 4K upload that
// outran the transcoder's memory wrote `failed` and STAYED failed - because
// `MarkTranscodeResult` refuses any asset that is not mid-pipeline, and nothing
// could move a row back. The bytes were fine in the bucket and the creator's
// only route was to re-upload the whole file.
//
// The original object is reused, so a retry costs seconds rather than the upload
// time of a multi-gigabyte file.
func (h *AuthHandler) RetryMedia(c *gin.Context) {
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

	// ---- failed -> uploaded, clearing the old reason ----
	//
	// The reason is cleared rather than appended because the schema has one
	// `failure_reason` column: a second failure should record the SECOND error,
	// not a concatenation nobody can read. Losing the first reason is accepted
	// for exactly that reason - the audit trail lives in the transcoder's logs.
	if err := h.media.RetryFailed(c.Request.Context(), assetID, uuidFromString(uid)); err != nil {
		writeMediaError(c, err)
		return
	}

	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}

	// ---- Queue the transcode against the SAME stored bytes ----
	//
	// A failure to queue is NOT a failure of the request, and matches
	// `FinalizeMedia`'s reasoning: the asset is recorded and re-uploadable, so
	// the honest answer is "the asset is queued for another try" rather than
	// "the retry failed, please re-upload".
	queued := false
	jobID := ""
	if h.transcode != nil {
		if res, terr := h.transcode.Submit(c.Request.Context(), service.TranscodeRequest{
			VideoID:   asset.ID.String(),
			SourceURL: h.media.InternalObjectURL(asset),
			Kind:      asset.Kind,
		}); terr == nil {
			queued, jobID = true, res.JobID
		} else {
			log.Printf("[MEDIA] retry transcode enqueue FAILED for asset %s: %v", asset.ID, terr)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"asset":            asset,
		"transcode_queued": queued,
		"transcode_job_id": jobID,
		"note": "Retry queued. The original file is reused - nothing is re-uploaded.",
	})
}

// DeleteMedia removes a FAILED asset and its stored bytes.
//
// Only `failed` is deletable here, and that is deliberate. An in-flight asset is
// being written to by its own transcode; deleting that row out from under the
// pipeline is how a callback resurrects a video the creator already removed.
//
// The row is deleted first, then the objects. Not the other way around: if the
// object deletion fails after the row is gone, the result is an unreferenced
// blob that a later sweep can catch. If the ROW survived an object failure, the
// creator sees a video that no longer plays and cannot delete it again.
func (h *AuthHandler) DeleteMedia(c *gin.Context) {
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

	asset, err := h.media.DeleteAsset(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}

	// Best-effort byte cleanup. A failure here is NOT reported as a failure of
	// the delete: the row is gone, the video is gone from every list, and the
	// only consequence is storage that a sweep can reclaim. Reporting 500 would
	// make the caller believe the delete failed and prompt a retry that would
	// now 404.
	if h.storage != nil {
		if derr := h.storage.DeleteAssetObjects(
			c.Request.Context(), asset.ObjectKey, asset.ID.String()); derr != nil {
			log.Printf("[MEDIA] object cleanup failed for deleted asset %s: %v", asset.ID, derr)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted":  true,
		"asset_id": asset.ID,
		"message":  "The asset was removed.",
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
// ---------------------------------------------------------------------------
// POST /api/v1/auth/media/:id/publish
// ---------------------------------------------------------------------------
//
// Marks an owner's own asset as PUBLISHED - the step that makes it appear on the
// public video page.
//
// WHY THIS IS A SEPARATE STATE AND NOT JUST `moderation_status`
//
// `moderation_status` answers "did the screening approve this". `published_at`
// answers "did the owner CHOOSE to put it live". Those are different questions and
// collapsing them loses information: an approved clip that the owner is still
// editing would look identical to one they released.
//
// More importantly, the owner's confirmation is the point. Automated screening runs
// on every upload, but the platform's position is that the owner carries the
// responsibility for what goes out - so the record of "the owner confirmed, after
// being shown what they were certifying" has to exist somewhere, and this is it.
//
// THE GATE, AND WHY IT IS THE SAME ONE AS EVERYWHERE ELSE
//
//	owner          - taken from the token, never the body
//	ready          - an unfinished transcode is not publishable
//	moderation approved - a refused clip is structurally unpublishable, and this
//	                    endpoint refuses the REQUEST rather than overriding the
//	                    verdict. There is no code path that publishes over the
//	                    screening result, by design.
//
// The confirmation dialogue lives in the UI. This endpoint takes the confirmation
// as given and records it - if the UI ever stops showing it, this has no way to
// know, which is exactly why the wording is a statement of existing responsibility
// rather than a disclaimer the platform grants.
func (h *AuthHandler) PublishMedia(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	ownerID, perr := uuid.Parse(uid)
	if perr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	assetID, perr := uuid.Parse(c.Param("id"))
	if perr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	// Owner-scoped: a missing asset and someone else's asset answer the same way,
	// so this cannot be used to discover that an id exists.
	asset, gerr := h.media.Get(c.Request.Context(), assetID, ownerID)
	if gerr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	// The gate. `ready` alone is not enough: `IsVisiblePublic` carries
	// `ready AND moderation approved`, and refusing here rather than overriding is
	// what keeps the screening result final.
	if asset.Status != model.MediaStatusReady {
		c.JSON(http.StatusConflict, gin.H{
			"error":   "not_ready",
			"message": "This clip is still being processed. You can publish it once it is ready.",
		})
		return
	}
	if asset.ModerationStatus != model.ModerationApproved {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "not_screened",
			"message": "Automated screening has not approved this clip, so it cannot be published.",
		})
		return
	}

	// Idempotent by design. A viewer who double-taps "Publish" gets the same asset
	// back both times rather than an error on the second tap - and re-publishing a
	// clip that is already live is a no-op, not a fresh publication event.
	publishedAt := time.Now().UTC()
	if err := h.media.MarkPublished(c.Request.Context(), assetID, ownerID, publishedAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_publish"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"asset_id":    assetID,
		"published_at": publishedAt,
		"live":        true,
	})
}

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

// SignedStreamURL returns a short-lived presigned GET for one object inside a
// media asset, so the owner can actually WATCH it.
//
// The `video` bucket is private by design (R6), so a plain URL returns
// `AccessDenied` for everyone - including the uploader. Without this, every
// finished upload is invisible, which is a worse outcome than the URL simply
// being forgotten.
//
// Ownership is verified in the SERVICE, not here and not in MinIO: MinIO has no
// idea who owns an object, so without the check any asset id would sign a URL to
// anyone's video. The id is read from the token, never from the body.
//
// `?path=` is a RELATIVE path inside the asset's prefix (`1080p/playlist.m3u8`,
// `poster.jpg`, `720p/seg_00000.ts`). Never an absolute object key: a caller
// must not be able to name a path outside its own asset.
func (h *AuthHandler) SignedStreamURL(c *gin.Context) {
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

	// Scoped to its owner. A missing asset and someone else's asset produce the
	// SAME error, so this cannot be used to discover that an id exists.
	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		writeMediaError(c, err)
		return
	}

	rel := strings.TrimSpace(c.Query("path"))
	if rel == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "missing_path",
			"message": "path is required, and must be a relative path inside the asset.",
		})
		return
	}

	url, expiresIn, err := h.storage.SignedObjectURL(c.Request.Context(), asset.ID, rel)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_path", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"asset_id":   asset.ID,
		"path":       rel,
		"url":        url,
		"expires_in": expiresIn,
	})
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

// OwnerStream serves the object's bytes to the asset's owner.
//
// WHY A SECOND STREAMING ENDPOINT
//
// The owner's library contains material the world may not see: a draft on a
// private channel, an asset still awaiting a moderation verdict. The public
// route refuses all of those, correctly. So an owner watching their own library
// needs a route whose authority is the SESSION, not the visibility rule.
//
// It streams rather than signing for the same reason the public one does: a
// presigned URL carries the Host in its signature, so a URL signed for
// `localhost:9000` is `AccessDenied` when fetched from `minio:9000`, and inside
// the container network `localhost:9000` is the caller itself. See
// `StorageService.OpenVideoObject`.
func (h *AuthHandler) OwnerStream(c *gin.Context) {
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

	rel := strings.TrimSpace(c.Query("path"))
	if rel == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "missing_path",
			"message": "path is required, and must be a relative path inside the asset.",
		})
		return
	}

	offset, length, hasRange := parseRangeHeader(c.GetHeader("Range"))

	obj, oerr := h.media.OwnerMediaStream(
		c.Request.Context(), assetID, uuidFromString(uid), rel, offset, length)
	if oerr != nil {
		if errors.Is(oerr, service.ErrMediaNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_path", "message": oerr.Error()})
		return
	}
	defer obj.Body.Close()

	extra := map[string]string{
		// Private, per-owner content: never a shared cache. The signature-free
		// stream means the gate is re-evaluated on every request.
		"Cache-Control": "private, no-store",
	}

	body := io.Reader(obj.Body)
	if hasRange {
		if length <= 0 {
			length = obj.Size - offset
		}
		extra["Content-Range"] = fmt.Sprintf("bytes %d-%d/%d", offset, offset+length-1, obj.Size)
		c.DataFromReader(http.StatusPartialContent, length, obj.ContentType, body, extra)
		return
	}
	c.DataFromReader(http.StatusOK, obj.Size, obj.ContentType, body, extra)
}

// uploadContextFrom reads the uploader's footprint off the request.
//
// WHY THIS IS THE ONLY PLACE IT IS READ
//
// The presigned PUT goes straight from the browser to MinIO. After `initiate`
// this service has no further contact with the uploader, so every later stage -
// finalize, transcode, moderation, review - is acting on data whose origin is
// only knowable from a row written here. That is what makes the T&C's
// law-enforcement clause true or false.
//
// ---- THE IP IS THE PROXY-AWARE ONE ----
//
// In this deployment auth-service is behind the web BFF, so the REMOTE address of
// a creator request is the BFF's container IP, not the creator's. Taking it raw
// would record the same value for every user on the platform, which is worse than
// nothing: it looks like a footprint and identifies nobody.
//
// So `Forwarded` is preferred, then `X-Forwarded-For` (leftmost entry - the
// original client), and `RemoteAddr` only as the last resort. The trust question
// - "can this header be spoofed?" - is answered by the deployment: only the BFF
// can write it because the service is not exposed, which is a property of the
// network rather than of this code, and it is stated rather than assumed.
//
// A SPOOFABLE header is still recorded rather than rejected: a header that lies is
// itself evidence, and discarding a claim because it might be false would mean
// recording nothing for the honest case.
func uploadContextFrom(c *gin.Context) service.UploadContext {
	req := c.Request

	ip := ""
	if fwd := strings.TrimSpace(req.Header.Get("X-Forwarded-For")); fwd != "" {
		// Leftmost entry is the original client; every entry after it is a proxy
		// that appended itself.
		if comma := strings.Index(fwd, ","); comma > 0 {
			ip = strings.TrimSpace(fwd[:comma])
		} else {
			ip = fwd
		}
	}
	if ip == "" {
		// RemoteAddr is host:port, so the port is dropped rather than stored as
		// part of the address.
		if host, _, err := net.SplitHostPort(req.RemoteAddr); err == nil {
			ip = host
		} else {
			ip = req.RemoteAddr
		}
	}

	// The device fingerprint is opaque and client-supplied. It is not validated
	// here because validating it would mean agreeing a schema with the browser,
	// and a schema that changes becomes a value nobody can read back. Its entire
	// purpose is CONSISTENCY: the same browser sends the same value.
	//
	// It is not an identity. It correlates accounts; it does not authenticate one.
	fp := strings.TrimSpace(req.Header.Get("X-Device-Fingerprint"))

	return service.UploadContext{
		IP:        ip,
		UserAgent: req.UserAgent(),
		DeviceFP:  fp,
	}
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





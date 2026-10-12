package handler

// Content-moderation review surface for operator accounts.
//
// =============================================================================
// WHAT THIS IS, AND WHY IT IS NOT IN THE EXISTING HANDLERS
// =============================================================================
//
// The automated screener is a heuristic engine. Its own header says what it does
// not catch: clothed suggestive poses, anything semantic, and ALL speech in the
// audio track (there is no ASR model). It also declares a borderline band on
// purpose - a score high enough to doubt and not high enough to refuse.
//
// That band is where a human is required, and before this file the endpoint to be
// that human did not exist. `ModerationWorklist` and `ResolveModeration` had been
// written in the service layer and had no route on top of them - so every video
// the engine flagged sat at `flagged` forever, invisible to everyone including its
// creator, with nothing saying why.
//
// That is a worse state than refusing it. A refusal tells the creator something;
// a silent hold does not.
//
// =============================================================================
// THE TWO ENDPOINTS, AND WHY THE ROLES DIFFER
// =============================================================================
//
//	GET  /moderation/queue   - what is waiting. GATED BY `audit.view`.
//	POST /moderation/:id     - decide it. GATED BY `moderation.review`.
//
// Reading is deliberately a weaker permission than deciding. Somebody triaging an
// incident needs to see the queue; somebody publishing content a screener refused
// needs a stronger grant. Splitting them means "who looked" and "who approved" are
// different sets of people, which is the property that makes an audit of this
// queue meaningful.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/service"
)

// ModerationQueue lists what the screener could not decide.
//
// Paginated, and bounded at 50 by default. It is a worklist for a human with a
// minute per item, so an unbounded query would either dump the queue into one
// response or encourage treating it as a batch process - and batch-approving
// moderated content is the failure this whole system exists to prevent.
func (h *AuthHandler) ModerationQueue(c *gin.Context) {
	// Clamped, not trusted. A worklist endpoint that accepts `?limit=1000000` is a
	// way to read the entire moderation backlog into one response, and the
	// uploader footprints along with it.
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}

	rows, total, err := h.media.ModerationWorklist(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the queue"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": rows,
		"total": total,
		"limit": limit,
		"note": "These uploads are held back from every public surface. A review here " +
			"is recorded with your identity and your note.",
	})
}

// ModerationAudits returns the decision history for one asset.
//
// Kept on the same handler because a reviewer's second question after "what am I
// looking at" is "what did the engine say, and did anyone already look".
func (h *AuthHandler) ModerationAudits(c *gin.Context) {
	assetID := uuidFromString(c.Param("id"))
	if assetID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}
	rows, err := h.media.ModerationAuditsFor(c.Request.Context(), assetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the audit trail"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"audits": rows})
}

// ResolveModeration applies a human decision to a held-back upload.
//
// -----------------------------------------------------------------------------
// WHAT A HUMAN MAY AND MAY NOT DO
// -----------------------------------------------------------------------------
//
// A reviewer may resolve `pending_review` and `flagged` - the two states that mean
// "nobody decided". They may NOT release a `rejected` asset, and they may not
// refuse an `approved` one.
//
// That asymmetry is the whole design, and it is why `ResolveModeration` in the
// service checks `IsModerationPending()` before touching the row:
//
//	- releasing a refusal would make the refusal advisory. A zero-tolerance policy
//	  that a human can quietly reverse is not a policy, and the T&C wording
//	  promises deletion and legal action rather than "usually".
//
//	- refusing an approval is a different power - REMOVAL - which belongs to
//	  `media.delete`, not here. Collapsing them would let any reviewer destroy
//	  content rather than only decide what may be published.
//
// -----------------------------------------------------------------------------
// WHY A NOTE IS REQUIRED
// -----------------------------------------------------------------------------
//
// Not a comment for whoever reads the log later. The audit row is the answer to
// "why was this released", and a row with an empty note cannot be distinguished
// from one a reviewer filled in lazily. `ErrNoReason` is the same sentinel the
// appointment system uses, for the same reason.
func (h *AuthHandler) ResolveModeration(c *gin.Context) {
	reviewerID, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	assetID := uuidFromString(c.Param("id"))
	if assetID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	var req struct {
		// `approve` rather than a verdict enum, and deliberately: a human has two
		// options on something they are being asked about, and a three-value enum
		// would invite a "reject" flag on an asset the service would then refuse to
		// write.
		Approve bool   `json:"approve"`
		Note    string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "note_required",
			"message": "A note is required: the audit trail records why a human " +
				"released or refused this upload.",
		})
		return
	}

	reviewer := uuidFromString(reviewerID)
	if err := h.media.ResolveModeration(c.Request.Context(), assetID, reviewer, req.Approve, note); err != nil {
		// 409, not 403: the reviewer is permitted, and this particular asset is not
		// in a state they may decide. The two need different responses - one is a
		// permissions question, this is a workflow one.
		if errors.Is(err, service.ErrInvalidStateTransition) {
			c.JSON(http.StatusConflict, gin.H{
				"error": "not_reviewable",
				"message": "This upload is not awaiting a decision. A refused upload " +
					"cannot be released here, and an approved one cannot be refused - " +
					"removal is a separate permission.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not apply the decision"})
		return
	}

	action := "refused"
	if req.Approve {
		action = "approved"
	}
	c.JSON(http.StatusOK, gin.H{
		"resolved":   true,
		"asset_id":   assetID,
		"action":     action,
		"reviewed_by": reviewer.String(),
		"note":       note,
	})
}

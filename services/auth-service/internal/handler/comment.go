package handler

// COMMENT HANDLER - list, create, like, edit, delete.
//
// Every route is under the media path, because a comment is about a CLIP and not
// a free-floating entity. `/media/:id/comments` keeps the asset id in the path,
// which is what the service needs to scope the query.
//
// ============================================================================
// THE TWO THINGS THIS FILE IS CAREFUL ABOUT
// ============================================================================
//
//  1. THE VIEWER'S IDENTITY ALWAYS COMES FROM THE TOKEN.
//
//     `user_id` is never read from the body or from a query parameter. A handler
//     that accepts a caller-supplied user id is one that lets anyone post as
//     anyone, and the check is one line - so it is not a check that is left to a
//     caller to remember.
//
//  2. THE LINK REFUSAL IS PASSED THROUGH VERBATIM.
//
//     A link in a comment is refused with 400 and the service's reason, which
//     names the offending text. Re-wording it here would mean two places to keep
//     the message in step, and the message the author reads is the one that stops
//     the obfuscation.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/service"
)

// commentsReady reports whether the comment store is wired.
//
// Every route checks this FIRST, and answers 503 rather than panicking on a nil
// service. A deployment that forgot to wire comments should fail loudly on the one
// thing that needs it, not crash the router for every media request too.
func (h *AuthHandler) commentsReady(c *gin.Context) bool {
	if h.comments == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "comments_unavailable",
			"message": "Comments are not available on this deployment.",
		})
		return false
	}
	return true
}

// MediaComments lists a page of top-level comments with their replies.
//
// Public - no session. A clip is watchable by a stranger, and the comments under
// it are part of the page they are looking at. An anonymous viewer gets the
// comments with `viewer_has_liked` false everywhere rather than an error, which is
// the correct answer to "which of these did I like" when there is no "I".
func (h *AuthHandler) MediaComments(c *gin.Context) {
	if !h.commentsReady(c) {
		return
	}
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	limit, offset := pageWindow(c.Query("limit"), c.Query("offset"))

	// The viewer, when there is one. `commentViewer` returns the zero uuid for an
	// anonymous request, and the service treats that as "no likes of theirs" rather
	// than an error.
	viewer := commentViewer(c)

	page, lerr := h.comments.List(c.Request.Context(), assetID, viewer, limit, offset)
	if lerr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_load_comments"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"asset_id":  assetID,
		"comments":  page.Comments,
		"total":     page.Total,
		"offset":    page.Offset,
		"limit":     page.Limit,
		"has_more":  page.Offset+len(page.Comments) < int(page.Total),
		// The viewer's own id, so the UI can decide what to show WITHOUT having to
		// compare against a value it should not have been given.
		"viewer_id": viewer,
	})
}

// CommentCreate posts a top-level comment or a reply.
func (h *AuthHandler) CommentCreate(c *gin.Context) {
	if !h.commentsReady(c) {
		return
	}
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	viewer, perr := uuid.Parse(uid)
	if perr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	assetID, perr := uuid.Parse(c.Param("id"))
	if perr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	var body struct {
		Body     string  `json:"body"`
		ParentID *string `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_body",
			"message": "A JSON body with a `body` field is required.",
		})
		return
	}

	var parentID *uuid.UUID
	if body.ParentID != nil && strings.TrimSpace(*body.ParentID) != "" {
		p, aerr := uuid.Parse(strings.TrimSpace(*body.ParentID))
		if aerr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_parent",
				"message": "That comment id is not valid.",
			})
			return
		}
		parentID = &p
	}

	comment, cerr := h.comments.Create(c.Request.Context(), assetID, viewer, body.Body, parentID)
	if cerr != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "comment_refused",
			"message": cerr.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"comment": comment})
}

// CommentLike toggles the viewer's like on one comment.
//
// A POST and not a PUT, because the endpoint TOGGLES: the same request likes an
// unliked comment and unlikes a liked one. A PUT would promise "set to this state"
// and then quietly do the opposite of what was asked half the time.
func (h *AuthHandler) CommentLike(c *gin.Context) {
	if !h.commentsReady(c) {
		return
	}
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	viewer, perr := uuid.Parse(uid)
	if perr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	commentID, aerr := uuid.Parse(c.Param("cid"))
	if aerr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
		return
	}

	liked, count, lerr := h.comments.Like(c.Request.Context(), commentID, viewer)
	if lerr != nil {
		if errors.Is(lerr, service.ErrCommentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_update_like"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"comment_id": commentID,
		"liked":      liked,
		"like_count": count,
	})
}

// CommentEdit edits a comment the viewer wrote.
func (h *AuthHandler) CommentEdit(c *gin.Context) {
	if !h.commentsReady(c) {
		return
	}
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	viewer, perr := uuid.Parse(uid)
	if perr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	commentID, aerr := uuid.Parse(c.Param("cid"))
	if aerr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
		return
	}

	var body struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}

	comment, uerr := h.comments.Update(c.Request.Context(), commentID, viewer, body.Body)
	if uerr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comment_refused", "message": uerr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"comment": comment})
}

// CommentDelete removes a comment.
//
// Authorised for the AUTHOR and for the CLIP OWNER, which is why the asset is
// loaded first: the clip owner's id has to come from the asset and not from the
// request, or a caller could pass an asset they do not own.
func (h *AuthHandler) CommentDelete(c *gin.Context) {
	if !h.commentsReady(c) {
		return
	}
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	viewer, perr := uuid.Parse(uid)
	if perr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	commentID, aerr := uuid.Parse(c.Param("cid"))
	if aerr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
		return
	}

	// The comment's asset, so the clip owner is the ASSET's owner and not something
	// the caller chose. Loaded through the comment so a caller cannot point at one
	// asset's owner while acting on another asset's comment.
	comment, cerr := h.comments.CommentForDeletion(c.Request.Context(), commentID)
	if cerr != nil {
		if errors.Is(cerr, service.ErrCommentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_load_comment"})
		return
	}

	assetOwnerID, p2 := uuid.Parse(comment.AssetOwnerID)
	if p2 != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_resolve_owner"})
		return
	}

	if err := h.comments.Delete(c.Request.Context(), commentID, viewer, assetOwnerID); err != nil {
		if errors.Is(err, service.ErrCommentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "comment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could_not_delete"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true, "comment_id": commentID})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// commentViewer returns the signed-in viewer's id, or the zero uuid.
//
// The zero uuid is the honest answer for an anonymous request: the service reads
// it as "this viewer has liked nothing" rather than as an error, so a public page
// loads comments for a stranger instead of failing.
func commentViewer(c *gin.Context) uuid.UUID {
	uid, ok := creatorUserID(c)
	if !ok {
		return uuid.Nil
	}
	parsed, err := uuid.Parse(uid)
	if err != nil {
		return uuid.Nil
	}
	return parsed
}

// pageWindow parses the limit and offset, clamped.
//
// The upper bound on limit is the important half: a caller asking for 10,000
// comments is asking the database for a query that will time out, and the clamp
// turns that into 100 without touching the offset.
func pageWindow(limitRaw, offsetRaw string) (int, int) {
	limit := 20
	if n, err := strconv.Atoi(strings.TrimSpace(limitRaw)); err == nil {
		limit = n
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}

	offset := 0
	if n, err := strconv.Atoi(strings.TrimSpace(offsetRaw)); err == nil && n > 0 {
		offset = n
	}
	return limit, offset
}

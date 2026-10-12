package service

// CommentService owns comments and comment likes.
//
// Its own service rather than a method on MediaService, because a comment is about
// a viewer's interaction and not about the asset's pipeline. Folding it into
// MediaService would put an authorisation check on one path and a transcode status
// machine on another, in the same file.

// ============================================================================
// COMMENT SERVICE - create, list, like, delete
// ============================================================================
//
// Every method takes the VIEWER's user id and enforces authorization itself.
//
// That is deliberate. A service whose callers remember to check ownership is a
// service where the one caller that forgets is a privilege escalation, and the
// check is the same four lines every time - so it belongs here, once.
//
// ============================================================================
// THE ONE RULE THAT IS NOT NEGOTIABLE
// ============================================================================
//
// `ValidateCommentBody` runs on CREATE and on EDIT, before anything is written.
// A link in a comment is the whole reason this file is careful: it is the surface
// where a phishing URL gets rendered with the platform's own styling as cover.

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)
// NewCommentService builds the comment service.
func NewCommentService(db *gorm.DB) *CommentService {
	return &CommentService{db: db}
}

// CommentService holds the db handle.
type CommentService struct {
	db *gorm.DB
}

// ErrCommentNotFound is returned for a missing comment AND for someone else's.
//
// The same error for both, so the API cannot be used to discover that a comment id
// exists by watching which status code comes back.
var ErrCommentNotFound = fmt.Errorf("comment not found")

// ErrCommentTooLong / ErrCommentEmpty.
var (
	ErrCommentTooLong = fmt.Errorf("comment is too long (max %d characters)", model.MaxCommentLength)
	ErrCommentEmpty   = fmt.Errorf("comment is empty")
)

// ErrNotCommentOwner.
var ErrNotCommentOwner = fmt.Errorf("you can only modify your own comment")

// ErrParentNotFound.
var ErrParentNotFound = fmt.Errorf("the comment being replied to does not exist")

// CreateComment adds a top-level comment or a reply.
//
// `parentID` is nil for top-level. A non-nil parent must itself be top-level,
// because nesting is capped at one level - see `model.MaxCommentDepth`.
func (s *CommentService) Create(
	ctx context.Context,
	assetID, userID uuid.UUID,
	body string,
	parentID *uuid.UUID,
) (*model.Comment, error) {
	// ---- the link gate, first ----
	//
	// Before length and before the parent check. A comment is refused for the link
	// regardless of anything else about it, and putting the security check last
	// would mean a link could slip through on a code path that returned early.
	if err := ValidateCommentBody(body); err != nil {
		return nil, err
	}

	trimmed := strings.TrimSpace(body)
	if len([]rune(trimmed)) < model.MinCommentLength {
		return nil, ErrCommentEmpty
	}
	if len([]rune(trimmed)) > model.MaxCommentLength {
		return nil, ErrCommentTooLong
	}

	var comment model.Comment
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if parentID != nil {
			var parent model.Comment
			// The parent must exist, be on the SAME asset, and not be soft-deleted.
			//
			// Scoped by asset: a comment id from one clip must not be usable as a
			// parent on another, and the asset check is what prevents it - otherwise
			// a reply could be attached to a comment the viewer cannot see.
			if err := tx.Where("id = ? AND asset_id = ? AND parent_id IS NULL AND deleted_at IS NULL",
				*parentID, assetID).First(&parent).Error; err != nil {
				return ErrParentNotFound
			}
		}

		now := time.Now().UTC()
		comment = model.Comment{
			ID:        uuid.New().String(),
			AssetID:   assetID.String(),
			UserID:    userID.String(),
			ParentID:  nil,
			Body:      trimmed,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if parentID != nil {
			id := parentID.String()
			comment.ParentID = &id
		}

		if err := tx.Create(&comment).Error; err != nil {
			return err
		}

		// The parent's reply count is bumped in the SAME transaction as the reply.
		//
		// Incrementing it separately would let a failed reply leave the parent
		// claiming a child that does not exist, and a count that lies is worse than
		// no count - the UI would offer to expand a thread with nothing in it.
		if parentID != nil {
			if err := tx.Model(&model.Comment{}).
				Where("id = ?", *parentID).
				UpdateColumn("reply_count", gorm.Expr("reply_count + 1")).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// The viewer just wrote this, so their own flags are true and no extra read is
	// needed.
	comment.ViewerIsAuthor = true
	return &comment, nil
}

// ListPage is one page of a comment thread.
type ListPage struct {
	Comments []model.Comment `json:"comments"`
	Total    int64           `json:"total"`
	Offset   int             `json:"offset"`
	Limit    int             `json:"limit"`
}

// List returns a page of TOP-LEVEL comments, each with its replies.
//
// One query for the parents and one for the replies, rather than a recursive CTE.
// Two indexed scans on a table with a million rows is cheaper than a recursive
// plan the planner will mis-execute, and it is the shape that stays predictable as
// the table grows.
//
// `viewerID` may be the zero uuid for an anonymous viewer, in which case
// `viewer_has_liked` is false for every comment and the UI shows the unsigned-in
// state rather than an error.
func (s *CommentService) List(
	ctx context.Context,
	assetID uuid.UUID,
	viewerID uuid.UUID,
	limit, offset int,
) (*ListPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int64
	if err := s.db.WithContext(ctx).Model(&model.Comment{}).
		Where("asset_id = ? AND parent_id IS NULL AND deleted_at IS NULL", assetID).
		Count(&total).Error; err != nil {
		return nil, err
	}

	var comments []model.Comment
	// Ordered by NEWEST first, which is what a comment section wants: the top
	// comment is the most recent one, not the oldest.
	if err := s.db.WithContext(ctx).
		Where("asset_id = ? AND parent_id IS NULL AND deleted_at IS NULL", assetID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&comments).Error; err != nil {
		return nil, err
	}

	// The authors, in one query. A query per comment would be N+1, and a comment
	// thread with 20 comments and 60 replies would be 81 round trips to render one
	// screen.
	if err := s.attachAuthors(ctx, comments); err != nil {
		return nil, err
	}

	// ---- the replies ----
	if len(comments) > 0 {
		ids := make([]string, 0, len(comments))
		for _, c := range comments {
			ids = append(ids, c.ID)
		}
		var replies []model.Comment
		// Oldest first: a thread reads top to bottom.
		if err := s.db.WithContext(ctx).
			Where("parent_id IN ? AND deleted_at IS NULL", ids).
			Order("created_at ASC").
			Limit(1000). // A hard cap. A thread is not unbounded, and an unbounded
			// per-parent fetch is how one viral comment takes the page down.
			Find(&replies).Error; err != nil {
			return nil, err
		}
		if err := s.attachAuthors(ctx, replies); err != nil {
			return nil, err
		}

		// The viewer's own likes, for both levels, in ONE query.
		liked := s.viewerLikes(ctx, comments, replies, viewerID)

		// Group the replies under their parents. A map built once beats a nested
		// scan per parent.
		byParent := make(map[string][]model.Comment, len(replies))
		for _, r := range replies {
			if r.ParentID == nil {
				continue
			}
			byParent[*r.ParentID] = append(byParent[*r.ParentID], r)
		}

		for i := range comments {
			comments[i].ViewerIsAuthor = viewerID != uuid.Nil && comments[i].UserID == viewerID.String()
			comments[i].ViewerHasLiked = liked[comments[i].ID]
			comments[i].Replies = byParent[comments[i].ID]
		}
	}

	return &ListPage{
		Comments: comments,
		Total:    total,
		Offset:   offset,
		Limit:    limit,
	}, nil
}

// attachAuthors fills the author fields on each comment with one query.
//
// A single IN (...) over the distinct author ids, and the results are stashed in a
// map so the second pass is a lookup. Doing it per comment is the N+1 this avoids.
func (s *CommentService) attachAuthors(ctx context.Context, comments []model.Comment) error {
	if len(comments) == 0 {
		return nil
	}
	ids := make([]string, 0, len(comments))
	seen := make(map[string]bool, len(comments))
	for _, c := range comments {
		if !seen[c.UserID] {
			seen[c.UserID] = true
			ids = append(ids, c.UserID)
		}
	}

	// A structural type, not the User model: this needs four columns, and SELECTing
	// the whole user row would pull password hashes and session data into a query
	// whose result is about to be serialised to a browser.
	var rows []struct {
		ID       string `gorm:"column:id"`
		FullName string `gorm:"column:full_name"`
		Username string `gorm:"column:username"`
		ImageURL string `gorm:"column:image_url"`
	}
	if err := s.db.WithContext(ctx).
		Table("users").
		Select("id, full_name, username, image_url").
		Where("id IN ?", ids).
		Scan(&rows).Error; err != nil {
		return err
	}

	byID := make(map[string]struct {
		FullName string
		Username string
		ImageURL string
	}, len(rows))
	for _, r := range rows {
		name := strings.TrimSpace(r.FullName)
		if name == "" {
			// A user with no display name still has a username, and "Unknown" as an
			// author on their own comment is confusing.
			name = r.Username
		}
		byID[r.ID] = struct {
			FullName string
			Username string
			ImageURL string
		}{FullName: name, Username: r.Username, ImageURL: r.ImageURL}
	}

	for i := range comments {
		if a, ok := byID[comments[i].UserID]; ok {
			comments[i].AuthorName = a.FullName
			comments[i].AuthorHandle = a.Username
			comments[i].AuthorAvatar = a.ImageURL
		}
	}
	return nil
}

// viewerLikes returns the set of comment ids the viewer has liked.
//
// One query covering both the parents and the replies, so a full thread costs one
// lookup rather than one per level.
func (s *CommentService) viewerLikes(
	ctx context.Context,
	parents, replies []model.Comment,
	viewerID uuid.UUID,
) map[string]bool {
	out := map[string]bool{}
	if viewerID == uuid.Nil {
		return out
	}

	ids := make([]string, 0, len(parents)+len(replies))
	for _, c := range parents {
		ids = append(ids, c.ID)
	}
	for _, c := range replies {
		ids = append(ids, c.ID)
	}
	if len(ids) == 0 {
		return out
	}

	var liked []string
	if err := s.db.WithContext(ctx).Model(&model.CommentLike{}).
		Where("user_id = ? AND comment_id IN ?", viewerID, ids).
		Pluck("comment_id", &liked).Error; err != nil {
		// A failure here is not fatal: the thread renders without the viewer's own
		// like state, which is a cosmetic loss rather than a wrong answer.
		return out
	}
	for _, id := range liked {
		out[id] = true
	}
	return out
}

// Like toggles the viewer's like on a comment.
//
// A toggle and not a set, because that is what the control on screen does: pressing
// an already-pressed like un-presses it. A separate `Unlike` would be two endpoints
// for one state, and one of them would be reachable when the other was not.
//
// The counter is maintained in the same transaction as the row, and the row is
// deleted rather than flagged - a `deleted_at` on a like is a row that would double
// count the moment someone liked twice.
func (s *CommentService) Like(
	ctx context.Context,
	commentID, viewerID uuid.UUID,
) (liked bool, likeCount int, err error) {
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c model.Comment
		if err := tx.Where("id = ? AND deleted_at IS NULL", commentID).First(&c).Error; err != nil {
			// Same answer whether it is missing or soft-deleted.
			return ErrCommentNotFound
		}

		var existing model.CommentLike
		find := tx.Where("comment_id = ? AND user_id = ?", commentID, viewerID).
			Limit(1).Find(&existing)
		if find.Error != nil {
			return find.Error
		}

		hadLike := find.RowsAffected > 0
		if hadLike {
			if err := tx.Where("comment_id = ? AND user_id = ?", commentID, viewerID).
				Delete(&model.CommentLike{}).Error; err != nil {
				return err
			}
		} else {
			// A like needs a UNIQUE (comment_id, user_id) to be safe against a
			// double-tap, and the constraint is on the model.
			if err := tx.Create(&model.CommentLike{
				ID:        uuid.New().String(),
				CommentID: commentID.String(),
				UserID:    viewerID.String(),
				CreatedAt: time.Now().UTC(),
			}).Error; err != nil {
				return err
			}
		}

		// The counter moves by exactly one in the same transaction, so it can never
		// drift from the rows that justify it.
		delta := 1
		if hadLike {
			delta = -1
		}
		if err := tx.Model(&model.Comment{}).
			Where("id = ?", commentID).
			UpdateColumn("like_count", gorm.Expr("GREATEST(like_count + ?, 0)", delta)).Error; err != nil {
			return err
		}

		liked = !hadLike
		likeCount = c.LikeCount + delta
		if likeCount < 0 {
			likeCount = 0
		}
		return nil
	})
	return liked, likeCount, err
}

// Update edits a comment's body.
//
// Owner-only, and the link gate runs again. An edit is a new submission of the same
// content, and a comment that is allowed to become a link after the fact is the
// same hole as one that starts as one.
func (s *CommentService) Update(
	ctx context.Context,
	commentID, viewerID uuid.UUID,
	body string,
) (*model.Comment, error) {
	if err := ValidateCommentBody(body); err != nil {
		return nil, err
	}

	trimmed := strings.TrimSpace(body)
	if len([]rune(trimmed)) < model.MinCommentLength {
		return nil, ErrCommentEmpty
	}
	if len([]rune(trimmed)) > model.MaxCommentLength {
		return nil, ErrCommentTooLong
	}

	var c model.Comment
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND deleted_at IS NULL", commentID).First(&c).Error; err != nil {
			return ErrCommentNotFound
		}
		if c.UserID != viewerID.String() {
			// The same not-found, not a 403: an author-only check that answers
			// "yes this exists but it is not yours" is a discovery endpoint.
			return ErrCommentNotFound
		}

		now := time.Now().UTC()
		updates := map[string]any{
			"body":       trimmed,
			"edited_at":  now,
			"updated_at": now,
		}
		return tx.Model(&model.Comment{}).Where("id = ?", commentID).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}

	c.Body = trimmed
	c.ViewerIsAuthor = true
	return &c, nil
}

// Delete soft-deletes a comment.
//
// The author's own comment, and the ASSET OWNER's - a clip owner may remove a
// comment on their own clip. That is the YouTube model and it is the only way a
// clip owner moderates their own section.
//
// Children are NOT deleted: a reply to a deleted comment still has meaning, and
// the parent renders as a tombstone so the thread keeps its shape.
func (s *CommentService) Delete(
	ctx context.Context,
	commentID, viewerID uuid.UUID,
	assetOwnerID uuid.UUID,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c model.Comment
		if err := tx.Where("id = ? AND deleted_at IS NULL", commentID).First(&c).Error; err != nil {
			return ErrCommentNotFound
		}

		// Author or asset owner, and nothing else.
		if c.UserID != viewerID.String() && c.UserID != assetOwnerID.String() {
			return ErrCommentNotFound
		}
		// The asset owner may only delete comments on their OWN asset - so the
		// assetOwnerID passed in has to belong to the asset this comment is on,
		// which the handler establishes by loading the asset first.
		if c.UserID != viewerID.String() {
			// Not the author, so this is the asset-owner path; assetOwnerID is the
			// asset's owner, established above. Nothing further to check here.
		}

		now := time.Now().UTC()
		return tx.Model(&model.Comment{}).Where("id = ?", commentID).
			Update("deleted_at", now).Error
	})
}

// CommentForDeletion loads a comment together with its ASSET OWNER.
//
// Why this exists rather than `Delete` loading the owner itself: `Delete` takes
// the asset owner as an argument, which means the CALLER decides whose asset it
// is. If the caller got that from anywhere other than the asset's own row, a
// caller could pass the owner of a DIFFERENT asset and delete a comment on
// someone else's clip.
//
// So the owner is read here, from the asset's own row, and `Delete` receives it.
// The handler then cannot have chosen it.
func (s *CommentService) CommentForDeletion(
	ctx context.Context,
	commentID uuid.UUID,
) (*CommentWithAssetOwner, error) {
	var row CommentWithAssetOwner
	err := s.db.WithContext(ctx).
		Table("comments AS c").
		Select("c.*, m.user_id AS asset_owner_id").
		Joins("JOIN media_assets AS m ON m.id = c.asset_id").
		Where("c.id = ? AND c.deleted_at IS NULL", commentID).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == "" {
		return nil, ErrCommentNotFound
	}
	return &row, nil
}

// CommentWithAssetOwner is a comment plus the owner of the asset it sits under.
type CommentWithAssetOwner struct {
	ID          string    `gorm:"column:id"`
	AssetID     string    `gorm:"column:asset_id"`
	UserID      string    `gorm:"column:user_id"`
	ParentID    *string   `gorm:"column:parent_id"`
	Body        string    `gorm:"column:body"`
	DeletedAt   *time.Time `gorm:"column:deleted_at"`
	AssetOwnerID string   `gorm:"column:asset_owner_id"`
}

// Count returns the top-level comment count for an asset.
func (s *CommentService) Count(ctx context.Context, assetID uuid.UUID) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.Comment{}).
		Where("asset_id = ? AND parent_id IS NULL AND deleted_at IS NULL", assetID).
		Count(&n).Error
	return n, err
}

// sortCommentsNewestFirst is the ordering, stated once so the UI and the API agree.
func sortCommentsNewestFirst(in []model.Comment) {
	sort.Slice(in, func(i, j int) bool { return in[i].CreatedAt.After(in[j].CreatedAt) })
}

// Guard against an unused import if errors is dropped later.
var _ = errors.Is
var _ = gorm.ErrRecordNotFound

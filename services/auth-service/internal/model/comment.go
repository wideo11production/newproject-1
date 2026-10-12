package model

// COMMENT - one line under a clip, and one row per author who liked it.
//
// ============================================================================
// WHY THIS IS ONE TABLE AND NOT SEVERAL
// ============================================================================
//
// A comment thread with replies is one recursive table with `parent_id`, not a
// `comments` plus a `replies`. Two tables means two code paths for the same
// behaviour, and the reply path is the one that gets forgotten - so replies end
// up unable to be liked, or unable to be deleted, and the bug is invisible until
// someone tries.
//
// ============================================================================
// WHY `like_count` IS A COLUMN
// ============================================================================
//
// Deriving it means a GROUP BY over the likes table on every list, and a list is
// the hot path - it is what every viewer's screen loads. A denormalised counter
// costs one UPDATE per like and turns the read into a single indexed scan.
//
// The counter is maintained in the SAME transaction as the like row, so it cannot
// drift from the table that justifies it. A counter that is ever incremented
// without its row existing is a number no one can trust.
//
// ============================================================================
// WHY SOFT DELETE
// ============================================================================
//
// A hard delete orphans every reply below it, and a reply whose parent is gone
// reads as a floating comment with no context. `deleted_at` keeps the row so the
// thread still has its shape, and the handler renders a tombstone instead of the
// body. Deleting the parent does NOT delete the children.

import "time"

// Comment is one comment or one reply.
type Comment struct {
	ID     string `gorm:"type:uuid;primaryKey" json:"id"`
	AssetID string `gorm:"type:uuid;index;not null" json:"asset_id"`
	UserID  string `gorm:"type:uuid;index;not null" json:"user_id"`

	// ParentID is nil for a top-level comment and self-referential for a reply.
	//
	// A nullable self-reference rather than a separate table, because a reply is a
	// comment in every respect that matters.
	ParentID *string `gorm:"type:uuid;index" json:"parent_id,omitempty"`

	Body string `gorm:"type:text;not null" json:"body"`

	// LikeCount is denormalised - see the note on the type.
	LikeCount int `gorm:"not null;default:0" json:"like_count"`
	// ReplyCount is the number of direct children, also denormalised.
	//
	// Counted rather than derived for the same reason, and it is what the UI shows
	// without expanding the thread.
	ReplyCount int `gorm:"not null;default:0" json:"reply_count"`

	// EditedAt is nil until the author edits. Shown as "edited" rather than hidden,
	// because a comment that silently changes after people have replied to it is a
	// comment nobody can reason about.
	EditedAt *time.Time `gorm:"column:edited_at" json:"edited_at,omitempty"`

	CreatedAt time.Time  `gorm:"autoCreateTime;index" json:"created_at"`
	UpdatedAt time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt *time.Time `gorm:"index" json:"-"`

	// ---- joined, not stored ----
	//
	// These come from the JOIN in the list query and are never written. Keeping
	// them on the model rather than in a separate DTO means one type travels the
	// whole path, and a field that is only populated on read is marked by being
	// `gorm:"-"`.
	AuthorName     string `gorm:"-" json:"author_name"`
	AuthorAvatar   string `gorm:"-" json:"author_avatar,omitempty"`
	AuthorHandle   string `gorm:"-" json:"author_handle,omitempty"`
	ViewerHasLiked bool   `gorm:"-" json:"viewer_has_liked"`
	ViewerIsAuthor bool   `gorm:"-" json:"viewer_is_author"`

	// Replies are the direct children, populated on read.
	//
	// On the model rather than in a separate response DTO because it is a VIEW of
	// the data, not part of it: `Replies` is never written, and the only code that
	// touches it is the list query that fills it. A DTO for the same shape would be
	// a second type to keep in step.
	Replies []Comment `gorm:"-" json:"replies,omitempty"`
}

func (Comment) TableName() string { return "comments" }

// CommentLike is one author's like on one comment.
//
// A row and not a counter on the comment, because a viewer needs to know whether
// THEY liked it - and a count cannot answer that.
type CommentLike struct {
	ID        string    `gorm:"type:uuid;primaryKey" json:"id"`
	CommentID string    `gorm:"type:uuid;index:idx_comment_like_user,unique;not null" json:"comment_id"`
	UserID    string    `gorm:"type:uuid;index:idx_comment_like_user,unique;not null" json:"user_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (CommentLike) TableName() string { return "comment_likes" }

// Comment limits.
const (
	// MaxCommentLength caps a comment at 2000 characters.
	//
	// Long enough for a paragraph and short enough that a wall of text cannot bury
	// every other comment on a clip.
	MaxCommentLength = 2000

	// MinCommentLength is 1 after trimming: an empty comment is not a comment.
	MinCommentLength = 1

	// MaxCommentDepth caps nesting at ONE level.
	//
	// Infinite nesting is how a thread becomes unreadable: a reply to a reply to a
	// reply has no context on screen, and each level costs another indent until
	// there is no room left for the text. So a reply is flat, and the UI says who
	// is being answered.
	MaxCommentDepth = 1
)

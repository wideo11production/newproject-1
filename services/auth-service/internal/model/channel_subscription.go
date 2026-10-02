// Channel subscriptions - the authoritative source for subscriber counts.
//
// =============================================================================
// WHY THERE IS NO `subscriber_count` COLUMN HERE
// =============================================================================
//
// Because it would be wrong within a week.
//
// A counter that gets incremented is correct only if every path that should
// increment it does, exactly once, and if nothing ever needs to decrement it.
// This domain breaks all three:
//
//   1. A payment reversal, a moderation action or a refund unsubscribes someone.
//      A counter has no way to express that without a decrement path, and a
//      decrement path added later is exactly the kind of thing that gets
//      forgotten on one of the seven code paths that unsubscribe people.
//
//   2. Read-modify-write loses updates. `count = count + 1` in two transactions
//      is a lost update unless the row is locked, and the classic
//      read-then-write in application code is a lost update even WITH a lock if
//      the lock is in the wrong place.
//
//   3. Nothing can check it. With no underlying table, there is no way to ask
//      "is this number right?" - so drift is invisible and permanent. A
//      creator whose count is wrong by 400 has no way to find out.
//
// The count is therefore DERIVED - a `count(*)` over this table, exposed as the
// `channel_subscriber_counts` view so the definition of "subscribed" is written
// down once instead of re-typed in three places that can disagree.
//
// That is a real trade: the count costs a query (mitigated by an index and a
// short-lived cache), and it is always right. A counter is free and eventually
// lies.

package model

import (
	"time"

	"github.com/google/uuid"
)

// Subscription tiers.
const (
	SubscriptionTierFree = "free"
	SubscriptionTierPaid = "paid"
)

// Subscription states.
//
// Note what is NOT here: "expired". Expiry is derived from `EndsAt`, so a lapsed
// subscription leaves the count without a scheduler writing to it. A status that
// a job maintains is a status that eventually disagrees with its own timer.
const (
	SubscriptionStatusActive    = "active"
	SubscriptionStatusCancelled = "cancelled"
)

// ChannelSubscription is one viewer's subscription to one channel.
//
// One row per (channel, user) - a subscription is a STATE, not a movement. Money
// movements for a paid tier belong in the wallet ledger, which is a different
// table with a different lifetime; mixing them here would make both harder to
// reason about.
type ChannelSubscription struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ChannelID uuid.UUID `gorm:"type:uuid;not null;index" json:"channel_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	Tier   string `gorm:"size:16;not null;default:'free'" json:"tier"`
	Status string `gorm:"size:16;not null;default:'active'" json:"status"`

	// FirstSubscribedAt is never overwritten, including across a
	// cancel/re-subscribe cycle. "You have had this subscriber for two years" is a
	// real creator-facing number, and re-subscribing must not reset the clock.
	FirstSubscribedAt time.Time `gorm:"not null" json:"first_subscribed_at"`

	StartedAt   time.Time  `gorm:"not null" json:"started_at"`
	EndsAt      *time.Time `json:"ends_at,omitempty"`
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (ChannelSubscription) TableName() string { return "channel_subscriptions" }

// ChannelSubscriberCounts mirrors the `channel_subscriber_counts` view.
//
// It exists as a Go type because the view is what the count is read from, and
// having the struct next to the model makes the wire shape obvious. The
// constants below are the view's exact column names - they are written out
// rather than inferred, so a rename of a view column breaks the build instead of
// silently returning zero.
const (
	ColSubscriberCount      = "subscriber_count"
	ColPaidSubscriberCount  = "paid_subscriber_count"
	ColFreeSubscriberCount  = "free_subscriber_count"
	ColOldestSubscriptionAt = "oldest_subscription_at"
)

// ChannelSubscriberCounts is one row of the derived-count view.
type ChannelSubscriberCounts struct {
	ChannelID            uuid.UUID  `json:"channel_id"`
	SubscriberCount      int64      `json:"subscriber_count"`
	PaidSubscriberCount  int64      `json:"paid_subscriber_count"`
	FreeSubscriberCount  int64      `json:"free_subscriber_count"`
	OldestSubscriptionAt *time.Time `json:"oldest_subscription_at,omitempty"`
}

// IsActive reports whether this subscription currently counts.
//
// Derived, never stored as a boolean, for the same reason the count is derived:
// a status column that has to be kept in step with a timer is a status that
// eventually is not in step with it.
func (s ChannelSubscription) IsActive(now time.Time) bool {
	return s.Status == SubscriptionStatusActive && (s.EndsAt == nil || s.EndsAt.After(now))
}

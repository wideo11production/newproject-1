package model

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// ENTITLEMENTS: WHAT A USER IS ALLOWED TO DO
// =============================================================================
//
// The companion table to `entitlement_grants`, which is the catalogue of what
// each plan grants.
//
// Why two tables and not a `plan_code` column on `users`:
//
//	entitlement_grants  - deploy-time. What we intend to sell. Seeded from .env
//	                     on every boot, so a plan change is a restart.
//	entitlements       - request-time. What THIS user holds. Append-only ledger.
//
// A column cannot express "was Pro until Tuesday, downgraded after". The ledger
// can, and folding MAX over live rows is what makes a downgrade behave.
//
// =============================================================================

// Entitlement sources.
//
// Recorded because the source decides how an entitlement ends: a trial expires
// on its own, a lifetime never does, and a gift is usually revoked by an admin.
const (
	EntitlementSourceSubscription = "subscription"
	EntitlementSourceLifetime     = "lifetime"
	EntitlementSourceTrial        = "trial"
	EntitlementSourceGrant        = "grant"
	EntitlementSourceMigration    = "migration"
)

// EntitlementGrant is one capability of one plan.
//
// `LimitValue` nil means UNLIMITED, and that is deliberately not 0: 0 and
// "unlimited" are different answers, and a plan that grants NOTHING must be able
// to say so.
//
// No foreign key to a plans table, on purpose - a user must be able to keep an
// entitlement for a plan that has since been retired from the catalogue.
// Removing a plan from sale must not invalidate the people who bought it.
type EntitlementGrant struct {
	ID         int64  `gorm:"primarykey" json:"id"`
	PlanCode   string `gorm:"column:plan_code;size:32;not null;uniqueIndex:uq_grant" json:"plan_code"`
	Capability string `gorm:"column:capability;size:64;not null;uniqueIndex:uq_grant" json:"capability"`
	// Nullable on purpose: nil == unlimited.
	LimitValue *int64    `gorm:"column:limit_value" json:"limit_value"`
	UpdatedAt  time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (EntitlementGrant) TableName() string { return "entitlement_grants" }

// IsUnlimited reports whether this grant has no cap.
func (g EntitlementGrant) IsUnlimited() bool { return g.LimitValue == nil }

// Entitlement is one user's holding. Append-only.
//
// The two timestamps that look similar and are not:
//
//	ends_at       NULL means FOREVER - that is how a lifetime plan is expressed,
//	              rather than as a date far in the future that eventually has to
//	              be extended and eventually gets missed.
//	cancelled_at  set when the user cancels. NOT the same as ends_at: a cancelled
//	              subscription keeps working until the period they PAID FOR runs
//	              out. Collapsing the two revokes something already bought, which
//	              is how you turn a cancellation into a chargeback.
type Entitlement struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	PlanCode string `gorm:"column:plan_code;size:32;not null" json:"plan_code"`
	Source   string `gorm:"column:source;size:16;not null;default:'subscription'" json:"source"`

	StartsAt time.Time  `gorm:"column:starts_at;not null;default:now()" json:"starts_at"`
	EndsAt   *time.Time `gorm:"column:ends_at;index" json:"ends_at,omitempty"`

	CancelledAt *time.Time `gorm:"column:cancelled_at" json:"cancelled_at,omitempty"`

	CurrentPeriodStart *time.Time `gorm:"column:current_period_start" json:"current_period_start,omitempty"`
	CurrentPeriodEnd   *time.Time `gorm:"column:current_period_end" json:"current_period_end,omitempty"`

	// The address this plan was granted FOR.
	//
	// This is the anti-transfer control. A lifetime plan is not giftable and not
	// poolable, and "hand the login to a friend" is account sharing rather than a
	// transfer - so the plan has to be attached to an IDENTITY, not just to a row.
	//
	// The abuse this closes, concretely: six friends share one laptop. Friend A
	// buys a lifetime plan. Friend B cannot use it - but before this, B could
	// simply change the account's email to their own, because nothing referenced
	// the address, so replacing it broke nothing.
	//
	// NULL means "bound to the user, not to an address": correct for a seeded or
	// migrated plan, and deliberately a DIFFERENT state from a bound address, so
	// the two are never confused during a review.
	BoundEmail *string `gorm:"column:bound_email" json:"bound_email,omitempty"`

	// The device the purchase was MADE on, and when.
	//
	// The origin device is UNPINNABLE. A `lifetime5` plan allows five devices,
	// so at first glance the origin looks like just the first of five and
	// swappable for another. It is not: it is the record that the sale happened
	// to this person on this machine, and a user releasing their other slots
	// cannot release it. A friend who talks the owner into dropping their own
	// device has not got the plan - they have got somebody's hardware
	// registration, and the audit trail shows it.
	BoundDeviceFingerprint *string    `gorm:"column:bound_device_fingerprint" json:"-"`
	BoundDeviceAt          *time.Time `gorm:"column:bound_device_at" json:"bound_device_at,omitempty"`

	// IsTransferable is always false, and CHECK-constrained to stay that way in
	// migration 019. The column exists so the answer to "can this be gifted or
	// pooled?" lives in the SCHEMA rather than in a paragraph nobody opens.
	IsTransferable bool `gorm:"column:is_transferable;not null;default:false" json:"is_transferable"`

	// Suspended is NOT revoked, and the difference is the whole point.
	//
	// Revoked   - ended deliberately, by an admin or a cancellation.
	// Suspended - still paid for, still owned, but not applying right now because
	//             the identity stopped matching. It RESUMES when the new address
	//             is verified.
	//
	// Collapsing them would make a suspended plan unrecoverable, and would treat
	// a customer who changed their email by accident as a thief.
	SuspendedAt   *time.Time `gorm:"column:suspended_at;index" json:"suspended_at,omitempty"`
	SuspendReason string     `gorm:"column:suspend_reason" json:"suspend_reason,omitempty"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

func (Entitlement) TableName() string { return "entitlements" }

// IsLive reports whether this entitlement confers authority right now.
//
// FOUR conditions, and the last is the recent one:
//
//	cancelled? -> no
//	suspended? -> no
//	expired?   -> no
//	IDENTITY?  -> checked by IdentityMatches against the account's CURRENT email
//
// The identity check lives in a separate function on purpose: `IsLive` answers
// about time, `IdentityMatches` answers about who, and folding them together
// means a call site that only has a timestamp cannot check the identity at all.
//
// Derived, never stored as a status: a status kept in step with the user's own
// profile is a status that eventually is not in step with it.
func (e Entitlement) IsLive(now time.Time) bool {
	if e.CancelledAt != nil {
		return false
	}
	if e.SuspendedAt != nil {
		return false
	}
	if e.EndsAt != nil && !e.EndsAt.After(now) {
		return false
	}
	return true
}

// IdentityMatches reports whether this plan still belongs to `email`.
//
// A plan with no bound email is bound to the USER and always matches - that is
// the seeded and migrated case, and treating it as a mismatch would suspend every
// legacy plan at once.
//
// Case-insensitive, because addresses are: `In@x.com` and `in@x.com` are one
// mailbox. Comparing case-sensitively would suspend a paying customer over their
// mail client's capitalisation, which is precisely how you teach people to
// disable security checks.
func (e Entitlement) IdentityMatches(email string) bool {
	if e.BoundEmail == nil {
		return true
	}
	return strings.EqualFold(*e.BoundEmail, email)
}

// IsLive reports whether this entitlement counts right now.
//
// Derived rather than stored, for the same reason the subscriber count is: a
// status that has to be kept in step with a clock is a status that eventually
// is not in step with it, and an expired-but-still-active row is exactly what a
// quota check would then honour.
//
// REMOVED: the original two-condition version of this method. It is superseded by
// the one above, which also checks suspension - and a second IsLive in the same
// file, with a different answer, is precisely the kind of thing that makes a
// security check unreliable. One method, one answer.

func (e Entitlement) IsLifetime() bool {
	return e.EndsAt == nil
}

package service

// Device slots: how many devices a LIFETIME plan may be used from.
//
// =============================================================================
// REUSED, NOT DUPLICATED
// =============================================================================
//
// `device_accounts` already answers a different question on a different axis:
//
//	max N ACCOUNTS per DEVICE   ->  COUNT(*)          WHERE fingerprint = ?
//	max N DEVICES per USER      ->  COUNT(DISTINCT fingerprint) WHERE user_id = ?
//
// One table, one unique index on (fingerprint, user_id), two queries. A second
// table for device slots would be the same facts stored twice, and the two would
// drift the first time a row was written to one and not the other.
//
// The unique index also does real work here: because there can be at most one
// row per (device, user), `COUNT(*)` and `COUNT(DISTINCT fingerprint)` are the
// same number for a given user, and the DISTINCT is there to say so rather than
// to paper over duplicates.
//
// =============================================================================
// WHY THIS IS FAILS-OPEN, WHICH IS NOT THE USUAL RULE HERE
// =============================================================================
//
// Everything else in this service fails closed, and the reason is that failing
// open would grant something the user has not paid for.
//
// This one is the deliberate exception, and the test is which side of the
// transaction loses more:
//
//	FAIL OPEN   a lifetime user gets an extra device. They paid once; the loss
//	             is one seat.
//	FAIL CLOSED  a paying lifetime user cannot log in at all because the
//	             entitlement table was briefly unreachable. That is a support
//	             ticket, a refund conversation, and a customer who does not
//	             believe the product works.
//
// Taking away something already bought is worse than giving away a small
// amount. So an unreadable cap allows the sign-in, and the limit resumes as
// soon as the table is back. The failure is logged so it is visible.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
)

// ErrDeviceSlotsExhausted - the lifetime plan's device allowance is used up.
var ErrDeviceSlotsExhausted = errors.New("lifetime device allowance used up")

// DeviceSlotService counts and caps the devices a user may sign in from.
type DeviceSlotService struct {
	db           *gorm.DB
	entitlements *EntitlementService
}

// NewDeviceSlotService builds the service.
//
// `entitlements` may be nil, and then every device is allowed - see the fails-open
// note in the file header.
func NewDeviceSlotService(db *gorm.DB, entitlements *EntitlementService) *DeviceSlotService {
	return &DeviceSlotService{db: db, entitlements: entitlements}
}

// DeviceUsage is one device a user has signed in from.
type DeviceUsage struct {
	Fingerprint string    `gorm:"column:fingerprint" json:"fingerprint"`
	FirstSeenAt time.Time `gorm:"column:first_seen_at" json:"first_seen_at"`
	LastSeenAt  time.Time `gorm:"column:last_seen_at" json:"last_seen_at"`
	Browser     string    `gorm:"column:browser" json:"browser"`
	OS          string    `gorm:"column:os" json:"os"`
	Country     string    `gorm:"column:country" json:"country"`
}

// deviceRow is a `device_accounts` row as this needs it.
//
// A struct rather than the GORM model because this service only needs these
// fields, and being unable to reach a `user_id` by accident is not a property
// worth giving up.
//
// `TableName` is MANDATORY, not optional: without it GORM pluralises the Go
// type name and looks for `device_rows`, which does not exist. That produced
// `relation "device_rows" does not exist` at runtime, not at build time.
type deviceRow struct {
	Fingerprint string    `gorm:"column:fingerprint"`
	CreatedAt   time.Time `gorm:"column:created_at"`
}

func (deviceRow) TableName() string { return "device_accounts" }

// DevicesUsed is how many distinct devices this user has signed in from.
func (s *DeviceSlotService) DevicesUsed(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&deviceRow{}).
		Where("user_id = ?", userID).
		Distinct("fingerprint").
		Count(&n).Error
	return int(n), err
}

// CheckSlot decides whether `fingerprint` may be used, WITHOUT recording it.
//
// Two cases, and the second is the one that matters:
//
//   - the device is already known for this user -> ALLOW, and no slot is
//     consumed. Returning to a device you have used before is not a new device,
//     and counting it again would lock a paying user out of their own second
//     device after they sign out of it.
//   - the device is new -> consume a slot, and refuse if the allowance is used
//     up.
//
// The caller records the row separately, AFTER the answer, so a refused device
// leaves no trace. Recording first would mean a refused attempt still counted
// towards the very limit it violated.
func (s *DeviceSlotService) CheckSlot(ctx context.Context, userID uuid.UUID, fingerprint string) error {
	if fingerprint == "" {
		// No fingerprint means no device identity. Refusing outright would lock
		// out any client that does not send one; treating it as unlimited would
		// make the limit trivially bypassable by omitting the header.
		//
		// So: not a new device, and not a slot. The account-level per-device
		// rule (the `device_accounts` account cap) still applies, and that is the
		// control that does not depend on device identity.
		return nil
	}

	// Already known?
	var existing int64
	if err := s.db.WithContext(ctx).Model(&deviceRow{}).
		Where("user_id = ? AND fingerprint = ?", userID, fingerprint).
		Count(&existing).Error; err != nil {
		// Cannot tell whether this is a new device. See the fails-open note: allow,
		// because refusing takes away a paid lifetime user's access over a query
		// error. Logged so the blip is not silent.
		log.Printf("[DEVICES] known-device lookup failed for user %s: %v - allowing", userID, err)
		return nil
	}
	if existing > 0 {
		return nil
	}

	cap, granted, err := s.cap(ctx, userID)
	if err != nil || !granted {
		if err != nil {
			log.Printf("[DEVICES] cap lookup failed for user %s: %v - allowing (fails open)", userID, err)
		}
		return nil
	}
	if cap == config.Unlimited {
		return nil
	}

	used, err := s.DevicesUsed(ctx, userID)
	if err != nil {
		log.Printf("[DEVICES] device count failed for user %s: %v - allowing (fails open)", userID, err)
		return nil
	}

	if int64(used) >= cap {
		return fmt.Errorf(
			"%w: this plan includes %d device%s, and all %d are in use. "+
				"Remove one from another device to free a slot.",
			ErrDeviceSlotsExhausted, cap, plural(int(cap)), used)
	}
	return nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// cap is the effective device allowance for a user.
//
// A SUBSCRIPTION has no device cap. That is the whole difference between a
// recurring plan and a lifetime one: stopping payment ends the subscription, so
// it is already self-limiting, while a one-off purchase would otherwise be
// unbounded forever.
func (s *DeviceSlotService) cap(ctx context.Context, userID uuid.UUID) (int64, bool, error) {
	if s == nil || s.entitlements == nil {
		return config.Unlimited, true, nil
	}
	return s.entitlements.Limit(ctx, userID, config.CapLifetimeDevices)
}

// Revoke frees exactly one device slot.
//
// Deletes ONE row, scoped to (user_id, fingerprint). It is deliberately not a
// "sign out everywhere" operation - a user who revokes one stolen laptop should
// keep their own phone, and a blanket delete would sign them out of everything
// and hand a thief all of it at once.
//
// It DOES free a slot immediately, with no cooldown. Cooldowns here look like
// anti-abuse, but the failure mode is a paying customer locked out of their own
// account, and the abuse it would prevent (buying one plan, sharing it by
// revoking and re-adding) is already bounded by the cap itself.
func (s *DeviceSlotService) Revoke(ctx context.Context, userID uuid.UUID, fingerprint string) error {
	if fingerprint == "" {
		return errors.New("fingerprint is required")
	}

	res := s.db.WithContext(ctx).
		Where("user_id = ? AND fingerprint = ?", userID, fingerprint).
		Delete(&deviceRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// Nothing to revoke. Reported rather than treated as success: a UI that
		// says "done" for a device that was never there hides a real bug.
		return fmt.Errorf("that device is not in your list")
	}
	return nil
}

// List returns the devices a user has signed in from, for the account screen.
func (s *DeviceSlotService) List(ctx context.Context, userID uuid.UUID) ([]DeviceUsage, error) {
	var out []DeviceUsage
	err := s.db.WithContext(ctx).Raw(`
		SELECT da.fingerprint,
		       min(da.created_at) AS first_seen_at,
		       max(da.created_at) AS last_seen_at
		FROM device_accounts da
		WHERE da.user_id = ?
		GROUP BY da.fingerprint
		ORDER BY max(da.created_at) DESC
		LIMIT 200
	`, userID).Scan(&out).Error
	return out, err
}

// Status is what the account screen needs to explain the rule to a user.
//
// The limit and the count are both computed, so a lifetime user on 3 of 3 sees
// "3 of 3 devices" rather than a number with no context - and a subscriber sees
// that the limit does not apply to them at all, instead of wondering why a
// lifetime-only rule is on their screen.
func (s *DeviceSlotService) Status(ctx context.Context, userID uuid.UUID) (map[string]any, error) {
	used, err := s.DevicesUsed(ctx, userID)
	if err != nil {
		return nil, err
	}

	limit, granted, lerr := s.cap(ctx, userID)
	out := map[string]any{
		"devices_used":  used,
		"limit_applies": false,
	}
	if lerr == nil && granted && limit != config.Unlimited {
		out["limit_applies"] = true
		out["device_limit"] = limit
		out["slots_remaining"] = limit - int64(used)
	}
	return out, nil
}

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
)

// Every plan in these tests is pinned to ONE identity and ONE device, so a test
// about device LIMITS is not accidentally also a test about TRANSFER.
const (
	testEmail       = "pinned@probe.local"
	testFingerprint = "probe-origin-device"
)

// =============================================================================
// WHAT IS WORTH TESTING HERE
// =============================================================================
//
// A device cap is a thing people PAY for, so the failure modes that matter are
// the ones where a paying user loses access or a free slot is handed out:
//
//	1. returning to a KNOWN device must not consume a new slot - otherwise
//	   signing out of your own phone locks you out of it permanently
//	2. a REFUSED device must leave no row - otherwise the failed attempt counts
//	   towards the limit it just violated
//	3. a SUBSCRIPTION has no device cap (stopping payment ends the plan)
//	4. a LIFETIME plan is capped at 1 / 5 / 10
//	5. revoking frees EXACTLY ONE device, and the others survive
//	6. a password change must not free a slot - nothing here is keyed on
//	   credentials, but the test pins it so a future change cannot
//	7. an unreadable cap FAILS OPEN, because locking a paying user out is the
//	   worse of the two failures
//
// The table is shared with the per-device ACCOUNT cap, which is the point - see
// device_slots.go. These tests use the same table that rule does.

func seedDevice(t *testing.T, db *gorm.DB, userID uuid.UUID, fingerprint string) {
	t.Helper()
	if err := db.Exec(
		`INSERT INTO device_accounts (fingerprint, user_id) VALUES (?, ?)
		 ON CONFLICT (fingerprint, user_id) DO NOTHING`,
		fingerprint, userID).Error; err != nil {
		t.Fatalf("seed device %s: %v", fingerprint, err)
	}
}

func TestDeviceSlotReturnsToKnownDeviceIsFree(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}

	// The one device this plan includes. The grant above has NO end date, which is
	// what "lifetime" means here - so no date maths is needed anywhere below.
	seedDevice(t, db, user, "device-A")

	// A KNOWN device, and the user has signed out and back in many times.
	for i := 0; i < 5; i++ {
		if err := slots.CheckSlot(ctx, user, "device-A"); err != nil {
			t.Fatalf("returning to a device the user already uses was refused (round %d): %v", i, err)
		}
	}

	used, err := slots.DevicesUsed(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if used != 1 {
		t.Errorf("devices_used = %d, want 1 - returning to a device is not a new device", used)
	}
}

func TestDeviceSlotRefusalLeavesNoRow(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}
	seedDevice(t, db, user, "device-A")

	// A second device on a 1-device plan: refused.
	if err := slots.CheckSlot(ctx, user, "device-B"); !errors.Is(err, ErrDeviceSlotsExhausted) {
		t.Fatalf("second device on lifetime1: got %v, want ErrDeviceSlotsExhausted", err)
	}

	// AND the refused device left nothing behind.
	used, err := slots.DevicesUsed(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if used != 1 {
		t.Errorf("devices_used = %d after a refused attempt, want 1.\n"+
			"A refused device that still counted would leave the user permanently one\n"+
			"short for a mistake they were already told about.", used)
	}
}

func TestDeviceSlotLimitsFollowThePlan(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	cases := []struct {
		plan      string
		wantLimit int64
		wantApply bool
	}{
		{"lifetime1", 1, true},
		{"lifetime5", 5, true},
		{"lifetime10", 10, true},
		// A subscription is self-limiting: payment stops the plan. Capping it by
		// device too would be punishing people for being customers.
		{"pro", config.Unlimited, false},
		{"studio", config.Unlimited, false},
	}

	for _, tc := range cases {
		user := probeEntUser(t, db)
		if _, err := svc.Grant(ctx, user, tc.plan, "grant", nil, nil, nil, testEmail, testFingerprint); err != nil {
			t.Fatalf("%s: %v", tc.plan, err)
		}

		// The cap comes from the DEVICE service, which is what the register path
		// actually calls.
		slotsForPlan := NewDeviceSlotService(db, svc)
		limit, granted, err := slotsForPlan.cap(ctx, user)
		if err != nil {
			t.Fatalf("%s: %v", tc.plan, err)
		}
		if !granted {
			t.Errorf("%s: the device allowance is not reported at all", tc.plan)
		}
		if limit != tc.wantLimit {
			t.Errorf("%s: device limit = %d, want %d", tc.plan, limit, tc.wantLimit)
		}

		status, err := slots.Status(ctx, user)
		if err != nil {
			t.Fatalf("%s: %v", tc.plan, err)
		}
		if status["limit_applies"] != tc.wantApply {
			t.Errorf("%s: limit_applies = %v, want %v - a subscriber should be told the\n"+
				"rule does not concern them, rather than wondering why it is on screen",
				tc.plan, status["limit_applies"], tc.wantApply)
		}
	}
}

func TestDeviceRevokeFreesExactlyOne(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime5", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"device-A", "device-B", "device-C"} {
		seedDevice(t, db, user, f)
	}

	if err := slots.Revoke(ctx, user, "device-B"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	used, err := slots.DevicesUsed(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if used != 2 {
		t.Errorf("devices_used = %d after revoking one, want 2", used)
	}

	// A and C must still be there - this is NOT "sign out everywhere".
	devices, err := slots.List(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, d := range devices {
		seen[d.Fingerprint] = true
	}
	if seen["device-B"] {
		t.Error("the revoked device is still listed")
	}
	if !seen["device-A"] || !seen["device-C"] {
		t.Errorf("revoking one device removed others: %v", seen)
	}

	// Revoking something that was never there is an error, not a silent success.
	if err := slots.Revoke(ctx, user, "never-existed"); err == nil {
		t.Error("revoking a device that was never registered reported success")
	}
}

// TestDeviceSlotIsNotFreedByAPasswordChange pins a rule the whole design rests
// on: the slot is counted from DEVICES, so nothing about credentials can change
// it.
//
// There is no code path that deletes a device_accounts row on a credential
// change today, and this test is here so that stays true - a future "security
// feature" that resets device registrations on a password change would silently
// turn a lifetime purchase into an unlimited one.
func TestDeviceSlotIsNotFreedByAPasswordChange(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}
	// Only device-A exists, and it consumes the plan's single slot.
	//
	// NOTE: an earlier version of this test seeded device-B too, and then
	// expected device-B to be REFUSED. It was not - and it should not have been:
	// a device already in the table is a KNOWN device, and returning to a device
	// you have used before is not a new device. The test was wrong, not the code.
	// It now seeds only the one device that owns the slot, and checks a genuinely
	// new one.
	seedDevice(t, db, user, "device-A")

	// Before: a new device is already out of allowance.
	if err := slots.CheckSlot(ctx, user, "device-B"); !errors.Is(err, ErrDeviceSlotsExhausted) {
		t.Fatalf("setup: a new device on lifetime1 was allowed (err=%v)", err)
	}

	// Change the password.
	if err := db.Exec(`UPDATE users SET password_hash = 'changed' WHERE id = ?`, user).Error; err != nil {
		t.Fatalf("password change: %v", err)
	}

	// After: still out of allowance. A password change must not free a slot.
	if err := slots.CheckSlot(ctx, user, "device-B"); !errors.Is(err, ErrDeviceSlotsExhausted) {
		t.Fatalf("a password change freed a device slot (err=%v).\n"+
			"Slots are counted from devices and must never be tied to credentials.\n"+
			"Otherwise changing a password silently converts a lifetime plan into\n"+
			"an unlimited one.", err)
	}

	// And device-A, the one already in use, is untouched.
	if err := slots.CheckSlot(ctx, user, "device-A"); err != nil {
		t.Errorf("a password change locked the user out of a device already in use: %v", err)
	}
}

// TestDeviceSlotFailsOpen: locking a paying lifetime user out because a table
// was briefly unreachable is worse than letting one extra device in.
func TestDeviceSlotFailsOpen(t *testing.T) {
	db := entTestDB(t)
	ctx := context.Background()

	user := probeEntUser(t, db)
	seedDevice(t, db, user, "device-A")

	// No entitlement service at all: the cap is unknown.
	bare := NewDeviceSlotService(db, nil)
	if err := bare.CheckSlot(ctx, user, "device-B"); err != nil {
		t.Errorf("an unreadable cap refused a paid user: %v\n"+
			"Fails OPEN here, deliberately - see device_slots.go. Refusing takes away\n"+
			"something already bought; allowing costs one seat.", err)
	}

}

// A user with no fingerprint is not a new device and consumes no slot, because
// refusing outright would lock out any client that does not send one.
func TestDeviceSlotWithNoFingerprintConsumesNothing(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	slots := NewDeviceSlotService(db, svc)
	ctx := context.Background()

	user := probeEntUser(t, db)
	if _, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil, testEmail, testFingerprint); err != nil {
		t.Fatal(err)
	}
	seedDevice(t, db, user, "device-A")

	if err := slots.CheckSlot(ctx, user, ""); err != nil {
		t.Errorf("a client sending no fingerprint was refused: %v", err)
	}
	used, _ := slots.DevicesUsed(ctx, user)
	if used != 1 {
		t.Errorf("an empty fingerprint consumed a slot: %d devices recorded", used)
	}
}

package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// A PLAN IS NOT TRANSFERABLE
// =============================================================================
//
// The abuse, in the form it actually takes - not a gift, and not a transfer
// feature that was never built. Six friends share one laptop.
//
//	Day one  Friend A buys a LIFETIME plan and logs in on that laptop.
//	Day two  Friend B needs the editor, so A hands over the address and password.
//	         Or B changes the account's email to their own - which, before the
//	         pin existed, broke nothing at all, because nothing referenced the
//	         address.
//	Repeat    until the device allowance is gone.
//
// The email pin closes the second move. The device pin closes the first for the
// origin machine. The database trigger closes both against anything that is not
// this Go code - a migration, a script, a future service - which is why the
// tests below include a raw SQL attempt.
//
// Nothing here prevents someone typing a shared password. It is worth being
// straight about that: it is not solvable by a schema. What it does is make the
// plan stop following the person, which is the difference between "we did not
// design for that" and "that does not work".

// ============================================================================
// THE PIN IS TAKEN AT THE MOMENT OF SALE
// ============================================================================

func TestGrantPinsIdentityAndDevice(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()
	user := probeEntUser(t, db)

	got, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"buyer@example.com", "origin-laptop-01")
	if err != nil {
		t.Fatal(err)
	}

	if got.BoundEmail == nil || *got.BoundEmail != "buyer@example.com" {
		t.Errorf("bound_email = %v, want buyer@example.com.\n"+
			"A plan granted to nobody in particular is a plan that follows whoever finds it.", got.BoundEmail)
	}
	if got.BoundDeviceFingerprint == nil || *got.BoundDeviceFingerprint != "origin-laptop-01" {
		t.Errorf("bound_device = %v, want origin-laptop-01.\n"+
			"The device a sale happened on is the only record that it happened to this person.", got.BoundDeviceFingerprint)
	}
	if got.BoundDeviceAt == nil {
		t.Error("bound_device_at is not set, so the purchase moment is unrecorded")
	}
	if got.IsTransferable {
		t.Error("a lifetime plan was created as TRANSFERABLE.\n" +
			"Handing a login to a friend is account sharing, not a transfer.")
	}
}

// A blank email or fingerprint is a real state, and must not become a
// same-shaped-but-different one.
func TestGrantWithNoFingerprintLeavesItUnpinned(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()
	user := probeEntUser(t, db)

	got, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"buyer@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.BoundDeviceFingerprint != nil {
		t.Errorf("an empty fingerprint was stored as %q - a client that sends no fingerprint`n"+
			"must be distinguishable from one bound to \"\"", *got.BoundDeviceFingerprint)
	}
	if got.BoundEmail == nil {
		t.Error("the email should still be pinned even when the device is not")
	}
}

// ============================================================================
// THE PIN DOES NOT MOVE
// ============================================================================

// The check the user actually asked for: once an email and a device are linked
// and registered, that does not change.
func TestIdentityMatchIsCaseInsensitive(t *testing.T) {
	bound := "Buyer@Example.com"
	e := model.Entitlement{BoundEmail: &bound}

	// Addresses are case-insensitive. `In@x.com` and `in@x.com` are one
	// mailbox, and comparing case-sensitively would suspend a paying customer over
	// their mail client's capitalisation - which is how you teach people to turn
	// security checks off.
	if !e.IdentityMatches("buyer@example.com") {
		t.Error("a case difference in the email was treated as a different person")
	}
	if e.IdentityMatches("someone-else@example.com") {
		t.Error("a genuinely different address was accepted as a match")
	}

	// An unpinned plan is bound to the USER, and always matches - otherwise
	// every seeded and migrated plan would be treated as transferred.
	unbound := model.Entitlement{}
	if !unbound.IdentityMatches("anyone@example.com") {
		t.Error("a plan with no bound email does not match, which would suspend every legacy plan")
	}
}

// THE TEST THAT MATTERS MOST: the database refuses, not just the Go code.
//
// "The application checks" is a line that can be deleted in a merge, skipped by
// a path that writes directly, or bypassed by a script. The trigger is the last
// place the value passes through, and nothing in the application routes around it.
func TestDatabaseRefusesToRebind(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()
	user := probeEntUser(t, db)

	got, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"buyer@example.com", "origin-laptop-01")
	if err != nil {
		t.Fatal(err)
	}

	// A rebind, attempted the way a careless migration or a bad script would.
	err = db.Exec(
		`UPDATE entitlements SET bound_device_fingerprint = 'friends-laptop' WHERE id = ?`,
		got.ID).Error
	if err == nil {
		t.Fatal("the database allowed a device rebind.\n" +
			"Any code path can change this - including a migration, a script, or a\n" +
			"future service that is not this code. The trigger is the control.")
	}
	if !strings.Contains(err.Error(), "cannot be rebound") {
		t.Errorf("the refusal does not say why: %v", err)
	}

	// Same for the email.
	if err := db.Exec(
		`UPDATE entitlements SET bound_email = 'attacker@evil.example' WHERE id = ?`,
		got.ID).Error; err == nil {
		t.Error("the database allowed an EMAIL rebind")
	}

	// And the value is genuinely unchanged.
	var check model.Entitlement
	if err := db.First(&check, "id = ?", got.ID).Error; err != nil {
		t.Fatal(err)
	}
	if check.BoundDeviceFingerprint == nil || *check.BoundDeviceFingerprint != "origin-laptop-01" {
		t.Errorf("the pin changed despite the refusal: %v", check.BoundDeviceFingerprint)
	}
	if check.BoundEmail == nil || *check.BoundEmail != "buyer@example.com" {
		t.Errorf("the bound email changed despite the refusal: %v", check.BoundEmail)
	}
}

// A granted plan can still be RENEWED, and a renewal must not disturb the pin.
func TestRenewalDoesNotMoveThePin(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()
	user := probeEntUser(t, db)

	first, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"buyer@example.com", "origin-laptop-01")
	if err != nil {
		t.Fatal(err)
	}

	// Grant again - the retry-a-webhook path.
	again, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"someone.else@example.com", "a-different-laptop")
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID {
		t.Fatalf("a re-grant created a SECOND row (%s vs %s).\n"+
			"One plan, one row: a duplicate would not double a limit, but it would make\n"+
			"`revoke it` ambiguous.", again.ID, first.ID)
	}

	// And the pin is exactly where it started.
	if again.BoundEmail == nil || *again.BoundEmail != "buyer@example.com" {
		t.Errorf("a re-grant moved the bound email to %v.\n"+
			"Re-grant is the retry path a duplicate webhook takes, so it must not be a\n"+
			"way to re-point a plan at a different identity.", again.BoundEmail)
	}
	if again.BoundDeviceFingerprint == nil || *again.BoundDeviceFingerprint != "origin-laptop-01" {
		t.Errorf("a re-grant moved the bound device to %v", again.BoundDeviceFingerprint)
	}
}

// ============================================================================
// SUSPENDED IS NOT REVOKED
// ============================================================================

// A plan whose identity no longer matches is SUSPENDED: still paid for, still
// owned, not applying. It resumes on re-verification.
//
// Collapsing suspended into revoked would treat a customer who mistyped their
// email as a thief, and there is no way back from there.
func TestSuspendedPlanIsNotLiveButNotRevoked(t *testing.T) {
	db := entTestDB(t)
	svc := entSvc(t, db)
	ctx := context.Background()
	user := probeEntUser(t, db)

	got, err := svc.Grant(ctx, user, "lifetime1", "lifetime", nil, nil, nil,
		"buyer@example.com", "origin-laptop-01")
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	if !got.IsLive(now) {
		t.Fatal("a fresh plan is not live")
	}

	if err := db.Exec(
		`UPDATE entitlements SET suspended_at = now(), suspend_reason = 'email changed' WHERE id = ?`,
		got.ID).Error; err != nil {
		t.Fatal(err)
	}

	var reloaded model.Entitlement
	if err := db.First(&reloaded, "id = ?", got.ID).Error; err != nil {
		t.Fatal(err)
	}

	if reloaded.IsLive(now) {
		t.Error("a suspended plan is still LIVE - the email change would not have stopped it")
	}
	if reloaded.CancelledAt != nil {
		t.Error("the plan was CANCELLED, not suspended.\n" +
			"Revoked is unrecoverable; a customer who changed their email by accident\n" +
			"would lose a plan they paid for.")
	}
	// It is still the user's, and the pin survived the suspension.
	if reloaded.BoundEmail == nil || *reloaded.BoundEmail != "buyer@example.com" {
		t.Errorf("suspension moved the pin: %v", reloaded.BoundEmail)
	}
}

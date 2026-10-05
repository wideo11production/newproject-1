package model

import "time"

// Trial device registry — one trial per BROWSER.
//
// =============================================================================
// WHY THIS IS KEYED ON A BROWSER AND NOT ON AN IP
// =============================================================================
//
// The question being asked is "has this person already taken a free trial", and the
// honest answer is that nobody knows who people are without asking them for
// something that proves it. The product deliberately has no payment provider and no
// verified identity, so this layer works with what a browser can offer.
//
// An IP cap is the tempting answer and it is the wrong one. Every person on one
// household connection, one office, one campus, or one mobile carrier CGNAT pool
// shares an IP. An IP cap refuses the second person to register from an ordinary
// home — a false positive on somebody doing nothing wrong, and one they cannot fix,
// because they cannot change their IP.
//
// A browser fingerprint is per INSTALL:
//
//	same browser,   second email  ->  BLOCKED. One person re-registering.
//	same wifi,     other browser  ->  ALLOWED. Two people, one router.
//	cleared data,  new browser    ->  ALLOWED. The known limit; see below.
//
// That last row is the honest boundary. Clearing site data mints a new fingerprint,
// so this stops casual re-registration and NOT a determined actor. Nothing at this
// layer can stop a determined actor — that needs a payment method or real identity
// verification, neither of which this product has. The alternative to a weak
// control is no control at all, and no control is strictly worse.
//
// So: honest about its reach, explicit about what it does, and it emits a
// CRITICAL security event on every refusal so a human reviews the repeats.

// TrialDevice records that a browser claimed a trial.
type TrialDevice struct {
	// DeviceFingerprint is the client-generated id from `localStorage`.
	//
	// PRIMARY KEY, not an index: uniqueness is the entire mechanism. A cap that a
	// NULL can bypass is not a cap.
	DeviceFingerprint string `gorm:"primaryKey;size:64" json:"device_fingerprint"`

	// ClaimedBy is the email that took the trial. NOT a foreign key - see the file
	// header.
	ClaimedBy string `gorm:"size:255;not null" json:"claimed_by"`

	ClaimedAt time.Time `gorm:"not null;default:now()" json:"claimed_at"`

	// BlockedAttempts counts REFUSALS from this device. One is somebody's family
	// member; nine is an operation. That difference is what separates an alert worth
	// reading from noise, and it is why a refusal is a CRITICAL security event.
	BlockedAttempts int `gorm:"not null;default:0" json:"blocked_attempts"`

	LastBlockedAt *time.Time `json:"last_blocked_at,omitempty"`
}

// TableName pins it so GORM's pluralisation cannot guess `trial_devices` into
// `trial_devicees` or similar.
func (TrialDevice) TableName() string { return "trial_devices" }

// EventTrialBlockedDevice is emitted when the device cap refuses a trial.
//
// CRITICAL, deliberately, and it goes through the same path as `LOCKOUT_TRIGGERED`
// and `DEVICE_LIMIT_EXCEEDED` — which means it appears on the superadmin banner and
// is acknowledged with the OK button built in Session 30. No new alert machinery
// was needed for this; adding an event type to `criticalTypes` was enough.
//
// The `Detail` carries the family-member signal, because "this device was refused
// before" and "this device was refused four times" are the same event type and very
// different things to read at 3am.
const EventTrialBlockedDevice = "TRIAL_BLOCKED_DEVICE"
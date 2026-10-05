package service

// =============================================================================
// ONE TRIAL PER BROWSER
// =============================================================================
//
// `Register` already enforces one trial per ACCOUNT: it fails with
// `ErrUserExists` for a duplicate email. That is one-per-EMAIL, which is not
// one-per-PERSON. Three addresses, three trials, and nothing in the code prevented
// it.
//
// WHY A BROWSER FINGERPRINT AND NOT AN IP
//
// An IP cap is the obvious choice and it is the wrong one.
//
// Every person on one household connection, one office, one campus, or one mobile
// carrier CGNAT pool shares an IP. An IP cap refuses the SECOND person to register
// from an ordinary home — a false positive against somebody doing nothing wrong, and
// one they cannot fix, because they cannot change their IP.
//
// A browser fingerprint is per INSTALL:
//
//	same browser,  second email  ->  BLOCKED. One person re-registering.
//	same wifi,    other browser  ->  ALLOWED. Two people, one router.
//	same family,  two computers   ->  ALLOWED.
//	cleared data, new browser    ->  ALLOWED. The known limit; see below.
//
// -----------------------------------------------------------------------------
// THE HONEST LIMIT, STATED WHERE IT CANNOT BE MISSED
// -----------------------------------------------------------------------------
//
// Clearing site data mints a new fingerprint. **This stops casual
// re-registration, not a determined actor.**
//
// Nothing at this layer can stop a determined actor. That needs a payment method or
// real identity verification, and the product deliberately has neither — it is
// self-hosted with no payment provider, which is a deliberate trade for zero
// per-seat cost. A weak control that works for the 99% case beats no control, and
// pretending otherwise would be the actual failure.
//
// Every refusal is counted and emitted as a CRITICAL security event, so a person
// reviews the repeats. That is the part that makes this a control rather than a
// speed bump: one refusal is somebody's family member, and nine is an operation.
//
// -----------------------------------------------------------------------------
// WHY A REFUSAL DOES NOT BLOCK REGISTRATION
// -----------------------------------------------------------------------------
//
// It blocks the TRIAL. The account is created.
//
// Blocking signup instead would punish the innocent case — the family member on the
// shared laptop, who did nothing wrong and now cannot have an account at all —
// which is the same false positive an IP cap causes, just at a worse moment.
//
// So: the account exists, and it starts with zero allowances until somebody upgrades
// or an operator grants a plan. That is an honest state the UI can explain, rather
// than a hard failure the person cannot act on.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/wideo11/auth-service/internal/model"
)

// ErrTrialDeviceCap is returned when a device has already claimed a trial.
var ErrTrialDeviceCap = errors.New("this browser has already used a free trial")

// TrialDeviceService owns the device registry.
//
// A separate service rather than a method on `EntitlementService` because the two
// answer different questions on different schedules: entitlements are about what a
// PAID plan allows, this is about whether a FREE offer has been collected.
type TrialDeviceService struct {
	db *gorm.DB
}

// NewTrialDeviceService builds the service.
func NewTrialDeviceService(db *gorm.DB) *TrialDeviceService {
	return &TrialDeviceService{db: db}
}

// TrialClaimResult is the answer for one registration attempt.
type TrialClaimResult struct {
	// Granted is true when this browser claimed the trial.
	Granted bool
	// AlreadyClaimedBy is the email that claimed it, for the operator's log.
	AlreadyClaimedBy string
	// BlockedAttempts is the running count INCLUDING this one.
	BlockedAttempts int
}

// ClaimTrial records that `fingerprint` is taking a trial with `email`, or refuses.
//
// An empty fingerprint returns `Granted: true` without writing anything.
//
//	NOT a bypass: it is the case of a client that sends no fingerprint at all, and
//	the alternative is refusing to give a trial to a caller whose browser choice we
//	cannot see. `localStorage` can be blocked by policy, and a person should not lose
//	the product because of their employer's cookie settings. It is recorded here
//	because the silent case is worth knowing about when reading the registry.
//
// A SECURITY control that refuses on missing input is an availability control
// wearing a security label — it breaks honest users and stops no attacker, because
// an attacker simply sends a value.
func (s *TrialDeviceService) ClaimTrial(
	ctx context.Context,
	fingerprint, email string,
) (*TrialClaimResult, error) {
	if fingerprint == "" {
		return &TrialClaimResult{Granted: true}, nil
	}

	// ---- The claim, done as an INSERT so the uniqueness constraint decides ----
	//
	// Not SELECT-then-INSERT. That sequence has a race: two registrations carrying
	// the same fingerprint both read "not present", both insert, and the unique
	// constraint then kills the second as an opaque error the caller would have to
	// guess at. Letting the INSERT decide turns "who wins" into a database fact.
	claim := &model.TrialDevice{
		DeviceFingerprint: fingerprint,
		ClaimedBy:         email,
		ClaimedAt:         time.Now().UTC(),
	}

	res := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(claim)
	if res.Error != nil {
		return nil, res.Error
	}

	// ---- Did we win? ----
	//
	// `RowsAffected == 1` MEANS THE ROW IS OURS. `RowsAffected == 0` means the
	// conflict clause swallowed a duplicate and somebody else already holds this
	// browser.
	//
	// The first version of this decided by comparing timestamps after re-reading the
	// row - `existing.ClaimedAt.Before(claim.ClaimedAt)` - and it was ALWAYS TRUE,
	// because `claim.ClaimedAt` was stamped at the start of this call and the
	// existing row is necessarily older. So every second email was granted a trial
	// and the cap did nothing at all.
	//
	// That is the exact bug `TestCapRefusesASecondEmailOnTheSameBrowser` exists to
	// catch, and it is why the answer comes from the INSERT's own result rather than
	// from re-reading state and inferring.
	if res.RowsAffected == 1 {
		return &TrialClaimResult{Granted: true}, nil
	}

	// ---- Somebody else holds this browser ----
	var existing model.TrialDevice
	if err := s.db.WithContext(ctx).
		Where("device_fingerprint = ?", fingerprint).
		First(&existing).Error; err != nil {
		return nil, err
	}

	// The SAME email re-claiming its own trial is not a cap violation. `Register`
	// already refuses a duplicate account, so this cannot be used to obtain a second
	// one - and refusing it would mean a user who clears their data loses the trial
	// they legitimately hold.
	if existing.ClaimedBy == email {
		return &TrialClaimResult{Granted: true, AlreadyClaimedBy: existing.ClaimedBy}, nil
	}

	// ---- Refused. Count it, so "a lot" is distinguishable from "once". ----
	now := time.Now().UTC()
	var updated model.TrialDevice
	if err := s.db.WithContext(ctx).
		Model(&model.TrialDevice{}).
		Where("device_fingerprint = ?", fingerprint).
		Updates(map[string]any{
			"blocked_attempts": gorm.Expr("blocked_attempts + 1"),
			"last_blocked_at": now,
		}).
		First(&updated).Error; err != nil {
		return nil, err
	}

	return &TrialClaimResult{
		Granted:         false,
		AlreadyClaimedBy: existing.ClaimedBy,
		BlockedAttempts:  int(updated.BlockedAttempts),
	}, nil
}

// DeviceSummary lists devices that have been refused more than once.
//
// The query an operator actually runs: who is repeatedly taking a trial. One refusal
// is noise; a table of them is a signal.
type DeviceSummary struct {
	Fingerprint     string     `json:"device_fingerprint"`
	ClaimedBy       string     `json:"claimed_by"`
	ClaimedAt       time.Time  `json:"claimed_at"`
	BlockedAttempts int        `json:"blocked_attempts"`
	LastBlockedAt   *time.Time `json:"last_blocked_at,omitempty"`
}

// ListRefusedDevices returns devices with repeated refusals, newest first.
func (s *TrialDeviceService) ListRefusedDevices(ctx context.Context, minBlocked int) ([]DeviceSummary, error) {
	if minBlocked < 1 {
		minBlocked = 1
	}
	var rows []DeviceSummary
	err := s.db.WithContext(ctx).
		Model(&model.TrialDevice{}).
		Select("device_fingerprint, claimed_by, claimed_at, blocked_attempts, last_blocked_at").
		Where("blocked_attempts >= ?", minBlocked).
		Order("blocked_attempts DESC, last_blocked_at DESC NULLS LAST").
		Scan(&rows).Error
	return rows, err
}

// EventDetail renders the refusal for the audit log.
//
// The attempt COUNT is in the message on purpose. The event type alone
// (`TRIAL_BLOCKED_DEVICE`) cannot distinguish a family member from an operation,
// and an operator reading a wall of identical events learns nothing.
func TrialBlockedDetail(fingerprint, claimedBy string, attempts int) string {
	shown := fingerprint
	if len(shown) > 8 {
		shown = shown[:8]
	}
	return fmt.Sprintf(
		"trial refused from this browser (…%s), already claimed by %s — refusal #%d",
		shown, claimedBy, attempts,
	)
}
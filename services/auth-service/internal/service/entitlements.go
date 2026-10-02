package service

// EntitlementService: "what may this user do right now?"
//
// =============================================================================
// THE FOLD IS A MAX, NOT A SUM AND NOT A LOOKUP
// =============================================================================
//
// Effective capability = the MAXIMUM over every live entitlement the user holds.
//
//   MAX   - so "Pro, then downgraded to Starter" works. The user still has both
//           rows; the Pro one runs to the end of the period they paid for, and
//           the fold takes the larger of the two for exactly that long. A
//           "most recent wins" lookup would cut Pro off the day they downgraded,
//           which takes away something they already bought.
//   SUM   - would let a user with five overlapping grants get five times the
//           quota. A downgrade would ADD to their allowance.
//   latest- only - as above, cuts paid-for access early.
//
// Each is a real bug, so the choice is written down rather than left implicit.
//
// =============================================================================
// TRIAL: NOTHING PERSISTED, AND THE REFUSAL IS SERVER-SIDE
// =============================================================================
//
// `save_projects` on the trial is the IN-SESSION allowance (two projects while
// looking at them). What makes a trial save-nothing is that the PERSIST write
// refuses, not that the button is greyed out.
//
// A disabled button is a button someone screenshots and works around. The
// refusal lives here, where the client cannot reach it.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// Entitlement errors.
var (
	// ErrEntitlementMissing - the user holds no live entitlement at all.
	ErrEntitlementMissing = errors.New("no active entitlement")

	// ErrQuotaExceeded - they have a plan, but this thing is past its limit.
	ErrQuotaExceeded = errors.New("plan quota exceeded")

	// ErrQuotaDenied - the plan does not include this capability AT ALL.
	//
	// Distinct from ErrQuotaExceeded on purpose. "Upgrade to get this" and "you
	// have used too many" are different messages, and collapsing them tells a
	// paying customer to upgrade when the real answer is that they finished.
	ErrQuotaDenied = errors.New("capability not in plan")
)

// EntitlementService answers capability questions.
type EntitlementService struct {
	db    *gorm.DB
	plans config.PlansConfig
}

// NewEntitlementService builds the service.
func NewEntitlementService(db *gorm.DB, plans config.PlansConfig) *EntitlementService {
	return &EntitlementService{db: db, plans: plans}
}

// Seed syncs the capability catalogue into `entitlement_grants`.
//
// Called on every boot. It is an UPSERT by (plan_code, capability), which is
// what makes a plan change a restart rather than a migration - and, just as
// importantly, what makes REMOVING a capability work: a grant deleted from
// `.env` disappears here instead of lingering in the table forever, granting
// something the plan no longer sells.
//
// Grants for plans that are no longer configured are removed too. Leaving them
// is how a retired plan quietly keeps granting capabilities to whoever still
// holds it.
func (s *EntitlementService) Seed(ctx context.Context) error {
	wanted := make(map[string]bool)

	for _, plan := range s.plans.Plans {
		for capability, limit := range plan.Grants {
			wanted[plan.Code+"/"+capability] = true

			// A NEGATIVE limit is how the config spells "unlimited", and the table
			// spells it as NULL. Translated once, here, rather than at every read -
			// a conversion that lives in two places is a conversion that will be in
			// two places differently.
			var stored *int64
			if limit >= 0 {
				v := limit
				stored = &v
			}

			var existing model.EntitlementGrant
			err := s.db.WithContext(ctx).
				Where("plan_code = ? AND capability = ?", plan.Code, capability).
				First(&existing).Error

			switch {
			case err == nil:
				if sameLimit(existing.LimitValue, stored) {
					continue
				}
				existing.LimitValue = stored
				if err := s.db.WithContext(ctx).Save(&existing).Error; err != nil {
					return err
				}
			case errors.Is(err, gorm.ErrRecordNotFound):
				g := model.EntitlementGrant{
					PlanCode:   plan.Code,
					Capability: capability,
					LimitValue: stored,
				}
				if err := s.db.WithContext(ctx).Create(&g).Error; err != nil {
					return err
				}
			default:
				return err
			}
		}
	}

	// Drop grants for anything no longer configured. A plan that is retired from
	// the catalogue must stop granting.
	var stale []model.EntitlementGrant
	if err := s.db.WithContext(ctx).Find(&stale).Error; err != nil {
		return err
	}
	for _, g := range stale {
		if wanted[g.PlanCode+"/"+g.Capability] {
			continue
		}
		if err := s.db.WithContext(ctx).Delete(&g).Error; err != nil {
			return err
		}
	}

	return nil
}

// liveEntitlements returns the rows that count RIGHT NOW.
//
// Two rules, and the second one is the subtle one:
//
//  1. `ends_at IS NULL` means forever; `ends_at > now` means still running. A row
//     past its end is simply not returned - expiry needs no job to write anything,
//     which is the same reasoning as the subscriber count.
//
//  2. **CANCELLED ROWS STILL COUNT, UNTIL THEIR PERIOD ENDS.** `cancelled_at` is
//     deliberately NOT filtered here.
//
//     That looks wrong until you read what cancelling means: the user has paid
//     for the rest of the period. Filtering on `cancelled_at IS NULL` revokes
//     access they bought, on the day they cancelled - which is both wrong and the
//     fastest route to a chargeback. It also made a lifetime purchase
//     un-cancellable in practice, since its `ends_at` is NULL and would simply
//     keep granting forever.
//
//     So the fold is driven by `ends_at` alone. A cancellation changes nothing
//     about today; it stops renewal, and the row lapses on its own.
func (s *EntitlementService) liveEntitlements(ctx context.Context, userID uuid.UUID) ([]model.Entitlement, error) {
	now := time.Now().UTC()
	var rows []model.Entitlement
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND (ends_at IS NULL OR ends_at > ?)", userID, now).
		Find(&rows).Error
	return rows, err
}

// EffectivePlanCode is the plan a user is treated as, for display and for
// "what does upgrading from here mean".
//
// Ordered by how generous the plan is, not alphabetically - otherwise "pro" and
// "studio" sort in a way that has nothing to do with their allowances.
func (s *EntitlementService) EffectivePlanCode(ctx context.Context, userID uuid.UUID) (string, error) {
	rows, err := s.liveEntitlements(ctx, userID)
	if err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", ErrEntitlementMissing
	}

	best := ""
	bestScore := int64(-2)
	for _, r := range rows {
		score, ok := s.planGenerosity(r.PlanCode)
		if !ok {
			continue
		}
		if score > bestScore {
			bestScore, best = score, r.PlanCode
		}
	}
	if best == "" {
		return "", ErrEntitlementMissing
	}
	return best, nil
}

// planGenerosity scores a plan so the "most generous" fold is well defined.
//
// Scored on SAVED PROJECTS because that is the capability a person would
// describe first, and because it happens to be ordered the same way across the
// catalogue: unlimited > 250 > 25 > 2 > 0.
func (s *EntitlementService) planGenerosity(code string) (int64, bool) {
	plan, ok := s.plans.Get(code)
	if !ok {
		return 0, false
	}
	if _, has := plan.Grants[config.CapSaveProjects]; !has {
		return 0, false
	}
	v := plan.Grants[config.CapSaveProjects]
	if v == config.Unlimited {
		// Bounded but above every real number, so "unlimited" always wins the
		// fold without needing a separate ordering path.
		return 1 << 40, true
	}
	return v, true
}

// Limit returns the effective limit for a capability.
//
// `config.Unlimited` (negative) means no cap. The second return value is false
// when the user has no live entitlement, which is DIFFERENT from a limit of zero.
//
// Those two must not be conflated: "you have a plan that does not include this"
// and "your plan includes this and you have used it up" are different answers
// for a user, and the error the caller returns differs too.
func (s *EntitlementService) Limit(ctx context.Context, userID uuid.UUID, capability string) (int64, bool, error) {
	rows, err := s.liveEntitlements(ctx, userID)
	if err != nil {
		return 0, false, err
	}
	if len(rows) == 0 {
		return 0, false, ErrEntitlementMissing
	}

	best := int64(0)
	granted := false

	for _, r := range rows {
		plan, ok := s.plans.Get(r.PlanCode)
		if !ok {
			continue
		}
		limit, has := plan.Grants[capability]
		if !has {
			continue
		}
		granted = true

		// MAX fold. `Unlimited` wins outright.
		if limit == config.Unlimited {
			return config.Unlimited, true, nil
		}
		if !granted || limit > best {
			best = limit
		}
	}

	if !granted {
		return 0, false, ErrQuotaDenied
	}

	// A grant of ZERO means "not available on this plan", not "you have used it
	// all up".
	//
	// There is no world in which someone can do zero of a thing, so a 0 grant
	// carries the same information as an absent one - and reporting it as
	// `ErrQuotaDenied` rather than `ErrQuotaExceeded` is what makes the two
	// errors mean different things to a user. Otherwise a trial user is told
	// "you have hit your campaign limit, upgrade" when the truth is "campaigns
	// are not in your plan", and a paying customer is told to upgrade when they
	// have simply finished.
	if best == 0 {
		return 0, false, ErrQuotaDenied
	}

	return best, true, nil
}

// Can reports whether a capability is permitted, with no counting.
//
// The cheapest question, for when you only need yes/no.
func (s *EntitlementService) Can(ctx context.Context, userID uuid.UUID, capability string) (bool, error) {
	limit, granted, err := s.Limit(ctx, userID, capability)
	if err != nil {
		if errors.Is(err, ErrQuotaDenied) || errors.Is(err, ErrEntitlementMissing) {
			return false, nil
		}
		return false, err
	}
	_ = limit
	return granted, nil
}

// CheckUsage is the real quota check: does `current` leave room for `adding`?
//
// Compares rather than counting inside the same call, because the caller
// usually counted a moment ago and a re-count here would race with whatever is
// being created.
//
// `Unlimited` never fails.
func (s *EntitlementService) CheckUsage(ctx context.Context, userID uuid.UUID, capability string, current, adding int64) error {
	limit, granted, err := s.Limit(ctx, userID, capability)
	if err != nil {
		return err
	}
	if !granted {
		return fmt.Errorf("%w: %s", ErrQuotaDenied, capability)
	}
	if limit == config.Unlimited {
		return nil
	}
	if current+adding > limit {
		return fmt.Errorf("%w: %s allows %d, you have %d", ErrQuotaExceeded, capability, limit, current)
	}
	return nil
}

// Grant appends an entitlement row, PINNED to the buying identity and device.
//
// APPEND, not upsert. The history is the point, and the unique index on
// (user_id, plan_code) is there to stop a double webhook creating two of the
// same thing - which would double-count nothing but WOULD make "revoke one"
// ambiguous.
//
// A plan already held is treated as a no-op rather than an error: a retried
// webhook is normal traffic, not a bug.
//
// -----------------------------------------------------------------------------
// THE PIN, AND WHY IT IS TAKEN HERE AND NOW
// -----------------------------------------------------------------------------
//
// `email` and `fingerprint` are the moment of sale. That is the only moment
// they mean anything: a week later the same laptop could be a different person.
//
// Neither is optional for a plan that can be resold, and both are recorded as
// they are rather than being validated - a purchase record is a fact, not a
// preference.
func (s *EntitlementService) Grant(
	ctx context.Context,
	userID uuid.UUID,
	planCode, source string,
	endsAt *time.Time,
	periodStart, periodEnd *time.Time,
	email, fingerprint string,
) (*model.Entitlement, error) {
	if _, ok := s.plans.Get(planCode); !ok {
		return nil, fmt.Errorf("unknown plan %q", planCode)
	}

	// The purchase moment, recorded once. A device with no fingerprint is a
	// client that did not send one, and that is a real state: the plan works, but
	// its origin device is unrecorded, and the audit trail will show that.
	boundAt := nowUTC()
	_ = boundAt

	var existing model.Entitlement
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND plan_code = ?", userID, planCode).
		First(&existing).Error
	if err == nil {
		// Already held. Refresh the dates, which is what a renewal is, and
		// un-suspend it: a user who resubscribes should get their access back.
		//
		// The PIN is deliberately NOT touched here. It is already set, and
		// touching it would be refused by the database trigger anyway - which is
		// the point of having the trigger rather than only this check.
		existing.EndsAt = endsAt
		existing.CurrentPeriodStart = periodStart
		existing.CurrentPeriodEnd = periodEnd
		existing.CancelledAt = nil
		if err := s.db.WithContext(ctx).Save(&existing).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	e := &model.Entitlement{
		ID:                 uuid.New(),
		UserID:             userID,
		PlanCode:           planCode,
		Source:             source,
		StartsAt:           nowUTC(),
		EndsAt:             endsAt,
		CurrentPeriodStart: periodStart,
		CurrentPeriodEnd:   periodEnd,

		// ---- The pin, taken at the moment of sale ----
		BoundEmail:             pinOrNil(email),
		BoundDeviceFingerprint: pinOrNil(fingerprint),
		BoundDeviceAt:          &boundAt,
		// Explicitly false even though the column defaults to it. This row is
		// being written by code that means it, and a reader should not have to
		// check whether the default applies.
		IsTransferable: false,
	}
	if err := s.db.WithContext(ctx).Create(e).Error; err != nil {
		return nil, err
	}
	return e, nil
}

// pinOrNil turns an empty string into a nil pointer.
//
// A pointer, not an empty string, because "bound to nobody" and "bound to the
// empty address" have to be different states - and a downstream equality check
// against `""` would otherwise silently treat one as the other.
func pinOrNil(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	trimmed := strings.TrimSpace(v)
	return &trimmed
}

// Cancel marks an entitlement cancelled WITHOUT revoking access.
//
// cancelled_at is not ends_at, and the difference is the whole reason this does
// not take a date. A user who cancels has paid for the rest of the period;
// revoking now takes away something they bought, which is both wrong and the
// fastest route to a chargeback. Access ends on its own when ends_at passes.
func (s *EntitlementService) Cancel(ctx context.Context, userID uuid.UUID, planCode string) error {
	res := s.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("user_id = ? AND plan_code = ? AND cancelled_at IS NULL", userID, planCode).
		Update("cancelled_at", nowUTC())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("no live entitlement for plan %q", planCode)
	}
	return nil
}

// List returns every entitlement a user holds, live and expired.
//
// The history is visible on purpose - "what was I on, and when did it end" is a
// real question, and a table that only shows the present cannot answer it.
func (s *EntitlementService) List(ctx context.Context, userID uuid.UUID) ([]model.Entitlement, error) {
	var rows []model.Entitlement
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&rows).Error
	return rows, err
}

func nowUTC() time.Time { return time.Now().UTC() }

// sameLimit compares two nullable limits.
//
// Pointer comparison would compare ADDRESSES, so `sameLimit(nil, nil)` would be
// false and every boot would rewrite every unlimited grant - a write storm
// proportional to the size of the catalogue, for no change.
func sameLimit(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

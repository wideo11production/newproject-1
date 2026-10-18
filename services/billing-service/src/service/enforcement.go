package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

var (
	ErrViolationAlreadySuspended = errors.New("channel already suspended")
	ErrPenaltyAlreadyApplied     = errors.New("penalty already applied")
)

// ComplianceEnforcementEngine - AURA student/content policy enforcement loop.
//
// Hinglish: ye engine compliance violations ko handle karta hai:
//
//   Step 1 (pehli violation): warning system log + notification (system_logs me entry)
//   Step 2 (doosri violation): channel SUSPENDED, wallet withdrawal freeze,
//                               25% pricing penalty fine
//
// 25% penalty = plan price * 25 / 100, minor units (decimal, float nahi).
//
// Enforcement flow:
//   1. auth-service compliance gate detects non-educational upload from
//      student tier channel → calls POST /compliance/violation
//   2. Engine records violation, checks previous violations for this user
//   3. If first violation → Step 1 warning (system log, warning_sent=true)
//   4. If second+ violation → Step 2: suspend channel, freeze wallet, 25% penalty
//
// Channel suspension aur wallet freeze billing-service me record hote hain.
// auth-service aur wallet-service inhe check karte hain apne level pe.
type ComplianceEnforcementEngine struct {
	violationRepo repository.ComplianceViolationRepository
	systemLogRepo repository.SystemLogRepository
	subRepo       repository.SubscriptionRepository
	planRepo      repository.SubscriptionPlanRepository
}

// NewComplianceEnforcementEngine creates the enforcement engine.
func NewComplianceEnforcementEngine(
	violationRepo repository.ComplianceViolationRepository,
	systemLogRepo repository.SystemLogRepository,
	subRepo repository.SubscriptionRepository,
	planRepo repository.SubscriptionPlanRepository,
) *ComplianceEnforcementEngine {
	return &ComplianceEnforcementEngine{
		violationRepo: violationRepo,
		systemLogRepo: systemLogRepo,
		subRepo:       subRepo,
		planRepo:      planRepo,
	}
}

// RecordViolation records a compliance violation and enforces the appropriate step.
//
// Returns the violation record and the enforcement step taken ("warning" or "suspension").
//
// Hinglish: ye function violation record karta hai aur decide karta hai ki
// warning dena hai ya suspend karna hai. Agar user ki pehli violation hai
// to warning (Step 1). Agar pehle se warning ho to suspension + penalty (Step 2).
func (e *ComplianceEnforcementEngine) RecordViolation(
	ctx context.Context,
	userID uint,
	channelID *uuid.UUID,
	violationType string,
	details string,
) (*model.ComplianceViolation, string, error) {
	// Check if user already has a warning or suspension.
	existing, err := e.violationRepo.GetByUserID(ctx, userID)
	if err != nil && !errors.Is(err, repository.ErrComplianceViolationNotFound) {
		return nil, "", err
	}

	// Count existing warnings for this user.
	warningCount, _ := e.violationRepo.CountByUserIDAndStatus(ctx, userID, model.ViolationStatusWarning)
	suspendedCount, _ := e.violationRepo.CountByUserIDAndStatus(ctx, userID, model.ViolationStatusSuspended)

	now := time.Now().UTC()
	violation := &model.ComplianceViolation{
		UserID:        userID,
		ChannelID:     channelID,
		ViolationType: violationType,
		Status:        model.ViolationStatusWarning,
		Details:       details,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	enforcementStep := "warning"

	// Step 2: if user already has a warning, escalate to suspension + penalty.
	if warningCount >= 1 || suspendedCount >= 1 {
		if existing != nil && existing.Status == model.ViolationStatusSuspended {
			return existing, "already_suspended", nil
		}
		enforcementStep = "suspension"
		violation.Status = model.ViolationStatusSuspended
		violation.SuspendedAt = &now
		violation.WalletFrozen = true
		violation.WalletFrozenAt = &now

		// Calculate 25% penalty from user's current plan.
		penalty, perr := e.calculatePenalty(ctx, userID)
		if perr == nil {
			violation.PenaltyAmount = penalty
		}
	}

	if err := e.violationRepo.Create(ctx, violation); err != nil {
		return nil, "", err
	}

	// Step 1: Send warning system log.
	if enforcementStep == "warning" {
		if serr := e.sendWarningLog(ctx, userID, channelID, violationType, details); serr != nil {
			// Log failure doesn't block the violation record.
			_ = serr
		}
		violation.WarningSent = true
		violation.WarningSentAt = &now
		_ = e.violationRepo.UpdateStatus(ctx, violation.ID, model.ViolationStatusWarning, map[string]any{
			"warning_sent":    true,
			"warning_sent_at": now,
		})
	}

	// Step 2: Send suspension notice system log.
	if enforcementStep == "suspension" {
		if serr := e.sendSuspensionLog(ctx, userID, channelID, violation.PenaltyAmount); serr != nil {
			_ = serr
		}
	}

	return violation, enforcementStep, nil
}

// calculatePenalty computes 25% of the user's current plan price.
func (e *ComplianceEnforcementEngine) calculatePenalty(ctx context.Context, userID uint) (decimal.Decimal, error) {
	sub, err := e.subRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return decimal.Decimal{}, ErrNoActiveSubscription
		}
		return decimal.Decimal{}, err
	}
	if sub == nil {
		return decimal.Decimal{}, ErrNoActiveSubscription
	}
	plan, err := e.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return decimal.Decimal{}, err
	}
	return CalculateStudentRevocationPenalty(plan), nil
}

// sendWarningLog creates a system log entry for the Step 1 warning.
//
// Template: compliance_warning_v1
// Hinglish: "Aapke channel par non-educational content upload ki koshish ki gayi.
// Ye pehla warning hai. Agli violation par channel suspend kar diya jayega
// aur 25% penalty lagenge."
func (e *ComplianceEnforcementEngine) sendWarningLog(
	ctx context.Context,
	userID uint,
	channelID *uuid.UUID,
	violationType string,
	details string,
) error {
	message := fmt.Sprintf(
		"Compliance warning: user %d committed %s violation. %s",
		userID, violationType, details,
	)
	log := &model.SystemLog{
		UserID:    userID,
		LogType:   model.LogTypeComplianceWarning,
		Message:   message,
		Template:  "compliance_warning_v1",
		ChannelID: channelID,
		CreatedAt: time.Now().UTC(),
	}
	return e.systemLogRepo.Create(ctx, log)
}

// sendSuspensionLog creates a system log entry for the Step 2 suspension.
//
// Template: suspension_notice_v1
// Hinglish: "Aapka channel suspend kar diya gaya hai because of repeat
// compliance violations. 25% penalty apply hua hai. Wallet withdrawals freeze ho gaye hain."
func (e *ComplianceEnforcementEngine) sendSuspensionLog(
	ctx context.Context,
	userID uint,
	channelID *uuid.UUID,
	penaltyAmount decimal.Decimal,
) error {
	message := fmt.Sprintf(
		"Suspension notice: user %d channel suspended for repeat compliance violations. "+
			"25%% penalty applied: %s. Wallet withdrawals frozen.",
		userID, penaltyAmount.String(),
	)
	log := &model.SystemLog{
		UserID:    userID,
		LogType:   model.LogTypeSuspensionNotice,
		Message:   message,
		Template:  "suspension_notice_v1",
		ChannelID: channelID,
		CreatedAt: time.Now().UTC(),
	}
	return e.systemLogRepo.Create(ctx, log)
}

// ResolveViolation marks a violation as resolved (penalty paid, channel restored).
func (e *ComplianceEnforcementEngine) ResolveViolation(ctx context.Context, violationID uint) error {
	return e.violationRepo.UpdateStatus(ctx, violationID, model.ViolationStatusResolved, map[string]any{})
}

// GetViolationsForUser returns all compliance violations for a user.
func (e *ComplianceEnforcementEngine) GetViolationsForUser(ctx context.Context, userID uint) ([]*model.ComplianceViolation, error) {
	return e.violationRepo.ListByUserID(ctx, userID)
}

// IsUserFrozen returns true if the user has an active wallet freeze.
func (e *ComplianceEnforcementEngine) IsUserFrozen(ctx context.Context, userID uint) (bool, error) {
	v, err := e.violationRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrComplianceViolationNotFound) {
			return false, nil
		}
		return false, err
	}
	return v.WalletFrozen && v.Status == model.ViolationStatusSuspended, nil
}

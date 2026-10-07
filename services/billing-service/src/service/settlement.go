// Revenue settlement engine — ad revenue → wallet credits.
//
// YEH MODULE ad revenue ka REALIZATION step hai:
//   1. Ad revenue aata hai (device guard ya campaign se).
//   2. Split apply karta hai: viewer 60%, platform 20%, creator 10-20%.
//   3. 5% sister share NET (post-GST) revenue se nikalta hai.
//   4. Wallet credit karta hai via WalletCredit interface
//      (cross-module: separate Go module, isliye interface use karta hai).
//
// Hinglish: ye engine actual paisa transfer nahi karta — uske
// liye `WalletCredit` interface ka implementation (HTTP client to
// wallet-service) use hoga, jo main.go wire karega. Engine khud
// sirf LOGIC + ledger record karta hai.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// Wallet credit interface (cross-module safe)
// ---------------------------------------------------------------------------

// WalletCreditService — wallet-service ke Credit method ka interface.
//
// Hinglish: billing-service wallet-service ke module ko directly
// import nahi karta (circular dependency risk). Is interface ko
// main.go implement karega (HTTP client). Tests mein fake lagta hai.
type WalletCreditService interface {
	// Credit adds funds to a user's wallet. Returns transaction reference.
	Credit(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (txRef string, err error)
}

// ---------------------------------------------------------------------------
// Settlement record (audit trail)
// ---------------------------------------------------------------------------

// SettlementStatus — settlement ka state.
type SettlementStatus string

const (
	SettlementPending  SettlementStatus = "pending"
	SettlementPartial  SettlementStatus = "partial"
	SettlementComplete SettlementStatus = "complete"
	SettlementFailed   SettlementStatus = "failed"
)

// RevenueSettlement — ek ad revenue event ka settlement record.
//
// Hinglish: ye ledger table hai — kya revenue kitni banti thi,
// kis ko kitna mila, aur kya status hai. Audit + retry ke liye.
type RevenueSettlement struct {
	ID          uint           `json:"id"`
	UUID        uuid.UUID      `json:"uuid"`
	// Source ad event ka identifier.
	EventID     string         `json:"event_id"`
	GrossAmount decimal.Decimal `json:"gross_amount"`
	Currency    string         `json:"currency"`
	// CountryCode — GST calculation ke liye (IN = 18% GST).
	CountryCode string         `json:"country_code"`
	CustomerState string       `json:"customer_state"` // GST state code for viewer
	BusinessState string       `json:"business_state"` // GST config state code
	// Split amounts (post-GST, pre-sister-share).
	ViewerAmount   decimal.Decimal `json:"viewer_amount"`
	CreatorAmount  decimal.Decimal `json:"creator_amount"`
	PlatformAmount decimal.Decimal `json:"platform_amount"`
	// GST amounts.
	GstTotal       decimal.Decimal `json:"gst_total"`
	CgstAmount     decimal.Decimal `json:"cgst_amount"`
	SgstAmount     decimal.Decimal `json:"sgst_amount"`
	IgstAmount     decimal.Decimal `json:"igst_amount"`
	// Sister share (5% of NET revenue).
	SisterShareAmount decimal.Decimal `json:"sister_share_amount"`
	// After sister share — what actually lands in wallets.
	NetToWallets decimal.Decimal `json:"net_to_wallets"`
	// Settlement details.
	Status       SettlementStatus `json:"status"`
	FailureReason string           `json:"failure_reason,omitempty"`
	CompletedAt  *time.Time       `json:"completed_at,omitempty"`
	CreatedAt    time.Time        `json:"created_at"`
	UpdatedAt    time.Time        `json:"updated_at"`
}

// RevenueSettlementRepository — settlement records ka storage.
type RevenueSettlementRepository interface {
	Create(ctx context.Context, s *RevenueSettlement) error
	GetByEventID(ctx context.Context, eventID string) (*RevenueSettlement, error)
	UpdateStatus(ctx context.Context, id uint, status SettlementStatus, reason string) error
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settlement engine
// ---------------------------------------------------------------------------

// SettlementConfig — business config for settlement.
type SettlementConfig struct {
	// BusinessStateCode — for GST intrastate/interstate split.
	BusinessStateCode string
	// BusinessStateName — invoice display.
	BusinessStateName string
	// SisterSharePercent — 5 (user directive, always).
	SisterSharePercent decimal.Decimal
}

// DefaultSettlementConfig — safe defaults (user directive values).
func DefaultSettlementConfig() SettlementConfig {
	return SettlementConfig{
		BusinessStateCode:  "27",                                       // Maharashtra
		BusinessStateName:  "Maharashtra",
		SisterSharePercent: decimal.NewFromInt(5),                       // 5% always
	}
}

// RevenueSettlementEngine — ad revenue → wallet credits.
//
// Hinglish: ye engine 3 cheez karta hai:
// 1. GST calculate karta hai (india = 18%, foreign = 0%)
// 2. 5% sister share NET revenue se nikalta hai
// 3. Split amounts (viewer/creator/platform) wallet me credit karta hai
//
// Money conservation: Gross = GST + SisterShare + Viewer + Creator + Platform
// (rounding differences sirf GSTMismatchReason me note hote hain).
type RevenueSettlementEngine struct {
	wallet WalletCreditService
	gst    *GstConfig
	repo   RevenueSettlementRepository
}

// NewRevenueSettlementEngine builds the settlement engine.
func NewRevenueSettlementEngine(wallet WalletCreditService, repo RevenueSettlementRepository, config SettlementConfig) *RevenueSettlementEngine {
	return &RevenueSettlementEngine{
		wallet: wallet,
		gst: &GstConfig{
			BusinessStateCode:  config.BusinessStateCode,
			BusinessStateName:  config.BusinessStateName,
		},
		repo: repo,
	}
}

// SettlementInput — ek ad revenue event.
type SettlementInput struct {
	EventID       string
	GrossAmount   decimal.Decimal
	Currency      string
	CountryCode   string    // "IN" for India, "US" for US, etc.
	ViewerUserID  uint
	CreatorUserID uint
	CreatorSubscribed bool     // Q3.2: subscribed creator = 20%, free = 0% (nothing)
	ViewerStateCode string     // GST state code of viewer (for intrastate/interstate)
}

// SettlementResult — settlement completion outcome.
type SettlementResult struct {
	Settlement    *RevenueSettlement
	ViewerCredit  decimal.Decimal
	CreatorCredit decimal.Decimal
	PlatformCredit decimal.Decimal
	// ConservationCheck: true agar gross = sum of all parts.
	ConservationOK bool
	ConservationError string
}

// SettleAdRevenue ek ad revenue event ko settle karta hai.
//
// Flow:
//  1. GST calculate (india = 18% IGST or CGST+SGST).
//  2. Net revenue = gross - GST.
//  3. Sister share = 5% of net revenue.
//  4. After sister share = net - sister.
//  5. Ad split (CalculateRevenueSplit) on AFTER-SISTER amount.
//  6. Credit wallets: viewer, creator, platform.
//
// Hinglish: GST pehle nikalta hai kyunki ye platform ka expense hai.
// Phir 5% sister share NET se. Phir bache huye amount ko 3-tareeko
// me baantte hain (viewer/creator/platform).
func (e *RevenueSettlementEngine) SettleAdRevenue(ctx context.Context, in SettlementInput) (*SettlementResult, error) {

	// 1. Create settlement record (pending).
	settlement := &RevenueSettlement{
		UUID:            uuid.New(),
		EventID:         in.EventID,
		GrossAmount:     money(in.GrossAmount),
		Currency:        in.Currency,
		CountryCode:     strings.ToUpper(strings.TrimSpace(in.CountryCode)),
		CustomerState:   in.ViewerStateCode,
		BusinessState:   e.gst.BusinessStateCode,
		Status:          SettlementPending,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if e.repo != nil {
		if err := e.repo.Create(ctx, settlement); err != nil {
			return nil, fmt.Errorf("settlement record create failed: %w", err)
		}
	}

	// 2. GST calculation.
	gstBreakdown := e.gst.CalculateGstForItem(settlement.GrossAmount, in.ViewerStateCode, in.CountryCode)
	settlement.GstTotal = gstBreakdown.TotalGst
	settlement.CgstAmount = gstBreakdown.Cgst
	settlement.SgstAmount = gstBreakdown.Sgst
	settlement.IgstAmount = gstBreakdown.Igst

	// 3. Net revenue = gross - GST.
	netRevenue := money(settlement.GrossAmount.Sub(settlement.GstTotal))
	settlement.NetToWallets = netRevenue

	// 4. Sister share (5% of net).
	sisterShare := money(netRevenue.Mul(decimal.NewFromInt(5)).Div(decimal.NewFromInt(100)))
	settlement.SisterShareAmount = sisterShare

	// 5. Ad split on (net - sister).
	afterSister := money(netRevenue.Sub(sisterShare))
	split := CalculateRevenueSplit(afterSister, in.CreatorSubscribed)

	settlement.ViewerAmount = split.Viewer
	settlement.CreatorAmount = split.Creator
	settlement.PlatformAmount = split.Platform

	// 6. Conservation check: gross should equal GST + sister + viewer + creator + platform.
	expectedTotal := money(
		settlement.GstTotal.
			Add(settlement.SisterShareAmount).
			Add(settlement.ViewerAmount).
			Add(settlement.CreatorAmount).
			Add(settlement.PlatformAmount),
	)

	result := &SettlementResult{
		Settlement:       settlement,
		ViewerCredit:     settlement.ViewerAmount,
		CreatorCredit:    settlement.CreatorAmount,
		PlatformCredit:   settlement.PlatformAmount,
	}

	conservationOK := expectedTotal.Equal(settlement.GrossAmount)
	result.ConservationOK = conservationOK
	if !conservationOK {
		delta := money(settlement.GrossAmount.Sub(expectedTotal))
		result.ConservationError = fmt.Sprintf(
			"conservation violation: expected total %s, got %s, delta %s",
			settlement.GrossAmount.String(), expectedTotal.String(), delta.String(),
		)
	}

	// 7. Credit wallets.
	// Note: platform wallet is internal — credited separately via ledger trigger.
	// Viewer + creator get real wallet credits.
	settlement.CompletedAt = &time.Time{}
	*settlement.CompletedAt = time.Now()

	if e.wallet != nil {
		// Credit viewer.
		if settlement.ViewerAmount.GreaterThan(decimal.Zero) {
			txRef, err := e.wallet.Credit(ctx, in.ViewerUserID, in.Currency,
				settlement.ViewerAmount, "ad_revenue", in.EventID,
				fmt.Sprintf("Ad revenue share (₹%s gross, viewer)", settlement.GrossAmount.String()))
			if err != nil {
				settlement.Status = SettlementFailed
				settlement.FailureReason = fmt.Sprintf("viewer wallet credit failed: %v", err)
				settlement.UpdatedAt = time.Now()
				if e.repo != nil {
					_ = e.repo.UpdateStatus(ctx, settlement.ID, SettlementFailed, settlement.FailureReason)
				}
				return result, fmt.Errorf("viewer credit failed: %w", err)
			}
			_ = txRef // tx ref stored in wallet's own transaction log
		}

		// Credit creator.
		if settlement.CreatorAmount.GreaterThan(decimal.Zero) {
			_, err := e.wallet.Credit(ctx, in.CreatorUserID, in.Currency,
				settlement.CreatorAmount, "ad_revenue", in.EventID,
				fmt.Sprintf("Ad revenue share (₹%s gross, creator %s)",
					settlement.GrossAmount.String(),
					creatorSubLabel(in.CreatorSubscribed)))
			if err != nil {
				settlement.Status = SettlementFailed
				settlement.FailureReason = fmt.Sprintf("creator wallet credit failed: %v", err)
				settlement.UpdatedAt = time.Now()
				if e.repo != nil {
					_ = e.repo.UpdateStatus(ctx, settlement.ID, SettlementFailed, settlement.FailureReason)
				}
				return result, fmt.Errorf("creator credit failed: %w", err)
			}
		}
	}

	settlement.Status = SettlementComplete
	settlement.UpdatedAt = time.Now()
	if e.repo != nil {
		if err := e.repo.UpdateStatus(ctx, settlement.ID, SettlementComplete, ""); err != nil {
			// Record created but status update failed — still return result,
			// but note the issue. This is best-effort logging.
			result.ConservationError = fmt.Sprintf("settlement complete but status update failed: %v", err)
		}
	}

	return result, nil
}

// creatorSubLabel returns human-readable creator subscription status.
func creatorSubLabel(subscribed bool) string {
	if subscribed {
		return "subscribed"
	}
	return "free"
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sister share allocation (standalone, for ledger service)
// ---------------------------------------------------------------------------

// AllocateSisterShare — standalone 5% sister share calculator.
//
// Hinglish: ye function GST engine ke saath use hota hai lekin
// alag bhi kaam karta hai — ledger-service ke liye jiske paas
// actual balances hain. 5% always (user directive: "hamesha lagta rahe").
func AllocateSisterShare(netRevenue decimal.Decimal) decimal.Decimal {
	return money(netRevenue.Mul(decimal.NewFromInt(5)).Div(decimal.NewFromInt(100)))
}

// AllocateWithBuffer — applies ₹2000 maintenance buffer mask + 5% sister share.
//
// User directive (Q1.1): nominee ke balance mein ₹2000 buffer HIDDEN hota hai.
// Sirf excess (above buffer) transferable. Sister share buffer se
// pehle ya baad — dono alag hain (business_laws_test.go TestBufferAndSisterShareAreIndependent).
func AllocateWithBuffer(totalBalance decimal.Decimal) (transferable, buffer, sisterShare decimal.Decimal) {
	buffer = decimal.NewFromInt(2000) // ₹2000 maintenance buffer (user directive)
	if totalBalance.LessThan(buffer) {
		transferable = decimal.Zero
	} else {
		transferable = money(totalBalance.Sub(buffer))
	}
	sisterShare = AllocateSisterShare(totalBalance) // 5% of TOTAL (not excess)
	return transferable, buffer, sisterShare
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error definitions
// ---------------------------------------------------------------------------

var (
	ErrInvalidSettlementInput = errors.New("invalid settlement input")
	ErrNoActiveAllocation     = errors.New("no_active_settlement_allocation")
)

// ValidateSettlementInput — pre-condition check before settlement.
func ValidateSettlementInput(in SettlementInput) error {
	if in.EventID == "" {
		return fmt.Errorf("%w: event_id is required", ErrInvalidSettlementInput)
	}
	if in.GrossAmount.LessThanOrEqual(decimal.Zero) {
		return fmt.Errorf("%w: gross amount must be positive", ErrInvalidSettlementInput)
	}
	if in.Currency == "" {
		return fmt.Errorf("%w: currency is required", ErrInvalidSettlementInput)
	}
	if in.ViewerUserID == 0 || in.CreatorUserID == 0 {
		return fmt.Errorf("%w: viewer and creator user IDs are required", ErrInvalidSettlementInput)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helper: format string for logging
// ---------------------------------------------------------------------------

func (r *SettlementResult) Summary() string {
	return fmt.Sprintf("Settlement %s: gross=₹%s, viewer=₹%s, creator=₹%s, platform=₹%s, sister=₹%s, gst=₹%s, conserved=%v",
		r.Settlement.EventID,
		r.Settlement.GrossAmount.String(),
		r.ViewerCredit.String(),
		r.CreatorCredit.String(),
		r.PlatformCredit.String(),
		r.Settlement.SisterShareAmount.String(),
		r.Settlement.GstTotal.String(),
		r.ConservationOK,
	)
}

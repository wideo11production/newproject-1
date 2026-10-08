package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/ledger-service/src/model"
	"newproject/services/ledger-service/src/repository"
)

type SisterProfileService struct {
	profileRepo    repository.SisterProfileRepository
	shareLedgerRepo repository.SisterShareLedgerRepository
}

func NewSisterProfileService(
	profileRepo repository.SisterProfileRepository,
	shareLedgerRepo repository.SisterShareLedgerRepository,
) *SisterProfileService {
	return &SisterProfileService{
		profileRepo:     profileRepo,
		shareLedgerRepo: shareLedgerRepo,
	}
}

// CreateOrGetSisterProfile — sister master profile create ya get karta hai.
// Hinglish: ek baar create ho gaya to phir update nahi hota (immutable).
func (s *SisterProfileService) CreateOrGetSisterProfile(ctx context.Context, walletUserID uint, name string) (*model.SisterMasterProfile, error) {
	existing, err := s.profileRepo.GetByWalletUserID(ctx, walletUserID)
	if err == nil {
		return existing, nil
	}

	// Create new sister master profile
	profile := &model.SisterMasterProfile{
		UUID:           uuid.New(),
		Name:           name,
		Relationship:   "sister",
		WalletUserID:   walletUserID,
		CurrentBalance: decimal.Zero,
		TotalReceived:  decimal.Zero,
		TotalWithdrawn: decimal.Zero,
		BufferExempt:   true,
		DirectWithdraw: true,
		Status:         model.SisterProfileActive,
	}

	if err := s.profileRepo.Create(ctx, profile); err != nil {
		return nil, fmt.Errorf("sister profile create failed: %w", err)
	}

	return profile, nil
}

// AllocateSisterShare — 5% sister share allocate karta hai settlement se.
// Hinglish: har settlement ke baad 5% net revenue sister ke balance mein jaata hai.
// Direct credit, no buffer check (bufferExempt = true).
func (s *SisterProfileService) AllocateSisterShare(ctx context.Context, settlementRef string, grossRevenue, gstAmount, netRevenue decimal.Decimal) (*model.SisterShareLedger, error) {
	// 5% sister share (hardcoded invariant)
	sisterSharePct := decimal.NewFromFloat(5.00)
	sisterShareAmount := netRevenue.Mul(sisterSharePct).Div(decimal.NewFromFloat(100.00))

	// Create ledger record
	ledger := &model.SisterShareLedger{
		UUID:               uuid.New(),
		SettlementRef:      settlementRef,
		GrossRevenue:       grossRevenue,
		GSTAmount:          gstAmount,
		NetRevenue:         netRevenue,
		SisterSharePct:     sisterSharePct,
		SisterShareAmount:  sisterShareAmount,
		Currency:           "INR",
		BufferApplied:      false,
		DirectCredit:       true,
	}

	if err := s.shareLedgerRepo.Create(ctx, ledger); err != nil {
		return nil, fmt.Errorf("sister share ledger create failed: %w", err)
	}

	// Credit sister's master profile directly (buffer-free)
	if err := s.profileRepo.Credit(ctx, 1, sisterShareAmount); err != nil {
		// Log error but don't fail the settlement
		// In production, this would trigger a reconciliation job
		fmt.Printf("sister profile credit failed: %v\n", err)
	}

	return ledger, nil
}

// GetSisterProfileBalance — sister ka current balance return karta hai.
func (s *SisterProfileService) GetSisterProfileBalance(ctx context.Context, walletUserID uint) (decimal.Decimal, error) {
	return s.profileRepo.GetBalance(ctx, walletUserID)
}

// GetSisterProfile — sister master profile details.
func (s *SisterProfileService) GetSisterProfile(ctx context.Context, walletUserID uint) (*model.SisterMasterProfile, error) {
	return s.profileRepo.GetByWalletUserID(ctx, walletUserID)
}

// WithdrawSisterFunds — sister direct withdrawal (no buffer check).
// Hinglish: sister ₹2,000 maintenance buffer bypass karti hai.
func (s *SisterProfileService) WithdrawSisterFunds(ctx context.Context, walletUserID uint, amount decimal.Decimal) error {
	// Direct debit - buffer exempt
	return s.profileRepo.Debit(ctx, walletUserID, amount)
}
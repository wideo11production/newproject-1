package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/withdrawal-service/src/model"
	"newproject/services/withdrawal-service/src/repository"
)

type WithdrawalService struct {
	kycRepo          repository.KYRepository
	withdrawalRepo   repository.WithdrawalRepository
	bankRepo         repository.BankAccountRepository
	configRepo       repository.ConfigRepository
	approvalRepo     repository.ApprovalRuleRepository
	limitRepo        repository.WithdrawalLimitRepository
}

func NewWithdrawalService(
	kycRepo repository.KYRepository,
	withdrawalRepo repository.WithdrawalRepository,
	bankRepo repository.BankAccountRepository,
	configRepo repository.ConfigRepository,
	approvalRepo repository.ApprovalRuleRepository,
	limitRepo repository.WithdrawalLimitRepository,
) *WithdrawalService {
	return &WithdrawalService{
		kycRepo:        kycRepo,
		withdrawalRepo: withdrawalRepo,
		bankRepo:       bankRepo,
		configRepo:     configRepo,
		approvalRepo:   approvalRepo,
		limitRepo:      limitRepo,
	}
}

func (s *WithdrawalService) SubmitKYC(ctx context.Context, userID uint, docType model.KYCDocumentType, docNumber, docImage string) (*model.KYC, error) {
	existing, err := s.kycRepo.GetByUserID(ctx, userID)
	if err == nil {
		existing.DocumentType = docType
		existing.DocumentNumber = docNumber
		existing.DocumentImage = docImage
		existing.Status = model.KYCStatusPending
		existing.VerifiedBy = nil
		existing.VerifiedAt = nil
		existing.RejectionReason = ""
		if err := s.kycRepo.Update(ctx, existing); err != nil {
			return nil, err
		}
		return existing, nil
	}
	if err != repository.ErrKYCNotFound {
		return nil, err
	}

	kyc := &model.KYC{
		UUID:         uuid.New(),
		UserID:       userID,
		DocumentType: docType,
		DocumentNumber: docNumber,
		DocumentImage: docImage,
		Status:       model.KYCStatusPending,
	}
	if err := s.kycRepo.Create(ctx, kyc); err != nil {
		return nil, err
	}
	return kyc, nil
}

func (s *WithdrawalService) VerifyKYC(ctx context.Context, kycID uint, verifiedBy uint, approved bool, reason string) (*model.KYC, error) {
	kyc, err := s.kycRepo.GetByID(ctx, kycID)
	if err != nil {
		return nil, err
	}

	if approved {
		kyc.Status = model.KYCStatusVerified
		kyc.VerifiedBy = &verifiedBy
		now := time.Now()
		kyc.VerifiedAt = &now
	} else {
		kyc.Status = model.KYCStatusRejected
		kyc.RejectionReason = reason
	}

	if err := s.kycRepo.Update(ctx, kyc); err != nil {
		return nil, err
	}
	return kyc, nil
}

func (s *WithdrawalService) GetKYC(ctx context.Context, userID uint) (*model.KYC, error) {
	return s.kycRepo.GetByUserID(ctx, userID)
}

func (s *WithdrawalService) GetConfig(ctx context.Context) (*model.WithdrawalConfig, error) {
	cfg, err := s.configRepo.GetLatest(ctx)
	if err != nil {
		if err == repository.ErrConfigNotFound {
			cfg = &model.WithdrawalConfig{
				UUID:        uuid.New(),
				MinAmount:   decimal.NewFromInt(10),
				MaxAmount:   decimal.NewFromInt(100000),
				FeeRate:     decimal.NewFromFloat(0.02),
				MinFee:      decimal.NewFromInt(1),
				MaxFee:      decimal.NewFromInt(100),
				ProcessingTime: "2-3 business days",
				KYCThreshold: decimal.NewFromInt(1000),
				DailyLimit:  decimal.NewFromInt(50000),
				WeeklyLimit: decimal.NewFromInt(200000),
				IsKYCRequired: true,
			}
			if err := s.configRepo.Create(ctx, cfg); err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}
	return cfg, nil
}

func (s *WithdrawalService) AddBankAccount(ctx context.Context, ba *model.BankAccount) error {
	ba.UUID = uuid.New()
	ba.Verified = false
	if ba.IsDefault {
		existing, err := s.bankRepo.GetDefault(ctx, ba.UserID)
		if err == nil {
			existing.IsDefault = false
			if err := s.bankRepo.Update(ctx, existing); err != nil {
				return err
			}
		}
	}
	return s.bankRepo.Create(ctx, ba)
}

func (s *WithdrawalService) GetBankAccounts(ctx context.Context, userID uint) ([]*model.BankAccount, error) {
	return s.bankRepo.GetByUserID(ctx, userID)
}

func (s *WithdrawalService) GetDefaultBankAccount(ctx context.Context, userID uint) (*model.BankAccount, error) {
	return s.bankRepo.GetDefault(ctx, userID)
}

func (s *WithdrawalService) UpdateBankAccount(ctx context.Context, ba *model.BankAccount) error {
	return s.bankRepo.Update(ctx, ba)
}

func (s *WithdrawalService) DeleteBankAccount(ctx context.Context, id uint) error {
	return s.bankRepo.Delete(ctx, id)
}

func (s *WithdrawalService) SetDefaultBankAccount(ctx context.Context, userID uint, id uint) error {
	return s.bankRepo.SetDefault(ctx, userID, id)
}

func (s *WithdrawalService) CalculateFee(amount, feeRate, minFee, maxFee decimal.Decimal) decimal.Decimal {
	fee := amount.Mul(feeRate)
	if fee.LessThan(minFee) {
		fee = minFee
	}
	if fee.GreaterThan(maxFee) {
		fee = maxFee
	}
	return fee
}

func (s *WithdrawalService) CheckLimits(ctx context.Context, userID uint, amount decimal.Decimal) error {
	cfg, err := s.GetConfig(ctx)
	if err != nil {
		return err
	}

	if amount.LessThan(cfg.MinAmount) {
		return errors.New("amount below minimum withdrawal")
	}
	if amount.GreaterThan(cfg.MaxAmount) {
		return errors.New("amount above maximum withdrawal")
	}

	now := time.Now().UTC()

	dailyLimit, err := s.limitRepo.GetByUserID(ctx, userID, "daily")
	if err == repository.ErrLimitNotFound || dailyLimit == nil {
		dailyLimit = &model.WithdrawalLimit{
			UserID:     userID,
			Type:       "daily",
			Limit:      cfg.DailyLimit,
			Used:       decimal.Zero,
			PeriodStart: now.Add(-24 * time.Hour),
			PeriodEnd:   now,
		}
		if err := s.limitRepo.Create(ctx, dailyLimit); err != nil {
			return err
		}
	}

	if dailyLimit.Used.Add(amount).GreaterThan(dailyLimit.Limit) {
		return repository.ErrLimitExceeded
	}

	weeklyLimit, err := s.limitRepo.GetByUserID(ctx, userID, "weekly")
	if err == repository.ErrLimitNotFound || weeklyLimit == nil {
		weeklyLimit = &model.WithdrawalLimit{
			UserID:     userID,
			Type:       "weekly",
			Limit:      cfg.WeeklyLimit,
			Used:       decimal.Zero,
			PeriodStart: now.Add(-7 * 24 * time.Hour),
			PeriodEnd:   now,
		}
		if err := s.limitRepo.Create(ctx, weeklyLimit); err != nil {
			return err
		}
	}

	if weeklyLimit.Used.Add(amount).GreaterThan(weeklyLimit.Limit) {
		return repository.ErrLimitExceeded
	}

	return nil
}

func (s *WithdrawalService) RequestWithdrawal(ctx context.Context, userID uint, walletID uint, amount string, paymentMethod string, bankAccountID *uint, upiID string) (*model.WithdrawalRequest, error) {
	amt, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, errors.New("invalid amount")
	}

	if amt.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	cfg, err := s.GetConfig(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.CheckLimits(ctx, userID, amt); err != nil {
		return nil, err
	}

	if cfg.IsKYCRequired && amt.GreaterThan(cfg.KYCThreshold) {
		kyc, err := s.kycRepo.GetByUserID(ctx, userID)
		if err != nil {
			return nil, repository.ErrKYCPending
		}
		if kyc.Status != model.KYCStatusVerified {
			return nil, repository.ErrKYCRejected
		}
	}

	if paymentMethod == "upi" && upiID == "" {
		return nil, errors.New("UPI ID required for UPI withdrawal")
	}
	if paymentMethod == "bank" && bankAccountID == nil {
		ba, err := s.bankRepo.GetDefault(ctx, userID)
		if err != nil {
			return nil, errors.New("no default bank account found")
		}
		bankAccountID = &ba.ID
	}

	fee := s.CalculateFee(amt, cfg.FeeRate, cfg.MinFee, cfg.MaxFee)
	netAmount := amt.Sub(fee)

	rule, err := s.approvalRepo.GetByAmount(ctx, amount)
	if err != nil && err != repository.ErrApprovalRuleNotFound {
		return nil, err
	}

	approvalLevel := 0
	if rule != nil {
		approvalLevel = rule.Level
	}

	provider := model.BankProviderManual
	if paymentMethod == "upi" {
		provider = model.BankProviderRazorpay
	}

	withdrawal := &model.WithdrawalRequest{
		UUID:          uuid.New(),
		UserID:        userID,
		WalletID:      walletID,
		Amount:        amt,
		Fee:           fee,
		NetAmount:     netAmount,
		Currency:      "INR",
		Status:        model.WStatusPendingReview,
		PaymentMethod: paymentMethod,
		BankAccountID: bankAccountID,
		UpiID:         upiID,
		Provider:      provider,
		KYCRequired:   cfg.IsKYCRequired && amt.GreaterThan(cfg.KYCThreshold),
		ApprovalLevel: approvalLevel,
	}

	if err := s.withdrawalRepo.Create(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) GetWithdrawal(ctx context.Context, id uint) (*model.WithdrawalRequest, error) {
	return s.withdrawalRepo.GetByID(ctx, id)
}

func (s *WithdrawalService) GetWithdrawalByUUID(ctx context.Context, uuid string) (*model.WithdrawalRequest, error) {
	return s.withdrawalRepo.GetByUUID(ctx, uuid)
}

func (s *WithdrawalService) ListWithdrawals(ctx context.Context, userID uint, limit, offset int) ([]*model.WithdrawalRequest, error) {
	return s.withdrawalRepo.GetByUserID(ctx, userID, limit, offset)
}

func (s *WithdrawalService) ListWithdrawalsByStatus(ctx context.Context, status model.WithdrawalStatus, limit, offset int) ([]*model.WithdrawalRequest, error) {
	return s.withdrawalRepo.GetByStatus(ctx, status, limit, offset)
}

func (s *WithdrawalService) ApproveWithdrawal(ctx context.Context, withdrawalID uint, approvedBy uint) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	if withdrawal.Status != model.WStatusPendingReview {
		return nil, errors.New("withdrawal is not pending review")
	}

	now := time.Now()
	withdrawal.Status = model.WStatusApproved
	withdrawal.ApprovedBy = &approvedBy
	withdrawal.ApprovedAt = &now

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) RejectWithdrawal(ctx context.Context, withdrawalID uint, approvedBy uint, reason string) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	if withdrawal.Status != model.WStatusPendingReview {
		return nil, errors.New("withdrawal is not pending review")
	}

	now := time.Now()
	withdrawal.Status = model.WStatusRejected
	withdrawal.ApprovedBy = &approvedBy
	withdrawal.ApprovedAt = &now
	withdrawal.RejectionReason = reason

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) ProcessWithdrawal(ctx context.Context, withdrawalID uint, processedBy uint) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	if withdrawal.Status != model.WStatusApproved {
		return nil, errors.New("withdrawal is not approved")
	}

	withdrawal.Status = model.WStatusProcessing
	withdrawal.ProcessedBy = &processedBy
	now := time.Now()
	withdrawal.ProcessedAt = &now

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) CompleteWithdrawal(ctx context.Context, withdrawalID uint, providerRef string) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	if withdrawal.Status != model.WStatusProcessing {
		return nil, errors.New("withdrawal is not processing")
	}

	now := time.Now()
	withdrawal.Status = model.WStatusCompleted
	withdrawal.CompletedAt = &now
	withdrawal.ProviderRef = providerRef

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) FailWithdrawal(ctx context.Context, withdrawalID uint, reason string) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	withdrawal.Status = model.WStatusFailed
	withdrawal.CompletedAt = &now
	withdrawal.Notes = reason

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) CancelWithdrawal(ctx context.Context, withdrawalID uint, reason string) (*model.WithdrawalRequest, error) {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return nil, err
	}

	if withdrawal.Status != model.WStatusPendingReview && withdrawal.Status != model.WStatusApproved {
		return nil, errors.New("withdrawal cannot be cancelled in current status")
	}

	now := time.Now()
	withdrawal.Status = model.WStatusCancelled
	withdrawal.CompletedAt = &now
	withdrawal.Notes = reason

	if err := s.withdrawalRepo.Update(ctx, withdrawal); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WithdrawalService) CreateApprovalRule(ctx context.Context, level int, minAmount, maxAmount string, role string, isAuto bool) (*model.ApprovalRule, error) {
	minAmt, err := decimal.NewFromString(minAmount)
	if err != nil {
		return nil, errors.New("invalid min_amount")
	}
	maxAmt, err := decimal.NewFromString(maxAmount)
	if err != nil {
		return nil, errors.New("invalid max_amount")
	}

	rule := &model.ApprovalRule{
		UUID:      uuid.New(),
		Level:     level,
		MinAmount: minAmt,
		MaxAmount: maxAmt,
		Role:      role,
		IsAuto:    isAuto,
	}
	if err := s.approvalRepo.Create(ctx, rule); err != nil {
		return nil, err
	}
	return rule, nil
}

func (s *WithdrawalService) GetApprovalRules(ctx context.Context) ([]*model.ApprovalRule, error) {
	return s.approvalRepo.List(ctx)
}

func (s *WithdrawalService) UpdateConfig(ctx context.Context, minAmount, maxAmount, feeRate, minFee, maxFee, kycThreshold, dailyLimit, weeklyLimit string, kycRequired bool) (*model.WithdrawalConfig, error) {
	cfg, err := s.GetConfig(ctx)
	if err != nil {
		return nil, err
	}

	cfg.MinAmount, _ = decimal.NewFromString(minAmount)
	cfg.MaxAmount, _ = decimal.NewFromString(maxAmount)
	cfg.FeeRate, _ = decimal.NewFromString(feeRate)
	cfg.MinFee, _ = decimal.NewFromString(minFee)
	cfg.MaxFee, _ = decimal.NewFromString(maxFee)
	cfg.KYCThreshold, _ = decimal.NewFromString(kycThreshold)
	cfg.DailyLimit, _ = decimal.NewFromString(dailyLimit)
	cfg.WeeklyLimit, _ = decimal.NewFromString(weeklyLimit)
	cfg.IsKYCRequired = kycRequired

	if err := s.configRepo.Update(ctx, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

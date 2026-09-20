package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/wallet-service/src/model"
	"newproject/services/wallet-service/src/repository"
)

type WalletService struct {
	walletRepo     repository.WalletRepository
	txnRepo        repository.TransactionRepository
	withdrawalRepo repository.WithdrawalRepository
	bankRepo       repository.BankAccountRepository
}

func NewWalletService(
	walletRepo repository.WalletRepository,
	txnRepo repository.TransactionRepository,
	withdrawalRepo repository.WithdrawalRepository,
	bankRepo repository.BankAccountRepository,
) *WalletService {
	return &WalletService{
		walletRepo:     walletRepo,
		txnRepo:        txnRepo,
		withdrawalRepo: withdrawalRepo,
		bankRepo:       bankRepo,
	}
}

func (s *WalletService) GetOrCreateWallet(ctx context.Context, userID uint, currency string) (*model.Wallet, error) {
	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		if err == repository.ErrWalletNotFound {
			wallet = &model.Wallet{
				UUID:      uuid.New(),
				UserID:    userID,
				Currency:  currency,
				Available: decimal.Zero,
				Pending:   decimal.Zero,
				Held:      decimal.Zero,
				Withdrawable: decimal.Zero,
			}
			if err := s.walletRepo.Create(ctx, wallet); err != nil {
				return nil, err
			}
			return wallet, nil
		}
		return nil, err
	}
	return wallet, nil
}

func (s *WalletService) GetWallet(ctx context.Context, userID uint, currency string) (*model.Wallet, error) {
	return s.walletRepo.GetByUserID(ctx, userID, currency)
}

func (s *WalletService) GetWalletByID(ctx context.Context, id uint) (*model.Wallet, error) {
	return s.walletRepo.GetByID(ctx, id)
}

func (s *WalletService) Credit(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (*model.Transaction, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	wallet, err := s.GetOrCreateWallet(ctx, userID, currency)
	if err != nil {
		return nil, err
	}

	balanceBefore := wallet.Available
	balanceAfter := balanceBefore.Add(amount)

	txn := &model.Transaction{
		UUID:          uuid.New(),
		WalletID:      wallet.ID,
		UserID:        userID,
		Type:          model.TxnTypeCredit,
		Status:        model.TxnStatusCompleted,
		Amount:        amount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		ReferenceType: refType,
		ReferenceID:   refID,
		Description:   description,
		CompletedAt:   timePtr(time.Now()),
	}

	if err := s.txnRepo.Create(ctx, txn); err != nil {
		return nil, err
	}

	wallet.Available = balanceAfter
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return nil, err
	}

	return txn, nil
}

func (s *WalletService) Debit(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (*model.Transaction, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		return nil, err
	}

	if wallet.Available.LessThan(amount) {
		return nil, repository.ErrInsufficientFunds
	}

	balanceBefore := wallet.Available
	balanceAfter := balanceBefore.Sub(amount)

	txn := &model.Transaction{
		UUID:          uuid.New(),
		WalletID:      wallet.ID,
		UserID:        userID,
		Type:          model.TxnTypeDebit,
		Status:        model.TxnStatusCompleted,
		Amount:        amount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		ReferenceType: refType,
		ReferenceID:   refID,
		Description:   description,
		CompletedAt:   timePtr(time.Now()),
	}

	if err := s.txnRepo.Create(ctx, txn); err != nil {
		return nil, err
	}

	wallet.Available = balanceAfter
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return nil, err
	}

	return txn, nil
}

func (s *WalletService) Hold(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (*model.Transaction, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		return nil, err
	}

	if wallet.Available.LessThan(amount) {
		return nil, repository.ErrInsufficientFunds
	}

	balanceBefore := wallet.Available
	balanceAfter := balanceBefore.Sub(amount)
	heldAfter := wallet.Held.Add(amount)

	txn := &model.Transaction{
		UUID:          uuid.New(),
		WalletID:      wallet.ID,
		UserID:        userID,
		Type:          model.TxnTypeHold,
		Status:        model.TxnStatusCompleted,
		Amount:        amount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		ReferenceType: refType,
		ReferenceID:   refID,
		Description:   description,
		CompletedAt:   timePtr(time.Now()),
	}

	if err := s.txnRepo.Create(ctx, txn); err != nil {
		return nil, err
	}

	wallet.Available = balanceAfter
	wallet.Held = heldAfter
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return nil, err
	}

	return txn, nil
}

func (s *WalletService) ReleaseHold(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (*model.Transaction, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		return nil, err
	}

	if wallet.Held.LessThan(amount) {
		return nil, errors.New("insufficient held balance")
	}

	heldBefore := wallet.Held
	heldAfter := heldBefore.Sub(amount)
	availableAfter := wallet.Available.Add(amount)

	txn := &model.Transaction{
		UUID:          uuid.New(),
		WalletID:      wallet.ID,
		UserID:        userID,
		Type:          model.TxnTypeRelease,
		Status:        model.TxnStatusCompleted,
		Amount:        amount,
		BalanceBefore: heldBefore,
		BalanceAfter:  heldAfter,
		ReferenceType: refType,
		ReferenceID:   refID,
		Description:   description,
		CompletedAt:   timePtr(time.Now()),
	}

	if err := s.txnRepo.Create(ctx, txn); err != nil {
		return nil, err
	}

	wallet.Held = heldAfter
	wallet.Available = availableAfter
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return nil, err
	}

	return txn, nil
}

func (s *WalletService) GetTransactions(ctx context.Context, userID uint, currency string, limit, offset int) ([]*model.Transaction, error) {
	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		return nil, err
	}
	return s.txnRepo.GetByWalletID(ctx, wallet.ID, limit, offset)
}

func (s *WalletService) GetTransaction(ctx context.Context, id uint) (*model.Transaction, error) {
	return s.txnRepo.GetByID(ctx, id)
}

func (s *WalletService) RequestWithdrawal(ctx context.Context, userID uint, currency string, amount decimal.Decimal, bankAccountID *uint, upiID string) (*model.Withdrawal, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("amount must be positive")
	}

	wallet, err := s.walletRepo.GetByUserID(ctx, userID, currency)
	if err != nil {
		return nil, err
	}

	if wallet.Withdrawable.LessThan(amount) {
		return nil, repository.ErrInsufficientFunds
	}

	var bankAccount *model.BankAccount
	if bankAccountID != nil {
		bankAccount, err = s.bankRepo.GetByID(ctx, *bankAccountID)
		if err != nil {
			return nil, err
		}
		if bankAccount.UserID != userID {
			return nil, errors.New("bank account does not belong to user")
		}
	} else if upiID != "" {
		// UPI withdrawal
	} else {
		// Try default bank account
		bankAccount, err = s.bankRepo.GetDefault(ctx, userID)
		if err != nil && err != repository.ErrBankAccountNotFound {
			return nil, err
		}
		if err == nil && bankAccount != nil {
			bankAccountID = &bankAccount.ID
		} else if bankAccountID == nil && upiID == "" {
			return nil, errors.New("no bank account or UPI ID provided")
		}
	}

	fee := amount.Mul(decimal.NewFromFloat(0.02)) // 2% fee
	if fee.LessThan(decimal.NewFromInt(1)) {
		fee = decimal.NewFromInt(1) // minimum 1 INR fee
	}
	if fee.GreaterThan(decimal.NewFromInt(100)) {
		fee = decimal.NewFromInt(100) // maximum 100 INR fee
	}

	netAmount := amount.Sub(fee)

	withdrawal := &model.Withdrawal{
		UUID:        uuid.New(),
		WalletID:    wallet.ID,
		UserID:      userID,
		Amount:      amount,
		Fee:         fee,
		NetAmount:   netAmount,
		Status:      model.WithdrawalStatusPending,
		BankAccountID: bankAccountID,
		UpiID:       upiID,
	}

	if err := s.withdrawalRepo.Create(ctx, withdrawal); err != nil {
		return nil, err
	}

	// Hold the amount
	wallet.Withdrawable = wallet.Withdrawable.Sub(amount)
	wallet.Held = wallet.Held.Add(amount)
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return nil, err
	}

	return withdrawal, nil
}

func (s *WalletService) GetWithdrawals(ctx context.Context, userID uint, limit, offset int) ([]*model.Withdrawal, error) {
	return s.withdrawalRepo.GetByUserID(ctx, userID, limit, offset)
}

func (s *WalletService) GetWithdrawal(ctx context.Context, id uint) (*model.Withdrawal, error) {
	return s.withdrawalRepo.GetByID(ctx, id)
}

func (s *WalletService) ApproveWithdrawal(ctx context.Context, withdrawalID uint, processorID uint) error {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return err
	}

	if withdrawal.Status != model.WithdrawalStatusPending {
		return errors.New("withdrawal not in pending status")
	}

	wallet, err := s.walletRepo.GetByID(ctx, withdrawal.WalletID)
	if err != nil {
		return err
	}

	// Move from held to completed (already held)
	wallet.Held = wallet.Held.Sub(withdrawal.Amount)
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return err
	}

	withdrawal.Status = model.WithdrawalStatusApproved
	withdrawal.ProcessedBy = &processorID
	now := time.Now()
	withdrawal.CompletedAt = &now
	return s.withdrawalRepo.Update(ctx, withdrawal)
}

func (s *WalletService) RejectWithdrawal(ctx context.Context, withdrawalID uint, processorID uint, reason string) error {
	withdrawal, err := s.withdrawalRepo.GetByID(ctx, withdrawalID)
	if err != nil {
		return err
	}

	if withdrawal.Status != model.WithdrawalStatusPending {
		return errors.New("withdrawal not in pending status")
	}

	wallet, err := s.walletRepo.GetByID(ctx, withdrawal.WalletID)
	if err != nil {
		return err
	}

	// Release hold back to available/withdrawable
	wallet.Held = wallet.Held.Sub(withdrawal.Amount)
	wallet.Withdrawable = wallet.Withdrawable.Add(withdrawal.Amount)
	if err := s.walletRepo.Update(ctx, wallet); err != nil {
		return err
	}

	withdrawal.Status = model.WithdrawalStatusRejected
	withdrawal.ProcessedBy = &processorID
	withdrawal.RejectionReason = reason
	return s.withdrawalRepo.Update(ctx, withdrawal)
}

func (s *WalletService) AddBankAccount(ctx context.Context, ba *model.BankAccount) error {
	ba.UUID = uuid.New()
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

func (s *WalletService) GetBankAccounts(ctx context.Context, userID uint) ([]*model.BankAccount, error) {
	return s.bankRepo.GetByUserID(ctx, userID)
}

func (s *WalletService) GetDefaultBankAccount(ctx context.Context, userID uint) (*model.BankAccount, error) {
	return s.bankRepo.GetDefault(ctx, userID)
}

func (s *WalletService) UpdateBankAccount(ctx context.Context, ba *model.BankAccount) error {
	return s.bankRepo.Update(ctx, ba)
}

func (s *WalletService) DeleteBankAccount(ctx context.Context, id uint) error {
	return s.bankRepo.Delete(ctx, id)
}

func (s *WalletService) SetDefaultBankAccount(ctx context.Context, userID uint, id uint) error {
	return s.bankRepo.SetDefault(ctx, userID, id)
}

func timePtr(t time.Time) *time.Time {
	return &t
}
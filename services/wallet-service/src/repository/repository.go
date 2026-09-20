package repository

import (
	"context"
	"errors"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/wallet-service/src/model"
)

var (
	ErrWalletNotFound    = errors.New("wallet not found")
	ErrInsufficientFunds = errors.New("insufficient funds")
	ErrWithdrawalNotFound = errors.New("withdrawal not found")
	ErrBankAccountNotFound = errors.New("bank account not found")
)

type WalletRepository interface {
	Create(ctx context.Context, wallet *model.Wallet) error
	GetByID(ctx context.Context, id uint) (*model.Wallet, error)
	GetByUserID(ctx context.Context, userID uint, currency string) (*model.Wallet, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Wallet, error)
	Update(ctx context.Context, wallet *model.Wallet) error
	UpdateBalances(ctx context.Context, id uint, available, pending, held, withdrawable decimal.Decimal) error
}

type TransactionRepository interface {
	Create(ctx context.Context, txn *model.Transaction) error
	GetByID(ctx context.Context, id uint) (*model.Transaction, error)
	GetByWalletID(ctx context.Context, walletID uint, limit, offset int) ([]*model.Transaction, error)
	GetByReference(ctx context.Context, refType, refID string) (*model.Transaction, error)
	Update(ctx context.Context, txn *model.Transaction) error
	ListPending(ctx context.Context, limit int) ([]*model.Transaction, error)
}

type WithdrawalRepository interface {
	Create(ctx context.Context, w *model.Withdrawal) error
	GetByID(ctx context.Context, id uint) (*model.Withdrawal, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Withdrawal, error)
	GetByWalletID(ctx context.Context, walletID uint, limit, offset int) ([]*model.Withdrawal, error)
	GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.Withdrawal, error)
	GetPending(ctx context.Context, limit int) ([]*model.Withdrawal, error)
	Update(ctx context.Context, w *model.Withdrawal) error
}

type BankAccountRepository interface {
	Create(ctx context.Context, ba *model.BankAccount) error
	GetByID(ctx context.Context, id uint) (*model.BankAccount, error)
	GetByUserID(ctx context.Context, userID uint) ([]*model.BankAccount, error)
	GetDefault(ctx context.Context, userID uint) (*model.BankAccount, error)
	Update(ctx context.Context, ba *model.BankAccount) error
	Delete(ctx context.Context, id uint) error
	SetDefault(ctx context.Context, userID uint, id uint) error
}

type walletRepository struct {
	db *gorm.DB
}

func NewWalletRepository(db *gorm.DB) WalletRepository {
	return &walletRepository{db: db}
}

func (r *walletRepository) Create(ctx context.Context, wallet *model.Wallet) error {
	return r.db.WithContext(ctx).Create(wallet).Error
}

func (r *walletRepository) GetByID(ctx context.Context, id uint) (*model.Wallet, error) {
	var wallet model.Wallet
	err := r.db.WithContext(ctx).First(&wallet, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWalletNotFound
		}
		return nil, err
	}
	return &wallet, nil
}

func (r *walletRepository) GetByUserID(ctx context.Context, userID uint, currency string) (*model.Wallet, error) {
	var wallet model.Wallet
	err := r.db.WithContext(ctx).Where("user_id = ? AND currency = ?", userID, currency).First(&wallet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWalletNotFound
		}
		return nil, err
	}
	return &wallet, nil
}

func (r *walletRepository) GetByUUID(ctx context.Context, uuid string) (*model.Wallet, error) {
	var wallet model.Wallet
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&wallet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWalletNotFound
		}
		return nil, err
	}
	return &wallet, nil
}

func (r *walletRepository) Update(ctx context.Context, wallet *model.Wallet) error {
	return r.db.WithContext(ctx).Save(wallet).Error
}

func (r *walletRepository) UpdateBalances(ctx context.Context, id uint, available, pending, held, withdrawable decimal.Decimal) error {
	return r.db.WithContext(ctx).Model(&model.Wallet{}).Where("id = ?", id).Updates(map[string]interface{}{
		"available":   available,
		"pending":     pending,
		"held":        held,
		"withdrawable": withdrawable,
		"updated_at":  time.Now(),
	}).Error
}

type transactionRepository struct {
	db *gorm.DB
}

func NewTransactionRepository(db *gorm.DB) TransactionRepository {
	return &transactionRepository{db: db}
}

func (r *transactionRepository) Create(ctx context.Context, txn *model.Transaction) error {
	return r.db.WithContext(ctx).Create(txn).Error
}

func (r *transactionRepository) GetByID(ctx context.Context, id uint) (*model.Transaction, error) {
	var txn model.Transaction
	err := r.db.WithContext(ctx).First(&txn, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("transaction not found")
		}
		return nil, err
	}
	return &txn, nil
}

func (r *transactionRepository) GetByWalletID(ctx context.Context, walletID uint, limit, offset int) ([]*model.Transaction, error) {
	var txns []*model.Transaction
	err := r.db.WithContext(ctx).Where("wallet_id = ?", walletID).Order("created_at desc").Limit(limit).Offset(offset).Find(&txns).Error
	return txns, err
}

func (r *transactionRepository) GetByReference(ctx context.Context, refType, refID string) (*model.Transaction, error) {
	var txn model.Transaction
	err := r.db.WithContext(ctx).Where("reference_type = ? AND reference_id = ?", refType, refID).First(&txn).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("transaction not found")
		}
		return nil, err
	}
	return &txn, nil
}

func (r *transactionRepository) Update(ctx context.Context, txn *model.Transaction) error {
	return r.db.WithContext(ctx).Save(txn).Error
}

func (r *transactionRepository) ListPending(ctx context.Context, limit int) ([]*model.Transaction, error) {
	var txns []*model.Transaction
	err := r.db.WithContext(ctx).Where("status = ?", model.TxnStatusPending).Order("created_at asc").Limit(limit).Find(&txns).Error
	return txns, err
}

type withdrawalRepository struct {
	db *gorm.DB
}

func NewWithdrawalRepository(db *gorm.DB) WithdrawalRepository {
	return &withdrawalRepository{db: db}
}

func (r *withdrawalRepository) Create(ctx context.Context, w *model.Withdrawal) error {
	return r.db.WithContext(ctx).Create(w).Error
}

func (r *withdrawalRepository) GetByID(ctx context.Context, id uint) (*model.Withdrawal, error) {
	var w model.Withdrawal
	err := r.db.WithContext(ctx).First(&w, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWithdrawalNotFound
		}
		return nil, err
	}
	return &w, nil
}

func (r *withdrawalRepository) GetByUUID(ctx context.Context, uuid string) (*model.Withdrawal, error) {
	var w model.Withdrawal
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&w).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWithdrawalNotFound
		}
		return nil, err
	}
	return &w, nil
}

func (r *withdrawalRepository) GetByWalletID(ctx context.Context, walletID uint, limit, offset int) ([]*model.Withdrawal, error) {
	var withdrawals []*model.Withdrawal
	err := r.db.WithContext(ctx).Where("wallet_id = ?", walletID).Order("created_at desc").Limit(limit).Offset(offset).Find(&withdrawals).Error
	return withdrawals, err
}

func (r *withdrawalRepository) GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.Withdrawal, error) {
	var withdrawals []*model.Withdrawal
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at desc").Limit(limit).Offset(offset).Find(&withdrawals).Error
	return withdrawals, err
}

func (r *withdrawalRepository) GetPending(ctx context.Context, limit int) ([]*model.Withdrawal, error) {
	var withdrawals []*model.Withdrawal
	err := r.db.WithContext(ctx).Where("status = ?", model.WithdrawalStatusPending).Order("created_at asc").Limit(limit).Find(&withdrawals).Error
	return withdrawals, err
}

func (r *withdrawalRepository) Update(ctx context.Context, w *model.Withdrawal) error {
	return r.db.WithContext(ctx).Save(w).Error
}

type bankAccountRepository struct {
	db *gorm.DB
}

func NewBankAccountRepository(db *gorm.DB) BankAccountRepository {
	return &bankAccountRepository{db: db}
}

func (r *bankAccountRepository) Create(ctx context.Context, ba *model.BankAccount) error {
	return r.db.WithContext(ctx).Create(ba).Error
}

func (r *bankAccountRepository) GetByID(ctx context.Context, id uint) (*model.BankAccount, error) {
	var ba model.BankAccount
	err := r.db.WithContext(ctx).First(&ba, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBankAccountNotFound
		}
		return nil, err
	}
	return &ba, nil
}

func (r *bankAccountRepository) GetByUserID(ctx context.Context, userID uint) ([]*model.BankAccount, error) {
	var accounts []*model.BankAccount
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&accounts).Error
	return accounts, err
}

func (r *bankAccountRepository) GetDefault(ctx context.Context, userID uint) (*model.BankAccount, error) {
	var ba model.BankAccount
	err := r.db.WithContext(ctx).Where("user_id = ? AND is_default = ?", userID, true).First(&ba).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBankAccountNotFound
		}
		return nil, err
	}
	return &ba, nil
}

func (r *bankAccountRepository) Update(ctx context.Context, ba *model.BankAccount) error {
	return r.db.WithContext(ctx).Save(ba).Error
}

func (r *bankAccountRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.BankAccount{}, id).Error
}

func (r *bankAccountRepository) SetDefault(ctx context.Context, userID uint, id uint) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.BankAccount{}).Where("user_id = ?", userID).Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&model.BankAccount{}).Where("id = ?", id).Update("is_default", true).Error
	})
}
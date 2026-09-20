package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/withdrawal-service/src/model"
)

var (
	ErrKYCNotFound            = errors.New("kyc not found")
	ErrWithdrawalNotFound     = errors.New("withdrawal not found")
	ErrBankAccountNotFound    = errors.New("bank account not found")
	ErrConfigNotFound         = errors.New("config not found")
	ErrApprovalRuleNotFound   = errors.New("approval rule not found")
	ErrLimitNotFound          = errors.New("withdrawal limit not found")
	ErrKYCPending             = errors.New("kyc verification pending")
	ErrKYCRejected            = errors.New("kyc rejected")
	ErrLimitExceeded          = errors.New("withdrawal limit exceeded")
)

type KYRepository interface {
	Create(ctx context.Context, kyc *model.KYC) error
	GetByID(ctx context.Context, id uint) (*model.KYC, error)
	GetByUserID(ctx context.Context, userID uint) (*model.KYC, error)
	GetByUUID(ctx context.Context, uuid string) (*model.KYC, error)
	Update(ctx context.Context, kyc *model.KYC) error
}

type WithdrawalRepository interface {
	Create(ctx context.Context, w *model.WithdrawalRequest) error
	GetByID(ctx context.Context, id uint) (*model.WithdrawalRequest, error)
	GetByUUID(ctx context.Context, uuid string) (*model.WithdrawalRequest, error)
	GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.WithdrawalRequest, error)
	GetByStatus(ctx context.Context, status model.WithdrawalStatus, limit, offset int) ([]*model.WithdrawalRequest, error)
	Update(ctx context.Context, w *model.WithdrawalRequest) error
}

type BankAccountRepository interface {
	Create(ctx context.Context, ba *model.BankAccount) error
	GetByID(ctx context.Context, id uint) (*model.BankAccount, error)
	GetByUserID(ctx context.Context, userID uint) ([]*model.BankAccount, error)
	GetDefault(ctx context.Context, userID uint) (*model.BankAccount, error)
	GetByUUID(ctx context.Context, uuid string) (*model.BankAccount, error)
	Update(ctx context.Context, ba *model.BankAccount) error
	Delete(ctx context.Context, id uint) error
	SetDefault(ctx context.Context, userID uint, id uint) error
}

type ConfigRepository interface {
	Create(ctx context.Context, cfg *model.WithdrawalConfig) error
	GetByID(ctx context.Context, id uint) (*model.WithdrawalConfig, error)
	GetLatest(ctx context.Context) (*model.WithdrawalConfig, error)
	Update(ctx context.Context, cfg *model.WithdrawalConfig) error
}

type ApprovalRuleRepository interface {
	Create(ctx context.Context, rule *model.ApprovalRule) error
	GetByID(ctx context.Context, id uint) (*model.ApprovalRule, error)
	GetByLevel(ctx context.Context, level int) (*model.ApprovalRule, error)
	GetByAmount(ctx context.Context, amount interface{}) (*model.ApprovalRule, error)
	List(ctx context.Context) ([]*model.ApprovalRule, error)
	Update(ctx context.Context, rule *model.ApprovalRule) error
}

type WithdrawalLimitRepository interface {
	Create(ctx context.Context, limit *model.WithdrawalLimit) error
	GetByUserID(ctx context.Context, userID uint, limitType string) (*model.WithdrawalLimit, error)
	Update(ctx context.Context, limit *model.WithdrawalLimit) error
	GetByID(ctx context.Context, id uint) (*model.WithdrawalLimit, error)
}

type kycRepository struct {
	db *gorm.DB
}

func NewKYRepository(db *gorm.DB) KYRepository {
	return &kycRepository{db: db}
}

func (r *kycRepository) Create(ctx context.Context, kyc *model.KYC) error {
	return r.db.WithContext(ctx).Create(kyc).Error
}

func (r *kycRepository) GetByID(ctx context.Context, id uint) (*model.KYC, error) {
	var kyc model.KYC
	err := r.db.WithContext(ctx).First(&kyc, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrKYCNotFound
		}
		return nil, err
	}
	return &kyc, nil
}

func (r *kycRepository) GetByUserID(ctx context.Context, userID uint) (*model.KYC, error) {
	var kyc model.KYC
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&kyc).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrKYCNotFound
		}
		return nil, err
	}
	return &kyc, nil
}

func (r *kycRepository) GetByUUID(ctx context.Context, uuid string) (*model.KYC, error) {
	var kyc model.KYC
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&kyc).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrKYCNotFound
		}
		return nil, err
	}
	return &kyc, nil
}

func (r *kycRepository) Update(ctx context.Context, kyc *model.KYC) error {
	return r.db.WithContext(ctx).Save(kyc).Error
}

type withdrawalRepository struct {
	db *gorm.DB
}

func NewWithdrawalRepository(db *gorm.DB) WithdrawalRepository {
	return &withdrawalRepository{db: db}
}

func (r *withdrawalRepository) Create(ctx context.Context, w *model.WithdrawalRequest) error {
	return r.db.WithContext(ctx).Create(w).Error
}

func (r *withdrawalRepository) GetByID(ctx context.Context, id uint) (*model.WithdrawalRequest, error) {
	var w model.WithdrawalRequest
	err := r.db.WithContext(ctx).First(&w, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWithdrawalNotFound
		}
		return nil, err
	}
	return &w, nil
}

func (r *withdrawalRepository) GetByUUID(ctx context.Context, uuid string) (*model.WithdrawalRequest, error) {
	var w model.WithdrawalRequest
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&w).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWithdrawalNotFound
		}
		return nil, err
	}
	return &w, nil
}

func (r *withdrawalRepository) GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.WithdrawalRequest, error) {
	var withdrawals []*model.WithdrawalRequest
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at desc").Limit(limit).Offset(offset).Find(&withdrawals).Error
	return withdrawals, err
}

func (r *withdrawalRepository) GetByStatus(ctx context.Context, status model.WithdrawalStatus, limit, offset int) ([]*model.WithdrawalRequest, error) {
	var withdrawals []*model.WithdrawalRequest
	err := r.db.WithContext(ctx).Where("status = ?", status).Order("created_at asc").Limit(limit).Offset(offset).Find(&withdrawals).Error
	return withdrawals, err
}

func (r *withdrawalRepository) Update(ctx context.Context, w *model.WithdrawalRequest) error {
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

func (r *bankAccountRepository) GetByUUID(ctx context.Context, uuid string) (*model.BankAccount, error) {
	var ba model.BankAccount
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&ba).Error
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

type configRepository struct {
	db *gorm.DB
}

func NewConfigRepository(db *gorm.DB) ConfigRepository {
	return &configRepository{db: db}
}

func (r *configRepository) Create(ctx context.Context, cfg *model.WithdrawalConfig) error {
	return r.db.WithContext(ctx).Create(cfg).Error
}

func (r *configRepository) GetByID(ctx context.Context, id uint) (*model.WithdrawalConfig, error) {
	var cfg model.WithdrawalConfig
	err := r.db.WithContext(ctx).First(&cfg, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConfigNotFound
		}
		return nil, err
	}
	return &cfg, nil
}

func (r *configRepository) GetLatest(ctx context.Context) (*model.WithdrawalConfig, error) {
	var cfg model.WithdrawalConfig
	err := r.db.WithContext(ctx).Order("created_at desc").First(&cfg).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConfigNotFound
		}
		return nil, err
	}
	return &cfg, nil
}

func (r *configRepository) Update(ctx context.Context, cfg *model.WithdrawalConfig) error {
	return r.db.WithContext(ctx).Save(cfg).Error
}

type approvalRuleRepository struct {
	db *gorm.DB
}

func NewApprovalRuleRepository(db *gorm.DB) ApprovalRuleRepository {
	return &approvalRuleRepository{db: db}
}

func (r *approvalRuleRepository) Create(ctx context.Context, rule *model.ApprovalRule) error {
	return r.db.WithContext(ctx).Create(rule).Error
}

func (r *approvalRuleRepository) GetByID(ctx context.Context, id uint) (*model.ApprovalRule, error) {
	var rule model.ApprovalRule
	err := r.db.WithContext(ctx).First(&rule, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrApprovalRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *approvalRuleRepository) GetByLevel(ctx context.Context, level int) (*model.ApprovalRule, error) {
	var rule model.ApprovalRule
	err := r.db.WithContext(ctx).Where("level = ?", level).First(&rule).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrApprovalRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *approvalRuleRepository) GetByAmount(ctx context.Context, amount interface{}) (*model.ApprovalRule, error) {
	var rule model.ApprovalRule
	err := r.db.WithContext(ctx).Where("min_amount <= ? AND max_amount >= ?", amount, amount).Order("level desc").First(&rule).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrApprovalRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *approvalRuleRepository) List(ctx context.Context) ([]*model.ApprovalRule, error) {
	var rules []*model.ApprovalRule
	err := r.db.WithContext(ctx).Order("level asc").Find(&rules).Error
	return rules, err
}

func (r *approvalRuleRepository) Update(ctx context.Context, rule *model.ApprovalRule) error {
	return r.db.WithContext(ctx).Save(rule).Error
}

type withdrawalLimitRepository struct {
	db *gorm.DB
}

func NewWithdrawalLimitRepository(db *gorm.DB) WithdrawalLimitRepository {
	return &withdrawalLimitRepository{db: db}
}

func (r *withdrawalLimitRepository) Create(ctx context.Context, limit *model.WithdrawalLimit) error {
	return r.db.WithContext(ctx).Create(limit).Error
}

func (r *withdrawalLimitRepository) GetByUserID(ctx context.Context, userID uint, limitType string) (*model.WithdrawalLimit, error) {
	var limit model.WithdrawalLimit
	err := r.db.WithContext(ctx).Where("user_id = ? AND type = ?", userID, limitType).First(&limit).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLimitNotFound
		}
		return nil, err
	}
	return &limit, nil
}

func (r *withdrawalLimitRepository) GetByID(ctx context.Context, id uint) (*model.WithdrawalLimit, error) {
	var limit model.WithdrawalLimit
	err := r.db.WithContext(ctx).First(&limit, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLimitNotFound
		}
		return nil, err
	}
	return &limit, nil
}

func (r *withdrawalLimitRepository) Update(ctx context.Context, limit *model.WithdrawalLimit) error {
	return r.db.WithContext(ctx).Save(limit).Error
}

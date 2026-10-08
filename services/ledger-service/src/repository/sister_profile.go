package repository

import (
	"context"
	"errors"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/ledger-service/src/model"
)

var (
	ErrSisterProfileNotFound = errors.New("sister profile not found")
)

// SisterProfileRepository — sister master profile persistence.
type SisterProfileRepository interface {
	Create(ctx context.Context, profile *model.SisterMasterProfile) error
	GetByID(ctx context.Context, id uint) (*model.SisterMasterProfile, error)
	GetByWalletUserID(ctx context.Context, walletUserID uint) (*model.SisterMasterProfile, error)
	Update(ctx context.Context, profile *model.SisterMasterProfile) error
	Credit(ctx context.Context, walletUserID uint, amount decimal.Decimal) error
	Debit(ctx context.Context, walletUserID uint, amount decimal.Decimal) error
	GetBalance(ctx context.Context, walletUserID uint) (decimal.Decimal, error)
}

// SisterShareLedgerRepository — 5% share allocation records.
type SisterShareLedgerRepository interface {
	Create(ctx context.Context, ledger *model.SisterShareLedger) error
	GetBySettlementRef(ctx context.Context, ref string) (*model.SisterShareLedger, error)
	GetTotalReceived(ctx context.Context) (decimal.Decimal, error)
	ListByTimeRange(ctx context.Context, start, end string, limit, offset int) ([]*model.SisterShareLedger, error)
}

type sisterProfileRepository struct {
	db *gorm.DB
}

func NewSisterProfileRepository(db *gorm.DB) SisterProfileRepository {
	return &sisterProfileRepository{db: db}
}

func (r *sisterProfileRepository) Create(ctx context.Context, profile *model.SisterMasterProfile) error {
	return r.db.WithContext(ctx).Create(profile).Error
}

func (r *sisterProfileRepository) GetByID(ctx context.Context, id uint) (*model.SisterMasterProfile, error) {
	var profile model.SisterMasterProfile
	err := r.db.WithContext(ctx).First(&profile, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSisterProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

func (r *sisterProfileRepository) GetByWalletUserID(ctx context.Context, walletUserID uint) (*model.SisterMasterProfile, error) {
	var profile model.SisterMasterProfile
	err := r.db.WithContext(ctx).Where("wallet_user_id = ?", walletUserID).First(&profile).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSisterProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

func (r *sisterProfileRepository) Update(ctx context.Context, profile *model.SisterMasterProfile) error {
	return r.db.WithContext(ctx).Save(profile).Error
}

// Credit — sister ke balance mein amount joda (buffer-free).
// Hinglish: sister ke case mein ₹2,000 buffer check NAHI hota.
// Direct credit hota hai, koi restriction nahi.
func (r *sisterProfileRepository) Credit(ctx context.Context, walletUserID uint, amount decimal.Decimal) error {
	return r.db.WithContext(ctx).Model(&model.SisterMasterProfile{}).
		Where("wallet_user_id = ?", walletUserID).
		UpdateColumn("current_balance", gorm.Expr("current_balance + ?", amount)).
		UpdateColumn("total_received", gorm.Expr("total_received + ?", amount)).
		Error
}

// Debit — sister ke balance mein amount kata.
// Hinglish: direct withdrawal access hai, buffer check nahi.
func (r *sisterProfileRepository) Debit(ctx context.Context, walletUserID uint, amount decimal.Decimal) error {
	return r.db.WithContext(ctx).Model(&model.SisterMasterProfile{}).
		Where("wallet_user_id = ? AND current_balance >= ?", walletUserID, amount).
		UpdateColumn("current_balance", gorm.Expr("current_balance - ?", amount)).
		UpdateColumn("total_withdrawn", gorm.Expr("total_withdrawn + ?", amount)).
		Error
}

func (r *sisterProfileRepository) GetBalance(ctx context.Context, walletUserID uint) (decimal.Decimal, error) {
	var profile model.SisterMasterProfile
	err := r.db.WithContext(ctx).Where("wallet_user_id = ?", walletUserID).First(&profile).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return decimal.Zero, ErrSisterProfileNotFound
		}
		return decimal.Zero, err
	}
	return profile.CurrentBalance, nil
}

type sisterShareLedgerRepository struct {
	db *gorm.DB
}

func NewSisterShareLedgerRepository(db *gorm.DB) SisterShareLedgerRepository {
	return &sisterShareLedgerRepository{db: db}
}

func (r *sisterShareLedgerRepository) Create(ctx context.Context, ledger *model.SisterShareLedger) error {
	return r.db.WithContext(ctx).Create(ledger).Error
}

func (r *sisterShareLedgerRepository) GetBySettlementRef(ctx context.Context, ref string) (*model.SisterShareLedger, error) {
	var ledger model.SisterShareLedger
	err := r.db.WithContext(ctx).Where("settlement_ref = ?", ref).First(&ledger).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSisterProfileNotFound
		}
		return nil, err
	}
	return &ledger, nil
}

func (r *sisterShareLedgerRepository) GetTotalReceived(ctx context.Context) (decimal.Decimal, error) {
	var total decimal.Decimal
	err := r.db.WithContext(ctx).Model(&model.SisterShareLedger{}).Select("COALESCE(SUM(sister_share_amount), 0)").Scan(&total).Error
	return total, err
}

func (r *sisterShareLedgerRepository) ListByTimeRange(ctx context.Context, start, end string, limit, offset int) ([]*model.SisterShareLedger, error) {
	var ledgers []*model.SisterShareLedger
	err := r.db.WithContext(ctx).Where("created_at BETWEEN ? AND ?", start, end).Order("created_at desc").Limit(limit).Offset(offset).Find(&ledgers).Error
	return ledgers, err
}
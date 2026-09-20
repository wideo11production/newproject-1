package repository

import (
	"context"
	"errors"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/royalty-service/src/model"
)

var (
	ErrRateTierNotFound    = errors.New("rate tier not found")
	ErrRoyaltyNotFound     = errors.New("royalty record not found")
	ErrPlatformFeeNotFound = errors.New("platform fee not found")
)

type RateTierRepository interface {
	Create(ctx context.Context, tier *model.RateTier) error
	GetByID(ctx context.Context, id uint) (*model.RateTier, error)
	GetByCurrency(ctx context.Context, currency model.Currency, limit, offset int) ([]*model.RateTier, error)
	GetByRevenueSource(ctx context.Context, source model.RevenueSource, limit, offset int) ([]*model.RateTier, error)
	GetDefault(ctx context.Context, currency model.Currency) (*model.RateTier, error)
	GetByAmount(ctx context.Context, currency model.Currency, revenue decimal.Decimal) (*model.RateTier, error)
	Update(ctx context.Context, tier *model.RateTier) error
}

type RoyaltyRepository interface {
	Create(ctx context.Context, record *model.RoyaltyRecord) error
	GetByID(ctx context.Context, id uint) (*model.RoyaltyRecord, error)
	GetByUUID(ctx context.Context, uuid string) (*model.RoyaltyRecord, error)
	GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.RoyaltyRecord, error)
	GetByPeriod(ctx context.Context, userID uint, start, end time.Time) ([]*model.RoyaltyRecord, error)
	GetByStatus(ctx context.Context, status model.RoyaltyStatus, limit int) ([]*model.RoyaltyRecord, error)
	Update(ctx context.Context, record *model.RoyaltyRecord) error
}

type PlatformFeeRepository interface {
	Create(ctx context.Context, fee *model.PlatformFee) error
	GetByID(ctx context.Context, id uint) (*model.PlatformFee, error)
	GetByCurrency(ctx context.Context, currency model.Currency) (*model.PlatformFee, error)
	GetBySource(ctx context.Context, source model.RevenueSource) ([]*model.PlatformFee, error)
	Update(ctx context.Context, fee *model.PlatformFee) error
}

type rateTierRepository struct {
	db *gorm.DB
}

func NewRateTierRepository(db *gorm.DB) RateTierRepository {
	return &rateTierRepository{db: db}
}

func (r *rateTierRepository) Create(ctx context.Context, tier *model.RateTier) error {
	return r.db.WithContext(ctx).Create(tier).Error
}

func (r *rateTierRepository) GetByID(ctx context.Context, id uint) (*model.RateTier, error) {
	var tier model.RateTier
	err := r.db.WithContext(ctx).First(&tier, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRateTierNotFound
		}
		return nil, err
	}
	return &tier, nil
}

func (r *rateTierRepository) GetByCurrency(ctx context.Context, currency model.Currency, limit, offset int) ([]*model.RateTier, error) {
	var tiers []*model.RateTier
	err := r.db.WithContext(ctx).Where("currency = ?", currency).Order("min_revenue asc").Limit(limit).Offset(offset).Find(&tiers).Error
	return tiers, err
}

func (r *rateTierRepository) GetByRevenueSource(ctx context.Context, source model.RevenueSource, limit, offset int) ([]*model.RateTier, error) {
	var tiers []*model.RateTier
	err := r.db.WithContext(ctx).Where("source = ?", source).Order("min_revenue asc").Limit(limit).Offset(offset).Find(&tiers).Error
	return tiers, err
}

func (r *rateTierRepository) GetDefault(ctx context.Context, currency model.Currency) (*model.RateTier, error) {
	var tier model.RateTier
	err := r.db.WithContext(ctx).Where("currency = ? AND is_default = ?", currency, true).First(&tier).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRateTierNotFound
		}
		return nil, err
	}
	return &tier, nil
}

func (r *rateTierRepository) GetByAmount(ctx context.Context, currency model.Currency, revenue decimal.Decimal) (*model.RateTier, error) {
	var tier model.RateTier
	err := r.db.WithContext(ctx).Where("currency = ? AND min_revenue <= ? AND (max_revenue IS NULL OR max_revenue >= ?)", currency, revenue, revenue).Order("min_revenue desc").First(&tier).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRateTierNotFound
		}
		return nil, err
	}
	return &tier, nil
}

func (r *rateTierRepository) Update(ctx context.Context, tier *model.RateTier) error {
	return r.db.WithContext(ctx).Save(tier).Error
}

type royaltyRepository struct {
	db *gorm.DB
}

func NewRoyaltyRepository(db *gorm.DB) RoyaltyRepository {
	return &royaltyRepository{db: db}
}

func (r *royaltyRepository) Create(ctx context.Context, record *model.RoyaltyRecord) error {
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *royaltyRepository) GetByID(ctx context.Context, id uint) (*model.RoyaltyRecord, error) {
	var record model.RoyaltyRecord
	err := r.db.WithContext(ctx).First(&record, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoyaltyNotFound
		}
		return nil, err
	}
	return &record, nil
}

func (r *royaltyRepository) GetByUUID(ctx context.Context, uuid string) (*model.RoyaltyRecord, error) {
	var record model.RoyaltyRecord
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoyaltyNotFound
		}
		return nil, err
	}
	return &record, nil
}

func (r *royaltyRepository) GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.RoyaltyRecord, error) {
	var records []*model.RoyaltyRecord
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("period_end desc").Limit(limit).Offset(offset).Find(&records).Error
	return records, err
}

func (r *royaltyRepository) GetByPeriod(ctx context.Context, userID uint, start, end time.Time) ([]*model.RoyaltyRecord, error) {
	var records []*model.RoyaltyRecord
	err := r.db.WithContext(ctx).Where("user_id = ? AND period_start >= ? AND period_end <= ?", userID, start, end).Order("period_end desc").Find(&records).Error
	return records, err
}

func (r *royaltyRepository) GetByStatus(ctx context.Context, status model.RoyaltyStatus, limit int) ([]*model.RoyaltyRecord, error) {
	var records []*model.RoyaltyRecord
	err := r.db.WithContext(ctx).Where("status = ?", status).Order("created_at asc").Limit(limit).Find(&records).Error
	return records, err
}

func (r *royaltyRepository) Update(ctx context.Context, record *model.RoyaltyRecord) error {
	return r.db.WithContext(ctx).Save(record).Error
}

type platformFeeRepository struct {
	db *gorm.DB
}

func NewPlatformFeeRepository(db *gorm.DB) PlatformFeeRepository {
	return &platformFeeRepository{db: db}
}

func (r *platformFeeRepository) Create(ctx context.Context, fee *model.PlatformFee) error {
	return r.db.WithContext(ctx).Create(fee).Error
}

func (r *platformFeeRepository) GetByID(ctx context.Context, id uint) (*model.PlatformFee, error) {
	var fee model.PlatformFee
	err := r.db.WithContext(ctx).First(&fee, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlatformFeeNotFound
		}
		return nil, err
	}
	return &fee, nil
}

func (r *platformFeeRepository) GetByCurrency(ctx context.Context, currency model.Currency) (*model.PlatformFee, error) {
	var fee model.PlatformFee
	err := r.db.WithContext(ctx).Where("currency = ?", currency).Order("created_at desc").First(&fee).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlatformFeeNotFound
		}
		return nil, err
	}
	return &fee, nil
}

func (r *platformFeeRepository) GetBySource(ctx context.Context, source model.RevenueSource) ([]*model.PlatformFee, error) {
	var fees []*model.PlatformFee
	err := r.db.WithContext(ctx).Where("source = ?", source).Order("created_at desc").Find(&fees).Error
	return fees, err
}

func (r *platformFeeRepository) Update(ctx context.Context, fee *model.PlatformFee) error {
	return r.db.WithContext(ctx).Save(fee).Error
}

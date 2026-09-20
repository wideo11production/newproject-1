package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/ads-service/src/model"
)

var (
	ErrAdNotFound           = errors.New("ad not found")
	ErrPlacementNotFound    = errors.New("placement not found")
	ErrSlotNotFound         = errors.New("slot not found")
	ErrNotEnoughBudget      = errors.New("not enough campaign budget")
	ErrAdNotActive          = errors.New("ad is not active")
	ErrPlacementInactive    = errors.New("placement is not active")
)

type AdRepository interface {
	Create(ctx context.Context, ad *model.Ad) error
	GetByID(ctx context.Context, id uint) (*model.Ad, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Ad, error)
	GetByCampaignID(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Ad, error)
	GetActiveByCampaign(ctx context.Context, campaignID uint) ([]*model.Ad, error)
	Update(ctx context.Context, ad *model.Ad) error
	IncrementStats(ctx context.Context, adID uint, clicks, impressions int) error
	AddSpent(ctx context.Context, adID uint, amount interface{}) error
}

type PlacementRepository interface {
	Create(ctx context.Context, placement *model.AdPlacement) error
	GetByID(ctx context.Context, id uint) (*model.AdPlacement, error)
	GetByCode(ctx context.Context, code string) (*model.AdPlacement, error)
	GetByAdType(ctx context.Context, adType model.AdType, limit, offset int) ([]*model.AdPlacement, error)
	Update(ctx context.Context, placement *model.AdPlacement) error
}

type AdSlotRepository interface {
	Create(ctx context.Context, slot *model.AdSlot) error
	GetByID(ctx context.Context, id uint) (*model.AdSlot, error)
	GetByPlacementID(ctx context.Context, placementID uint, limit, offset int) ([]*model.AdSlot, error)
	GetActiveByPlacement(ctx context.Context, placementID uint) ([]*model.AdSlot, error)
	Update(ctx context.Context, slot *model.AdSlot) error
}

type ImpressionRepository interface {
	Create(ctx context.Context, imp *model.AdImpression) error
	CreateBatch(ctx context.Context, impressions []*model.AdImpression) error
	CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error)
}

type ClickRepository interface {
	Create(ctx context.Context, click *model.AdClick) error
	CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error)
}

type ConversionRepository interface {
	Create(ctx context.Context, conv *model.ConversionEvent) error
	CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error)
	CountByCampaign(ctx context.Context, campaignID uint, eventType string, start, end time.Time) (int64, error)
}

type adRepository struct {
	db *gorm.DB
}

func NewAdRepository(db *gorm.DB) AdRepository {
	return &adRepository{db: db}
}

func (r *adRepository) Create(ctx context.Context, ad *model.Ad) error {
	return r.db.WithContext(ctx).Create(ad).Error
}

func (r *adRepository) GetByID(ctx context.Context, id uint) (*model.Ad, error) {
	var ad model.Ad
	err := r.db.WithContext(ctx).First(&ad, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAdNotFound
		}
		return nil, err
	}
	return &ad, nil
}

func (r *adRepository) GetByUUID(ctx context.Context, uuid string) (*model.Ad, error) {
	var ad model.Ad
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&ad).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAdNotFound
		}
		return nil, err
	}
	return &ad, nil
}

func (r *adRepository) GetByCampaignID(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Ad, error) {
	var ads []*model.Ad
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Limit(limit).Offset(offset).Find(&ads).Error
	return ads, err
}

func (r *adRepository) GetActiveByCampaign(ctx context.Context, campaignID uint) ([]*model.Ad, error) {
	var ads []*model.Ad
	err := r.db.WithContext(ctx).Where("campaign_id = ? AND status = ?", campaignID, model.AdStatusActive).Find(&ads).Error
	return ads, err
}

func (r *adRepository) Update(ctx context.Context, ad *model.Ad) error {
	return r.db.WithContext(ctx).Save(ad).Error
}

func (r *adRepository) IncrementStats(ctx context.Context, adID uint, clicks, impressions int) error {
	updates := map[string]interface{}{
		"clicks":      gorm.Expr("clicks + ?", clicks),
		"impressions": gorm.Expr("impressions + ?", impressions),
	}
	return r.db.WithContext(ctx).Model(&model.Ad{}).Where("id = ?", adID).Updates(updates).Error
}

func (r *adRepository) AddSpent(ctx context.Context, adID uint, amount interface{}) error {
	return r.db.WithContext(ctx).Model(&model.Ad{}).Where("id = ?", adID).Update("spent", gorm.Expr("spent + ?", amount)).Error
}

type placementRepository struct {
	db *gorm.DB
}

func NewPlacementRepository(db *gorm.DB) PlacementRepository {
	return &placementRepository{db: db}
}

func (r *placementRepository) Create(ctx context.Context, placement *model.AdPlacement) error {
	return r.db.WithContext(ctx).Create(placement).Error
}

func (r *placementRepository) GetByID(ctx context.Context, id uint) (*model.AdPlacement, error) {
	var placement model.AdPlacement
	err := r.db.WithContext(ctx).First(&placement, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlacementNotFound
		}
		return nil, err
	}
	return &placement, nil
}

func (r *placementRepository) GetByCode(ctx context.Context, code string) (*model.AdPlacement, error) {
	var placement model.AdPlacement
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&placement).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlacementNotFound
		}
		return nil, err
	}
	return &placement, nil
}

func (r *placementRepository) GetByAdType(ctx context.Context, adType model.AdType, limit, offset int) ([]*model.AdPlacement, error) {
	var placements []*model.AdPlacement
	err := r.db.WithContext(ctx).Where("ad_type = ? AND is_active = ?", adType, true).Limit(limit).Offset(offset).Find(&placements).Error
	return placements, err
}

func (r *placementRepository) Update(ctx context.Context, placement *model.AdPlacement) error {
	return r.db.WithContext(ctx).Save(placement).Error
}

type adSlotRepository struct {
	db *gorm.DB
}

func NewAdSlotRepository(db *gorm.DB) AdSlotRepository {
	return &adSlotRepository{db: db}
}

func (r *adSlotRepository) Create(ctx context.Context, slot *model.AdSlot) error {
	return r.db.WithContext(ctx).Create(slot).Error
}

func (r *adSlotRepository) GetByID(ctx context.Context, id uint) (*model.AdSlot, error) {
	var slot model.AdSlot
	err := r.db.WithContext(ctx).First(&slot, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSlotNotFound
		}
		return nil, err
	}
	return &slot, nil
}

func (r *adSlotRepository) GetByPlacementID(ctx context.Context, placementID uint, limit, offset int) ([]*model.AdSlot, error) {
	var slots []*model.AdSlot
	err := r.db.WithContext(ctx).Where("placement_id = ?", placementID).Limit(limit).Offset(offset).Find(&slots).Error
	return slots, err
}

func (r *adSlotRepository) GetActiveByPlacement(ctx context.Context, placementID uint) ([]*model.AdSlot, error) {
	var slots []*model.AdSlot
	err := r.db.WithContext(ctx).Where("placement_id = ? AND is_enabled = ?", placementID, true).Find(&slots).Error
	return slots, err
}

func (r *adSlotRepository) Update(ctx context.Context, slot *model.AdSlot) error {
	return r.db.WithContext(ctx).Save(slot).Error
}

type impressionRepository struct {
	db *gorm.DB
}

func NewImpressionRepository(db *gorm.DB) ImpressionRepository {
	return &impressionRepository{db: db}
}

func (r *impressionRepository) Create(ctx context.Context, imp *model.AdImpression) error {
	return r.db.WithContext(ctx).Create(imp).Error
}

func (r *impressionRepository) CreateBatch(ctx context.Context, impressions []*model.AdImpression) error {
	return r.db.WithContext(ctx).Create(&impressions).Error
}

func (r *impressionRepository) CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.AdImpression{}).Where("ad_id = ? AND timestamp BETWEEN ? AND ?", adID, start, end).Count(&count).Error
	return count, err
}

type clickRepository struct {
	db *gorm.DB
}

func NewClickRepository(db *gorm.DB) ClickRepository {
	return &clickRepository{db: db}
}

func (r *clickRepository) Create(ctx context.Context, click *model.AdClick) error {
	return r.db.WithContext(ctx).Create(click).Error
}

func (r *clickRepository) CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.AdClick{}).Where("ad_id = ? AND timestamp BETWEEN ? AND ?", adID, start, end).Count(&count).Error
	return count, err
}

type conversionRepository struct {
	db *gorm.DB
}

func NewConversionRepository(db *gorm.DB) ConversionRepository {
	return &conversionRepository{db: db}
}

func (r *conversionRepository) Create(ctx context.Context, conv *model.ConversionEvent) error {
	return r.db.WithContext(ctx).Create(conv).Error
}

func (r *conversionRepository) CountByAd(ctx context.Context, adID uint, start, end time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.ConversionEvent{}).Where("ad_id = ? AND timestamp BETWEEN ? AND ?", adID, start, end).Count(&count).Error
	return count, err
}

func (r *conversionRepository) CountByCampaign(ctx context.Context, campaignID uint, eventType string, start, end time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.ConversionEvent{}).Where("campaign_id = ? AND event_type = ? AND timestamp BETWEEN ? AND ?", campaignID, eventType, start, end).Count(&count).Error
	return count, err
}

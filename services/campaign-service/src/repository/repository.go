package repository

import (
	"context"
	"errors"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/campaign-service/src/model"
)

var (
	ErrCampaignNotFound       = errors.New("campaign not found")
	ErrTargetingRuleNotFound  = errors.New("targeting rule not found")
	ErrNoActiveCampaigns      = errors.New("no active campaigns")
	ErrInsufficientBudget     = errors.New("insufficient budget")
)

type CampaignRepository interface {
	Create(ctx context.Context, campaign *model.Campaign) error
	GetByID(ctx context.Context, id uint) (*model.Campaign, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Campaign, error)
	GetByCode(ctx context.Context, code string) (*model.Campaign, error)
	GetByAdvertiserID(ctx context.Context, advertiserID uint, limit, offset int) ([]*model.Campaign, error)
	GetActive(ctx context.Context, limit, offset int) ([]*model.Campaign, error)
	GetExpiring(ctx context.Context, before time.Time) ([]*model.Campaign, error)
	GetByStatus(ctx context.Context, status model.CampaignStatus, limit, offset int) ([]*model.Campaign, error)
	Update(ctx context.Context, campaign *model.Campaign) error
	AddSpent(ctx context.Context, campaignID uint, amount decimal.Decimal) error
	UpdateStats(ctx context.Context, campaignID uint, impressions, clicks int, spent decimal.Decimal, conversions int, revenue decimal.Decimal) error
}

type TargetingRuleRepository interface {
	Create(ctx context.Context, rule *model.TargetingRule) error
	CreateBatch(ctx context.Context, rules []*model.TargetingRule) error
	GetByID(ctx context.Context, id uint) (*model.TargetingRule, error)
	GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.TargetingRule, error)
	GetByCampaignAndField(ctx context.Context, campaignID uint, field string) ([]*model.TargetingRule, error)
	Update(ctx context.Context, rule *model.TargetingRule) error
	Delete(ctx context.Context, id uint) error
	DeleteByCampaignID(ctx context.Context, campaignID uint) error
}

type CampaignStatRepository interface {
	Create(ctx context.Context, stat *model.CampaignDailyStat) error
	GetByCampaignAndDate(ctx context.Context, campaignID uint, date time.Time) (*model.CampaignDailyStat, error)
	UpdateOrCreate(ctx context.Context, stat *model.CampaignDailyStat) error
	GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.CampaignDailyStat, error)
}

type campaignRepository struct {
	db *gorm.DB
}

func NewCampaignRepository(db *gorm.DB) CampaignRepository {
	return &campaignRepository{db: db}
}

func (r *campaignRepository) Create(ctx context.Context, campaign *model.Campaign) error {
	return r.db.WithContext(ctx).Create(campaign).Error
}

func (r *campaignRepository) GetByID(ctx context.Context, id uint) (*model.Campaign, error) {
	var campaign model.Campaign
	err := r.db.WithContext(ctx).First(&campaign, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &campaign, nil
}

func (r *campaignRepository) GetByUUID(ctx context.Context, uuid string) (*model.Campaign, error) {
	var campaign model.Campaign
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&campaign).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &campaign, nil
}

func (r *campaignRepository) GetByCode(ctx context.Context, code string) (*model.Campaign, error) {
	var campaign model.Campaign
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&campaign).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &campaign, nil
}

func (r *campaignRepository) GetByAdvertiserID(ctx context.Context, advertiserID uint, limit, offset int) ([]*model.Campaign, error) {
	var campaigns []*model.Campaign
	err := r.db.WithContext(ctx).Where("advertiser_id = ?", advertiserID).Order("created_at desc").Limit(limit).Offset(offset).Find(&campaigns).Error
	return campaigns, err
}

func (r *campaignRepository) GetActive(ctx context.Context, limit, offset int) ([]*model.Campaign, error) {
	var campaigns []*model.Campaign
	err := r.db.WithContext(ctx).Where("status = ? AND is_active = ? AND end_date > ?", model.CampaignStatusActive, true, time.Now()).Order("priority desc, created_at asc").Limit(limit).Offset(offset).Find(&campaigns).Error
	return campaigns, err
}

func (r *campaignRepository) GetExpiring(ctx context.Context, before time.Time) ([]*model.Campaign, error) {
	var campaigns []*model.Campaign
	err := r.db.WithContext(ctx).Where("status = ? AND end_date <= ?", model.CampaignStatusActive, before).Find(&campaigns).Error
	return campaigns, err
}

func (r *campaignRepository) GetByStatus(ctx context.Context, status model.CampaignStatus, limit, offset int) ([]*model.Campaign, error) {
	var campaigns []*model.Campaign
	err := r.db.WithContext(ctx).Where("status = ?", status).Order("created_at desc").Limit(limit).Offset(offset).Find(&campaigns).Error
	return campaigns, err
}

func (r *campaignRepository) Update(ctx context.Context, campaign *model.Campaign) error {
	return r.db.WithContext(ctx).Save(campaign).Error
}

func (r *campaignRepository) AddSpent(ctx context.Context, campaignID uint, amount decimal.Decimal) error {
	return r.db.WithContext(ctx).Model(&model.Campaign{}).Where("id = ?", campaignID).
		Update("spent", gorm.Expr("spent + ?", amount)).
		Update("remaining", gorm.Expr("remaining - ?", amount)).Error
}

func (r *campaignRepository) UpdateStats(ctx context.Context, campaignID uint, impressions, clicks int, spent decimal.Decimal, conversions int, revenue decimal.Decimal) error {
	return r.db.WithContext(ctx).Model(&model.Campaign{}).Where("id = ?", campaignID).
		Update("spent", gorm.Expr("spent + ?", spent)).
		Update("remaining", gorm.Expr("remaining - ?", spent)).
		Update("impressions", gorm.Expr("impressions + ?", impressions)).
		Update("clicks", gorm.Expr("clicks + ?", clicks)).Error
}

type targetingRuleRepository struct {
	db *gorm.DB
}

func NewTargetingRuleRepository(db *gorm.DB) TargetingRuleRepository {
	return &targetingRuleRepository{db: db}
}

func (r *targetingRuleRepository) Create(ctx context.Context, rule *model.TargetingRule) error {
	return r.db.WithContext(ctx).Create(rule).Error
}

func (r *targetingRuleRepository) CreateBatch(ctx context.Context, rules []*model.TargetingRule) error {
	return r.db.WithContext(ctx).Create(&rules).Error
}

func (r *targetingRuleRepository) GetByID(ctx context.Context, id uint) (*model.TargetingRule, error) {
	var rule model.TargetingRule
	err := r.db.WithContext(ctx).First(&rule, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTargetingRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *targetingRuleRepository) GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.TargetingRule, error) {
	var rules []*model.TargetingRule
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Find(&rules).Error
	return rules, err
}

func (r *targetingRuleRepository) GetByCampaignAndField(ctx context.Context, campaignID uint, field string) ([]*model.TargetingRule, error) {
	var rules []*model.TargetingRule
	err := r.db.WithContext(ctx).Where("campaign_id = ? AND field = ?", campaignID, field).Find(&rules).Error
	return rules, err
}

func (r *targetingRuleRepository) Update(ctx context.Context, rule *model.TargetingRule) error {
	return r.db.WithContext(ctx).Save(rule).Error
}

func (r *targetingRuleRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.TargetingRule{}, id).Error
}

func (r *targetingRuleRepository) DeleteByCampaignID(ctx context.Context, campaignID uint) error {
	return r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Delete(&model.TargetingRule{}).Error
}

type campaignStatRepository struct {
	db *gorm.DB
}

func NewCampaignStatRepository(db *gorm.DB) CampaignStatRepository {
	return &campaignStatRepository{db: db}
}

func (r *campaignStatRepository) Create(ctx context.Context, stat *model.CampaignDailyStat) error {
	return r.db.WithContext(ctx).Create(stat).Error
}

func (r *campaignStatRepository) GetByCampaignAndDate(ctx context.Context, campaignID uint, date time.Time) (*model.CampaignDailyStat, error) {
	var stat model.CampaignDailyStat
	day := date.Truncate(24 * time.Hour)
	err := r.db.WithContext(ctx).Where("campaign_id = ? AND date = ?", campaignID, day).First(&stat).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("stat not found")
		}
		return nil, err
	}
	return &stat, nil
}

func (r *campaignStatRepository) UpdateOrCreate(ctx context.Context, stat *model.CampaignDailyStat) error {
	return r.db.WithContext(ctx).Save(stat).Error
}

func (r *campaignStatRepository) GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.CampaignDailyStat, error) {
	var stats []*model.CampaignDailyStat
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Order("date desc").Limit(limit).Offset(offset).Find(&stats).Error
	return stats, err
}

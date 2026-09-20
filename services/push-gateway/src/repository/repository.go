package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/push-gateway/src/model"
)

var (
	ErrTemplateNotFound = errors.New("template not found")
	ErrCampaignNotFound = errors.New("campaign not found")
	ErrConfigNotFound   = errors.New("platform config not found")
	ErrScheduledNotFound = errors.New("scheduled push not found")
)

type TemplateRepository interface {
	Create(ctx context.Context, t *model.PushTemplate) error
	GetByID(ctx context.Context, id uint) (*model.PushTemplate, error)
	GetByUUID(ctx context.Context, uuid string) (*model.PushTemplate, error)
	GetByCategory(ctx context.Context, category string) ([]*model.PushTemplate, error)
	Update(ctx context.Context, t *model.PushTemplate) error
	Delete(ctx context.Context, id uint) error
}

type CampaignRepository interface {
	Create(ctx context.Context, c *model.PushCampaign) error
	GetByID(ctx context.Context, id uint) (*model.PushCampaign, error)
	GetByUUID(ctx context.Context, uuid string) (*model.PushCampaign, error)
	List(ctx context.Context, limit, offset int) ([]*model.PushCampaign, error)
	Update(ctx context.Context, c *model.PushCampaign) error
	Delete(ctx context.Context, id uint) error
	GetPending(ctx context.Context) ([]*model.PushCampaign, error)
}

type AnalyticsRepository interface {
	Create(ctx context.Context, a *model.PushAnalytics) error
	GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.PushAnalytics, error)
	GetStats(ctx context.Context, campaignID uint) (map[string]int64, error)
}

type PlatformConfigRepository interface {
	Create(ctx context.Context, c *model.PlatformConfig) error
	GetByName(ctx context.Context, name string) (*model.PlatformConfig, error)
	GetAll(ctx context.Context) ([]*model.PlatformConfig, error)
	Update(ctx context.Context, c *model.PlatformConfig) error
	Delete(ctx context.Context, id uint) error
}

type ScheduledPushRepository interface {
	Create(ctx context.Context, s *model.ScheduledPush) error
	GetByID(ctx context.Context, id uint) (*model.ScheduledPush, error)
	GetPending(ctx context.Context, before time.Time) ([]*model.ScheduledPush, error)
	Update(ctx context.Context, s *model.ScheduledPush) error
	Delete(ctx context.Context, id uint) error
}

type templateRepository struct {
	db *gorm.DB
}

func NewTemplateRepository(db *gorm.DB) TemplateRepository {
	return &templateRepository{db: db}
}

func (r *templateRepository) Create(ctx context.Context, t *model.PushTemplate) error {
	return r.db.WithContext(ctx).Create(t).Error
}

func (r *templateRepository) GetByID(ctx context.Context, id uint) (*model.PushTemplate, error) {
	var t model.PushTemplate
	err := r.db.WithContext(ctx).First(&t, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTemplateNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *templateRepository) GetByUUID(ctx context.Context, uuid string) (*model.PushTemplate, error) {
	var t model.PushTemplate
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTemplateNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *templateRepository) GetByCategory(ctx context.Context, category string) ([]*model.PushTemplate, error) {
	var templates []*model.PushTemplate
	err := r.db.WithContext(ctx).Where("category = ?", category).Find(&templates).Error
	return templates, err
}

func (r *templateRepository) Update(ctx context.Context, t *model.PushTemplate) error {
	return r.db.WithContext(ctx).Save(t).Error
}

func (r *templateRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.PushTemplate{}, id).Error
}

type campaignRepository struct {
	db *gorm.DB
}

func NewCampaignRepository(db *gorm.DB) CampaignRepository {
	return &campaignRepository{db: db}
}

func (r *campaignRepository) Create(ctx context.Context, c *model.PushCampaign) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *campaignRepository) GetByID(ctx context.Context, id uint) (*model.PushCampaign, error) {
	var c model.PushCampaign
	err := r.db.WithContext(ctx).First(&c, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *campaignRepository) GetByUUID(ctx context.Context, uuid string) (*model.PushCampaign, error) {
	var c model.PushCampaign
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&c).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *campaignRepository) List(ctx context.Context, limit, offset int) ([]*model.PushCampaign, error) {
	var campaigns []*model.PushCampaign
	err := r.db.WithContext(ctx).Limit(limit).Offset(offset).Find(&campaigns).Error
	return campaigns, err
}

func (r *campaignRepository) Update(ctx context.Context, c *model.PushCampaign) error {
	return r.db.WithContext(ctx).Save(c).Error
}

func (r *campaignRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.PushCampaign{}, id).Error
}

func (r *campaignRepository) GetPending(ctx context.Context) ([]*model.PushCampaign, error) {
	var campaigns []*model.PushCampaign
	err := r.db.WithContext(ctx).Where("status = ? AND scheduled_at IS NOT NULL AND scheduled_at <= ?", "scheduled", time.Now()).Find(&campaigns).Error
	return campaigns, err
}

type analyticsRepository struct {
	db *gorm.DB
}

func NewAnalyticsRepository(db *gorm.DB) AnalyticsRepository {
	return &analyticsRepository{db: db}
}

func (r *analyticsRepository) Create(ctx context.Context, a *model.PushAnalytics) error {
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *analyticsRepository) GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.PushAnalytics, error) {
	var analytics []*model.PushAnalytics
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Find(&analytics).Error
	return analytics, err
}

func (r *analyticsRepository) GetStats(ctx context.Context, campaignID uint) (map[string]int64, error) {
	var stats []struct {
		EventType string
		Count     int64
	}
	err := r.db.WithContext(ctx).Model(&model.PushAnalytics{}).Where("campaign_id = ?", campaignID).Select("event_type, count(*) as count").Group("event_type").Scan(&stats).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]int64)
	for _, s := range stats {
		result[s.EventType] = s.Count
	}
	return result, nil
}

type platformConfigRepository struct {
	db *gorm.DB
}

func NewPlatformConfigRepository(db *gorm.DB) PlatformConfigRepository {
	return &platformConfigRepository{db: db}
}

func (r *platformConfigRepository) Create(ctx context.Context, c *model.PlatformConfig) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *platformConfigRepository) GetByName(ctx context.Context, name string) (*model.PlatformConfig, error) {
	var c model.PlatformConfig
	err := r.db.WithContext(ctx).Where("name = ?", name).First(&c).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConfigNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *platformConfigRepository) GetAll(ctx context.Context) ([]*model.PlatformConfig, error) {
	var configs []*model.PlatformConfig
	err := r.db.WithContext(ctx).Order("priority desc").Find(&configs).Error
	return configs, err
}

func (r *platformConfigRepository) Update(ctx context.Context, c *model.PlatformConfig) error {
	return r.db.WithContext(ctx).Save(c).Error
}

func (r *platformConfigRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.PlatformConfig{}, id).Error
}

type scheduledPushRepository struct {
	db *gorm.DB
}

func NewScheduledPushRepository(db *gorm.DB) ScheduledPushRepository {
	return &scheduledPushRepository{db: db}
}

func (r *scheduledPushRepository) Create(ctx context.Context, s *model.ScheduledPush) error {
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *scheduledPushRepository) GetByID(ctx context.Context, id uint) (*model.ScheduledPush, error) {
	var s model.ScheduledPush
	err := r.db.WithContext(ctx).First(&s, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrScheduledNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *scheduledPushRepository) GetPending(ctx context.Context, before time.Time) ([]*model.ScheduledPush, error) {
	var scheduled []*model.ScheduledPush
	err := r.db.WithContext(ctx).Where("status = ? AND scheduled_at <= ?", "pending", before).Find(&scheduled).Error
	return scheduled, err
}

func (r *scheduledPushRepository) Update(ctx context.Context, s *model.ScheduledPush) error {
	return r.db.WithContext(ctx).Save(s).Error
}

func (r *scheduledPushRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.ScheduledPush{}, id).Error
}
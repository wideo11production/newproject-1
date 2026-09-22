package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/cdn-service/src/model"
)

var (
	ErrCDNConfigNotFound       = errors.New("cdn config not found")
	ErrCDNCacheRuleNotFound    = errors.New("cdn cache rule not found")
	ErrCDNInvalidationNotFound = errors.New("cdn invalidation not found")
	ErrCDNSignedURLNotFound    = errors.New("cdn signed url not found")
	ErrCDNAnalyticsNotFound    = errors.New("cdn analytics not found")
	ErrVideoCDNMappingNotFound = errors.New("video cdn mapping not found")
)

type CDNConfigRepository interface {
	Create(ctx context.Context, config *model.CDNConfig) error
	GetByID(ctx context.Context, id uint) (*model.CDNConfig, error)
	GetByUUID(ctx context.Context, uuid string) (*model.CDNConfig, error)
	GetByDomain(ctx context.Context, domain string) (*model.CDNConfig, error)
	List(ctx context.Context, limit, offset int) ([]*model.CDNConfig, error)
	Update(ctx context.Context, config *model.CDNConfig) error
	Delete(ctx context.Context, id uint) error
	GetEnabledConfigs(ctx context.Context) ([]*model.CDNConfig, error)
}

type CDNCacheRuleRepository interface {
	CreateRule(ctx context.Context, rule *model.CDNCacheRule) error
	GetRuleByID(ctx context.Context, id uint) (*model.CDNCacheRule, error)
	GetByConfigID(ctx context.Context, configID uint) ([]*model.CDNCacheRule, error)
	ListRules(ctx context.Context, limit, offset int) ([]*model.CDNCacheRule, error)
	UpdateRule(ctx context.Context, rule *model.CDNCacheRule) error
	DeleteRule(ctx context.Context, id uint) error
	GetEnabledRulesForConfig(ctx context.Context, configID uint) ([]*model.CDNCacheRule, error)
}

type CDNInvalidationRepository interface {
	CreateInvalidation(ctx context.Context, inv *model.CDNInvalidation) error
	GetInvalidationByID(ctx context.Context, id uint) (*model.CDNInvalidation, error)
	GetInvalidationByUUID(ctx context.Context, uuid string) (*model.CDNInvalidation, error)
	ListInvalidationsByConfig(ctx context.Context, configID uint, limit, offset int) ([]*model.CDNInvalidation, error)
	GetInvalidationByProviderID(ctx context.Context, invID string) (*model.CDNInvalidation, error)
	UpdateInvalidation(ctx context.Context, inv *model.CDNInvalidation) error
	ListPendingInvalidations(ctx context.Context, limit int) ([]*model.CDNInvalidation, error)
}

type CDNSignedURLRepository interface {
	CreateSignedURL(ctx context.Context, su *model.CDNSignedURL) error
	GetSignedURLByID(ctx context.Context, id uint) (*model.CDNSignedURL, error)
	GetByToken(ctx context.Context, token string) (*model.CDNSignedURL, error)
	ListSignedURLsByConfig(ctx context.Context, configID uint, limit, offset int) ([]*model.CDNSignedURL, error)
	UpdateSignedURL(ctx context.Context, su *model.CDNSignedURL) error
	DeleteExpiredSignedURLs(ctx context.Context) (int64, error)
	GetValidSignedURL(ctx context.Context, resourcePath string, clientIP string) (*model.CDNSignedURL, error)
}

type CDNAnalyticsRepository interface {
	CreateAnalytics(ctx context.Context, a *model.CDNAnalytics) error
	GetAnalyticsByConfigIDAndDate(ctx context.Context, configID uint, date time.Time) (*model.CDNAnalytics, error)
	GetAnalyticsByConfigID(ctx context.Context, configID uint, startDate, endDate time.Time) ([]*model.CDNAnalytics, error)
	GetAggregatedStats(ctx context.Context, configID uint, startDate, endDate time.Time) (map[string]interface{}, error)
	UpsertDailyStats(ctx context.Context, a *model.CDNAnalytics) error
}

type VideoCDNMappingRepository interface {
	CreateMapping(ctx context.Context, m *model.VideoCDNMapping) error
	GetMappingByID(ctx context.Context, id uint) (*model.VideoCDNMapping, error)
	GetByVideoID(ctx context.Context, videoID string) (*model.VideoCDNMapping, error)
	ListMappingsByConfig(ctx context.Context, configID uint) ([]*model.VideoCDNMapping, error)
	ListAllMappings(ctx context.Context, limit, offset int) ([]*model.VideoCDNMapping, error)
	UpdateMapping(ctx context.Context, m *model.VideoCDNMapping) error
	DeleteMapping(ctx context.Context, id uint) error
	GetEnabledMappings(ctx context.Context) ([]*model.VideoCDNMapping, error)
}

type CDNRepository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *CDNRepository {
	return &CDNRepository{db: db}
}

// CDNConfigRepository methods

func (r *CDNRepository) Create(ctx context.Context, config *model.CDNConfig) error {
	return r.db.WithContext(ctx).Create(config).Error
}

func (r *CDNRepository) GetByID(ctx context.Context, id uint) (*model.CDNConfig, error) {
	var config model.CDNConfig
	err := r.db.WithContext(ctx).First(&config, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNConfigNotFound
		}
		return nil, err
	}
	return &config, nil
}

func (r *CDNRepository) GetByUUID(ctx context.Context, uuidStr string) (*model.CDNConfig, error) {
	var config model.CDNConfig
	err := r.db.WithContext(ctx).Where("uuid = ?", uuidStr).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNConfigNotFound
		}
		return nil, err
	}
	return &config, nil
}

func (r *CDNRepository) GetByDomain(ctx context.Context, domain string) (*model.CDNConfig, error) {
	var config model.CDNConfig
	err := r.db.WithContext(ctx).Where("domain = ?", domain).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNConfigNotFound
		}
		return nil, err
	}
	return &config, nil
}

func (r *CDNRepository) List(ctx context.Context, limit, offset int) ([]*model.CDNConfig, error) {
	var configs []*model.CDNConfig
	err := r.db.WithContext(ctx).Limit(limit).Offset(offset).Find(&configs).Error
	return configs, err
}

func (r *CDNRepository) Update(ctx context.Context, config *model.CDNConfig) error {
	return r.db.WithContext(ctx).Save(config).Error
}

func (r *CDNRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.CDNConfig{}, id).Error
}

func (r *CDNRepository) GetEnabledConfigs(ctx context.Context) ([]*model.CDNConfig, error) {
	var configs []*model.CDNConfig
	err := r.db.WithContext(ctx).Where("enabled = ?", true).Find(&configs).Error
	return configs, err
}

// CDNCacheRuleRepository methods

func (r *CDNRepository) CreateRule(ctx context.Context, rule *model.CDNCacheRule) error {
	return r.db.WithContext(ctx).Create(rule).Error
}

func (r *CDNRepository) GetRuleByID(ctx context.Context, id uint) (*model.CDNCacheRule, error) {
	var rule model.CDNCacheRule
	err := r.db.WithContext(ctx).First(&rule, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNCacheRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *CDNRepository) GetRulesByConfig(ctx context.Context, configID uint) ([]*model.CDNCacheRule, error) {
	var rules []*model.CDNCacheRule
	err := r.db.WithContext(ctx).Where("cdn_config_id = ?", configID).Find(&rules).Error
	return rules, err
}

func (r *CDNRepository) ListRules(ctx context.Context, limit, offset int) ([]*model.CDNCacheRule, error) {
	var rules []*model.CDNCacheRule
	err := r.db.WithContext(ctx).Limit(limit).Offset(offset).Find(&rules).Error
	return rules, err
}

func (r *CDNRepository) UpdateRule(ctx context.Context, rule *model.CDNCacheRule) error {
	return r.db.WithContext(ctx).Save(rule).Error
}

func (r *CDNRepository) DeleteRule(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.CDNCacheRule{}, id).Error
}

func (r *CDNRepository) GetEnabledRulesForConfig(ctx context.Context, configID uint) ([]*model.CDNCacheRule, error) {
	var rules []*model.CDNCacheRule
	err := r.db.WithContext(ctx).Where("cdn_config_id = ? AND enabled = ?", configID, true).Find(&rules).Error
	return rules, err
}

// CDNInvalidationRepository methods

func (r *CDNRepository) CreateInvalidation(ctx context.Context, inv *model.CDNInvalidation) error {
	return r.db.WithContext(ctx).Create(inv).Error
}

func (r *CDNRepository) GetInvalidationByID(ctx context.Context, id uint) (*model.CDNInvalidation, error) {
	var inv model.CDNInvalidation
	err := r.db.WithContext(ctx).First(&inv, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNInvalidationNotFound
		}
		return nil, err
	}
	return &inv, nil
}

func (r *CDNRepository) GetInvalidationByUUID(ctx context.Context, uuidStr string) (*model.CDNInvalidation, error) {
	var inv model.CDNInvalidation
	err := r.db.WithContext(ctx).Where("uuid = ?", uuidStr).First(&inv).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNInvalidationNotFound
		}
		return nil, err
	}
	return &inv, nil
}

func (r *CDNRepository) ListInvalidationsByConfig(ctx context.Context, configID uint, limit, offset int) ([]*model.CDNInvalidation, error) {
	var invs []*model.CDNInvalidation
	err := r.db.WithContext(ctx).Where("cdn_config_id = ?", configID).Limit(limit).Offset(offset).Find(&invs).Error
	return invs, err
}

func (r *CDNRepository) GetInvalidationByProviderID(ctx context.Context, invID string) (*model.CDNInvalidation, error) {
	var inv model.CDNInvalidation
	err := r.db.WithContext(ctx).Where("invalidation_id = ?", invID).First(&inv).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNInvalidationNotFound
		}
		return nil, err
	}
	return &inv, nil
}

func (r *CDNRepository) UpdateInvalidation(ctx context.Context, inv *model.CDNInvalidation) error {
	return r.db.WithContext(ctx).Save(inv).Error
}

func (r *CDNRepository) ListPendingInvalidations(ctx context.Context, limit int) ([]*model.CDNInvalidation, error) {
	var invs []*model.CDNInvalidation
	err := r.db.WithContext(ctx).Where("status IN ?", []string{"pending", "in_progress"}).Limit(limit).Find(&invs).Error
	return invs, err
}

// CDNSignedURLRepository methods

func (r *CDNRepository) CreateSignedURL(ctx context.Context, su *model.CDNSignedURL) error {
	return r.db.WithContext(ctx).Create(su).Error
}

func (r *CDNRepository) GetSignedURLByID(ctx context.Context, id uint) (*model.CDNSignedURL, error) {
	var su model.CDNSignedURL
	err := r.db.WithContext(ctx).First(&su, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNSignedURLNotFound
		}
		return nil, err
	}
	return &su, nil
}

func (r *CDNRepository) GetByToken(ctx context.Context, token string) (*model.CDNSignedURL, error) {
	var su model.CDNSignedURL
	err := r.db.WithContext(ctx).Where("uuid = ?", token).First(&su).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNSignedURLNotFound
		}
		return nil, err
	}
	return &su, nil
}

func (r *CDNRepository) ListSignedURLsByConfig(ctx context.Context, configID uint, limit, offset int) ([]*model.CDNSignedURL, error) {
	var sus []*model.CDNSignedURL
	err := r.db.WithContext(ctx).Where("cdn_config_id = ?", configID).Limit(limit).Offset(offset).Find(&sus).Error
	return sus, err
}

func (r *CDNRepository) UpdateSignedURL(ctx context.Context, su *model.CDNSignedURL) error {
	return r.db.WithContext(ctx).Save(su).Error
}

func (r *CDNRepository) DeleteExpiredSignedURLs(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&model.CDNSignedURL{})
	return result.RowsAffected, result.Error
}

func (r *CDNRepository) GetValidSignedURL(ctx context.Context, resourcePath string, clientIP string) (*model.CDNSignedURL, error) {
	var su model.CDNSignedURL
	err := r.db.WithContext(ctx).Where("resource_path = ? AND expires_at > ?", resourcePath, time.Now()).First(&su).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNSignedURLNotFound
		}
		return nil, err
	}
	return &su, nil
}

// CDNAnalyticsRepository methods

func (r *CDNRepository) CreateAnalytics(ctx context.Context, a *model.CDNAnalytics) error {
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *CDNRepository) GetAnalyticsByConfigIDAndDate(ctx context.Context, configID uint, date time.Time) (*model.CDNAnalytics, error) {
	var a model.CDNAnalytics
	err := r.db.WithContext(ctx).Where("cdn_config_id = ? AND date = ?", configID, date).First(&a).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCDNAnalyticsNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (r *CDNRepository) GetAnalyticsByConfigID(ctx context.Context, configID uint, startDate, endDate time.Time) ([]*model.CDNAnalytics, error) {
	var analytics []*model.CDNAnalytics
	err := r.db.WithContext(ctx).Where("cdn_config_id = ? AND date BETWEEN ? AND ?", configID, startDate, endDate).Find(&analytics).Error
	return analytics, err
}

func (r *CDNRepository) GetAggregatedStats(ctx context.Context, configID uint, startDate, endDate time.Time) (map[string]interface{}, error) {
	var stats struct {
		TotalRequests int64
		TotalBytes    int64
		CacheHits     int64
		CacheMisses   int64
	}

	err := r.db.WithContext(ctx).Model(&model.CDNAnalytics{}).
		Where("cdn_config_id = ? AND date BETWEEN ? AND ?", configID, startDate, endDate).
		Select("SUM(requests) as total_requests, SUM(bytes_transferred) as total_bytes, SUM(cache_hits) as cache_hits, SUM(cache_misses) as cache_misses").
		Row().Scan(&stats)

	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"total_requests": stats.TotalRequests,
		"total_bytes":    stats.TotalBytes,
		"cache_hits":     stats.CacheHits,
		"cache_misses":   stats.CacheMisses,
	}, nil
}

func (r *CDNRepository) UpsertDailyStats(ctx context.Context, a *model.CDNAnalytics) error {
	return r.db.WithContext(ctx).Save(a).Error
}

// VideoCDNMappingRepository methods

func (r *CDNRepository) CreateMapping(ctx context.Context, m *model.VideoCDNMapping) error {
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *CDNRepository) GetMappingByID(ctx context.Context, id uint) (*model.VideoCDNMapping, error) {
	var m model.VideoCDNMapping
	err := r.db.WithContext(ctx).First(&m, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVideoCDNMappingNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *CDNRepository) GetByVideoID(ctx context.Context, videoID string) (*model.VideoCDNMapping, error) {
	var m model.VideoCDNMapping
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVideoCDNMappingNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *CDNRepository) ListMappingsByConfig(ctx context.Context, configID uint) ([]*model.VideoCDNMapping, error) {
	var mappings []*model.VideoCDNMapping
	err := r.db.WithContext(ctx).Where("cdn_config_id = ?", configID).Find(&mappings).Error
	return mappings, err
}

func (r *CDNRepository) ListAllMappings(ctx context.Context, limit, offset int) ([]*model.VideoCDNMapping, error) {
	var mappings []*model.VideoCDNMapping
	err := r.db.WithContext(ctx).Limit(limit).Offset(offset).Find(&mappings).Error
	return mappings, err
}

func (r *CDNRepository) UpdateMapping(ctx context.Context, m *model.VideoCDNMapping) error {
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *CDNRepository) DeleteMapping(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.VideoCDNMapping{}, id).Error
}

func (r *CDNRepository) GetEnabledMappings(ctx context.Context) ([]*model.VideoCDNMapping, error) {
	var mappings []*model.VideoCDNMapping
	err := r.db.WithContext(ctx).Where("enabled = ?", true).Find(&mappings).Error
	return mappings, err
}
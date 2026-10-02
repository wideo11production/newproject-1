package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/analytics-service/src/model"
)

var (
	ErrViewLogNotFound       = errors.New("view log not found")
	ErrClickLogNotFound      = errors.New("click log not found")
	ErrConversionNotFound    = errors.New("conversion event not found")
	ErrReachNotFound         = errors.New("reach stat not found")
	ErrRevenueReportNotFound = errors.New("revenue report not found")
)

type ViewLogRepository interface {
	Create(ctx context.Context, log *model.ViewLog) error
	CreateBatch(ctx context.Context, logs []*model.ViewLog) error
	GetByID(ctx context.Context, id uint) (*model.ViewLog, error)
	GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ViewLog, error)
	List(ctx context.Context, limit, offset int) ([]*model.ViewLog, error)
}

type ClickLogRepository interface {
	Create(ctx context.Context, log *model.ClickLog) error
	CreateBatch(ctx context.Context, logs []*model.ClickLog) error
	GetByID(ctx context.Context, id uint) (*model.ClickLog, error)
	GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ClickLog, error)
	List(ctx context.Context, limit, offset int) ([]*model.ClickLog, error)
}

type ConversionRepository interface {
	Create(ctx context.Context, conv *model.ConversionEvent) error
	GetByID(ctx context.Context, id uint) (*model.ConversionEvent, error)
	GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ConversionEvent, error)
	List(ctx context.Context, limit, offset int) ([]*model.ConversionEvent, error)
}

type ReachRepository interface {
	Create(ctx context.Context, reach *model.Reach) error
	CreateBatch(ctx context.Context, reaches []*model.Reach) error
	GetByID(ctx context.Context, id uint) (*model.Reach, error)
	GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Reach, error)
	GetByDate(ctx context.Context, date time.Time, limit, offset int) ([]*model.Reach, error)
	Update(ctx context.Context, reach *model.Reach) error
}

type RevenueReportRepository interface {
	Create(ctx context.Context, report *model.RevenueReport) error
	GetByID(ctx context.Context, id uint) (*model.RevenueReport, error)
	GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.RevenueReport, error)
	GetByDate(ctx context.Context, date time.Time, limit, offset int) ([]*model.RevenueReport, error)
	Update(ctx context.Context, report *model.RevenueReport) error
}

type viewLogRepository struct {
	db *gorm.DB
}

type clickLogRepository struct {
	db *gorm.DB
}

type conversionRepository struct {
	db *gorm.DB
}

type reachRepository struct {
	db *gorm.DB
}

type revenueReportRepository struct {
	db *gorm.DB
}

func NewViewLogRepository(db *gorm.DB) ViewLogRepository {
	return &viewLogRepository{db: db}
}

func (r *viewLogRepository) Create(ctx context.Context, log *model.ViewLog) error {
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *viewLogRepository) CreateBatch(ctx context.Context, logs []*model.ViewLog) error {
	return r.db.WithContext(ctx).Create(&logs).Error
}

func (r *viewLogRepository) GetByID(ctx context.Context, id uint) (*model.ViewLog, error) {
	var log model.ViewLog
	err := r.db.WithContext(ctx).First(&log, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrViewLogNotFound
		}
		return nil, err
	}
	return &log, nil
}

func (r *viewLogRepository) GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ViewLog, error) {
	var logs []*model.ViewLog
	err := r.db.WithContext(ctx).Where("content_id = ?", contentID).Order("timestamp desc").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, err
}

func (r *viewLogRepository) List(ctx context.Context, limit, offset int) ([]*model.ViewLog, error) {
	var logs []*model.ViewLog
	err := r.db.WithContext(ctx).Order("timestamp desc").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, err
}

func NewClickLogRepository(db *gorm.DB) ClickLogRepository {
	return &clickLogRepository{db: db}
}

func (r *clickLogRepository) Create(ctx context.Context, log *model.ClickLog) error {
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *clickLogRepository) CreateBatch(ctx context.Context, logs []*model.ClickLog) error {
	return r.db.WithContext(ctx).Create(&logs).Error
}

func (r *clickLogRepository) GetByID(ctx context.Context, id uint) (*model.ClickLog, error) {
	var log model.ClickLog
	err := r.db.WithContext(ctx).First(&log, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrClickLogNotFound
		}
		return nil, err
	}
	return &log, nil
}

func (r *clickLogRepository) GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ClickLog, error) {
	var logs []*model.ClickLog
	err := r.db.WithContext(ctx).Where("content_id = ?", contentID).Order("timestamp desc").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, err
}

func (r *clickLogRepository) List(ctx context.Context, limit, offset int) ([]*model.ClickLog, error) {
	var logs []*model.ClickLog
	err := r.db.WithContext(ctx).Order("timestamp desc").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, err
}

func NewConversionRepository(db *gorm.DB) ConversionRepository {
	return &conversionRepository{db: db}
}

func (r *conversionRepository) Create(ctx context.Context, conv *model.ConversionEvent) error {
	return r.db.WithContext(ctx).Create(conv).Error
}

func (r *conversionRepository) GetByID(ctx context.Context, id uint) (*model.ConversionEvent, error) {
	var conv model.ConversionEvent
	err := r.db.WithContext(ctx).First(&conv, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConversionNotFound
		}
		return nil, err
	}
	return &conv, nil
}

func (r *conversionRepository) GetByContent(ctx context.Context, contentID string, limit, offset int) ([]*model.ConversionEvent, error) {
	var convs []*model.ConversionEvent
	err := r.db.WithContext(ctx).Where("content_id = ?", contentID).Order("timestamp desc").Limit(limit).Offset(offset).Find(&convs).Error
	return convs, err
}

func (r *conversionRepository) List(ctx context.Context, limit, offset int) ([]*model.ConversionEvent, error) {
	var convs []*model.ConversionEvent
	err := r.db.WithContext(ctx).Order("timestamp desc").Limit(limit).Offset(offset).Find(&convs).Error
	return convs, err
}

func NewReachRepository(db *gorm.DB) ReachRepository {
	return &reachRepository{db: db}
}

func (r *reachRepository) Create(ctx context.Context, reach *model.Reach) error {
	return r.db.WithContext(ctx).Create(reach).Error
}

func (r *reachRepository) CreateBatch(ctx context.Context, reaches []*model.Reach) error {
	return r.db.WithContext(ctx).Create(&reaches).Error
}

func (r *reachRepository) GetByID(ctx context.Context, id uint) (*model.Reach, error) {
	var reach model.Reach
	err := r.db.WithContext(ctx).First(&reach, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrReachNotFound
		}
		return nil, err
	}
	return &reach, nil
}

func (r *reachRepository) GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Reach, error) {
	var reaches []*model.Reach
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Order("date desc").Limit(limit).Offset(offset).Find(&reaches).Error
	return reaches, err
}

func (r *reachRepository) GetByDate(ctx context.Context, date time.Time, limit, offset int) ([]*model.Reach, error) {
	var reaches []*model.Reach
	err := r.db.WithContext(ctx).Where("date = ?", date).Order("campaign_id asc").Limit(limit).Offset(offset).Find(&reaches).Error
	return reaches, err
}

func (r *reachRepository) Update(ctx context.Context, reach *model.Reach) error {
	return r.db.WithContext(ctx).Save(reach).Error
}

func NewRevenueReportRepository(db *gorm.DB) RevenueReportRepository {
	return &revenueReportRepository{db: db}
}

func (r *revenueReportRepository) Create(ctx context.Context, report *model.RevenueReport) error {
	return r.db.WithContext(ctx).Create(report).Error
}

func (r *revenueReportRepository) GetByID(ctx context.Context, id uint) (*model.RevenueReport, error) {
	var report model.RevenueReport
	err := r.db.WithContext(ctx).First(&report, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRevenueReportNotFound
		}
		return nil, err
	}
	return &report, nil
}

func (r *revenueReportRepository) GetByCampaign(ctx context.Context, campaignID uint, limit, offset int) ([]*model.RevenueReport, error) {
	var reports []*model.RevenueReport
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Order("date desc").Limit(limit).Offset(offset).Find(&reports).Error
	return reports, err
}

func (r *revenueReportRepository) GetByDate(ctx context.Context, date time.Time, limit, offset int) ([]*model.RevenueReport, error) {
	var reports []*model.RevenueReport
	err := r.db.WithContext(ctx).Where("date = ?", date).Order("campaign_id asc").Limit(limit).Offset(offset).Find(&reports).Error
	return reports, err
}

func (r *revenueReportRepository) Update(ctx context.Context, report *model.RevenueReport) error {
	return r.db.WithContext(ctx).Save(report).Error
}

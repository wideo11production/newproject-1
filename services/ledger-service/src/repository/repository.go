package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/ledger-service/src/model"
)

var (
	ErrAuditEventNotFound      = errors.New("audit event not found")
	ErrReconciliationNotFound  = errors.New("reconciliation not found")
	ErrReconciliationItemNotFound = errors.New("reconciliation item not found")
)

type AuditEventRepository interface {
	Create(ctx context.Context, event *model.AuditEvent) error
	GetByID(ctx context.Context, id uint) (*model.AuditEvent, error)
	GetByUUID(ctx context.Context, uuid string) (*model.AuditEvent, error)
	GetByEventType(ctx context.Context, eventType model.AuditEventType, limit, offset int) ([]*model.AuditEvent, error)
	GetBySource(ctx context.Context, source string, limit, offset int) ([]*model.AuditEvent, error)
	GetByTimeRange(ctx context.Context, start, end string, limit, offset int) ([]*model.AuditEvent, error)
	GetLatest(ctx context.Context) (*model.AuditEvent, error)
}

type ReconciliationRepository interface {
	Create(ctx context.Context, recon *model.Reconciliation) error
	GetByID(ctx context.Context, id uint) (*model.Reconciliation, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Reconciliation, error)
	GetBySource(ctx context.Context, source string, limit, offset int) ([]*model.Reconciliation, error)
	GetPending(ctx context.Context, limit int) ([]*model.Reconciliation, error)
	Update(ctx context.Context, recon *model.Reconciliation) error
}

type ReconciliationItemRepository interface {
	Create(ctx context.Context, item *model.ReconciliationItem) error
	CreateBatch(ctx context.Context, items []*model.ReconciliationItem) error
	GetByID(ctx context.Context, id uint) (*model.ReconciliationItem, error)
	GetByReconciliationID(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error)
	GetMismatches(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error)
	Update(ctx context.Context, item *model.ReconciliationItem) error
}

type auditEventRepository struct {
	db *gorm.DB
}

func NewAuditEventRepository(db *gorm.DB) AuditEventRepository {
	return &auditEventRepository{db: db}
}

func (r *auditEventRepository) Create(ctx context.Context, event *model.AuditEvent) error {
	return r.db.WithContext(ctx).Create(event).Error
}

func (r *auditEventRepository) GetByID(ctx context.Context, id uint) (*model.AuditEvent, error) {
	var event model.AuditEvent
	err := r.db.WithContext(ctx).First(&event, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAuditEventNotFound
		}
		return nil, err
	}
	return &event, nil
}

func (r *auditEventRepository) GetByUUID(ctx context.Context, uuid string) (*model.AuditEvent, error) {
	var event model.AuditEvent
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&event).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAuditEventNotFound
		}
		return nil, err
	}
	return &event, nil
}

func (r *auditEventRepository) GetByEventType(ctx context.Context, eventType model.AuditEventType, limit, offset int) ([]*model.AuditEvent, error) {
	var events []*model.AuditEvent
	err := r.db.WithContext(ctx).Where("event_type = ?", eventType).Order("created_at desc").Limit(limit).Offset(offset).Find(&events).Error
	return events, err
}

func (r *auditEventRepository) GetBySource(ctx context.Context, source string, limit, offset int) ([]*model.AuditEvent, error) {
	var events []*model.AuditEvent
	err := r.db.WithContext(ctx).Where("source = ?", source).Order("created_at desc").Limit(limit).Offset(offset).Find(&events).Error
	return events, err
}

func (r *auditEventRepository) GetByTimeRange(ctx context.Context, start, end string, limit, offset int) ([]*model.AuditEvent, error) {
	var events []*model.AuditEvent
	err := r.db.WithContext(ctx).Where("timestamp BETWEEN ? AND ?", start, end).Order("timestamp desc").Limit(limit).Offset(offset).Find(&events).Error
	return events, err
}

func (r *auditEventRepository) GetLatest(ctx context.Context) (*model.AuditEvent, error) {
	var event model.AuditEvent
	err := r.db.WithContext(ctx).Order("timestamp desc").First(&event).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAuditEventNotFound
		}
		return nil, err
	}
	return &event, nil
}

type reconciliationRepository struct {
	db *gorm.DB
}

func NewReconciliationRepository(db *gorm.DB) ReconciliationRepository {
	return &reconciliationRepository{db: db}
}

func (r *reconciliationRepository) Create(ctx context.Context, recon *model.Reconciliation) error {
	return r.db.WithContext(ctx).Create(recon).Error
}

func (r *reconciliationRepository) GetByID(ctx context.Context, id uint) (*model.Reconciliation, error) {
	var recon model.Reconciliation
	err := r.db.WithContext(ctx).First(&recon, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrReconciliationNotFound
		}
		return nil, err
	}
	return &recon, nil
}

func (r *reconciliationRepository) GetByUUID(ctx context.Context, uuid string) (*model.Reconciliation, error) {
	var recon model.Reconciliation
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&recon).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrReconciliationNotFound
		}
		return nil, err
	}
	return &recon, nil
}

func (r *reconciliationRepository) GetBySource(ctx context.Context, source string, limit, offset int) ([]*model.Reconciliation, error) {
	var recons []*model.Reconciliation
	err := r.db.WithContext(ctx).Where("source = ?", source).Order("created_at desc").Limit(limit).Offset(offset).Find(&recons).Error
	return recons, err
}

func (r *reconciliationRepository) GetPending(ctx context.Context, limit int) ([]*model.Reconciliation, error) {
	var recons []*model.Reconciliation
	err := r.db.WithContext(ctx).Where("status = ?", model.ReconStatusPending).Order("created_at asc").Limit(limit).Find(&recons).Error
	return recons, err
}

func (r *reconciliationRepository) Update(ctx context.Context, recon *model.Reconciliation) error {
	return r.db.WithContext(ctx).Save(recon).Error
}

type reconciliationItemRepository struct {
	db *gorm.DB
}

func NewReconciliationItemRepository(db *gorm.DB) ReconciliationItemRepository {
	return &reconciliationItemRepository{db: db}
}

func (r *reconciliationItemRepository) Create(ctx context.Context, item *model.ReconciliationItem) error {
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *reconciliationItemRepository) CreateBatch(ctx context.Context, items []*model.ReconciliationItem) error {
	return r.db.WithContext(ctx).Create(&items).Error
}

func (r *reconciliationItemRepository) GetByID(ctx context.Context, id uint) (*model.ReconciliationItem, error) {
	var item model.ReconciliationItem
	err := r.db.WithContext(ctx).First(&item, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrReconciliationItemNotFound
		}
		return nil, err
	}
	return &item, nil
}

func (r *reconciliationItemRepository) GetByReconciliationID(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error) {
	var items []*model.ReconciliationItem
	err := r.db.WithContext(ctx).Where("reconciliation_id = ?", reconID).Find(&items).Error
	return items, err
}

func (r *reconciliationItemRepository) GetMismatches(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error) {
	var items []*model.ReconciliationItem
	err := r.db.WithContext(ctx).Where("reconciliation_id = ? AND status = ?", reconID, model.ReconStatusMismatched).Find(&items).Error
	return items, err
}

func (r *reconciliationItemRepository) Update(ctx context.Context, item *model.ReconciliationItem) error {
	return r.db.WithContext(ctx).Save(item).Error
}

package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"newproject/services/billing-service/src/model"
)

var (
	ErrComplianceViolationNotFound = errors.New("compliance violation not found")
	ErrSystemLogNotFound           = errors.New("system log not found")
)

// ComplianceViolationRepository - compliance violation persistence boundary.
type ComplianceViolationRepository interface {
	// Create records a new violation.
	Create(ctx context.Context, v *model.ComplianceViolation) error
	// GetByUserID returns the latest violation for a user.
	GetByUserID(ctx context.Context, userID uint) (*model.ComplianceViolation, error)
	// ListByUserID returns all violations for a user.
	ListByUserID(ctx context.Context, userID uint) ([]*model.ComplianceViolation, error)
	// UpdateStatus changes the status and related fields.
	UpdateStatus(ctx context.Context, id uint, status string, updates map[string]any) error
	// CountByUserIDAndStatus counts violations of a given status for a user.
	CountByUserIDAndStatus(ctx context.Context, userID uint, status string) (int64, error)
}

type complianceViolationRepository struct {
	db *gorm.DB
}

func NewComplianceViolationRepository(db *gorm.DB) ComplianceViolationRepository {
	return &complianceViolationRepository{db: db}
}

func (r *complianceViolationRepository) Create(ctx context.Context, v *model.ComplianceViolation) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{UpdateAll: true}).Create(v).Error
}

func (r *complianceViolationRepository) GetByUserID(ctx context.Context, userID uint) (*model.ComplianceViolation, error) {
	var v model.ComplianceViolation
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").First(&v).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrComplianceViolationNotFound
		}
		return nil, err
	}
	return &v, nil
}

func (r *complianceViolationRepository) ListByUserID(ctx context.Context, userID uint) ([]*model.ComplianceViolation, error) {
	var vs []*model.ComplianceViolation
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Find(&vs).Error
	if err != nil {
		return nil, err
	}
	return vs, nil
}

func (r *complianceViolationRepository) UpdateStatus(ctx context.Context, id uint, status string, updates map[string]any) error {
	updates["status"] = status
	updates["updated_at"] = time.Now().UTC()
	return r.db.WithContext(ctx).Model(&model.ComplianceViolation{}).Where("id = ?", id).Updates(updates).Error
}

func (r *complianceViolationRepository) CountByUserIDAndStatus(ctx context.Context, userID uint, status string) (int64, error) {
	var n int64
	r.db.WithContext(ctx).Model(&model.ComplianceViolation{}).Where("user_id = ? AND status = ?", userID, status).Count(&n)
	return n, nil
}

// SystemLogRepository - system notification log persistence boundary.
type SystemLogRepository interface {
	// Create records a new system log entry.
	Create(ctx context.Context, l *model.SystemLog) error
	// ListByUserID returns all logs for a user.
	ListByUserID(ctx context.Context, userID uint) ([]*model.SystemLog, error)
}

type systemLogRepository struct {
	db *gorm.DB
}

func NewSystemLogRepository(db *gorm.DB) SystemLogRepository {
	return &systemLogRepository{db: db}
}

func (r *systemLogRepository) Create(ctx context.Context, l *model.SystemLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *systemLogRepository) ListByUserID(ctx context.Context, userID uint) ([]*model.SystemLog, error) {
	var ls []*model.SystemLog
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Find(&ls).Error
	if err != nil {
		return nil, err
	}
	return ls, nil
}

package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"newproject/services/billing-service/src/model"
)

// ErrStudentIdentityNotFound - user ka student record nahi.
var ErrStudentIdentityNotFound = errors.New("student_identity_not_found")

// StudentIdentityRepository - AURA student gate ka storage boundary.
// Service sirf ye interface janti hai (test fake ke liye bhi).
type StudentIdentityRepository interface {
	// GetByUserID returns the user's student record.
	GetByUserID(ctx context.Context, userID uint) (*model.StudentIdentity, error)
	// Upsert creates-or-updates (manual review result ya re-verify).
	// OnConflict UpdateAll: user_id unique conflict par sab
	// fields overwrite honge — naya token, naya expiry, naya status.
	Upsert(ctx context.Context, identity *model.StudentIdentity) error
	// RevokeByUserID - educational violation par status revoked +
	// token cleared. Idempotent: agar already revoked/not-verified
	// to RowsAffected 0, error nahi (safe double-call).
	RevokeByUserID(ctx context.Context, userID uint) error
	// IsVerified - REAL verification check: flag true AND status
	// 'verified' AND token expiry in future.
	IsVerified(ctx context.Context, userID uint) bool
}

type studentIdentityRepository struct {
	db *gorm.DB
}

func NewStudentIdentityRepository(db *gorm.DB) StudentIdentityRepository {
	return &studentIdentityRepository{db: db}
}

func (r *studentIdentityRepository) GetByUserID(ctx context.Context, userID uint) (*model.StudentIdentity, error) {
	var si model.StudentIdentity
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&si).Error
	if err != nil {
		return nil, err
	}
	return &si, nil
}

func (r *studentIdentityRepository) Upsert(ctx context.Context, identity *model.StudentIdentity) error {
	// OnConflict UpdateAll = create karo ya existing overwrite karo.
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{UpdateAll: true}).Create(identity).Error
}

func (r *studentIdentityRepository) RevokeByUserID(ctx context.Context, userID uint) error {
	// Conditional update: sirf abhi verified & active row ko hi
	// revoke karo — double-revoke idempotent (RowsAffected 0 = nil).
	now := time.Now()
	res := r.db.WithContext(ctx).
		Model(&model.StudentIdentity{}).
		Where("user_id = ? AND is_verified_student = ? AND status = ? AND identity_token_expires_at > ?",
			userID, true, model.StudentStatusVerified, now).
		Updates(map[string]any{
			"is_verified_student": false,
			"status":              model.StudentStatusRevoked,
			"identity_token":      "",
			"identity_token_expires_at": nil,
		})
	if res.Error != nil {
		return res.Error
	}
	// RowsAffected 0 = already revoked/not-verified — treat as success
	// (the END STATE the caller asked for is achieved).
	return nil
}

func (r *studentIdentityRepository) IsVerified(ctx context.Context, userID uint) bool {
	// REAL check — sirf flag nahi, status + expiry bhi. Ek
	// expired token ya revoked status = discount ineligible.
	var n int64
	r.db.WithContext(ctx).Model(&model.StudentIdentity{}).
		Where("user_id = ? AND is_verified_student = ? AND status = ? AND identity_token_expires_at > ?",
			userID, true, model.StudentStatusVerified, time.Now()).
		Count(&n)
	return n > 0
}

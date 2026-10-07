// StudentVerificationRepository — GORM repository for StudentVerification model.
//
// Hinglish: ye repository student_verifications table ke CRUD operations handle
// karta hai. Dual-gate logic SERVICE layer mein hai (ye sirf data access hai).
// Repository interface use karta hai taaki tests mein fake laga sakein.
package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/user-service/src/model"
)

var (
	ErrStudentVerificationNotFound = errors.New("student verification not found")
)

// StudentVerificationRepository — interface for student verification persistence.
type StudentVerificationRepository interface {
	Create(ctx context.Context, sv *model.StudentVerification) error
	GetByUserID(ctx context.Context, userID uint) (*model.StudentVerification, error)
	Update(ctx context.Context, sv *model.StudentVerification) error
	Delete(ctx context.Context, userID uint) error
}

type studentVerificationRepository struct {
	db *gorm.DB
}

func NewStudentVerificationRepository(db *gorm.DB) StudentVerificationRepository {
	return &studentVerificationRepository{db: db}
}

// Create — insert new verification record.
func (r *studentVerificationRepository) Create(ctx context.Context, sv *model.StudentVerification) error {
	return r.db.WithContext(ctx).Create(sv).Error
}

// GetByUserID — fetch verification by user ID.
// Returns ErrStudentVerificationNotFound agar koi record nahi hai.
func (r *studentVerificationRepository) GetByUserID(ctx context.Context, userID uint) (*model.StudentVerification, error) {
	var sv model.StudentVerification
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&sv).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrStudentVerificationNotFound
		}
		return nil, err
	}
	return &sv, nil
}

// Update — upsert verification record.
func (r *studentVerificationRepository) Update(ctx context.Context, sv *model.StudentVerification) error {
	return r.db.WithContext(ctx).Save(sv).Error
}

// Delete — verification record delete kar (re-apply ke liye).
func (r *studentVerificationRepository) Delete(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.StudentVerification{}).Error
}

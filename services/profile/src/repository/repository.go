package repository

import (
	"context"
	"errors"

	"github.com/newproject/services/profile/src/model"
	"gorm.io/gorm"
)

var (
	ErrProfileNotFound = errors.New("profile not found")
)

// ProfileRepository defines methods for profile storage
type ProfileRepository interface {
	Create(ctx context.Context, profile *model.Profile) error
	GetByID(ctx context.Context, id uint) (*model.Profile, error)
	GetByUserID(ctx context.Context, userID uint) (*model.Profile, error)
	Update(ctx context.Context, profile *model.Profile) error
	DeleteByID(ctx context.Context, id uint) error
}

// profileRepository implements ProfileRepository using GORM
type profileRepository struct {
	db *gorm.DB
}

// NewProfileRepository creates a new ProfileRepository
func NewProfileRepository(db *gorm.DB) ProfileRepository {
	return &profileRepository{db: db}
}

func (r *profileRepository) Create(ctx context.Context, profile *model.Profile) error {
	return r.db.WithContext(ctx).Create(profile).Error
}

func (r *profileRepository) GetByID(ctx context.Context, id uint) (*model.Profile, error) {
	var profile model.Profile
	err := r.db.WithContext(ctx).First(&profile, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

func (r *profileRepository) GetByUserID(ctx context.Context, userID uint) (*model.Profile, error) {
	var profile model.Profile
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&profile).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

func (r *profileRepository) Update(ctx context.Context, profile *model.Profile) error {
	return r.db.WithContext(ctx).Save(profile).Error
}

func (r *profileRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Profile{}).Error
}
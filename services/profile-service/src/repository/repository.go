package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/profile-service/src/model"
)

var (
	ErrProfileNotFound     = errors.New("profile not found")
	ErrPreferenceNotFound  = errors.New("preferences not found")
)

type ProfileRepository interface {
	Create(ctx context.Context, profile *model.Profile) error
	GetByID(ctx context.Context, id uint) (*model.Profile, error)
	GetByUserID(ctx context.Context, userID uint) (*model.Profile, error)
	GetByUsername(ctx context.Context, username string) (*model.Profile, error)
	Update(ctx context.Context, profile *model.Profile) error
	Delete(ctx context.Context, id uint) error
}

type PreferenceRepository interface {
	Create(ctx context.Context, pref *model.UserPreference) error
	GetByUserID(ctx context.Context, userID uint) (*model.UserPreference, error)
	Update(ctx context.Context, pref *model.UserPreference) error
	Delete(ctx context.Context, userID uint) error
}

type profileRepository struct {
	db *gorm.DB
}

func NewProfileRepository(db *gorm.DB) ProfileRepository {
	return &profileRepository{db: db}
}

func (r *profileRepository) Create(ctx context.Context, profile *model.Profile) error {
	return r.db.WithContext(ctx).Create(profile).Error
}

func (r *profileRepository) GetByID(ctx context.Context, id uint) (*model.Profile, error) {
	var profile model.Profile
	err := r.db.WithContext(ctx).First(&profile, id).Error
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

func (r *profileRepository) GetByUsername(ctx context.Context, username string) (*model.Profile, error) {
	var profile model.Profile
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&profile).Error
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

func (r *profileRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Profile{}, id).Error
}

type preferenceRepository struct {
	db *gorm.DB
}

func NewPreferenceRepository(db *gorm.DB) PreferenceRepository {
	return &preferenceRepository{db: db}
}

func (r *preferenceRepository) Create(ctx context.Context, pref *model.UserPreference) error {
	return r.db.WithContext(ctx).Create(pref).Error
}

func (r *preferenceRepository) GetByUserID(ctx context.Context, userID uint) (*model.UserPreference, error) {
	var pref model.UserPreference
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&pref).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPreferenceNotFound
		}
		return nil, err
	}
	return &pref, nil
}

func (r *preferenceRepository) Update(ctx context.Context, pref *model.UserPreference) error {
	return r.db.WithContext(ctx).Save(pref).Error
}

func (r *preferenceRepository) Delete(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.UserPreference{}).Error
}

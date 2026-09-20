package repository

import (
	"context"
	"errors"

	"newproject/services/push-preferences/src/model"
	"gorm.io/gorm"
)

var (
	ErrPreferencesNotFound = errors.New("preferences not found")
	ErrDeviceNotFound      = errors.New("device not found")
)

type PreferencesRepository interface {
	Create(ctx context.Context, prefs *model.UserPreferences) error
	GetByUserID(ctx context.Context, userID uint) (*model.UserPreferences, error)
	Update(ctx context.Context, prefs *model.UserPreferences) error
	DeleteByUserID(ctx context.Context, userID uint) error
}

type DeviceRepository interface {
	Create(ctx context.Context, dev *model.DevicePreference) error
	GetByDeviceID(ctx context.Context, deviceID string) (*model.DevicePreference, error)
	GetByUserID(ctx context.Context, userID uint) ([]*model.DevicePreference, error)
	Update(ctx context.Context, dev *model.DevicePreference) error
	DeleteByDeviceID(ctx context.Context, deviceID string) error
	DeleteByUserID(ctx context.Context, userID uint) error
}

type preferencesRepository struct {
	db *gorm.DB
}

func NewPreferencesRepository(db *gorm.DB) PreferencesRepository {
	return &preferencesRepository{db: db}
}

func (r *preferencesRepository) Create(ctx context.Context, prefs *model.UserPreferences) error {
	return r.db.WithContext(ctx).Create(prefs).Error
}

func (r *preferencesRepository) GetByUserID(ctx context.Context, userID uint) (*model.UserPreferences, error) {
	var prefs model.UserPreferences
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&prefs).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPreferencesNotFound
		}
		return nil, err
	}
	return &prefs, nil
}

func (r *preferencesRepository) Update(ctx context.Context, prefs *model.UserPreferences) error {
	return r.db.WithContext(ctx).Save(prefs).Error
}

func (r *preferencesRepository) DeleteByUserID(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.UserPreferences{}).Error
}

type deviceRepository struct {
	db *gorm.DB
}

func NewDeviceRepository(db *gorm.DB) DeviceRepository {
	return &deviceRepository{db: db}
}

func (r *deviceRepository) Create(ctx context.Context, dev *model.DevicePreference) error {
	return r.db.WithContext(ctx).Create(dev).Error
}

func (r *deviceRepository) GetByDeviceID(ctx context.Context, deviceID string) (*model.DevicePreference, error) {
	var dev model.DevicePreference
	err := r.db.WithContext(ctx).Where("device_id = ?", deviceID).Preload("Categories").First(&dev).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &dev, nil
}

func (r *deviceRepository) GetByUserID(ctx context.Context, userID uint) ([]*model.DevicePreference, error) {
	var devs []*model.DevicePreference
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Preload("Categories").Find(&devs).Error
	return devs, err
}

func (r *deviceRepository) Update(ctx context.Context, dev *model.DevicePreference) error {
	return r.db.WithContext(ctx).Save(dev).Error
}

func (r *deviceRepository) DeleteByDeviceID(ctx context.Context, deviceID string) error {
	return r.db.WithContext(ctx).Where("device_id = ?", deviceID).Delete(&model.DevicePreference{}).Error
}

func (r *deviceRepository) DeleteByUserID(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.DevicePreference{}).Error
}

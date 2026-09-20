package repository

import (
	"context"
	"errors"

	"newproject/services/settings/src/model"
	"gorm.io/gorm"
)

var (
	ErrSettingNotFound = errors.New("setting not found")
)

// SettingRepository defines methods for setting storage
type SettingRepository interface {
	Create(ctx context.Context, setting *model.Setting) error
	GetByID(ctx context.Context, id uint) (*model.Setting, error)
	GetByKey(ctx context.Context, key string) (*model.Setting, error)
	Update(ctx context.Context, setting *model.Setting) error
	DeleteByID(ctx context.Context, id uint) error
	List(ctx context.Context) ([]*model.Setting, error)
}

// settingRepository implements SettingRepository using GORM
type settingRepository struct {
	db *gorm.DB
}

// NewSettingRepository creates a new SettingRepository
func NewSettingRepository(db *gorm.DB) SettingRepository {
	return &settingRepository{db: db}
}

func (r *settingRepository) Create(ctx context.Context, setting *model.Setting) error {
	return r.db.WithContext(ctx).Create(setting).Error
}

func (r *settingRepository) GetByID(ctx context.Context, id uint) (*model.Setting, error) {
	var setting model.Setting
	err := r.db.WithContext(ctx).First(&setting, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSettingNotFound
		}
		return nil, err
	}
	return &setting, nil
}

func (r *settingRepository) GetByKey(ctx context.Context, key string) (*model.Setting, error) {
	var setting model.Setting
	err := r.db.WithContext(ctx).Where("key = ?", key).First(&setting).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSettingNotFound
		}
		return nil, err
	}
	return &setting, nil
}

func (r *settingRepository) Update(ctx context.Context, setting *model.Setting) error {
	return r.db.WithContext(ctx).Save(setting).Error
}

func (r *settingRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Setting{}).Error
}

func (r *settingRepository) List(ctx context.Context) ([]*model.Setting, error) {
	var settings []*model.Setting
	err := r.db.WithContext(ctx).Find(&settings).Error
	if err != nil {
		return nil, err
	}
	return settings, nil
}
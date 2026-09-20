package service

import (
	"context"
	"errors"

	"newproject/services/settings/src/model"
	"newproject/services/settings/src/repository"
)

var (
	ErrSettingExists  = errors.New("setting already exists")
	ErrSettingNotFound = repository.ErrSettingNotFound
)

// SettingService handles settings-related business logic
type SettingService struct {
	settingRepo repository.SettingRepository
}

// NewSettingService creates a new SettingService
func NewSettingService(repo repository.SettingRepository) *SettingService {
	return &SettingService{
		settingRepo: repo,
	}
}

// CreateSetting creates a new setting
func (s *SettingService) CreateSetting(
	ctx context.Context,
	key string,
	value string,
	description string,
) (*model.Setting, error) {
	// Check if setting already exists by key
	if existing, err := s.settingRepo.GetByKey(ctx, key); err == nil && existing != nil {
		return nil, ErrSettingExists
	}
	// Create new setting
	setting := &model.Setting{
		Key:         key,
		Value:       value,
		Description: description,
	}
	if err := s.settingRepo.Create(ctx, setting); err != nil {
		return nil, err
	}
	return setting, nil
}

// GetSettingByID returns a setting by ID
func (s *SettingService) GetSettingByID(
	ctx context.Context,
	id uint,
) (*model.Setting, error) {
	return s.settingRepo.GetByID(ctx, id)
}

// GetSettingByKey returns a setting by key
func (s *SettingService) GetSettingByKey(
	ctx context.Context,
	key string,
) (*model.Setting, error) {
	return s.settingRepo.GetByKey(ctx, key)
}

// UpdateSetting updates an existing setting
func (s *SettingService) UpdateSetting(
	ctx context.Context,
	setting *model.Setting,
) error {
	// Check if setting exists
	if _, err := s.settingRepo.GetByID(ctx, setting.ID); err != nil {
		return err
	}
	// Update the setting
	return s.settingRepo.Update(ctx, setting)
}

// DeleteSetting deletes a setting by ID
func (s *SettingService) DeleteSetting(
	ctx context.Context,
	id uint,
) error {
	// Check if setting exists
	if _, err := s.settingRepo.GetByID(ctx, id); err != nil {
		return err
	}
	// Delete the setting
	return s.settingRepo.DeleteByID(ctx, id)
}

// ListSettings returns a list of all settings
func (s *SettingService) ListSettings(
	ctx context.Context,
) ([]*model.Setting, error) {
	return s.settingRepo.List(ctx)
}
package service

import (
	"context"
	"fmt"

	"newproject/services/push-preferences/src/model"
	"newproject/services/push-preferences/src/repository"
)

type PreferencesService struct {
	prefsRepo repository.PreferencesRepository
	devRepo   repository.DeviceRepository
}

func NewPreferencesService(prefsRepo repository.PreferencesRepository, devRepo repository.DeviceRepository) *PreferencesService {
	return &PreferencesService{
		prefsRepo: prefsRepo,
		devRepo:   devRepo,
	}
}

func (s *PreferencesService) GetUserPreferences(ctx context.Context, userID uint) (*model.UserPreferences, error) {
	prefs, err := s.prefsRepo.GetByUserID(ctx, userID)
	if err != nil {
		if err == repository.ErrPreferencesNotFound {
			prefs = &model.UserPreferences{
				UserID: userID,
				Categories: map[model.NotificationCategory]bool{
					model.CategoryVideo:    true,
					model.CategoryComments: true,
					model.CategoryLive:     true,
					model.CategoryAds:      false,
					model.CategorySystem:   true,
				},
				QuietHours: &model.QuietHours{Enabled: false},
				FrequencyCap: &model.FrequencyCap{
					PerHour: 10,
					PerDay:  100,
					PerWeek: 700,
				},
				Timezone: "UTC",
			}
			if err := s.prefsRepo.Create(ctx, prefs); err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}
	return prefs, nil
}

func (s *PreferencesService) UpdateUserPreferences(ctx context.Context, userID uint, prefs *model.UserPreferences) error {
	existing, err := s.prefsRepo.GetByUserID(ctx, userID)
	if err != nil {
		if err == repository.ErrPreferencesNotFound {
			prefs.UserID = userID
			return s.prefsRepo.Create(ctx, prefs)
		}
		return err
	}
	existing.Categories = prefs.Categories
	existing.QuietHours = prefs.QuietHours
	existing.FrequencyCap = prefs.FrequencyCap
	existing.Timezone = prefs.Timezone
	return s.prefsRepo.Update(ctx, existing)
}

func (s *PreferencesService) DeleteUserPreferences(ctx context.Context, userID uint) error {
	return s.prefsRepo.DeleteByUserID(ctx, userID)
}

func (s *PreferencesService) IsCategoryEnabled(ctx context.Context, userID uint, category model.NotificationCategory) (bool, error) {
	prefs, err := s.GetUserPreferences(ctx, userID)
	if err != nil {
		return false, err
	}
	enabled, ok := prefs.Categories[category]
	return ok && enabled, nil
}

func (s *PreferencesService) GetDevices(ctx context.Context, userID uint) ([]*model.DevicePreference, error) {
	return s.devRepo.GetByUserID(ctx, userID)
}

func (s *PreferencesService) AddDevice(ctx context.Context, dev *model.DevicePreference) error {
	if _, err := s.devRepo.GetByDeviceID(ctx, dev.DeviceID); err == nil {
		return fmt.Errorf("device already exists")
	}
	return s.devRepo.Create(ctx, dev)
}

func (s *PreferencesService) UpdateDevice(ctx context.Context, dev *model.DevicePreference) error {
	existing, err := s.devRepo.GetByDeviceID(ctx, dev.DeviceID)
	if err != nil {
		return err
	}
	existing.Enabled = dev.Enabled
	existing.UserAgent = dev.UserAgent
	return s.devRepo.Update(ctx, existing)
}

func (s *PreferencesService) DeleteDevice(ctx context.Context, deviceID string) error {
	return s.devRepo.DeleteByDeviceID(ctx, deviceID)
}

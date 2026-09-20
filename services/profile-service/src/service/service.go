package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"newproject/services/profile-service/src/model"
	"newproject/services/profile-service/src/repository"
)

type ProfileService struct {
	profileRepo   repository.ProfileRepository
	prefRepo      repository.PreferenceRepository
}

func NewProfileService(profileRepo repository.ProfileRepository, prefRepo repository.PreferenceRepository) *ProfileService {
	return &ProfileService{
		profileRepo: profileRepo,
		prefRepo:    prefRepo,
	}
}

func (s *ProfileService) CreateProfile(ctx context.Context, req CreateProfileRequest) (*model.Profile, error) {
	profile := &model.Profile{
		UUID:        uuid.New(),
		UserID:      req.UserID,
		Username:    req.Username,
		Email:       req.Email,
		DisplayName: req.DisplayName,
		Bio:         req.Bio,
		AvatarURL:   req.AvatarURL,
		Website:     req.Website,
		Location:    req.Location,
		Language:    req.Language,
	}

	if profile.DisplayName == "" {
		profile.DisplayName = req.Username
	}
	if profile.Language == "" {
		profile.Language = "en"
	}

	if err := s.profileRepo.Create(ctx, profile); err != nil {
		return nil, err
	}

	pref := &model.UserPreference{
		UserID:     req.UserID,
		Theme:      "system",
		EmailNotif: true,
		PushNotif:  true,
		Language:   profile.Language,
		Timezone:   "UTC",
	}
	_ = s.prefRepo.Create(ctx, pref)

	return profile, nil
}

func (s *ProfileService) GetProfileByID(ctx context.Context, id uint) (*model.Profile, error) {
	return s.profileRepo.GetByID(ctx, id)
}

func (s *ProfileService) GetProfileByUserID(ctx context.Context, userID uint) (*model.Profile, error) {
	return s.profileRepo.GetByUserID(ctx, userID)
}

func (s *ProfileService) GetProfileByUsername(ctx context.Context, username string) (*model.Profile, error) {
	return s.profileRepo.GetByUsername(ctx, username)
}

func (s *ProfileService) UpdateProfile(ctx context.Context, userID uint, req UpdateProfileRequest) (*model.Profile, error) {
	profile, err := s.profileRepo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	if req.DisplayName != nil {
		profile.DisplayName = *req.DisplayName
	}
	if req.Bio != nil {
		profile.Bio = *req.Bio
	}
	if req.AvatarURL != nil {
		profile.AvatarURL = *req.AvatarURL
	}
	if req.Website != nil {
		profile.Website = *req.Website
	}
	if req.Location != nil {
		profile.Location = *req.Location
	}
	if req.Birthdate != nil {
		profile.Birthdate = req.Birthdate
	}
	if req.Gender != nil {
		profile.Gender = *req.Gender
	}
	if req.Country != nil {
		profile.Country = *req.Country
	}
	if req.Language != nil {
		profile.Language = *req.Language
	}
	if req.Private != nil {
		profile.Private = *req.Private
	}

	profile.UpdatedAt = time.Now()
	if err := s.profileRepo.Update(ctx, profile); err != nil {
		return nil, err
	}

	return profile, nil
}

func (s *ProfileService) DeleteProfile(ctx context.Context, userID uint) error {
	profile, err := s.profileRepo.GetByUserID(ctx, userID)
	if err != nil {
		return err
	}
	return s.profileRepo.Delete(ctx, profile.ID)
}

func (s *ProfileService) GetUserPreferences(ctx context.Context, userID uint) (*model.UserPreference, error) {
	pref, err := s.prefRepo.GetByUserID(ctx, userID)
	if err != nil {
		if err == repository.ErrPreferenceNotFound {
			pref = &model.UserPreference{
				UserID:     userID,
				Theme:      "system",
				EmailNotif: true,
				PushNotif:  true,
				Language:   "en",
				Timezone:   "UTC",
			}
			if err := s.prefRepo.Create(ctx, pref); err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}
	return pref, nil
}

func (s *ProfileService) UpdateUserPreferences(ctx context.Context, userID uint, req UpdatePreferenceRequest) (*model.UserPreference, error) {
	pref, err := s.prefRepo.GetByUserID(ctx, userID)
	if err != nil {
		if err == repository.ErrPreferenceNotFound {
			pref = &model.UserPreference{UserID: userID}
		} else {
			return nil, err
		}
	}

	if req.Theme != nil {
		pref.Theme = *req.Theme
	}
	if req.EmailNotif != nil {
		pref.EmailNotif = *req.EmailNotif
	}
	if req.PushNotif != nil {
		pref.PushNotif = *req.PushNotif
	}
	if req.Language != nil {
		pref.Language = *req.Language
	}
	if req.Timezone != nil {
		pref.Timezone = *req.Timezone
	}

	pref.UpdatedAt = time.Now()
	if err := s.prefRepo.Update(ctx, pref); err != nil {
		return nil, err
	}

	return pref, nil
}

func (s *ProfileService) IncrementViewCount(ctx context.Context, userID uint) error {
	profile, err := s.profileRepo.GetByUserID(ctx, userID)
	if err != nil {
		return err
	}
	profile.ViewCount++
	return s.profileRepo.Update(ctx, profile)
}

func (s *ProfileService) IncrementSubscriberCount(ctx context.Context, userID uint) error {
	profile, err := s.profileRepo.GetByUserID(ctx, userID)
	if err != nil {
		return err
	}
	profile.SubscriberCount++
	return s.profileRepo.Update(ctx, profile)
}

type CreateProfileRequest struct {
	UserID      uint  `json:"user_id" binding:"required"`
	Username    string `json:"username" binding:"required"`
	Email       string `json:"email" binding:"required,email"`
	DisplayName string `json:"display_name,omitempty"`
	Bio         string `json:"bio,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Website     string `json:"website,omitempty"`
	Location    string `json:"location,omitempty"`
	Language    string `json:"language,omitempty"`
}

type UpdateProfileRequest struct {
	DisplayName *string    `json:"display_name,omitempty"`
	Bio         *string    `json:"bio,omitempty"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Website     *string    `json:"website,omitempty"`
	Location    *string    `json:"location,omitempty"`
	Gender      *string    `json:"gender,omitempty"`
	Country     *string    `json:"country,omitempty"`
	Language    *string    `json:"language,omitempty"`
	Private     *bool      `json:"private,omitempty"`
	Birthdate   *time.Time `json:"birthdate,omitempty"`
}

type UpdatePreferenceRequest struct {
	Theme     *string `json:"theme,omitempty"`
	EmailNotif *bool   `json:"email_notifications,omitempty"`
	PushNotif  *bool   `json:"push_notifications,omitempty"`
	Language   *string `json:"language,omitempty"`
	Timezone   *string `json:"timezone,omitempty"`
}

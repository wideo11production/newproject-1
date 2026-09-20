package service

import (
	"context"

	"newproject/services/profile/src/model"
	"newproject/services/profile/src/repository"
)

type ProfileService struct {
	profileRepo repository.ProfileRepository
}

func NewProfileService(profileRepo repository.ProfileRepository) *ProfileService {
	return &ProfileService{
		profileRepo: profileRepo,
	}
}

func (s *ProfileService) CreateProfile(ctx context.Context, userID uint, bio string, avatarURL string) (*model.Profile, error) {
	profile := &model.Profile{
		UserID:    userID,
		Bio:       bio,
		AvatarURL: avatarURL,
	}
	if err := s.profileRepo.Create(ctx, profile); err != nil {
		return nil, err
	}
	return profile, nil
}

func (s *ProfileService) GetProfileByID(ctx context.Context, id uint) (*model.Profile, error) {
	return s.profileRepo.GetByID(ctx, id)
}

func (s *ProfileService) GetProfileByUserID(ctx context.Context, userID uint) (*model.Profile, error) {
	return s.profileRepo.GetByUserID(ctx, userID)
}

func (s *ProfileService) UpdateProfile(ctx context.Context, profile *model.Profile) error {
	return s.profileRepo.Update(ctx, profile)
}

func (s *ProfileService) DeleteProfile(ctx context.Context, id uint) error {
	return s.profileRepo.DeleteByID(ctx, id)
}


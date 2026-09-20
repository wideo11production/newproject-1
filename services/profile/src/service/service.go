package service

import (
	"context"
	"errors"

	"github.com/newproject/services/profile/src/model"
	"github.com/newproject/services/profile/src/repository"
)

// UserService defines methods to check user existence
type UserService interface {
	GetUserByID(context.Context, uint) (*model.User, error)
}

// ProfileService handles profile-related business logic
type ProfileService struct {
	profileRepo repository.ProfileRepository
	userService UserService
}

// NewProfileService creates a new ProfileService
func NewProfileService(repo repository.ProfileRepository, us UserService) *ProfileService {
	return &ProfileService{
		profileRepo: repo,
		userService: us,
	}
}

// CreateProfile creates a new profile for a user
func (s *ProfileService) CreateProfile(
	ctx context.Context,
	userID uint,
	bio string,
	avatarURL string,
) (*model.Profile, error) {
	// Check if user exists
	if _, err := s.userService.GetUserByID(ctx, userID); err != nil {
		return nil, err
	}
	// Check if profile already exists for this user
	if existing, err := s.profileRepo.GetByUserID(ctx, userID); err == nil && existing != nil {
		return nil, errors.New("profile already exists for this user")
	}
	// Create new profile
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

// GetProfileByID returns a profile by ID
func (s *ProfileService) GetProfileByID(
	ctx context.Context,
	id uint,
) (*model.Profile, error) {
	return s.profileRepo.GetByID(ctx, id)
}

// GetProfileByUserID returns a profile by user ID
func (s *ProfileService) GetProfileByUserID(
	ctx context.Context,
	userID uint,
) (*model.Profile, error) {
	return s.profileRepo.GetByUserID(ctx, userID)
}

// UpdateProfile updates an existing profile
func (s *ProfileService) UpdateProfile(
	ctx context.Context,
	profile *model.Profile,
) error {
	// Check if profile exists
	if _, err := s.profileRepo.GetByID(ctx, profile.ID); err != nil {
		return err
	}
	// Update the profile
	return s.profileRepo.Update(ctx, profile)
}

// DeleteProfile deletes a profile by ID
func (s *ProfileService) DeleteProfile(
	ctx context.Context,
	id uint,
) error {
	// Check if profile exists
	if _, err := s.profileRepo.GetByID(ctx, id); err != nil {
		return err
	}
	// Delete the profile
	return s.profileRepo.DeleteByID(ctx, id)
}
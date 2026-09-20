package service

import (
	"context"

	"github.com/google/uuid"
	"newproject/services/user/src/model"
	"newproject/services/user/src/repository"
)

// UserService handles user-related business logic
type UserService struct {
	userRepo repository.UserRepository
}

var (
	ErrUserNotFound = repository.ErrUserNotFound
	ErrUserExists   = repository.ErrUserExists
)

// NewUserService creates a new UserService
func NewUserService(repo repository.UserRepository) *UserService {
	return &UserService{
		userRepo: repo,
	}
}

// CreateUser creates a new user
func (s *UserService) CreateUser(
	ctx context.Context,
	email string,
	name string,
) (*model.User, error) {
	// Check if user already exists by email
	existing, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil && err != repository.ErrUserNotFound {
		return nil, err
	}
	if existing != nil {
		return nil, repository.ErrUserExists
	}

	// Create new user
	user := &model.User{
		UUID:  uuid.New(),
		Email: email,
		Name:  name,
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

// GetUserByID returns a user by ID
func (s *UserService) GetUserByID(
	ctx context.Context,
	id uint,
) (*model.User, error) {
	return s.userRepo.GetByID(ctx, id)
}

// GetUserByUUID returns a user by UUID
func (s *UserService) GetUserByUUID(
	ctx context.Context,
	uuid uuid.UUID,
) (*model.User, error) {
	return s.userRepo.GetByUUID(ctx, uuid)
}

// GetUserByEmail returns a user by email
func (s *UserService) GetUserByEmail(
	ctx context.Context,
	email string,
) (*model.User, error) {
	return s.userRepo.GetByEmail(ctx, email)
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(
	ctx context.Context,
	user *model.User,
) error {
	// Check if user exists
	existing, err := s.userRepo.GetByID(ctx, user.ID)
	if err != nil {
		return err
	}
	if existing == nil {
		return repository.ErrUserNotFound
	}
	// Update the user
	return s.userRepo.Update(ctx, user)
}

// DeleteUser deletes a user by ID
func (s *UserService) DeleteUser(
	ctx context.Context,
	id uint,
) error {
	// Check if user exists
	existing, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return repository.ErrUserNotFound
	}
	// Delete the user
	return s.userRepo.DeleteByID(ctx, id)
}

// ListUsers returns a paginated list of users
func (s *UserService) ListUsers(
	ctx context.Context,
	page int,
	pageSize int,
) ([]*model.User, int64, error) {
	return s.userRepo.List(ctx, page, pageSize)
}
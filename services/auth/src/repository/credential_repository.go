package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"newproject/services/auth/src/model"
	"gorm.io/gorm"
)

var (
	ErrCredentialNotFound = errors.New("credential not found")
)

type CredentialRepository interface {
	Create(ctx context.Context, credential *model.Credential) error
	GetByID(ctx context.Context, id uint) (*model.Credential, error)
	GetByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Credential, error)
	GetByCredentialID(ctx context.Context, credentialID []byte) (*model.Credential, error)
	Update(ctx context.Context, credential *model.Credential) error
	Delete(ctx context.Context, id uint) error
}

type credentialRepository struct {
	db *gorm.DB
}

func NewCredentialRepository(db *gorm.DB) CredentialRepository {
	return &credentialRepository{db: db}
}

func (r *credentialRepository) Create(ctx context.Context, credential *model.Credential) error {
	return r.db.WithContext(ctx).Create(credential).Error
}

func (r *credentialRepository) GetByID(ctx context.Context, id uint) (*model.Credential, error) {
	var credential model.Credential
	err := r.db.WithContext(ctx).First(&credential, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCredentialNotFound
		}
		return nil, err
	}
	return &credential, nil
}

func (r *credentialRepository) GetByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Credential, error) {
	var credentials []*model.Credential
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&credentials).Error
	return credentials, err
}

func (r *credentialRepository) GetByCredentialID(ctx context.Context, credentialID []byte) (*model.Credential, error) {
	var credential model.Credential
	err := r.db.WithContext(ctx).Where("credential_id = ?", credentialID).First(&credential).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCredentialNotFound
		}
		return nil, err
	}
	return &credential, nil
}

func (r *credentialRepository) Update(ctx context.Context, credential *model.Credential) error {
	return r.db.WithContext(ctx).Save(credential).Error
}

func (r *credentialRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Credential{}, id).Error
}

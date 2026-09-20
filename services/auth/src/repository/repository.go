package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"newproject/services/auth/src/model"
	"gorm.io/gorm"
)

var (
	ErrRegistrationNotFound = errors.New("biometric registration not found")
	ErrChallengeNotFound    = errors.New("biometric challenge not found")
)

// BiometricRegistrationRepository defines methods for biometric registration storage
type BiometricRegistrationRepository interface {
	Create(ctx context.Context, reg *model.BiometricRegistration) error
	GetByUserID(ctx context.Context, userID uuid.UUID) (*model.BiometricRegistration, error)
	GetByCredentialID(ctx context.Context, credentialID []byte) (*model.BiometricRegistration, error)
	Update(ctx context.Context, reg *model.BiometricRegistration) error
}

// BiometricChallengeRepository defines methods for biometric challenge storage
type BiometricChallengeRepository interface {
	Create(ctx context.Context, chal *model.BiometricChallenge) error
	GetByUserID(ctx context.Context, userID uuid.UUID) (*model.BiometricChallenge, error)
	GetByChallenge(ctx context.Context, challenge []byte) (*model.BiometricChallenge, error)
	DeleteByUserID(ctx context.Context, userID uuid.UUID) error
}

// biometricRegistrationRepository implements BiometricRegistrationRepository using GORM
type biometricRegistrationRepository struct {
	db *gorm.DB
}

// NewBiometricRegistrationRepository creates a new BiometricRegistrationRepository
func NewBiometricRegistrationRepository(db *gorm.DB) BiometricRegistrationRepository {
	return &biometricRegistrationRepository{db: db}
}

func (r *biometricRegistrationRepository) Create(ctx context.Context, reg *model.BiometricRegistration) error {
	return r.db.WithContext(ctx).Create(reg).Error
}

func (r *biometricRegistrationRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*model.BiometricRegistration, error) {
	var reg model.BiometricRegistration
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&reg).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRegistrationNotFound
		}
		return nil, err
	}
	return &reg, nil
}

func (r *biometricRegistrationRepository) GetByCredentialID(ctx context.Context, credentialID []byte) (*model.BiometricRegistration, error) {
	var reg model.BiometricRegistration
	err := r.db.WithContext(ctx).Where("credential_id = ?", credentialID).First(&reg).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRegistrationNotFound
		}
		return nil, err
	}
	return &reg, nil
}

func (r *biometricRegistrationRepository) Update(ctx context.Context, reg *model.BiometricRegistration) error {
	return r.db.WithContext(ctx).Save(reg).Error
}

// biometricChallengeRepository implements BiometricChallengeRepository using GORM
type biometricChallengeRepository struct {
	db *gorm.DB
}

// NewBiometricChallengeRepository creates a new BiometricChallengeRepository
func NewBiometricChallengeRepository(db *gorm.DB) BiometricChallengeRepository {
	return &biometricChallengeRepository{db: db}
}

func (r *biometricChallengeRepository) Create(ctx context.Context, chal *model.BiometricChallenge) error {
	return r.db.WithContext(ctx).Create(chal).Error
}

func (r *biometricChallengeRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*model.BiometricChallenge, error) {
	var chal model.BiometricChallenge
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&chal).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrChallengeNotFound
		}
		return nil, err
	}
	return &chal, nil
}

func (r *biometricChallengeRepository) GetByChallenge(ctx context.Context, challenge []byte) (*model.BiometricChallenge, error) {
	var chal model.BiometricChallenge
	err := r.db.WithContext(ctx).Where("challenge = ?", challenge).First(&chal).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrChallengeNotFound
		}
		return nil, err
	}
	return &chal, nil
}

func (r *biometricChallengeRepository) DeleteByUserID(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.BiometricChallenge{}).Error
}

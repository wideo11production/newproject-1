package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/password"
	"gorm.io/gorm"
)

var (
	ErrUserNotFound    = errors.New("user not found")
	ErrUserExists      = errors.New("user already exists")
	ErrSessionNotFound = errors.New("session not found")
	ErrDeviceNotFound  = errors.New("device not found")
	ErrPINNotFound     = errors.New("PIN not found")
	ErrTokenNotFound   = errors.New("refresh token not found")
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	// GetByUsername added for migration 003 (username column).
	// Used by register service for a clean duplicate-username error instead of
	// relying on the DB UNIQUE violation (which surfaced as a useless 500).
	GetByUsername(ctx context.Context, username string) (*model.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*model.User, error)
	Update(ctx context.Context, user *model.User) error
	UpdateLastLogin(ctx context.Context, id uuid.UUID) error
}

type SessionRepository interface {
	Create(ctx context.Context, session *model.Session) error
	GetByID(ctx context.Context, id uuid.UUID) (*model.Session, error)
	GetByAccessToken(ctx context.Context, token string) (*model.Session, error)
	GetByRefreshToken(ctx context.Context, token string) (*model.Session, error)
	GetActiveByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Session, error)
	Revoke(ctx context.Context, id uuid.UUID) error
	RevokeAllByUserID(ctx context.Context, userID uuid.UUID) error
	DeleteExpired(ctx context.Context) error
}

type DeviceRepository interface {
	Create(ctx context.Context, device *model.Device) error
	GetByID(ctx context.Context, id uuid.UUID) (*model.Device, error)
	GetByFingerprint(ctx context.Context, fingerprint string) (*model.Device, error)
	GetByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Device, error)
	Update(ctx context.Context, device *model.Device) error
	UpdateLastSeen(ctx context.Context, id uuid.UUID) error
}

type PINRepository interface {
	Create(ctx context.Context, pin *model.PIN) error
	GetByUserID(ctx context.Context, userID uuid.UUID) (*model.PIN, error)
	Update(ctx context.Context, pin *model.PIN) error
	IncrementAttempts(ctx context.Context, userID uuid.UUID) error
	ResetAttempts(ctx context.Context, userID uuid.UUID) error
	Lock(ctx context.Context, userID uuid.UUID) error
}

type RefreshTokenRepository interface {
	Create(ctx context.Context, token *model.RefreshToken) error
	GetByTokenHash(ctx context.Context, hash string) (*model.RefreshToken, error)
	Revoke(ctx context.Context, id uuid.UUID) error
	RevokeAllByUserID(ctx context.Context, userID uuid.UUID) error
	DeleteExpired(ctx context.Context) error
}

type userRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) Create(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

// GetByUsername username se user dhoondhta hai.
//
// ADDED (migration 003): register service duplicate username check ke liye
// ye use karta hai, taaki DB UNIQUE violation se pehle hi clean error de sake.
//
// NOTE: `deleted_at` filter GORM ka soft-delete automatically lagata hai
// (jaise GetByEmail me bota hai) - yaani soft-deleted user ka username
// dobara use ho sakta hai. Ye intentional hai: user delete hone ke baad
// handle free hona chahiye.
func (r *userRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) Update(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *userRepository) UpdateLastLogin(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Update("last_login_at", now).Error
}

type sessionRepository struct {
	db *gorm.DB
}

func NewSessionRepository(db *gorm.DB) SessionRepository {
	return &sessionRepository{db: db}
}

func (r *sessionRepository) Create(ctx context.Context, session *model.Session) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *sessionRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.Session, error) {
	var session model.Session
	err := r.db.WithContext(ctx).First(&session, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepository) GetByAccessToken(ctx context.Context, token string) (*model.Session, error) {
	var session model.Session
	// SECURITY: raw JWT store nahi hota - hash compare hota hai
	hashed := password.HashToken(token)
	err := r.db.WithContext(ctx).
		Where("access_token = ? AND revoked_at IS NULL AND expires_at > ?", hashed, time.Now()).
		First(&session).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

// GetByRefreshToken raw token se session dhoondta hai.
//
// SECURITY FIX: ab ye SHA-256 hash compute karke compare karta hai, raw token se nahi.
// Pehle ye RAW JWT ko sessions.refresh_token column se compare karta tha, jisse:
//  1. DB leak = attacker ko usable session token mil jata tha (session hijack)
//  2. JWT length badhne par varchar(512) overflow ho jata tha (500 error)
//
// Hinglish: raw token DB me store karna unsafe tha - ab hash store hota hai
func (r *sessionRepository) GetByRefreshToken(ctx context.Context, token string) (*model.Session, error) {
	var session model.Session
	// SECURITY FIX: hash karo phir compare karo (raw token kabhi DB me store nahi hota)
	hashed := password.HashToken(token)
	err := r.db.WithContext(ctx).
		Where("refresh_token = ? AND revoked_at IS NULL AND expires_at > ?", hashed, time.Now()).
		First(&session).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepository) GetActiveByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Session, error) {
	var sessions []*model.Session
	err := r.db.WithContext(ctx).Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, time.Now()).Find(&sessions).Error
	return sessions, err
}

func (r *sessionRepository) Revoke(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.Session{}).Where("id = ?", id).Update("revoked_at", now).Error
}

func (r *sessionRepository) RevokeAllByUserID(ctx context.Context, userID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.Session{}).Where("user_id = ? AND revoked_at IS NULL", userID).Update("revoked_at", now).Error
}

func (r *sessionRepository) DeleteExpired(ctx context.Context) error {
	return r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&model.Session{}).Error
}

type deviceRepository struct {
	db *gorm.DB
}

func NewDeviceRepository(db *gorm.DB) DeviceRepository {
	return &deviceRepository{db: db}
}

func (r *deviceRepository) Create(ctx context.Context, device *model.Device) error {
	return r.db.WithContext(ctx).Create(device).Error
}

func (r *deviceRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.Device, error) {
	var device model.Device
	err := r.db.WithContext(ctx).First(&device, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &device, nil
}

func (r *deviceRepository) GetByFingerprint(ctx context.Context, fingerprint string) (*model.Device, error) {
	var device model.Device
	err := r.db.WithContext(ctx).Where("fingerprint = ?", fingerprint).First(&device).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &device, nil
}

func (r *deviceRepository) GetByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Device, error) {
	var devices []*model.Device
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&devices).Error
	return devices, err
}

func (r *deviceRepository) Update(ctx context.Context, device *model.Device) error {
	return r.db.WithContext(ctx).Save(device).Error
}

func (r *deviceRepository) UpdateLastSeen(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.Device{}).Where("id = ?", id).Update("last_seen_at", now).Error
}

type pinRepository struct {
	db *gorm.DB
}

func NewPINRepository(db *gorm.DB) PINRepository {
	return &pinRepository{db: db}
}

func (r *pinRepository) Create(ctx context.Context, pin *model.PIN) error {
	return r.db.WithContext(ctx).Create(pin).Error
}

func (r *pinRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*model.PIN, error) {
	var pin model.PIN
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&pin).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPINNotFound
		}
		return nil, err
	}
	return &pin, nil
}

func (r *pinRepository) Update(ctx context.Context, pin *model.PIN) error {
	return r.db.WithContext(ctx).Save(pin).Error
}

func (r *pinRepository) IncrementAttempts(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.PIN{}).Where("user_id = ?", userID).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
}

func (r *pinRepository) ResetAttempts(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.PIN{}).Where("user_id = ?", userID).Update("attempts", 0).Error
}

func (r *pinRepository) Lock(ctx context.Context, userID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.PIN{}).Where("user_id = ?", userID).Update("locked_at", now).Error
}

type refreshTokenRepository struct {
	db *gorm.DB
}

func NewRefreshTokenRepository(db *gorm.DB) RefreshTokenRepository {
	return &refreshTokenRepository{db: db}
}

func (r *refreshTokenRepository) Create(ctx context.Context, token *model.RefreshToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

func (r *refreshTokenRepository) GetByTokenHash(ctx context.Context, hash string) (*model.RefreshToken, error) {
	var token model.RefreshToken
	err := r.db.WithContext(ctx).Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?", hash, time.Now()).First(&token).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTokenNotFound
		}
		return nil, err
	}
	return &token, nil
}

func (r *refreshTokenRepository) Revoke(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.RefreshToken{}).Where("id = ?", id).Update("revoked_at", now).Error
}

func (r *refreshTokenRepository) RevokeAllByUserID(ctx context.Context, userID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.RefreshToken{}).Where("user_id = ? AND revoked_at IS NULL", userID).Update("revoked_at", now).Error
}

func (r *refreshTokenRepository) DeleteExpired(ctx context.Context) error {
	return r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&model.RefreshToken{}).Error
}

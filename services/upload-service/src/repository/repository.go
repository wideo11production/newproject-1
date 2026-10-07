package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/upload-service/src/model"
)

var (
	ErrUploadSessionNotFound = errors.New("upload session not found")
)

// SafetyRepository — content safety check + blacklist persistence.
type SafetyRepository interface {
	CreateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error
	UpdateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error
	GetSafetyCheckBySessionUUID(ctx context.Context, sessionUUID string) (*model.UploadSafetyCheck, error)

	AddBlacklistEntry(ctx context.Context, entry *model.BlacklistEntry) error
	IsBlacklisted(ctx context.Context, userID uint) bool
	GetBlacklistByUser(ctx context.Context, userID uint) ([]*model.BlacklistEntry, error)
}

type safetyRepository struct {
	db *gorm.DB
}

func NewSafetyRepository(db *gorm.DB) SafetyRepository {
	return &safetyRepository{db: db}
}

func (r *safetyRepository) CreateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error {
	return r.db.WithContext(ctx).Create(check).Error
}

func (r *safetyRepository) UpdateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error {
	return r.db.WithContext(ctx).Save(check).Error
}

func (r *safetyRepository) GetSafetyCheckBySessionUUID(ctx context.Context, sessionUUID string) (*model.UploadSafetyCheck, error) {
	var check model.UploadSafetyCheck
	err := r.db.WithContext(ctx).Where("session_uuid = ?", sessionUUID).First(&check).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("safety check not found")
		}
		return nil, err
	}
	return &check, nil
}

func (r *safetyRepository) AddBlacklistEntry(ctx context.Context, entry *model.BlacklistEntry) error {
	return r.db.WithContext(ctx).Create(entry).Error
}

func (r *safetyRepository) IsBlacklisted(ctx context.Context, userID uint) bool {
	var count int64
	r.db.WithContext(ctx).Model(&model.BlacklistEntry{}).
		Where("user_id = ? AND active = ?", userID, true).Count(&count)
	return count > 0
}

func (r *safetyRepository) GetBlacklistByUser(ctx context.Context, userID uint) ([]*model.BlacklistEntry, error) {
	var entries []*model.BlacklistEntry
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&entries).Error
	return entries, err
}

type UploadRepository interface {
	CreateSession(ctx context.Context, session *model.UploadSession) error
	GetSessionByID(ctx context.Context, id uint) (*model.UploadSession, error)
	GetSessionByUUID(ctx context.Context, uuid string) (*model.UploadSession, error)
	UpdateSession(ctx context.Context, session *model.UploadSession) error
	DeleteSession(ctx context.Context, id uint) error
	ListActiveSessions(ctx context.Context, userID uint) ([]*model.UploadSession, error)
	CleanupExpiredSessions(ctx context.Context, before time.Time) error
	CreateChunk(ctx context.Context, chunk *model.UploadChunk) error
	GetChunksBySessionID(ctx context.Context, sessionID uint) ([]*model.UploadChunk, error)
	DeleteChunksBySessionID(ctx context.Context, sessionID uint) error
}

type uploadRepository struct {
	db *gorm.DB
}

func NewUploadRepository(db *gorm.DB) UploadRepository {
	return &uploadRepository{db: db}
}

func (r *uploadRepository) CreateSession(ctx context.Context, session *model.UploadSession) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *uploadRepository) GetSessionByID(ctx context.Context, id uint) (*model.UploadSession, error) {
	var session model.UploadSession
	err := r.db.WithContext(ctx).First(&session, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUploadSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (r *uploadRepository) GetSessionByUUID(ctx context.Context, uuid string) (*model.UploadSession, error) {
	var session model.UploadSession
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&session).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUploadSessionNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (r *uploadRepository) UpdateSession(ctx context.Context, session *model.UploadSession) error {
	return r.db.WithContext(ctx).Save(session).Error
}

func (r *uploadRepository) DeleteSession(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.UploadSession{}, id).Error
}

func (r *uploadRepository) ListActiveSessions(ctx context.Context, userID uint) ([]*model.UploadSession, error) {
	var sessions []*model.UploadSession
	err := r.db.WithContext(ctx).Where("user_id = ? AND status IN (?)", userID, []string{"pending", "uploading"}).
		Where("expires_at > ?", time.Now()).Find(&sessions).Error
	return sessions, err
}

func (r *uploadRepository) CleanupExpiredSessions(ctx context.Context, before time.Time) error {
	return r.db.WithContext(ctx).Where("expires_at < ?", before).Delete(&model.UploadSession{}).Error
}

func (r *uploadRepository) CreateChunk(ctx context.Context, chunk *model.UploadChunk) error {
	return r.db.WithContext(ctx).Create(chunk).Error
}

func (r *uploadRepository) GetChunksBySessionID(ctx context.Context, sessionID uint) ([]*model.UploadChunk, error) {
	var chunks []*model.UploadChunk
	err := r.db.WithContext(ctx).Where("session_id = ?", sessionID).Order("chunk_number").Find(&chunks).Error
	return chunks, err
}

func (r *uploadRepository) DeleteChunksBySessionID(ctx context.Context, sessionID uint) error {
	return r.db.WithContext(ctx).Where("session_id = ?", sessionID).Delete(&model.UploadChunk{}).Error
}

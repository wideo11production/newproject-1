package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/video/src/model"
)

var (
	ErrVideoFingerprintNotFound = errors.New("video fingerprint not found")
	ErrAudioFingerprintNotFound  = errors.New("audio fingerprint not found")
	ErrTargetNotFound            = errors.New("target not found")
	ErrContentReportNotFound     = errors.New("content report not found")
)

// VideoFingerprintRepository defines methods for video fingerprint storage
// Supports fingerprint creation, lookup, and duplicate detection
// Essential for copyright protection and content validation
type VideoFingerprintRepository interface {
    Create(ctx context.Context, fingerprint *model.VideoFingerprint) error
    GetByVisualToken(ctx context.Context, visualToken string) (*model.VideoFingerprint, error)
    GetBySHA256(ctx context.Context, hash string) (*model.VideoFingerprint, error)
    GetByClipID(ctx context.Context, clipID string) ([]*model.VideoFingerprint, error)
    Update(ctx context.Context, fingerprint *model.VideoFingerprint) error
    Delete(ctx context.Context, id uint) error
}

// AudioFingerprintRepository defines methods for audio fingerprint storage
// Supports stock audio validation and licensing checks
// Essential for audio copyright compliance
type AudioFingerprintRepository interface {
    Create(ctx context.Context, fingerprint *model.AudioFingerprint) error
    GetByAudioHash(ctx context.Context, hash string) (*model.AudioFingerprint, error)
    GetByClipID(ctx context.Context, clipID string) ([]*model.AudioFingerprint, error)
    Update(ctx context.Context, fingerprint *model.AudioFingerprint) error
    Delete(ctx context.Context, id uint) error
}

// TargetRepository defines methods for target audio management
// Tracks licensing requirements and usage statistics
// Essential for compliance with stock audio licensing
type TargetRepository interface {
    Create(ctx context.Context, target *model.Target) error
    GetByAudioHash(ctx context.Context, hash string) (*model.Target, error)
    IsLicensed(ctx context.Context, hash string) (bool, error)
    Update(ctx context.Context, target *model.Target) error
    Delete(ctx context.Context, id uint) error
    IncrementUsage(ctx context.Context, hash string) error
}

// ContentReportRepository defines methods for copyright reports
// Manages infringement reports, investigation, and resolution
// Essential for enforcement and dispute resolution
type ContentReportRepository interface {
    Create(ctx context.Context, report *model.ContentReport) error
    GetByID(ctx context.Context, id uint) (*model.ContentReport, error)
    GetByClipID(ctx context.Context, clipID string) ([]*model.ContentReport, error)
    GetPendingReports(ctx context.Context) ([]*model.ContentReport, error)
    Update(ctx context.Context, report *model.ContentReport) error
    Delete(ctx context.Context, id uint) error
}

// videoFingerprintRepository implements VideoFingerprintRepository using GORM
// Provides efficient fingerprint storage and duplicate detection
type videoFingerprintRepository struct {
    db *gorm.DB
}

// NewVideoFingerprintRepository creates a new VideoFingerprintRepository
func NewVideoFingerprintRepository(db *gorm.DB) VideoFingerprintRepository {
    return &videoFingerprintRepository{db: db}
}

func (r *videoFingerprintRepository) Create(ctx context.Context, fingerprint *model.VideoFingerprint) error {
    return r.db.WithContext(ctx).Create(fingerprint).Error
}

func (r *videoFingerprintRepository) GetByVisualToken(ctx context.Context, visualToken string) (*model.VideoFingerprint, error) {
    var fingerprint model.VideoFingerprint
    err := r.db.WithContext(ctx).Where("visual_token = ?", visualToken).First(&fingerprint).Error
    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrVideoFingerprintNotFound
        }
        return nil, err
    }
    return &fingerprint, nil
}

func (r *videoFingerprintRepository) GetBySHA256(ctx context.Context, hash string) (*model.VideoFingerprint, error) {
    var fingerprint model.VideoFingerprint
    err := r.db.WithContext(ctx).Where("sha256_hash = ?", hash).First(&fingerprint).Error
    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrVideoFingerprintNotFound
        }
        return nil, err
    }
    return &fingerprint, nil
}

func (r *videoFingerprintRepository) GetByClipID(ctx context.Context, clipID string) ([]*model.VideoFingerprint, error) {
    var fingerprints []*model.VideoFingerprint
    err := r.db.WithContext(ctx).Where("clip_id = ?", clipID).Find(&fingerprints).Error
    return fingerprints, err
}

func (r *videoFingerprintRepository) Update(ctx context.Context, fingerprint *model.VideoFingerprint) error {
    return r.db.WithContext(ctx).Save(fingerprint).Error
}

func (r *videoFingerprintRepository) Delete(ctx context.Context, id uint) error {
    return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.VideoFingerprint{}).Error
}

// audioFingerprintRepository implements AudioFingerprintRepository using GORM
// Provides audio fingerprint storage and validation
type audioFingerprintRepository struct {
    db *gorm.DB
}

// NewAudioFingerprintRepository creates a new AudioFingerprintRepository
func NewAudioFingerprintRepository(db *gorm.DB) AudioFingerprintRepository {
    return &audioFingerprintRepository{db: db}
}

func (r *audioFingerprintRepository) Create(ctx context.Context, fingerprint *model.AudioFingerprint) error {
    return r.db.WithContext(ctx).Create(fingerprint).Error
}

func (r *audioFingerprintRepository) GetByAudioHash(ctx context.Context, hash string) (*model.AudioFingerprint, error) {
    var fingerprint model.AudioFingerprint
    err := r.db.WithContext(ctx).Where("audio_hash = ?", hash).First(&fingerprint).Error
    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrAudioFingerprintNotFound
        }
        return nil, err
    }
    return &fingerprint, nil
}

func (r *audioFingerprintRepository) GetByClipID(ctx context.Context, clipID string) ([]*model.AudioFingerprint, error) {
    var fingerprints []*model.AudioFingerprint
    err := r.db.WithContext(ctx).Where("clip_id = ?", clipID).Find(&fingerprints).Error
    return fingerprints, err
}

func (r *audioFingerprintRepository) Update(ctx context.Context, fingerprint *model.AudioFingerprint) error {
    return r.db.WithContext(ctx).Save(fingerprint).Error
}

func (r *audioFingerprintRepository) Delete(ctx context.Context, id uint) error {
    return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.AudioFingerprint{}).Error
}

// targetRepository implements TargetRepository using GORM
// Manages target audio licensing and usage tracking
type targetRepository struct {
    db *gorm.DB
}

// NewTargetRepository creates a new TargetRepository
func NewTargetRepository(db *gorm.DB) TargetRepository {
    return &targetRepository{db: db}
}

func (r *targetRepository) Create(ctx context.Context, target *model.Target) error {
    return r.db.WithContext(ctx).Create(target).Error
}

func (r *targetRepository) GetByAudioHash(ctx context.Context, hash string) (*model.Target, error) {
    var target model.Target
    err := r.db.WithContext(ctx).Where("audio_hash = ?", hash).First(&target).Error
    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrTargetNotFound
        }
        return nil, err
    }
    return &target, nil
}

func (r *targetRepository) IsLicensed(ctx context.Context, hash string) (bool, error) {
    target, err := r.GetByAudioHash(ctx, hash)
    if err != nil {
        if errors.Is(err, ErrTargetNotFound) {
            return false, nil
        }
        return false, err
    }
    return target.IsLicensed, nil
}

func (r *targetRepository) Update(ctx context.Context, target *model.Target) error {
    return r.db.WithContext(ctx).Save(target).Error
}

func (r *targetRepository) Delete(ctx context.Context, id uint) error {
    return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Target{}).Error
}

func (r *targetRepository) IncrementUsage(ctx context.Context, hash string) error {
    target, err := r.GetByAudioHash(ctx, hash)
    if err != nil {
        return err
    }
    target.UsageCount++
    return r.db.WithContext(ctx).Save(target).Error
}

// contentReportRepository implements ContentReportRepository using GORM
// Manages copyright violation reports and investigation
type contentReportRepository struct {
    db *gorm.DB
}

// NewContentReportRepository creates a new ContentReportRepository
func NewContentReportRepository(db *gorm.DB) ContentReportRepository {
    return &contentReportRepository{db: db}
}

func (r *contentReportRepository) Create(ctx context.Context, report *model.ContentReport) error {
    return r.db.WithContext(ctx).Create(report).Error
}

func (r *contentReportRepository) GetByID(ctx context.Context, id uint) (*model.ContentReport, error) {
    var report model.ContentReport
    err := r.db.WithContext(ctx).First(&report, id).Error
    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrContentReportNotFound
        }
        return nil, err
    }
    return &report, nil
}

func (r *contentReportRepository) GetByClipID(ctx context.Context, clipID string) ([]*model.ContentReport, error) {
    var reports []*model.ContentReport
    err := r.db.WithContext(ctx).Where("clip_id = ?", clipID).Find(&reports).Error
    return reports, err
}

func (r *contentReportRepository) GetPendingReports(ctx context.Context) ([]*model.ContentReport, error) {
    var reports []*model.ContentReport
    err := r.db.WithContext(ctx).Where("status = ?", "pending").Find(&reports).Error
    return reports, err
}

func (r *contentReportRepository) Update(ctx context.Context, report *model.ContentReport) error {
    return r.db.WithContext(ctx).Save(report).Error
}

func (r *contentReportRepository) Delete(ctx context.Context, id uint) error {
    return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.ContentReport{}).Error
}

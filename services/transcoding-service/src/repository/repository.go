package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/transcoding-service/src/model"
)

var (
	ErrVideoNotFound       = errors.New("video not found")
	ErrJobNotFound         = errors.New("transcoding job not found")
)

type VideoRepository interface {
	Create(ctx context.Context, video *model.Video) error
	GetByID(ctx context.Context, id uint) (*model.Video, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Video, error)
	Update(ctx context.Context, video *model.Video) error
	Delete(ctx context.Context, id uint) error
}

type QualityRepository interface {
	Create(ctx context.Context, q *model.QualityVariant) error
	GetByVideoID(ctx context.Context, videoID uint) ([]*model.QualityVariant, error)
	Update(ctx context.Context, q *model.QualityVariant) error
	DeleteByVideoID(ctx context.Context, videoID uint) error
}

type JobRepository interface {
	Create(ctx context.Context, job *model.TranscodingJob) error
	GetByID(ctx context.Context, id uint) (*model.TranscodingJob, error)
	GetByVideoID(ctx context.Context, videoID uint) (*model.TranscodingJob, error)
	Update(ctx context.Context, job *model.TranscodingJob) error
	Delete(ctx context.Context, id uint) error
	ListQueued(ctx context.Context, limit int) ([]*model.TranscodingJob, error)
}

type videoRepository struct {
	db *gorm.DB
}

func NewVideoRepository(db *gorm.DB) VideoRepository {
	return &videoRepository{db: db}
}

func (r *videoRepository) Create(ctx context.Context, video *model.Video) error {
	return r.db.WithContext(ctx).Create(video).Error
}

func (r *videoRepository) GetByID(ctx context.Context, id uint) (*model.Video, error) {
	var video model.Video
	err := r.db.WithContext(ctx).First(&video, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVideoNotFound
		}
		return nil, err
	}
	return &video, nil
}

func (r *videoRepository) GetByUUID(ctx context.Context, uuid string) (*model.Video, error) {
	var video model.Video
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&video).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVideoNotFound
		}
		return nil, err
	}
	return &video, nil
}

func (r *videoRepository) Update(ctx context.Context, video *model.Video) error {
	return r.db.WithContext(ctx).Save(video).Error
}

func (r *videoRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Video{}, id).Error
}

type qualityRepository struct {
	db *gorm.DB
}

func NewQualityRepository(db *gorm.DB) QualityRepository {
	return &qualityRepository{db: db}
}

func (r *qualityRepository) Create(ctx context.Context, q *model.QualityVariant) error {
	return r.db.WithContext(ctx).Create(q).Error
}

func (r *qualityRepository) GetByVideoID(ctx context.Context, videoID uint) ([]*model.QualityVariant, error) {
	var variants []*model.QualityVariant
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).Find(&variants).Error
	return variants, err
}

func (r *qualityRepository) Update(ctx context.Context, q *model.QualityVariant) error {
	return r.db.WithContext(ctx).Save(q).Error
}

func (r *qualityRepository) DeleteByVideoID(ctx context.Context, videoID uint) error {
	return r.db.WithContext(ctx).Where("video_id = ?", videoID).Delete(&model.QualityVariant{}).Error
}

type jobRepository struct {
	db *gorm.DB
}

func NewJobRepository(db *gorm.DB) JobRepository {
	return &jobRepository{db: db}
}

func (r *jobRepository) Create(ctx context.Context, job *model.TranscodingJob) error {
	return r.db.WithContext(ctx).Create(job).Error
}

func (r *jobRepository) GetByID(ctx context.Context, id uint) (*model.TranscodingJob, error) {
	var job model.TranscodingJob
	err := r.db.WithContext(ctx).First(&job, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *jobRepository) GetByVideoID(ctx context.Context, videoID uint) (*model.TranscodingJob, error) {
	var job model.TranscodingJob
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).Order("created_at desc").First(&job).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *jobRepository) Update(ctx context.Context, job *model.TranscodingJob) error {
	return r.db.WithContext(ctx).Save(job).Error
}

func (r *jobRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.TranscodingJob{}, id).Error
}

func (r *jobRepository) ListQueued(ctx context.Context, limit int) ([]*model.TranscodingJob, error) {
	var jobs []*model.TranscodingJob
	err := r.db.WithContext(ctx).Where("status = ?", "queued").Order("created_at asc").Limit(limit).Find(&jobs).Error
	return jobs, err
}

func (r *jobRepository) UpdateProgress(ctx context.Context, jobID uint, progress float64) error {
	return r.db.WithContext(ctx).Model(&model.TranscodingJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"progress":   progress,
		"updated_at": time.Now(),
	}).Error
}

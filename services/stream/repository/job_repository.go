package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"newproject/services/stream/src/model"
	"gorm.io/gorm"
)

var (
	ErrJobNotFound = errors.New("job not found")
	ErrOutputNotFound = errors.New("output not found")
	ErrManifestNotFound = errors.New("manifest not found")
)

type TranscodeJobRepository interface {
	Create(ctx context.Context, job *model.TranscodeJob) error
	GetByID(ctx context.Context, id uint) (*model.TranscodeJob, error)
	GetByJobID(ctx context.Context, jobID uuid.UUID) (*model.TranscodeJob, error)
	GetByUploadID(ctx context.Context, uploadID uuid.UUID) ([]*model.TranscodeJob, error)
	Update(ctx context.Context, job *model.TranscodeJob) error
	Delete(ctx context.Context, id uint) error
	GetPendingJobs(ctx context.Context, limit int) ([]*model.TranscodeJob, error)
	GetProcessingJobs(ctx context.Context) ([]*model.TranscodeJob, error)
	GetJobsByStatus(ctx context.Context, status string) ([]*model.TranscodeJob, error)
}

type TranscodeOutputRepository interface {
	Create(ctx context.Context, output *model.TranscodeOutput) error
	GetByID(ctx context.Context, id uint) (*model.TranscodeOutput, error)
	GetByJobID(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeOutput, error)
	GetByJobIDAndResolution(ctx context.Context, jobID uuid.UUID, resolution string) (*model.TranscodeOutput, error)
	Update(ctx context.Context, output *model.TranscodeOutput) error
	DeleteByJobID(ctx context.Context, jobID uuid.UUID) error
}

type TranscodeManifestRepository interface {
	Create(ctx context.Context, manifest *model.TranscodeManifest) error
	GetByID(ctx context.Context, id uint) (*model.TranscodeManifest, error)
	GetByJobID(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeManifest, error)
	GetByJobIDAndType(ctx context.Context, jobID uuid.UUID, manifestType string) (*model.TranscodeManifest, error)
	Update(ctx context.Context, manifest *model.TranscodeManifest) error
	DeleteByJobID(ctx context.Context, jobID uuid.UUID) error
}

type transcodeJobRepository struct {
	db *gorm.DB
}

func NewTranscodeJobRepository(db *gorm.DB) TranscodeJobRepository {
	return &transcodeJobRepository{db: db}
}

func (r *transcodeJobRepository) Create(ctx context.Context, job *model.TranscodeJob) error {
	return r.db.WithContext(ctx).Create(job).Error
}

func (r *transcodeJobRepository) GetByID(ctx context.Context, id uint) (*model.TranscodeJob, error) {
	var job model.TranscodeJob
	err := r.db.WithContext(ctx).First(&job, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *transcodeJobRepository) GetByJobID(ctx context.Context, jobID uuid.UUID) (*model.TranscodeJob, error) {
	var job model.TranscodeJob
	err := r.db.WithContext(ctx).Where("job_id = ?", jobID).First(&job).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	return &job, nil
}

func (r *transcodeJobRepository) GetByUploadID(ctx context.Context, uploadID uuid.UUID) ([]*model.TranscodeJob, error) {
	var jobs []*model.TranscodeJob
	err := r.db.WithContext(ctx).Where("upload_id = ?", uploadID).Find(&jobs).Error
	return jobs, err
}

func (r *transcodeJobRepository) Update(ctx context.Context, job *model.TranscodeJob) error {
	return r.db.WithContext(ctx).Save(job).Error
}

func (r *transcodeJobRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.TranscodeJob{}, id).Error
}

func (r *transcodeJobRepository) GetPendingJobs(ctx context.Context, limit int) ([]*model.TranscodeJob, error) {
	var jobs []*model.TranscodeJob
	err := r.db.WithContext(ctx).Where("status = ?", model.JobStatusPending).Limit(limit).Find(&jobs).Error
	return jobs, err
}

func (r *transcodeJobRepository) GetProcessingJobs(ctx context.Context) ([]*model.TranscodeJob, error) {
	var jobs []*model.TranscodeJob
	err := r.db.WithContext(ctx).Where("status = ?", model.JobStatusProcessing).Find(&jobs).Error
	return jobs, err
}

func (r *transcodeJobRepository) GetJobsByStatus(ctx context.Context, status string) ([]*model.TranscodeJob, error) {
	var jobs []*model.TranscodeJob
	err := r.db.WithContext(ctx).Where("status = ?", status).Find(&jobs).Error
	return jobs, err
}

type transcodeOutputRepository struct {
	db *gorm.DB
}

func NewTranscodeOutputRepository(db *gorm.DB) TranscodeOutputRepository {
	return &transcodeOutputRepository{db: db}
}

func (r *transcodeOutputRepository) Create(ctx context.Context, output *model.TranscodeOutput) error {
	return r.db.WithContext(ctx).Create(output).Error
}

func (r *transcodeOutputRepository) GetByID(ctx context.Context, id uint) (*model.TranscodeOutput, error) {
	var output model.TranscodeOutput
	err := r.db.WithContext(ctx).First(&output, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOutputNotFound
		}
		return nil, err
	}
	return &output, nil
}

func (r *transcodeOutputRepository) GetByJobID(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeOutput, error) {
	var outputs []*model.TranscodeOutput
	err := r.db.WithContext(ctx).Where("job_id = ?", jobID).Find(&outputs).Error
	return outputs, err
}

func (r *transcodeOutputRepository) GetByJobIDAndResolution(ctx context.Context, jobID uuid.UUID, resolution string) (*model.TranscodeOutput, error) {
	var output model.TranscodeOutput
	err := r.db.WithContext(ctx).Where("job_id = ? AND resolution = ?", jobID, resolution).First(&output).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOutputNotFound
		}
		return nil, err
	}
	return &output, nil
}

func (r *transcodeOutputRepository) Update(ctx context.Context, output *model.TranscodeOutput) error {
	return r.db.WithContext(ctx).Save(output).Error
}

func (r *transcodeOutputRepository) DeleteByJobID(ctx context.Context, jobID uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.TranscodeOutput{}, "job_id = ?", jobID).Error
}

type transcodeManifestRepository struct {
	db *gorm.DB
}

func NewTranscodeManifestRepository(db *gorm.DB) TranscodeManifestRepository {
	return &transcodeManifestRepository{db: db}
}

func (r *transcodeManifestRepository) Create(ctx context.Context, manifest *model.TranscodeManifest) error {
	return r.db.WithContext(ctx).Create(manifest).Error
}

func (r *transcodeManifestRepository) GetByID(ctx context.Context, id uint) (*model.TranscodeManifest, error) {
	var manifest model.TranscodeManifest
	err := r.db.WithContext(ctx).First(&manifest, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrManifestNotFound
		}
		return nil, err
	}
	return &manifest, nil
}

func (r *transcodeManifestRepository) GetByJobID(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeManifest, error) {
	var manifests []*model.TranscodeManifest
	err := r.db.WithContext(ctx).Where("job_id = ?", jobID).Find(&manifests).Error
	return manifests, err
}

func (r *transcodeManifestRepository) GetByJobIDAndType(ctx context.Context, jobID uuid.UUID, manifestType string) (*model.TranscodeManifest, error) {
	var manifest model.TranscodeManifest
	err := r.db.WithContext(ctx).Where("job_id = ? AND manifest_type = ?", jobID, manifestType).First(&manifest).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrManifestNotFound
		}
		return nil, err
	}
	return &manifest, nil
}

func (r *transcodeManifestRepository) Update(ctx context.Context, manifest *model.TranscodeManifest) error {
	return r.db.WithContext(ctx).Save(manifest).Error
}

func (r *transcodeManifestRepository) DeleteByJobID(ctx context.Context, jobID uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.TranscodeManifest{}, "job_id = ?", jobID).Error
}

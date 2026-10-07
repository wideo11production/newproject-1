package repository

import (
	"context"
	"errors"
	"time"

	"newproject/services/video/src/model"
	"gorm.io/gorm"
)

var (
	ErrProjectNotFound    = errors.New("project not found")
	ErrTrackNotFound      = errors.New("track not found")
	ErrClipNotFound       = errors.New("clip not found")
	ErrThumbnailNotFound  = errors.New("thumbnail not found")
	ErrFramerateProfileNotFound = errors.New("framerate profile not found")
	ErrMotionTrackNotFound      = errors.New("motion track not found")
)

// MotionTrackRepository — AI Motion Tracking ke liye repository interface.
// Hinglish: ye coordinate vectors, keyframes, aur element bindings store karta hai.
type MotionTrackRepository interface {
	Create(ctx context.Context, track *model.MotionTrack) error
	GetByID(ctx context.Context, id uint) (*model.MotionTrack, error)
	GetByProjectID(ctx context.Context, projectID uint) ([]*model.MotionTrack, error)
	Update(ctx context.Context, track *model.MotionTrack) error
	DeleteByID(ctx context.Context, id uint) error
}

// TrackKeyframeRepository — motion track keyframes ka lia repository.
type TrackKeyframeRepository interface {
	Create(ctx context.Context, kf *model.TrackKeyframe) error
	GetByTrackID(ctx context.Context, trackID uint) ([]*model.TrackKeyframe, error)
	DeleteByTrackID(ctx context.Context, trackID uint) error
}

// FramerateProfileRepository defines methods for framerate profile storage.
type FramerateProfileRepository interface {
	Create(ctx context.Context, p *model.ProjectFramerateProfile) error
	GetByProjectUUID(ctx context.Context, projectUUID string) (*model.ProjectFramerateProfile, error)
	Update(ctx context.Context, p *model.ProjectFramerateProfile) error
}

// ProjectRepository defines methods for project storage
type ProjectRepository interface {
	Create(ctx context.Context, project *model.Project) error
	GetByID(ctx context.Context, id uint) (*model.Project, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Project, error)
	Update(ctx context.Context, project *model.Project) error
	DeleteByID(ctx context.Context, id uint) error
	List(ctx context.Context) ([]*model.Project, error)
}

// TrackRepository defines methods for track storage
type TrackRepository interface {
	Create(ctx context.Context, track *model.Track) error
	GetByID(ctx context.Context, id uint) (*model.Track, error)
	GetByProjectID(ctx context.Context, projectID uint) ([]*model.Track, error)
	Update(ctx context.Context, track *model.Track) error
	DeleteByID(ctx context.Context, id uint) error
	DeleteByProjectID(ctx context.Context, projectID uint) error
	Reorder(ctx context.Context, projectID uint, trackIDs []uint) error
}

// ClipRepository defines methods for clip storage
type ClipRepository interface {
	Create(ctx context.Context, clip *model.Clip) error
	GetByID(ctx context.Context, id uint) (*model.Clip, error)
	GetByTrackID(ctx context.Context, trackID uint) ([]*model.Clip, error)
	Update(ctx context.Context, clip *model.Clip) error
	DeleteByID(ctx context.Context, id uint) error
	DeleteByTrackID(ctx context.Context, trackID uint) error
}

// ThumbnailCacheRepository defines methods for thumbnail cache storage
type ThumbnailCacheRepository interface {
	Create(ctx context.Context, thumbnail *model.ThumbnailCache) error
	GetByClipIDAndFrameTime(ctx context.Context, clipID uint, frameTime float64) (*model.ThumbnailCache, error)
	DeleteByClipID(ctx context.Context, clipID uint) error
	DeleteOlderThan(ctx context.Context, before time.Time) error
}

// projectRepository implements ProjectRepository using GORM
type projectRepository struct {
	db *gorm.DB
}

// NewProjectRepository creates a new ProjectRepository
func NewProjectRepository(db *gorm.DB) ProjectRepository {
	return &projectRepository{db: db}
}

func (r *projectRepository) Create(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Create(project).Error
}

func (r *projectRepository) GetByID(ctx context.Context, id uint) (*model.Project, error) {
	var project model.Project
	err := r.db.WithContext(ctx).First(&project, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProjectNotFound
		}
		return nil, err
	}
	return &project, nil
}

func (r *projectRepository) GetByUUID(ctx context.Context, uuid string) (*model.Project, error) {
	var project model.Project
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&project).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProjectNotFound
		}
		return nil, err
	}
	return &project, nil
}

func (r *projectRepository) Update(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Save(project).Error
}

func (r *projectRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Project{}).Error
}

func (r *projectRepository) List(ctx context.Context) ([]*model.Project, error) {
	var projects []*model.Project
	err := r.db.WithContext(ctx).Find(&projects).Error
	if err != nil {
		return nil, err
	}
	return projects, nil
}

// trackRepository implements TrackRepository using GORM
type trackRepository struct {
	db *gorm.DB
}

// NewTrackRepository creates a new TrackRepository
func NewTrackRepository(db *gorm.DB) TrackRepository {
	return &trackRepository{db: db}
}

func (r *trackRepository) Create(ctx context.Context, track *model.Track) error {
	return r.db.WithContext(ctx).Create(track).Error
}

func (r *trackRepository) GetByID(ctx context.Context, id uint) (*model.Track, error) {
	var track model.Track
	err := r.db.WithContext(ctx).First(&track, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTrackNotFound
		}
		return nil, err
	}
	return &track, nil
}

func (r *trackRepository) GetByProjectID(ctx context.Context, projectID uint) ([]*model.Track, error) {
	var tracks []*model.Track
	err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Order("position").Find(&tracks).Error
	if err != nil {
		return nil, err
	}
	return tracks, nil
}

func (r *trackRepository) Update(ctx context.Context, track *model.Track) error {
	return r.db.WithContext(ctx).Save(track).Error
}

func (r *trackRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Track{}).Error
}

func (r *trackRepository) DeleteByProjectID(ctx context.Context, projectID uint) error {
	return r.db.WithContext(ctx).Where("project_id = ?", projectID).Delete(&model.Track{}).Error
}

func (r *trackRepository) Reorder(ctx context.Context, projectID uint, trackIDs []uint) error {
	// Update position for each track based on its index in trackIDs
	for index, trackID := range trackIDs {
		if err := r.db.WithContext(ctx).Model(&model.Track{}).
			Where("id = ? AND project_id = ?", trackID, projectID).
			Update("position", index).Error; err != nil {
			return err
		}
	}
	return nil
}

// clipRepository implements ClipRepository using GORM
type clipRepository struct {
	db *gorm.DB
}

// NewClipRepository creates a new ClipRepository
func NewClipRepository(db *gorm.DB) ClipRepository {
	return &clipRepository{db: db}
}

func (r *clipRepository) Create(ctx context.Context, clip *model.Clip) error {
	return r.db.WithContext(ctx).Create(clip).Error
}

func (r *clipRepository) GetByID(ctx context.Context, id uint) (*model.Clip, error) {
	var clip model.Clip
	err := r.db.WithContext(ctx).First(&clip, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrClipNotFound
		}
		return nil, err
	}
	return &clip, nil
}

func (r *clipRepository) GetByTrackID(ctx context.Context, trackID uint) ([]*model.Clip, error) {
	var clips []*model.Clip
	err := r.db.WithContext(ctx).Where("track_id = ?", trackID).Order("start_time").Find(&clips).Error
	if err != nil {
		return nil, err
	}
	return clips, nil
}

func (r *clipRepository) Update(ctx context.Context, clip *model.Clip) error {
	return r.db.WithContext(ctx).Save(clip).Error
}

func (r *clipRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Clip{}).Error
}

func (r *clipRepository) DeleteByTrackID(ctx context.Context, trackID uint) error {
	return r.db.WithContext(ctx).Where("track_id = ?", trackID).Delete(&model.Clip{}).Error
}

// thumbnailCacheRepository implements ThumbnailCacheRepository using GORM
type thumbnailCacheRepository struct {
	db *gorm.DB
}

// NewThumbnailCacheRepository creates a new ThumbnailCacheRepository
func NewThumbnailCacheRepository(db *gorm.DB) ThumbnailCacheRepository {
	return &thumbnailCacheRepository{db: db}
}

func (r *thumbnailCacheRepository) Create(ctx context.Context, thumbnail *model.ThumbnailCache) error {
	return r.db.WithContext(ctx).Create(thumbnail).Error
}

func (r *thumbnailCacheRepository) GetByClipIDAndFrameTime(ctx context.Context, clipID uint, frameTime float64) (*model.ThumbnailCache, error) {
	var thumbnail model.ThumbnailCache
	err := r.db.WithContext(ctx).Where("clip_id = ? AND frame_time = ?", clipID, frameTime).First(&thumbnail).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrThumbnailNotFound
		}
		return nil, err
	}
	return &thumbnail, nil
}

func (r *thumbnailCacheRepository) DeleteByClipID(ctx context.Context, clipID uint) error {
	return r.db.WithContext(ctx).Where("clip_id = ?", clipID).Delete(&model.ThumbnailCache{}).Error
}

func (r *thumbnailCacheRepository) DeleteOlderThan(ctx context.Context, before time.Time) error {
	return r.db.WithContext(ctx).Where("created_at < ?", before).Delete(&model.ThumbnailCache{}).Error
}

// framerateProfileRepository implements FramerateProfileRepository using GORM.
type framerateProfileRepository struct {
	db *gorm.DB
}

// NewFramerateProfileRepository creates a new FramerateProfileRepository.
func NewFramerateProfileRepository(db *gorm.DB) FramerateProfileRepository {
	return &framerateProfileRepository{db: db}
}

func (r *framerateProfileRepository) Create(ctx context.Context, p *model.ProjectFramerateProfile) error {
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *framerateProfileRepository) GetByProjectUUID(ctx context.Context, projectUUID string) (*model.ProjectFramerateProfile, error) {
	var profile model.ProjectFramerateProfile
	err := r.db.WithContext(ctx).Where("project_uuid = ?", projectUUID).First(&profile).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFramerateProfileNotFound
		}
		return nil, err
	}
	return &profile, nil
}

func (r *framerateProfileRepository) Update(ctx context.Context, p *model.ProjectFramerateProfile) error {
	return r.db.WithContext(ctx).Save(p).Error
}

// ---------------------------------------------------------------------------
// Motion Tracking repositories
// ---------------------------------------------------------------------------

type motionTrackRepository struct {
	db *gorm.DB
}

func NewMotionTrackRepository(db *gorm.DB) MotionTrackRepository {
	return &motionTrackRepository{db: db}
}

func (r *motionTrackRepository) Create(ctx context.Context, track *model.MotionTrack) error {
	return r.db.WithContext(ctx).Create(track).Error
}

func (r *motionTrackRepository) GetByID(ctx context.Context, id uint) (*model.MotionTrack, error) {
	var track model.MotionTrack
	err := r.db.WithContext(ctx).First(&track, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMotionTrackNotFound
		}
		return nil, err
	}
	return &track, nil
}

func (r *motionTrackRepository) GetByProjectID(ctx context.Context, projectID uint) ([]*model.MotionTrack, error) {
	var tracks []*model.MotionTrack
	err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Find(&tracks).Error
	if err != nil {
		return nil, err
	}
	return tracks, nil
}

func (r *motionTrackRepository) Update(ctx context.Context, track *model.MotionTrack) error {
	return r.db.WithContext(ctx).Save(track).Error
}

func (r *motionTrackRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.MotionTrack{}).Error
}

type trackKeyframeRepository struct {
	db *gorm.DB
}

func NewTrackKeyframeRepository(db *gorm.DB) TrackKeyframeRepository {
	return &trackKeyframeRepository{db: db}
}

func (r *trackKeyframeRepository) Create(ctx context.Context, kf *model.TrackKeyframe) error {
	return r.db.WithContext(ctx).Create(kf).Error
}

func (r *trackKeyframeRepository) GetByTrackID(ctx context.Context, trackID uint) ([]*model.TrackKeyframe, error) {
	var keyframes []*model.TrackKeyframe
	err := r.db.WithContext(ctx).Where("track_id = ?", trackID).Order("frame").Find(&keyframes).Error
	if err != nil {
		return nil, err
	}
	return keyframes, nil
}

func (r *trackKeyframeRepository) DeleteByTrackID(ctx context.Context, trackID uint) error {
	return r.db.WithContext(ctx).Where("track_id = ?", trackID).Delete(&model.TrackKeyframe{}).Error
}
package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"newproject/services/video/src/config"
	"newproject/services/video/src/model"
	"newproject/services/video/src/repository"
)

// VideoService handles video editing operations
type VideoService struct {
	cfg             *config.Config
	projectRepo     repository.ProjectRepository
	trackRepo       repository.TrackRepository
	clipRepo        repository.ClipRepository
	thumbnailRepo   repository.ThumbnailCacheRepository
}

// NewVideoService creates a new VideoService
func NewVideoService(
	cfg *config.Config,
	projectRepo repository.ProjectRepository,
	trackRepo repository.TrackRepository,
	clipRepo repository.ClipRepository,
	thumbnailRepo repository.ThumbnailCacheRepository,
) *VideoService {
	return &VideoService{
		cfg:           cfg,
		projectRepo:   projectRepo,
		trackRepo:     trackRepo,
		clipRepo:      clipRepo,
		thumbnailRepo: thumbnailRepo,
	}
}

// Project management

// CreateProject creates a new video editing project
func (s *VideoService) CreateProject(
	ctx context.Context,
	name string,
	duration float64,
	fps int,
	width int,
	height int,
) (*model.Project, error) {
	project := &model.Project{
		UUID:     uuid.New().String(),
		Name:     name,
		Duration: duration,
		FPS:      fps,
		Width:    width,
		Height:   height,
	}
	if err := s.projectRepo.Create(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

// GetProject returns a project by ID
func (s *VideoService) GetProjectByID(ctx context.Context, id uint) (*model.Project, error) {
	return s.projectRepo.GetByID(context.Background(), id)
}

// GetProjectByUUID returns a project by UUID
func (s *VideoService) GetProjectByUUID(ctx context.Context, uuidStr string) (*model.Project, error) {
	return s.projectRepo.GetByUUID(context.Background(), uuidStr)
}

// UpdateProject updates a project
func (s *VideoService) UpdateProject(ctx context.Context, project *model.Project) error {
	return s.projectRepo.Update(ctx, project)
}

// DeleteProject deletes a project and all associated tracks and clips
func (s *VideoService) DeleteProject(ctx context.Context, id uint) error {
	// Delete all tracks (which will cascade delete clips)
	if err := s.trackRepo.DeleteByProjectID(context.Background(), id); err != nil {
		return err
	}
	return s.projectRepo.DeleteByID(ctx, id)
}

// ListProjects returns all projects
func (s *VideoService) ListProjects(ctx context.Context) ([]*model.Project, error) {
	return s.projectRepo.List(ctx)
}

// Track management

// CreateTrack creates a new track in a project
func (s *VideoService) CreateTrack(
	ctx context.Context,
	projectID uint,
	name string,
	trackType model.TrackType,
) (*model.Track, error) {
	// Verify project exists
	_, err := s.projectRepo.GetByID(ctx, projectID)
	if err != nil {
		return nil, err
	}

	// Get existing tracks to determine position
	existingTracks, err := s.trackRepo.GetByProjectID(ctx, projectID)
	if err != nil {
		return nil, err
	}

	track := &model.Track{
		ProjectID: projectID,
		Name:      name,
		TrackType: trackType,
		Position:  len(existingTracks), // Add to the end
	}

	if err := s.trackRepo.Create(ctx, track); err != nil {
		return nil, err
	}

	return track, nil
}

// GetTrack returns a track by ID
func (s *VideoService) GetTrack(ctx context.Context, id uint) (*model.Track, error) {
	return s.trackRepo.GetByID(context.Background(), id)
}

// GetTracksByProject returns all tracks for a project
func (s *VideoService) GetTracksByProject(ctx context.Context, projectID uint) ([]*model.Track, error) {
	return s.trackRepo.GetByProjectID(ctx, projectID)
}

// UpdateTrack updates a track
func (s *VideoService) UpdateTrack(ctx context.Context, track *model.Track) error {
	return s.trackRepo.Update(ctx, track)
}

// DeleteTrack deletes a track and all its clips
func (s *VideoService) DeleteTrack(ctx context.Context, id uint) error {
	// Delete all clips on this track first
	if err := s.clipRepo.DeleteByTrackID(ctx, id); err != nil {
		return err
	}
	return s.trackRepo.DeleteByID(context.Background(), id)
}

// ReorderTracks reorders tracks in a project
func (s *VideoService) ReorderTracks(ctx context.Context, projectID uint, trackIDs []uint) error {
	return s.trackRepo.Reorder(ctx, projectID, trackIDs)
}

// Clip management

// CreateClip adds a new clip to a track
func (s *VideoService) CreateClip(
	ctx context.Context,
	trackID uint,
	assetID string,
	name string,
	startTime float64,
	endTime float64,
	offsetIn float64,
	offsetOut float64,
	volume float64,
) (*model.Clip, error) {
	// Verify track exists
	_, err := s.trackRepo.GetByID(ctx, trackID)
	if err != nil {
		return nil, err
	}

	duration := endTime - startTime

	clip := &model.Clip{
		TrackID:   trackID,
		AssetID:   assetID,
		Name:      name,
		StartTime: startTime,
		EndTime:   endTime,
		Duration:  duration,
		OffsetIn:  offsetIn,
		OffsetOut: offsetOut,
		Volume:    volume,
	}

	if err := s.clipRepo.Create(ctx, clip); err != nil {
		return nil, err
	}

	return clip, nil
}

// GetClip returns a clip by ID
func (s *VideoService) GetClip(ctx context.Context, id uint) (*model.Clip, error) {
	return s.clipRepo.GetByID(context.Background(), id)
}

// GetClipsByTrack returns all clips on a track
func (s *VideoService) GetClipsByTrack(ctx context.Context, trackID uint) ([]*model.Clip, error) {
	return s.clipRepo.GetByTrackID(ctx, trackID)
}

// UpdateClip updates a clip
func (s *VideoService) UpdateClip(ctx context.Context, clip *model.Clip) error {
	// Recalculate duration if start/end times changed
	clip.Duration = clip.EndTime - clip.StartTime
	return s.clipRepo.Update(ctx, clip)
}

// DeleteClip deletes a clip
func (s *VideoService) DeleteClip(ctx context.Context, id uint) error {
	return s.clipRepo.DeleteByID(context.Background(), id)
}

// MoveClip moves a clip to a different track and/or time position
func (s *VideoService) MoveClip(
	ctx context.Context,
	clipID uint,
	newTrackID uint,
	newStartTime float64,
) error {
	clip, err := s.clipRepo.GetByID(ctx, clipID)
	if err != nil {
		return err
	}

	// Verify new track exists
	_, err = s.trackRepo.GetByID(ctx, newTrackID)
	if err != nil {
		return err
	}

	clip.TrackID = newTrackID
	clip.StartTime = newStartTime
	clip.EndTime = newStartTime + clip.Duration

	return s.clipRepo.Update(ctx, clip)
}

// TrimClip trims a clip by adjusting its start/end times
func (s *VideoService) TrimClip(
	ctx context.Context,
	clipID uint,
	newStartTime float64,
	newEndTime float64,
) error {
	clip, err := s.clipRepo.GetByID(ctx, clipID)
	if err != nil {
		return err
	}

	if newStartTime >= newEndTime {
		return errors.New("start time must be before end time")
	}

	if newStartTime < clip.OffsetIn || newEndTime > clip.OffsetOut {
		return errors.New("trim range exceeds asset boundaries")
	}

	clip.StartTime = newStartTime
	clip.EndTime = newEndTime
	clip.Duration = newEndTime - newStartTime

	return s.clipRepo.Update(ctx, clip)
}

// AdjustClipVolume changes the volume of a clip
func (s *VideoService) AdjustClipVolume(
	ctx context.Context,
	clipID uint,
	volume float64,
) error {
	clip, err := s.clipRepo.GetByID(ctx, clipID)
	if err != nil {
		return err
	}

	if volume < 0 || volume > 1 {
		return errors.New("volume must be between 0 and 1")
	}

	clip.Volume = volume
	return s.clipRepo.Update(ctx, clip)
}
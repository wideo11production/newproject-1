package service

import (
	"context"
	"fmt"
	"os/exec"
	"time"

	"newproject/services/thumbnail-service/src/model"
	"newproject/services/thumbnail-service/src/repository"
)

type ThumbnailService struct {
	thumbRepo  repository.ThumbnailRepository
	spriteRepo repository.SpriteRepository
	ffmpegPath string
	outputDir  string
}

type ThumbnailConfig struct {
	FFmpegPath string
	OutputDir  string
}

func NewThumbnailService(cfg ThumbnailConfig, thumbRepo repository.ThumbnailRepository, spriteRepo repository.SpriteRepository) *ThumbnailService {
	return &ThumbnailService{
		thumbRepo:  thumbRepo,
		spriteRepo: spriteRepo,
		ffmpegPath: cfg.FFmpegPath,
		outputDir:  cfg.OutputDir,
	}
}

func (s *ThumbnailService) GenerateAutoThumbnail(ctx context.Context, videoID uint, minioPath string) (*model.Thumbnail, error) {
	outputPath := fmt.Sprintf("%s/%d_auto_%s.jpg", s.outputDir, videoID, time.Now().Format("20060102150405"))

	cmd := exec.Command(s.ffmpegPath,
		"-i", minioPath,
		"-ss", "00:00:01",
		"-vframes", "1",
		"-q:v", "2",
		outputPath,
	)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to generate thumbnail: %w", err)
	}

	thumb := &model.Thumbnail{
		VideoID: videoID,
		URL:     outputPath,
		Timecode: 1.0,
		Type:    "auto",
		IsCustom: false,
	}

	if err := s.thumbRepo.Create(ctx, thumb); err != nil {
		return nil, err
	}

	return thumb, nil
}

func (s *ThumbnailService) GenerateCustomThumbnail(ctx context.Context, videoID uint, minioPath string, timecode float64) (*model.Thumbnail, error) {
	outputPath := fmt.Sprintf("%s/%d_custom_%f.jpg", s.outputDir, videoID, timecode)

	cmd := exec.Command(s.ffmpegPath,
		"-i", minioPath,
		"-ss", fmt.Sprintf("%f", timecode),
		"-vframes", "1",
		"-q:v", "2",
		outputPath,
	)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to generate custom thumbnail: %w", err)
	}

	thumb := &model.Thumbnail{
		VideoID:  videoID,
		URL:      outputPath,
		Timecode: timecode,
		Type:     "custom",
		IsCustom: true,
	}

	if err := s.thumbRepo.Create(ctx, thumb); err != nil {
		return nil, err
	}

	return thumb, nil
}

func (s *ThumbnailService) GenerateSpriteSheet(ctx context.Context, videoID uint, minioPath string, videoDuration float64) (*model.SpriteSheet, error) {
	thumbWidth := 160
	thumbHeight := 90
	columns := 10
	rows := int(videoDuration/10) + 1
	if rows < 1 {
		rows = 1
	}
	totalThumbs := columns * rows

	outputPath := fmt.Sprintf("%s/%d_sprite_%s.jpg", s.outputDir, videoID, time.Now().Format("20060102150405"))
	vf := fmt.Sprintf("fps=1/%d,scale=%d:%d,tile=%dx%d", 10, thumbWidth, thumbHeight, columns, rows)

	cmd := exec.Command(s.ffmpegPath,
		"-i", minioPath,
		"-vf", vf,
		"-frames:v", fmt.Sprintf("%d", totalThumbs),
		outputPath,
	)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to generate sprite sheet: %w", err)
	}

	sprite := &model.SpriteSheet{
		VideoID:     videoID,
		URL:         outputPath,
		ThumbCount:  totalThumbs,
		Columns:     columns,
		Rows:        rows,
		ThumbWidth:  thumbWidth,
		ThumbHeight: thumbHeight,
	}

	if err := s.spriteRepo.Create(ctx, sprite); err != nil {
		return nil, err
	}

	return sprite, nil
}

func (s *ThumbnailService) GetThumbnails(ctx context.Context, videoID uint) ([]*model.Thumbnail, error) {
	return s.thumbRepo.GetByVideoID(ctx, videoID)
}

func (s *ThumbnailService) GetAutoThumbnail(ctx context.Context, videoID uint) (*model.Thumbnail, error) {
	return s.thumbRepo.GetAutoByVideoID(ctx, videoID)
}

func (s *ThumbnailService) GetSpriteSheet(ctx context.Context, videoID uint) (*model.SpriteSheet, error) {
	return s.spriteRepo.GetByVideoID(ctx, videoID)
}

func (s *ThumbnailService) DeleteThumbnails(ctx context.Context, videoID uint) error {
	if err := s.thumbRepo.DeleteByVideoID(ctx, videoID); err != nil {
		return err
	}
	return s.spriteRepo.DeleteByVideoID(ctx, videoID)
}

func (s *ThumbnailService) DeleteThumbnail(ctx context.Context, id uint) error {
	return s.thumbRepo.Delete(ctx, id)
}

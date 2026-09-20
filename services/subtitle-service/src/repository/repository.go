package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/subtitle-service/src/model"
)

var (
	ErrSubtitleNotFound = errors.New("subtitle not found")
)

type SubtitleRepository interface {
	Create(ctx context.Context, sub *model.Subtitle) error
	GetByID(ctx context.Context, id uint) (*model.Subtitle, error)
	GetByVideoID(ctx context.Context, videoID uint) ([]*model.Subtitle, error)
	GetByLanguage(ctx context.Context, videoID uint, language string) (*model.Subtitle, error)
	GetDefault(ctx context.Context, videoID uint) (*model.Subtitle, error)
	Update(ctx context.Context, sub *model.Subtitle) error
	Delete(ctx context.Context, id uint) error
	DeleteByVideoID(ctx context.Context, videoID uint) error
}

type StyleRepository interface {
	Create(ctx context.Context, style *model.SubtitleStyle) error
	GetBySubtitleID(ctx context.Context, subtitleID uint) (*model.SubtitleStyle, error)
	Update(ctx context.Context, style *model.SubtitleStyle) error
	DeleteBySubtitleID(ctx context.Context, subtitleID uint) error
}

type subtitleRepository struct {
	db *gorm.DB
}

func NewSubtitleRepository(db *gorm.DB) SubtitleRepository {
	return &subtitleRepository{db: db}
}

func (r *subtitleRepository) Create(ctx context.Context, sub *model.Subtitle) error {
	return r.db.WithContext(ctx).Create(sub).Error
}

func (r *subtitleRepository) GetByID(ctx context.Context, id uint) (*model.Subtitle, error) {
	var sub model.Subtitle
	err := r.db.WithContext(ctx).First(&sub, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubtitleNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subtitleRepository) GetByVideoID(ctx context.Context, videoID uint) ([]*model.Subtitle, error) {
	var subs []*model.Subtitle
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).Order("is_default desc, created_at").Find(&subs).Error
	return subs, err
}

func (r *subtitleRepository) GetByLanguage(ctx context.Context, videoID uint, language string) (*model.Subtitle, error) {
	var sub model.Subtitle
	err := r.db.WithContext(ctx).Where("video_id = ? AND language = ?", videoID, language).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubtitleNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subtitleRepository) GetDefault(ctx context.Context, videoID uint) (*model.Subtitle, error) {
	var sub model.Subtitle
	err := r.db.WithContext(ctx).Where("video_id = ? AND is_default = ?", videoID, true).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubtitleNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subtitleRepository) Update(ctx context.Context, sub *model.Subtitle) error {
	return r.db.WithContext(ctx).Save(sub).Error
}

func (r *subtitleRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Subtitle{}, id).Error
}

func (r *subtitleRepository) DeleteByVideoID(ctx context.Context, videoID uint) error {
	return r.db.WithContext(ctx).Where("video_id = ?", videoID).Delete(&model.Subtitle{}).Error
}

type styleRepository struct {
	db *gorm.DB
}

func NewStyleRepository(db *gorm.DB) StyleRepository {
	return &styleRepository{db: db}
}

func (r *styleRepository) Create(ctx context.Context, style *model.SubtitleStyle) error {
	return r.db.WithContext(ctx).Create(style).Error
}

func (r *styleRepository) GetBySubtitleID(ctx context.Context, subtitleID uint) (*model.SubtitleStyle, error) {
	var style model.SubtitleStyle
	err := r.db.WithContext(ctx).Where("subtitle_id = ?", subtitleID).First(&style).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("style not found")
		}
		return nil, err
	}
	return &style, nil
}

func (r *styleRepository) Update(ctx context.Context, style *model.SubtitleStyle) error {
	return r.db.WithContext(ctx).Save(style).Error
}

func (r *styleRepository) DeleteBySubtitleID(ctx context.Context, subtitleID uint) error {
	return r.db.WithContext(ctx).Where("subtitle_id = ?", subtitleID).Delete(&model.SubtitleStyle{}).Error
}

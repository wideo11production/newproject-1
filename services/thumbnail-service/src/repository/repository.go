package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/thumbnail-service/src/model"
)

var (
	ErrThumbnailNotFound = errors.New("thumbnail not found")
	ErrSpriteNotFound    = errors.New("sprite sheet not found")
)

type ThumbnailRepository interface {
	Create(ctx context.Context, thumb *model.Thumbnail) error
	GetByID(ctx context.Context, id uint) (*model.Thumbnail, error)
	GetByVideoID(ctx context.Context, videoID uint) ([]*model.Thumbnail, error)
	GetAutoByVideoID(ctx context.Context, videoID uint) (*model.Thumbnail, error)
	Update(ctx context.Context, thumb *model.Thumbnail) error
	Delete(ctx context.Context, id uint) error
	DeleteByVideoID(ctx context.Context, videoID uint) error
}

type SpriteRepository interface {
	Create(ctx context.Context, sprite *model.SpriteSheet) error
	GetByID(ctx context.Context, id uint) (*model.SpriteSheet, error)
	GetByVideoID(ctx context.Context, videoID uint) (*model.SpriteSheet, error)
	Update(ctx context.Context, sprite *model.SpriteSheet) error
	Delete(ctx context.Context, id uint) error
	DeleteByVideoID(ctx context.Context, videoID uint) error
}

type thumbnailRepository struct {
	db *gorm.DB
}

func NewThumbnailRepository(db *gorm.DB) ThumbnailRepository {
	return &thumbnailRepository{db: db}
}

func (r *thumbnailRepository) Create(ctx context.Context, thumb *model.Thumbnail) error {
	return r.db.WithContext(ctx).Create(thumb).Error
}

func (r *thumbnailRepository) GetByID(ctx context.Context, id uint) (*model.Thumbnail, error) {
	var thumb model.Thumbnail
	err := r.db.WithContext(ctx).First(&thumb, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrThumbnailNotFound
		}
		return nil, err
	}
	return &thumb, nil
}

func (r *thumbnailRepository) GetByVideoID(ctx context.Context, videoID uint) ([]*model.Thumbnail, error) {
	var thumbs []*model.Thumbnail
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).Order("timecode").Find(&thumbs).Error
	return thumbs, err
}

func (r *thumbnailRepository) GetAutoByVideoID(ctx context.Context, videoID uint) (*model.Thumbnail, error) {
	var thumb model.Thumbnail
	err := r.db.WithContext(ctx).Where("video_id = ? AND type = ? AND is_custom = ?", videoID, "auto", false).First(&thumb).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrThumbnailNotFound
		}
		return nil, err
	}
	return &thumb, nil
}

func (r *thumbnailRepository) Update(ctx context.Context, thumb *model.Thumbnail) error {
	return r.db.WithContext(ctx).Save(thumb).Error
}

func (r *thumbnailRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Thumbnail{}, id).Error
}

func (r *thumbnailRepository) DeleteByVideoID(ctx context.Context, videoID uint) error {
	return r.db.WithContext(ctx).Where("video_id = ?", videoID).Delete(&model.Thumbnail{}).Error
}

type spriteRepository struct {
	db *gorm.DB
}

func NewSpriteRepository(db *gorm.DB) SpriteRepository {
	return &spriteRepository{db: db}
}

func (r *spriteRepository) Create(ctx context.Context, sprite *model.SpriteSheet) error {
	return r.db.WithContext(ctx).Create(sprite).Error
}

func (r *spriteRepository) GetByID(ctx context.Context, id uint) (*model.SpriteSheet, error) {
	var sprite model.SpriteSheet
	err := r.db.WithContext(ctx).First(&sprite, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSpriteNotFound
		}
		return nil, err
	}
	return &sprite, nil
}

func (r *spriteRepository) GetByVideoID(ctx context.Context, videoID uint) (*model.SpriteSheet, error) {
	var sprite model.SpriteSheet
	err := r.db.WithContext(ctx).Where("video_id = ?", videoID).First(&sprite).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSpriteNotFound
		}
		return nil, err
	}
	return &sprite, nil
}

func (r *spriteRepository) Update(ctx context.Context, sprite *model.SpriteSheet) error {
	return r.db.WithContext(ctx).Save(sprite).Error
}

func (r *spriteRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.SpriteSheet{}, id).Error
}

func (r *spriteRepository) DeleteByVideoID(ctx context.Context, videoID uint) error {
	return r.db.WithContext(ctx).Where("video_id = ?", videoID).Delete(&model.SpriteSheet{}).Error
}

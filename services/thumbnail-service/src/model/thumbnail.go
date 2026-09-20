package model

import (
	"time"
)

type Thumbnail struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	VideoID       uint           `gorm:"not null;index" json:"video_id"`
	URL           string         `gorm:"type:text;not null" json:"url"`
	Timecode      float64        `gorm:"not null" json:"timecode"`
	Width         int            `json:"width"`
	Height        int            `json:"height"`
	Type          string         `gorm:"type:text;default:'auto'" json:"type"`
	IsCustom      bool           `gorm:"default:false" json:"is_custom"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (Thumbnail) TableName() string {
	return "thumbnails"
}

type SpriteSheet struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	VideoID       uint           `gorm:"not null;index" json:"video_id"`
	URL           string         `gorm:"type:text;not null" json:"url"`
	ThumbCount    int            `gorm:"not null" json:"thumb_count"`
	Columns       int            `json:"columns"`
	Rows          int            `json:"rows"`
	ThumbWidth    int            `json:"thumb_width"`
	ThumbHeight   int            `json:"thumb_height"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
}

func (SpriteSheet) TableName() string {
	return "sprite_sheets"
}

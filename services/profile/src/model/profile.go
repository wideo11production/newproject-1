package model

import (
	"time"
)

// Profile stores additional information about a user
type Profile struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	UserID    uint           `gorm:"uniqueIndex;not null" json:"user_id"`
	Bio       string         `gorm:"type:text" json:"bio"`
	AvatarURL string         `gorm:"type:text" json:"avatar_url"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Profile) TableName() string {
	return "profiles"
}
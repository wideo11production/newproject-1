package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Setting stores key-value pairs for settings
type Setting struct {
	ID          uint           `gorm:"primarykey" json:"-"`
	Key         string         `gorm:"type:text;uniqueIndex;not null" json:"key"`
	Value       string         `gorm:"type:text" json:"value"`
	Description string         `gorm:"type:text" json:"description"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Setting) TableName() string {
	return "settings"
}
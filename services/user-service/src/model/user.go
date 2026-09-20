package model

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Email        string         `gorm:"uniqueIndex;not null;size:255" json:"email"`
	PasswordHash string         `gorm:"type:text" json:"-"`
	Username     string         `gorm:"uniqueIndex;not null;size:100" json:"username"`
	Status       string         `gorm:"default:'active'" json:"status"`
	Verified     bool           `gorm:"default:false" json:"verified"`
	CreatedAt    time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (User) TableName() string {
	return "users"
}

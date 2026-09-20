package model

import (
	"time"

	"github.com/google/uuid"
)

// User represents a user in the system
type User struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	UUID      uuid.UUID      `gorm:"type:uuid;uniqueIndex;not null" json:"uuid"`
	Email     string         `gorm:"type:text;uniqueIndex;not null" json:"email"`
	Name      string         `gorm:"type:text;not null" json:"name"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (User) TableName() string {
	return "users"
}
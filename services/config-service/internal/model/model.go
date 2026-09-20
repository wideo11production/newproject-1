package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Config struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Key         string    `gorm:"uniqueIndex;not null;size:255"`
	Value       string    `gorm:"type:text;not null"`
	Type        string    `gorm:"not null;size:50"` // string, int, float, bool, json, secret
	Description string    `gorm:"size:1000"`
	IsSecret    bool      `gorm:"default:false"`
	Environment string    `gorm:"not null;size:50;default:'all'"` // development, staging, production, all
	Version     int       `gorm:"default:1"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

type ConfigHistory struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	ConfigID  uuid.UUID `gorm:"type:uuid;not null;index"`
	Key       string    `gorm:"not null;size:255"`
	Value     string    `gorm:"type:text"`
	Action    string    `gorm:"not null;size:20"` // create, update, delete
	ChangedBy string    `gorm:"size:255"`
	CreatedAt time.Time
}

func (Config) TableName() string {
	return "configs"
}

func (ConfigHistory) TableName() string {
	return "config_histories"
}
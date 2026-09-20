package model

import (
	"time"

	"github.com/google/uuid"
)

type Profile struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID       uint            `gorm:"uniqueIndex;not null" json:"user_id"`
	Username     string          `gorm:"size:100;not null" json:"username"`
	Email        string          `gorm:"size:255;not null" json:"email"`
	DisplayName  string          `gorm:"size:255" json:"display_name"`
	Bio          string          `gorm:"type:text" json:"bio"`
	AvatarURL    string          `gorm:"type:text" json:"avatar_url"`
	Website      string          `gorm:"size:255" json:"website"`
	Location     string          `gorm:"size:255" json:"location"`
	Birthdate    *time.Time      `json:"birthdate,omitempty"`
	Gender       string          `gorm:"size:20" json:"gender"`
	Country      string          `gorm:"size:100" json:"country"`
	Language     string          `gorm:"size:10;default:'en'" json:"language"`
	Private      bool            `gorm:"default:false" json:"private"`
	Verified     bool            `gorm:"default:false" json:"verified"`
	ViewCount    int64           `gorm:"default:0" json:"view_count"`
	SubscriberCount int64        `gorm:"default:0" json:"subscriber_count"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Profile) TableName() string {
	return "profiles"
}

type UserPreference struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UserID       uint            `gorm:"uniqueIndex;not null" json:"user_id"`
	Theme        string          `gorm:"size:20;default:'system'" json:"theme"`
	EmailNotif   bool            `gorm:"default:true" json:"email_notifications"`
	PushNotif    bool            `gorm:"default:true" json:"push_notifications"`
	Language     string          `gorm:"size:10;default:'en'" json:"language"`
	Timezone     string          `gorm:"size:50;default:'UTC'" json:"timezone"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (UserPreference) TableName() string {
	return "user_preferences"
}

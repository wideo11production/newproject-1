package model

import (
	"time"
)

type NotificationCategory string

const (
	CategoryVideo    NotificationCategory = "video"
	CategoryComments NotificationCategory = "comments"
	CategoryLive     NotificationCategory = "live"
	CategoryAds      NotificationCategory = "ads"
	CategorySystem   NotificationCategory = "system"
)

type UserPreferences struct {
	ID        uint              `gorm:"primarykey" json:"id"`
	UserID    uint              `gorm:"uniqueIndex;not null" json:"user_id"`
	Categories map[NotificationCategory]bool `gorm:"-" json:"categories"`
	QuietHours  *QuietHours     `gorm:"embedded" json:"quiet_hours,omitempty"`
	FrequencyCap *FrequencyCap  `gorm:"embedded" json:"frequency_cap,omitempty"`
	Timezone    string          `gorm:"default:UTC" json:"timezone"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

type QuietHours struct {
	Enabled   bool   `json:"enabled"`
	Start     string `json:"start"`
	End       string `json:"end"`
	Timezone  string `json:"timezone,omitempty"`
}

type FrequencyCap struct {
	PerHour   int `json:"per_hour"`
	PerDay    int `json:"per_day"`
	PerWeek   int `json:"per_week"`
}

type DevicePreference struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UserID      uint           `gorm:"index;not null" json:"user_id"`
	DeviceID    string         `gorm:"uniqueIndex;not null" json:"device_id"`
	UserAgent   string         `gorm:"type:text" json:"user_agent"`
	Categories  []DeviceCategoryPref `gorm:"foreignKey:DevicePreferenceID" json:"categories"`
	Enabled     bool           `gorm:"default:true" json:"enabled"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

type DeviceCategoryPref struct {
	ID                uint                 `gorm:"primarykey" json:"id"`
	DevicePreferenceID uint                `json:"-"`
	Category          NotificationCategory `json:"category"`
	Enabled           bool                 `gorm:"default:true" json:"enabled"`
}

func (DevicePreference) TableName() string {
	return "device_preferences"
}

func (DeviceCategoryPref) TableName() string {
	return "device_category_prefs"
}

func (UserPreferences) TableName() string {
	return "user_preferences"
}

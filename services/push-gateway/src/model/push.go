package model

import (
	"time"

	"github.com/google/uuid"
)

type PushTemplate struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name      string         `gorm:"size:100;not null" json:"name"`
	Category  string         `gorm:"size:50;not null" json:"category"`
	Title     string         `gorm:"type:text" json:"title"`
	Body      string         `gorm:"type:text" json:"body"`
	Icon      string         `gorm:"type:text" json:"icon"`
	Image     string         `gorm:"type:text" json:"image"`
	URL       string         `gorm:"type:text" json:"url"`
	Action    string         `gorm:"type:text" json:"action"`
	Variables string         `gorm:"type:text" json:"variables"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (PushTemplate) TableName() string {
	return "push_templates"
}

type PushCampaign struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string         `gorm:"size:255;not null" json:"name"`
	TemplateID  uint           `gorm:"not null;index" json:"template_id"`
	TargetType  string         `gorm:"size:50;not null" json:"target_type"`
	TargetQuery string         `gorm:"type:text" json:"target_query"`
	ScheduledAt *time.Time     `json:"scheduled_at,omitempty"`
	Status      string         `gorm:"default:'draft'" json:"status"`
	SentCount   int            `gorm:"default:0" json:"sent_count"`
	DeliveredCount int         `gorm:"default:0" json:"delivered_count"`
	FailedCount int            `gorm:"default:0" json:"failed_count"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (PushCampaign) TableName() string {
	return "push_campaigns"
}

type PushAnalytics struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	CampaignID    uint           `gorm:"not null;index" json:"campaign_id"`
	SubscriptionID uint          `gorm:"not null;index" json:"subscription_id"`
	EventType     string         `gorm:"size:50;not null" json:"event_type"`
	Platform      string         `gorm:"size:50" json:"platform"`
	Timestamp     time.Time      `gorm:"autoCreateTime" json:"timestamp"`
	Metadata      string         `gorm:"type:text" json:"metadata"`
}

func (PushAnalytics) TableName() string {
	return "push_analytics"
}

type PlatformConfig struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	Name         string         `gorm:"size:50;not null;uniqueIndex" json:"name"`
	Enabled      bool           `gorm:"default:true" json:"enabled"`
	Config       string         `gorm:"type:text" json:"config"`
	Priority     int            `gorm:"default:0" json:"priority"`
	CreatedAt    time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (PlatformConfig) TableName() string {
	return "platform_configs"
}

type ScheduledPush struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID        uint           `gorm:"not null;index" json:"user_id"`
	Title         string         `gorm:"type:text;not null" json:"title"`
	Body          string         `gorm:"type:text" json:"body"`
	Icon          string         `gorm:"type:text" json:"icon"`
	URL           string         `gorm:"type:text" json:"url"`
	ScheduledAt   time.Time      `gorm:"not null;index" json:"scheduled_at"`
	Status        string         `gorm:"default:'pending'" json:"status"`
	AttemptCount  int            `gorm:"default:0" json:"attempt_count"`
	LastError     string         `gorm:"type:text" json:"last_error"`
	CreatedAt     time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (ScheduledPush) TableName() string {
	return "scheduled_pushes"
}
package model

import (
	"time"

	"github.com/google/uuid"
)

type PushSubscription struct {
	ID          uint           `gorm:"primarykey" json:"-"`
	UserID      uint           `gorm:"not null;index" json:"user_id"`
	Endpoint    string         `gorm:"type:text;not null;uniqueIndex" json:"endpoint"`
	P256DH      string         `gorm:"type:text;not null" json:"p256dh"`
	AuthSecret  string         `gorm:"type:text;not null" json:"auth_secret"`
	UserAgent   string         `gorm:"type:text" json:"user_agent"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	LastUsed    time.Time      `gorm:"autoCreateTime" json:"last_used"`
}

func (PushSubscription) TableName() string {
	return "push_subscriptions"
}

type PushMessage struct {
	ID              uint           `gorm:"primarykey" json:"-"`
	MessageID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"message_id"`
	UserID          uint           `gorm:"not null;index" json:"user_id"`
	Title           string         `gorm:"type:text;not null" json:"title"`
	Body            string         `gorm:"type:text" json:"body"`
	Icon            string         `gorm:"type:text" json:"icon"`
	URL             string         `gorm:"type:text" json:"url"`
	Tag             string         `gorm:"type:text" json:"tag"`
	Data            string         `gorm:"type:text" json:"data"`
	Urgency         string         `gorm:"type:text;default:'normal'" json:"urgency"`
	TTL             int            `gorm:"default:2419200" json:"ttl"`
	Topic           string         `gorm:"type:text" json:"topic"`
	Status          string         `gorm:"type:text;default:'pending'" json:"status"`
	DeliveryCount   int            `gorm:"default:0" json:"delivery_count"`
	LastError       string         `gorm:"type:text" json:"-"`
	SentAt          *time.Time     `json:"sent_at,omitempty"`
	DeliveredAt     *time.Time     `json:"delivered_at,omitempty"`
	CreatedAt       time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (PushMessage) TableName() string {
	return "push_messages"
}

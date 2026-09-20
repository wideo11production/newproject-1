package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Notification status constants
const (
	StatusPending  = "pending"
	StatusSending  = "sending"
	StatusSent     = "sent"
	StatusFailed   = "failed"
)

// Notification channel constants
const (
	ChannelEmail = "email"
	ChannelSMS   = "sms"
	ChannelPush  = "push"
)

// Notification represents a notification to be sent
type Notification struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	UUID      uuid.UUID      `gorm:"type:uuid;uniqueIndex;not null" json:"uuid"`
	Recipient string         `gorm:"type:text;not null" json:"recipient"` // e.g., email address, phone number
	Subject   string         `gorm:"type:text" json:"subject"`
	Body      string         `gorm:"type:text" json:"body"`
	Channel   string         `gorm:"type:text;not null" json:"channel"` // e.g., email, sms, push
	Status    string         `gorm:"type:text;not null;default:'pending'" json:"status"` // pending, sent, failed
	SentAt    *time.Time     `gorm:"type:timestamp" json:"sent_at,omitempty"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (Notification) TableName() string {
	return "notifications"
}
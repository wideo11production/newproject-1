package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// EmailTemplate stores email templates for sending emails
type EmailTemplate struct {
	ID        uint           `gorm:"primarykey" json:"-"`
	Name      string         `gorm:"type:text;uniqueIndex;not null" json:"name"`
	Subject   string         `gorm:"type:text;not null" json:"subject"`
	Body      string         `gorm:"type:text;not null" json:"body"` // plain text or HTML
	IsHTML    bool           `gorm:"not null" json:"is_html"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

// TableName overrides the table name used by GORM
func (EmailTemplate) TableName() string {
	return "email_templates"
}
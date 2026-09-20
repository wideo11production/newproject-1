package model

import (
	"time"

	"github.com/google/uuid"
)

type CountryCode string
const (
	CountryCodeUS CountryCode = "US"
	CountryCodeCA CountryCode = "CA"
	CountryCodeUK CountryCode = "GB"
	CountryCodeIN CountryCode = "IN"
	CountryCodeDE CountryCode = "DE"
	CountryCodeFR CountryCode = "FR"
	CountryCodeJP CountryCode = "JP"
	CountryCodeBR CountryCode = "BR"
)

type LanguageCode string
const (
	LanguageCodeEN LanguageCode = "en"
	LanguageCodeES LanguageCode = "es"
	LanguageCodeFR LanguageCode = "fr"
	LanguageCodeDE LanguageCode = "de"
	LanguageCodeIT LanguageCode = "it"
	LanguageCodePT LanguageCode = "pt"
	LanguageCodeHI LanguageCode = "hi"
	LanguageCodeJA LanguageCode = "ja"
)

type ChannelType string
const (
	ChannelTypeVideoChannel ChannelType = "video"
	ChannelTypeNews ChannelType = "news"
	ChannelTypeSports ChannelType = "sports"
	ChannelTypeGaming ChannelType = "gaming"
	ChannelTypeEntertainment ChannelType = "entertainment"
	ChannelTypeTech ChannelType = "tech"
	ChannelTypeLifestyle ChannelType = "lifestyle"
	ChannelTypeEducation ChannelType = "education"
)

type Category struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string    `gorm:"size:100;not null" json:"name"`
	Code        string    `gorm:"size:50;uniqueIndex;not null" json:"code"`
	Type        string    `gorm:"size:50;not null" json:"type"`
	Description string    `gorm:"type:text" json:"description"`
	ParentID    *uint     `json:"parent_id,omitempty"`
	Level       int       `gorm:"default:0" json:"level"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Category) TableName() string {
	return "categories"
}

type TargetRule struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  uint      `gorm:"not null;index" json:"campaign_id"`
	Field       string    `gorm:"size:50;not null" json:"field"`
	Operator    string    `gorm:"size:20;not null" json:"operator"`
	Value       string    `gorm:"type:text;not null" json:"value"`
	IsInclude   bool      `gorm:"default:true" json:"is_include"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (TargetRule) TableName() string {
	return "target_rules"
}

type GeographicTarget struct {
	ID         uint       `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	RuleID     uint       `gorm:"not null;index" json:"rule_id"`
	Country    CountryCode `gorm:"size:3;not null" json:"country"`
	State      string      `gorm:"size:100" json:"state"`
	City       string      `gorm:"size:100" json:"city"`
	Locality   string      `gorm:"size:100" json:"locality"`
}

func (GeographicTarget) TableName() string {
	return "geographic_targets"
}

type LanguageTarget struct {
	ID        uint        `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID   `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	RuleID    uint        `gorm:"not null;index" json:"rule_id"`
	Language  LanguageCode `gorm:"size:5;not null" json:"language"`
	Dialect   string       `gorm:"size:50" json:"dialect"`
}

func (LanguageTarget) TableName() string {
	return "language_targets"
}

type ChannelTarget struct {
	ID        uint         `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID    `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	RuleID    uint         `gorm:"not null;index" json:"rule_id"`
	Channel   ChannelType  `gorm:"size:30;not null" json:"channel"`
	Subgenre  string       `gorm:"size:100" json:"subgenre"`
}

func (ChannelTarget) TableName() string {
	return "channel_targets"
}

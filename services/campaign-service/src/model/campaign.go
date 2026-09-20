package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type CampaignStatus string

const (
	CampaignStatusDraft    CampaignStatus = "draft"
	CampaignStatusActive    CampaignStatus = "active"
	CampaignStatusPaused    CampaignStatus = "paused"
	CampaignStatusCompleted CampaignStatus = "completed"
	CampaignStatusRejected  CampaignStatus = "rejected"
)

type Campaign struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name          string          `gorm:"size:255;not null" json:"name"`
	Code          string          `gorm:"size:100;uniqueIndex;not null" json:"code"`
	Description   string          `gorm:"type:text" json:"description"`
	AdvertiserID  uint            `gorm:"not null;index" json:"advertiser_id"`
	Status        CampaignStatus  `gorm:"size:20;default:'draft'" json:"status"`
	Budget        decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"budget"`
	Spent         decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"spent"`
	Remaining     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"remaining"`
	Currency      string          `gorm:"size:3;default:'INR'" json:"currency"`
	CPC           decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"cpc"`
	CPM           decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"cpm"`
	StartDate     time.Time       `json:"start_date"`
	EndDate       time.Time       `json:"end_date"`
	Targeting     string          `gorm:"type:text" json:"targeting"`
	AdFormat      string          `gorm:"size:50" json:"ad_format"`
	FrequencyCap  int             `gorm:"default:3" json:"frequency_cap"`
	FrequencyWindow int           `gorm:"default:24" json:"frequency_window"`
	Priority      int             `gorm:"default:0" json:"priority"`
	IsActive      bool            `gorm:"default:true" json:"is_active"`
	ApprovedBy    *uint           `json:"approved_by,omitempty"`
	ApprovedAt    *time.Time      `json:"approved_at,omitempty"`
	RejectionReason string        `gorm:"type:text" json:"rejection_reason"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Campaign) TableName() string {
	return "campaigns"
}

type TargetingRule struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  uint           `gorm:"not null;index" json:"campaign_id"`
	Field       string         `gorm:"size:50;not null" json:"field"`
	Operator    string         `gorm:"size:20;not null" json:"operator"`
	Value       string         `gorm:"type:text;not null" json:"value"`
	IsInclude   bool           `gorm:"default:true" json:"is_include"`
	CreatedAt   time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (TargetingRule) TableName() string {
	return "targeting_rules"
}

type CampaignDailyStat struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	CampaignID    uint            `gorm:"not null;index" json:"campaign_id"`
	Date          time.Time       `gorm:"index" json:"date"`
	Impressions   int             `gorm:"default:0" json:"impressions"`
	Clicks        int             `gorm:"default:0" json:"clicks"`
	Spent         decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"spent"`
	Conversions   int             `gorm:"default:0" json:"conversions"`
	Revenue       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (CampaignDailyStat) TableName() string {
	return "campaign_daily_stats"
}

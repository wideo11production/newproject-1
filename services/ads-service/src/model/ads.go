package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type AdStatus string

const (
	AdStatusDraft      AdStatus = "draft"
	AdStatusActive     AdStatus = "active"
	AdStatusPaused     AdStatus = "paused"
	AdStatusCompleted  AdStatus = "completed"
	AdStatusRejected   AdStatus = "rejected"
)

type AdType string

const (
	AdTypeBanner   AdType = "banner"
	AdTypeVideo    AdType = "video"
	AdTypeNative   AdType = "native"
	AdTypeOverlay  AdType = "overlay"
	AdTypeSponsored AdType = "sponsored"
)

type AdSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func (s AdSize) String() string {
	return string(rune(s.Width)) + "x" + string(rune(s.Height))
}

type Ad struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  uint            `gorm:"not null;index" json:"campaign_id"`
	Name        string          `gorm:"size:255;not null" json:"name"`
	AdType      AdType          `gorm:"size:30;not null" json:"ad_type"`
	Status      AdStatus        `gorm:"size:20;default:'draft'" json:"status"`
	HTMLContent string          `gorm:"type:text" json:"html_content"`
	MediaURL    string          `gorm:"size:500" json:"media_url"`
	TargetURL   string          `gorm:"size:500;not null" json:"target_url"`
	Width       int             `json:"width"`
	Height      int             `json:"height"`
	CPC         decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"cpc"`
	CPM         decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"cpm"`
	CTR         decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"ctr"`
	Clicks        int           `gorm:"default:0" json:"clicks"`
	Impressions   int           `gorm:"default:0" json:"impressions"`
	Spent         decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"spent"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Ad) TableName() string {
	return "ads"
}

type AdPlacement struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string    `gorm:"size:100;not null" json:"name"`
	Code        string    `gorm:"size:50;uniqueIndex;not null" json:"code"`
	AdType      AdType    `gorm:"size:30;not null" json:"ad_type"`
	Page        string    `gorm:"size:100" json:"page"`
	Zone        string    `gorm:"size:100" json:"zone"`
	Width       int       `json:"width"`
	Height      int       `json:"height"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (AdPlacement) TableName() string {
	return "ad_placements"
}

type AdSlot struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	PlacementID uint      `gorm:"not null;index" json:"placement_id"`
	AdID        uint      `gorm:"index" json:"ad_id"`
	Score       decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"score"`
	Priority    int       `gorm:"default:0" json:"priority"`
	IsEnabled   bool      `gorm:"default:true" json:"is_enabled"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (AdSlot) TableName() string {
	return "ad_slots"
}

type AdImpression struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID      uint      `gorm:"not null;index" json:"ad_id"`
	CampaignID uint     `gorm:"not null;index" json:"campaign_id"`
	UserID    *uint     `json:"user_id,omitempty"`
	PlacementID uint    `gorm:"index" json:"placement_id"`
	Timestamp time.Time `gorm:"index" json:"timestamp"`
	IPAddress   string  `gorm:"size:45" json:"ip_address"`
	UserAgent   string  `gorm:"type:text" json:"user_agent"`
	Country    string   `gorm:"size:3" json:"country"`
	Region     string   `gorm:"size:100" json:"region"`
	City       string   `gorm:"size:100" json:"city"`
	Device     string   `gorm:"size:50" json:"device"`
}

func (AdImpression) TableName() string {
	return "ad_impressions"
}

type AdClick struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID      uint      `gorm:"not null;index" json:"ad_id"`
	CampaignID uint     `gorm:"not null;index" json:"campaign_id"`
	UserID    *uint     `json:"user_id,omitempty"`
	PlacementID uint    `gorm:"index" json:"placement_id"`
	Timestamp time.Time `gorm:"index" json:"timestamp"`
	IPAddress   string  `gorm:"size:45" json:"ip_address"`
	UserAgent   string  `gorm:"type:text" json:"user_agent"`
	Country    string   `gorm:"size:3" json:"country"`
	Region     string   `gorm:"size:100" json:"region"`
	City       string   `gorm:"size:100" json:"city"`
	Device     string   `gorm:"size:50" json:"device"`
}

func (AdClick) TableName() string {
	return "ad_clicks"
}

type ConversionEvent struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	ClickID      *uint     `json:"click_id,omitempty"`
	AdID         uint      `gorm:"not null;index" json:"ad_id"`
	CampaignID   uint      `gorm:"not null;index" json:"campaign_id"`
	UserID       *uint     `json:"user_id,omitempty"`
	EventType    string    `gorm:"size:50;not null" json:"event_type"`
	EventValue    decimal.Decimal `gorm:"type:numeric(20,2)" json:"event_value"`
	ConversionRevenue decimal.Decimal `gorm:"type:numeric(20,2)" json:"conversion_revenue"`
	Timestamp    time.Time `gorm:"index" json:"timestamp"`
	IPAddress    string    `gorm:"size:45" json:"ip_address"`
	UserAgent    string    `gorm:"type:text" json:"user_agent"`
	Country      string    `gorm:"size:3" json:"country"`
}

func (ConversionEvent) TableName() string {
	return "conversion_events"
}

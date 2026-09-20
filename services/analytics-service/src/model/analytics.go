package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type ViewType string

const (
	ViewTypeVideo ViewType = "video"
	ViewTypeImage ViewType = "image"
	ViewTypeText   ViewType = "text"
	ViewTypeLive   ViewType = "live"
)

type ViewLog struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID        *uint           `json:"ad_id,omitempty"`
	CampaignID  *uint           `json:"campaign_id,omitempty"`
	UserID      *uint           `json:"user_id,omitempty"`
	VideoID     *uint           `json:"video_id,omitempty"`
	ContentID   string          `gorm:"size:100" json:"content_id"`
	Type        ViewType        `gorm:"size:20;not null" json:"type"`
	Duration    int             `gorm:"not null" json:"duration"`
	PercentWatched decimal.Decimal `gorm:"type:numeric(10,2);not null" json:"percent_watched"`
	IPAddress    string          `gorm:"size:45" json:"ip_address"`
	UserAgent    string          `gorm:"type:text" json:"user_agent"`
	Country      string          `gorm:"size:3" json:"country"`
	Region       string          `gorm:"size:100" json:"region"`
	City         string          `gorm:"size:100" json:"city"`
	Device       string          `gorm:"size:50" json:"device"`
	Timestamp    time.Time       `gorm:"index" json:"timestamp"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (ViewLog) TableName() string {
	return "view_logs"
}

type ClickLog struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID        *uint     `json:"ad_id,omitempty"`
	CampaignID  *uint     `json:"campaign_id,omitempty"`
	UserID      *uint     `json:"user_id,omitempty"`
	ContentID   string    `gorm:"size:100" json:"content_id"`
	VideoID     *uint     `json:"video_id,omitempty"`
	IPAddress    string    `gorm:"size:45" json:"ip_address"`
	UserAgent    string    `gorm:"type:text" json:"user_agent"`
	Country      string    `gorm:"size:3" json:"country"`
	Region       string    `gorm:"size:100" json:"region"`
	City         string    `gorm:"size:100" json:"city"`
	Device       string    `gorm:"size:50" json:"device"`
	Timestamp    time.Time `gorm:"index" json:"timestamp"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (ClickLog) TableName() string {
	return "click_logs"
}

type ConversionEvent struct {
	ID             uint            `gorm:"primarykey" json:"id"`
	UUID           uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID           *uint           `json:"ad_id,omitempty"`
	CampaignID     *uint           `json:"campaign_id,omitempty"`
	UserID         *uint           `json:"user_id,omitempty"`
	VideoID        *uint           `json:"video_id,omitempty"`
	ContentID      string          `gorm:"size:100" json:"content_id"`
	EventType      string          `gorm:"size:50;not null" json:"event_type"`
	EventValue     decimal.Decimal `gorm:"type:numeric(20,2)" json:"event_value"`
	ConversionRevenue decimal.Decimal `gorm:"type:numeric(20,2)" json:"conversion_revenue"`
	RevenueSource  string          `gorm:"size:50" json:"revenue_source"`
	Timestamp      time.Time       `gorm:"index" json:"timestamp"`
	IPAddress      string          `gorm:"size:45" json:"ip_address"`
	UserAgent      string          `gorm:"type:text" json:"user_agent"`
	Country        string          `gorm:"size:3" json:"country"`
	CreatedAt      time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (ConversionEvent) TableName() string {
	return "conversion_events"
}

type Reach struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  uint      `gorm:"not null;index" json:"campaign_id"`
	Date        time.Time `gorm:"index;not null" json:"date"`
	UniqueUsers int       `gorm:"default:0" json:"unique_users"`
	Impressions int       `gorm:"default:0" json:"impressions"`
	ReachPercent decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"reach_percent"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (Reach) TableName() string {
	return "reach_stats"
}

type RevenueReport struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID    uint            `gorm:"not null;index" json:"campaign_id"`
	Date          time.Time       `gorm:"index;not null" json:"date"`
	Revenue       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	AdSpend       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"ad_spend"`
	NetRevenue    decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"net_revenue"`
	Conversions   int             `gorm:"default:0" json:"conversions"`
	RPM           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"rpm"`
	CPM           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"cpm"`
	CTR           decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"ctr"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (RevenueReport) TableName() string {
	return "revenue_reports"
}

type CampaignAnalytics struct {
	CampaignID   uint            `gorm:"index" json:"campaign_id"`
	CampaignName string          `gorm:"size:255" json:"campaign_name"`
	Impressions  int             `gorm:"default:0" json:"impressions"`
	Clicks       int             `gorm:"default:0" json:"clicks"`
	CTR          decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"ctr"`
	Reach        int             `gorm:"default:0" json:"reach"`
	Revenue      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	Conversions  int             `gorm:"default:0" json:"conversions"`
}

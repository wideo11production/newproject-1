package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Currency string

const (
	CurrencyINR Currency = "INR"
	CurrencyUSD Currency = "USD"
	CurrencyEUR Currency = "EUR"
)

type RevenueSource string

const (
	RevenueSourceAd        RevenueSource = "ad"
	RevenueSourcePremium   RevenueSource = "premium"
	RevenueSourceSuperChat RevenueSource = "super_chat"
	RevenueSourceMembership RevenueSource = "membership"
	RevenueSourceMerch     RevenueSource = "merch"
)

type RateTier struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Currency    Currency        `gorm:"size:3;not null" json:"currency"`
	MinRevenue  decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"min_revenue"`
	MaxRevenue  decimal.Decimal `gorm:"type:numeric(20,2)" json:"max_revenue"`
	Rate        decimal.Decimal `gorm:"type:numeric(20,4);not null" json:"rate"`
	Source      RevenueSource `gorm:"size:30;not null" json:"source"`
	Name        string          `gorm:"size:100" json:"name"`
	IsDefault   bool            `gorm:"default:false" json:"is_default"`
	Description string          `gorm:"type:text" json:"description"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (RateTier) TableName() string {
	return "rate_tiers"
}

type RoyaltyStatus string

const (
	RoyaltyStatusPending   RoyaltyStatus = "pending"
	RoyaltyStatusCalculated RoyaltyStatus = "calculated"
	RoyaltyStatusPaid      RoyaltyStatus = "paid"
	RoyaltyStatusFailed    RoyaltyStatus = "failed"
)

type RoyaltyRecord struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID      uint            `gorm:"not null;index" json:"user_id"`
	Currency    Currency        `gorm:"size:3;not null" json:"currency"`
	PeriodStart time.Time       `json:"period_start"`
	PeriodEnd   time.Time       `json:"period_end"`
	GrossRevenue decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"gross_revenue"`
	PlatformFee decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"platform_fee"`
	NetRevenue  decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"net_revenue"`
	RoyaltyRate decimal.Decimal `gorm:"type:numeric(20,4);default:0" json:"royalty_rate"`
	RoyaltyAmount decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"royalty_amount"`
	Status      RoyaltyStatus   `gorm:"size:20;default:'pending'" json:"status"`
	Source      RevenueSource   `gorm:"size:30" json:"source"`
	ReferenceID string          `gorm:"size:100" json:"reference_id"`
	Description string          `gorm:"type:text" json:"description"`
	PaidAt      *time.Time      `json:"paid_at,omitempty"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (RoyaltyRecord) TableName() string {
	return "royalty_records"
}

type PlatformFee struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Currency    Currency        `gorm:"size:3;not null" json:"currency"`
	Rate        decimal.Decimal `gorm:"type:numeric(20,4);not null" json:"rate"`
	MinFee      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"min_fee"`
	MaxFee      decimal.Decimal `gorm:"type:numeric(20,2)" json:"max_fee"`
	Source      RevenueSource   `gorm:"size:30;not null" json:"source"`
	Description string          `gorm:"type:text" json:"description"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (PlatformFee) TableName() string {
	return "platform_fees"
}

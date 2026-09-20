package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type SubscriptionStatus string

const (
	SubStatusActive    SubscriptionStatus = "active"
	SubStatusCancelled SubscriptionStatus = "cancelled"
	SubStatusExpired   SubscriptionStatus = "expired"
	SubStatusPastDue   SubscriptionStatus = "past_due"
	SubStatusTrial     SubscriptionStatus = "trial"
)

type BillingCycle string

const (
	CycleMonthly  BillingCycle = "monthly"
	CycleYearly   BillingCycle = "yearly"
	CycleQuarterly BillingCycle = "quarterly"
)

type SubscriptionPlan struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string          `gorm:"size:100;not null" json:"name"`
	Code        string          `gorm:"size:50;uniqueIndex;not null" json:"code"`
	Description string          `gorm:"type:text" json:"description"`
	Price       decimal.Decimal `gorm:"type:numeric(20,2)" json:"price"`
	Currency    string          `gorm:"size:3;default:'INR'" json:"currency"`
	Cycle       BillingCycle    `gorm:"size:20;not null" json:"cycle"`
	Interval    int             `gorm:"default:1" json:"interval"`
	TrialDays   int             `gorm:"default:0" json:"trial_days"`
	SortOrder   int             `gorm:"default:0" json:"sort_order"`
	IsActive    bool            `gorm:"default:true" json:"is_active"`
	Features    string          `gorm:"type:text" json:"features"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (SubscriptionPlan) TableName() string {
	return "subscription_plans"
}

type Subscription struct {
	ID        uint               `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID          `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID    uint               `gorm:"not null;index" json:"user_id"`
	PlanID    uint               `gorm:"not null" json:"plan_id"`
	Status    SubscriptionStatus `gorm:"size:20;default:'trial'" json:"status"`
	StartDate time.Time          `json:"start_date"`
	EndDate   time.Time          `json:"end_date"`
	AutoRenew bool               `gorm:"default:true" json:"auto_renew"`
	CanceledAt *time.Time        `json:"canceled_at,omitempty"`
	CancelReason string          `gorm:"type:text" json:"cancel_reason"`
	CreatedAt time.Time          `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time          `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

type InvoiceStatus string

const (
	InvoiceStatusDraft     InvoiceStatus = "draft"
	InvoiceStatusIssued    InvoiceStatus = "issued"
	InvoiceStatusPaid      InvoiceStatus = "paid"
	InvoiceStatusOverdue   InvoiceStatus = "overdue"
	InvoiceStatusCancelled InvoiceStatus = "cancelled"
	InvoiceStatusRefunded  InvoiceStatus = "refunded"
)

type InvoiceItem struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceID   uint            `gorm:"not null;index" json:"invoice_id"`
	Description string          `gorm:"type:text" json:"description"`
	Quantity    decimal.Decimal `gorm:"type:numeric(20,2);default:1" json:"quantity"`
	UnitPrice   decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"unit_price"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	TaxAmount   decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"tax_amount"`
	Discount    decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"discount"`
	TotalAmount decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total_amount"`
}

func (InvoiceItem) TableName() string {
	return "invoice_items"
}

type Invoice struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID        uint            `gorm:"not null;index" json:"user_id"`
	SubscriptionID *uint          `json:"subscription_id,omitempty"`
	InvoiceNumber string          `gorm:"size:50;uniqueIndex;not null" json:"invoice_number"`
	Status        InvoiceStatus   `gorm:"size:20;default:'draft'" json:"status"`
	IssueDate     time.Time       `json:"issue_date"`
	DueDate       time.Time       `json:"due_date"`
	Amount        decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	TaxAmount     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"tax_amount"`
	Discount      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"discount"`
	TotalAmount   decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total_amount"`
	Currency      string          `gorm:"size:3;default:'INR'" json:"currency"`
	PaymentStatus string          `gorm:"size:20;default:'pending'" json:"payment_status"`
	PaidAt        *time.Time      `json:"paid_at,omitempty"`
	Notes         string          `gorm:"type:text" json:"notes"`
	Metadata      string          `gorm:"type:text" json:"metadata"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Invoice) TableName() string {
	return "invoices"
}

type TaxRate struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string          `gorm:"size:100;not null" json:"name"`
	Code        string          `gorm:"size:20;uniqueIndex;not null" json:"code"`
	Rate        decimal.Decimal `gorm:"type:numeric(20,4);not null" json:"rate"`
	Type        string          `gorm:"size:20;not null" json:"type"` // percentage or fixed
	Country     string          `gorm:"size:3" json:"country"`
	Region      string          `gorm:"size:100" json:"region"`
	IsCompound  bool            `gorm:"default:false" json:"is_compound"`
	IsActive    bool            `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (TaxRate) TableName() string {
	return "tax_rates"
}

type PaymentStatus string

const (
	PaymentStatusPending  PaymentStatus = "pending"
	PaymentStatusSuccess  PaymentStatus = "success"
	PaymentStatusFailed   PaymentStatus = "failed"
	PaymentStatusRefunded PaymentStatus = "refunded"
)

type Payment struct {
	ID         uint            `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceID  uint            `gorm:"not null;index" json:"invoice_id"`
	UserID     uint            `gorm:"not null;index" json:"user_id"`
	Amount     decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Currency   string          `gorm:"size:3;default:'INR'" json:"currency"`
	Status     PaymentStatus   `gorm:"size:20;default:'pending'" json:"status"`
	Method     string          `gorm:"size:50;not null" json:"method"`
	Provider   string          `gorm:"size:50" json:"provider"`
	ProviderRef string         `gorm:"size:100" json:"provider_ref"`
	ProcessedAt *time.Time      `json:"processed_at,omitempty"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Payment) TableName() string {
	return "payments"
}

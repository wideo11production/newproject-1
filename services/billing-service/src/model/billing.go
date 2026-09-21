package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// BillingEventType represents the types of billing events that can occur
type BillingEventType string

const (
	// BillingInvoiceCreation indicates a new invoice has been created
	BillingInvoiceCreation BillingEventType = "invoice.create"
	// BillingInvoiceUpdate indicates an existing invoice has been updated
	BillingInvoiceUpdate BillingEventType = "invoice.update"
	// BillingPaymentReceived indicates a payment has been received
	BillingPaymentReceived BillingEventType = "payment.received"
	// BillingPaymentRefunded indicates a payment has been refunded
	BillingPaymentRefunded BillingEventType = "payment.refunded"
	// BillingSubscriptionCharge indicates a subscription charge has been applied
	BillingSubscriptionCharge BillingEventType = "subscription.charge"
)

// BillingCycle represents the billing cycle frequency for subscription plans
type BillingCycle string

const (
	BillingCycleMonthly   BillingCycle = "monthly"
	BillingCycleQuarterly BillingCycle = "quarterly"
	BillingCycleAnnually  BillingCycle = "annually"
	BillingCycleWeekly    BillingCycle = "weekly"
	BillingCycleDaily     BillingCycle = "daily"
)

// TaxType represents the type of tax for calculation purposes
type TaxType string

const (
	TaxTypeVAT   TaxType = "vat"
	TaxTypeGST   TaxType = "gst"
	TaxTypeSales TaxType = "sales_tax"
	TaxTypeOther TaxType = "other"
)

// PaymentMethod represents the payment method used for transactions
type PaymentMethod string

const (
	PaymentMethodCreditCard PaymentMethod = "credit_card"
	PaymentMethodDebitCard  PaymentMethod = "debit_card"
	PaymentMethodPayPal     PaymentMethod = "paypal"
	PaymentMethodBankTransfer PaymentMethod = "bank_transfer"
	PaymentMethodCrypto     PaymentMethod = "crypto"
	PaymentMethodCash       PaymentMethod = "cash"
	PaymentMethodOther      PaymentMethod = "other"
)

// PaymentProvider represents the payment provider/gateway used
type PaymentProvider string

const (
	PaymentProviderStripe    PaymentProvider = "stripe"
	PaymentProviderPayPal    PaymentProvider = "paypal"
	PaymentProviderRazorpay  PaymentProvider = "razorpay"
	PaymentProviderAdyen     PaymentProvider = "adyen"
	PaymentProviderAuthorize PaymentProvider = "authorize_net"
	PaymentProviderOther     PaymentProvider = "other"
)

// InvoiceStatus represents the current status of an invoice
type InvoiceStatus string

const (
	InvoiceStatusDraft     InvoiceStatus = "draft"
	InvoiceStatusPending   InvoiceStatus = "pending"
	InvoiceStatusPaid      InvoiceStatus = "paid"
	InvoiceStatusOverdue   InvoiceStatus = "overdue"
	InvoiceStatusCancelled InvoiceStatus = "cancelled"
	InvoiceStatusRefunded  InvoiceStatus = "refunded"
)

// SubscriptionStatus represents the current status of a subscription
type SubscriptionStatus string

const (
	SubscriptionStatusActive     SubscriptionStatus = "active"
	SubscriptionStatusPending    SubscriptionStatus = "pending"
	SubscriptionStatusCancelled  SubscriptionStatus = "cancelled"
	SubscriptionStatusExpired    SubscriptionStatus = "expired"
	SubscriptionStatusPaused     SubscriptionStatus = "paused"
	SubscriptionStatusTrial      SubscriptionStatus = "trial"
)

// SubscriptionPlan represents a subscription plan/product offered to customers
type SubscriptionPlan struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name        string         `gorm:"size:100;not null" json:"name"`
	Code        string         `gorm:"size:50;not null;uniqueIndex" json:"code"`
	Description string         `gorm:"size:500" json:"description"`
	Price       decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"price"`
	Currency    string         `gorm:"size:3;not null" json:"currency"`
	Cycle       BillingCycle   `gorm:"size:20;not null" json:"cycle"`
	Interval    int            `gorm:"default:1" json:"interval"`
	TrialDays   int            `gorm:"default:0" json:"trial_days"`
	Features    string         `gorm:"type:text" json:"features"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	SortOrder   int            `gorm:"default:0" json:"sort_order"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (SubscriptionPlan) TableName() string {
	return "subscription_plans"
}

// Subscription represents a customer's active subscription
type Subscription struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID     uint           `gorm:"not null;index" json:"user_id"`
	PlanID     uint           `gorm:"not null;index" json:"plan_id"`
	Plan       SubscriptionPlan `json:"plan"`
	Status     SubscriptionStatus `gorm:"size:20;default:'pending'" json:"status"`
	StartDate  time.Time        `json:"start_date"`
	EndDate    time.Time        `json:"end_date"`
	CurrentPeriodStart time.Time `json:"current_period_start"`
	CurrentPeriodEnd time.Time `json:"current_period_end"`
	TrialEnd   time.Time        `json:"trial_end"`
	AutoRenew  bool             `gorm:"default:false" json:"auto_renew"`
	CanceledAt time.Time        `json:"canceled_at"`
	CancelReason string         `gorm:"size:500" json:"cancel_reason"`
	PaymentProvider PaymentProvider `gorm:"size:30" json:"payment_provider"`
	PaymentMethod PaymentMethod `gorm:"size:30" json:"payment_method"`
	Metadata   string           `gorm:"type:text" json:"metadata"`
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

// TaxRate represents a tax rate configuration for different regions
type TaxRate struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name         string         `gorm:"size:100;not null" json:"name"`
	Code         string         `gorm:"size:50;not null;uniqueIndex" json:"code"`
	Rate         decimal.Decimal `gorm:"type:numeric(10,6);not null" json:"rate"`
	Type         TaxType        `gorm:"size:20;not null" json:"type"`
	Country      string         `gorm:"size:3;not null" json:"country"`
	Region       string         `gorm:"size:100" json:"region"`
	IsCompound   bool           `gorm:"default:false" json:"is_compound"`
	Priority     int            `gorm:"default:0" json:"priority"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (TaxRate) TableName() string {
	return "tax_rates"
}

// Invoice represents a billing invoice document
type Invoice struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceNumber string       `gorm:"size:50;not null;uniqueIndex" json:"invoice_number"`
	InvoiceType string         `gorm:"size:50;not null" json:"invoice_type"`
	CustomerID  string         `gorm:"size:100;not null" json:"customer_id"`
	SubscriptionID *uint       `gorm:"index" json:"subscription_id"`
	Status      InvoiceStatus  `gorm:"size:20;default:'draft'" json:"status"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	TaxAmount   decimal.Decimal `gorm:"type:numeric(20,2);default:'0.00'" json:"tax_amount"`
	TotalAmount decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total_amount"`
	Currency    string         `gorm:"size:3;not null" json:"currency"`
	DueDate     time.Time      `json:"due_date"`
	IssueDate   time.Time      `json:"issue_date"`
	Notes       string         `gorm:"type:text" json:"notes"`
	Items       []InvoiceItem  `json:"items"`
	Payments    []Payment      `json:"payments"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (Invoice) TableName() string {
	return "invoices"
}

// InvoiceItem represents a line item on an invoice
type InvoiceItem struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceID  uint           `gorm:"not null;index" json:"invoice_id"`
	Description string         `gorm:"size:500;not null" json:"description"`
	Quantity    int            `gorm:"default:1" json:"quantity"`
	UnitPrice   decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"unit_price"`
	TaxRateID  *uint           `gorm:"index" json:"tax_rate_id"`
	TaxRate    *TaxRate        `json:"tax_rate"`
	TaxAmount  decimal.Decimal `gorm:"type:numeric(20,2);default:'0.00'" json:"tax_amount"`
	Total      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total"`
	SortOrder   int            `gorm:"default:0" json:"sort_order"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (InvoiceItem) TableName() string {
	return "invoice_items"
}

// Payment represents a payment transaction against an invoice
type Payment struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	PaymentNumber string       `gorm:"size:50;not null;uniqueIndex" json:"payment_number"`
	InvoiceID  uint           `gorm:"not null;index" json:"invoice_id"`
	Invoice    Invoice        `json:"invoice"`
	CustomerID string          `gorm:"size:100;not null" json:"customer_id"`
	Amount     decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	AmountPaid decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount_paid"`
	RefundAmount decimal.Decimal `gorm:"type:numeric(20,2);default:'0.00'" json:"refund_amount"`
	Status     string         `gorm:"size:20;default:'pending'" json:"status"`
	Method     PaymentMethod  `gorm:"size:30;not null" json:"method"`
	Provider   PaymentProvider `gorm:"size:30" json:"provider"`
	TransactionID string       `gorm:"size:100" json:"transaction_id"`
	ProcessedAt time.Time      `json:"processed_at"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (Payment) TableName() string {
	return "payments"
}

// SubscriptionCharge represents a charge applied to a subscription
type SubscriptionCharge struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	SubscriptionID uint         `gorm:"not null;index" json:"subscription_id"`
	InvoiceID   uint           `gorm:"not null;index" json:"invoice_id"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	AmountDue   decimal.Decimal `gorm:"type:numeric(20,2)" json:"amount_due"`
	Currency    string         `gorm:"size:3;not null" json:"currency"`
	Status      string         `gorm:"size:20;default:'pending'" json:"status"`
	Description string         `gorm:"size:500" json:"description"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (SubscriptionCharge) TableName() string {
	return "subscription_charges"
}

// InvoiceItemRequest is used for creating invoice items via API
type InvoiceItemRequest struct {
	Description string  `json:"description" binding:"required"`
	Quantity    int     `json:"quantity" binding:"required,min:1"`
	UnitPrice   string  `json:"unit_price" binding:"required"`
	TaxRateCode string  `json:"tax_rate_code"`
}

// ManualExpense represents manual/offline expenses for superadmin tracking
type ManualExpense struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Description  string         `gorm:"size:500;not null" json:"description"`
	Amount       decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Currency     string         `gorm:"size:3;not null" json:"currency"`
	ExpenseDate  time.Time      `json:"expense_date"`
	Category     string         `gorm:"size:100" json:"category"`
	CustomerID   string         `gorm:"size:100" json:"customer_id"`
	Status       string         `gorm:"size:20;default:'pending'" json:"status"`
	Notes        string         `gorm:"type:text" json:"notes"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (ManualExpense) TableName() string {
	return "manual_expenses"
}

// Reconciliation represents billing reconciliation records
type Reconciliation struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	UUID         uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Type         string         `gorm:"size:50;not null" json:"type"`
	ExternalID   string         `gorm:"size:100;not null;uniqueIndex" json:"external_id"`
	Status       string         `gorm:"size:20;default:'pending'" json:"status"`
	Amount       decimal.Decimal `gorm:"type:numeric(20,2)" json:"amount"`
	MismatchReason string       `gorm:"size:500" json:"mismatch_reason"`
	Metadata     string         `gorm:"type:text" json:"metadata"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (Reconciliation) TableName() string {
	return "reconciliations"
}
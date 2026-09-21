package model

import "time"

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

type Invoice struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UUID       uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceType string        `gorm:"size:50;not null" json:"invoice_type"`
	CustomerID  string        `gorm:"size:100;not null" json:"customer_id"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2)" json:"amount"`
	Currency    string        `gorm:"size:3;not null" json:"currency"`
	Status      string        `gorm:"size:20;default:'pending'" json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

func (Invoice) TableName() string {
	return "invoices"
}

type SubscriptionCharge struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	InvoiceID   uint           `gorm:"not null;index" json:"invoice_id"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2)" json:"amount"`
	Currency    string        `gorm:"size:3;not null" json:"currency"`
	Status      string        `gorm:"size:20;default:'pending'" json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

func (SubscriptionCharge) TableName() string {
	return "subscription_charges"
}

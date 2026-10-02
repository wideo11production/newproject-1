package repository

import (
	"newproject/services/analytics-service/src/model"
	"time"
)

// PlanRepository handles subscription plan data operations
// Manages subscription pricing, features, and availability
// Tracks plan performance and creator revenue sharing
// Supports tiered service offering management

type PlanRepository interface {
	Create(plan *model.SubscriptionPlan) error
	GetByID(id uint) (*model.SubscriptionPlan, error)
	GetByName(name string) (*model.SubscriptionPlan, error)
	GetAll() ([]*model.SubscriptionPlan, error)
	GetActive() ([]*model.SubscriptionPlan, error)
	Update(plan *model.SubscriptionPlan) error
	Delete(id uint) error
	GetPlansByType(planType string) ([]*model.SubscriptionPlan, error)
	GetPlansByPriceRange(minPrice, maxPrice float64) ([]*model.SubscriptionPlan, error)
	GetPopularPlans(limit int) ([]*model.SubscriptionPlan, error)
}

// SubscriptionRepository manages subscription lifecycle data
// Tracks active subscriptions, billing cycles, and payment history
// Monitors subscription retention and churn patterns
// Essential for creator revenue forecasting

type SubscriptionRepository interface {
	Create(subscription *model.Subscription) error
	GetByID(id uint) (*model.Subscription, error)
	GetByCreatorID(creatorID uint) ([]*model.Subscription, error)
	GetByPlanID(planID uint) ([]*model.Subscription, error)
	GetActiveSubscriptions() ([]*model.Subscription, error)
	GetExpiringSubscriptions(days int) ([]*model.Subscription, error)
	Update(subscription *model.Subscription) error
	CancelSubscription(id uint, reason string) error
	GetSubscriptionHistory(creatorID uint, startDate, endDate time.Time) ([]*model.Subscription, error)
	GetBillingCycleStats(startDate, endDate time.Time) ([]struct {
		Date          time.Time
		Subscriptions int
		Revenue       float64
		ChurnRate     float64
	}, error)
}

// TaxRateRepository manages tax configuration data
// Defines tax rules for different regions and jurisdictions
// Supports complex tax scenarios and calculation methods
// Essential for accurate billing and revenue calculations

type TaxRateRepository interface {
	Create(taxRate *model.TaxRate) error
	GetByID(id uint) (*model.TaxRate, error)
	GetByCountry(country string) ([]*model.TaxRate, error)
	GetByCode(code string) (*model.TaxRate, error)
	GetAllActive() ([]*model.TaxRate, error)
	GetByTaxType(taxType string) ([]*model.TaxRate, error)
	GetByTaxCategory(category string) ([]*model.TaxRate, error)
	Update(taxRate *model.TaxRate) error
	Delete(id uint) error
	GetApplicableTaxRates(country, state string, amount float64) (float64, error)
}

// InvoiceRepository manages invoice data and billing records
// Tracks invoice generation, status, and payment processing
// Supports invoice lifecycle management and financial reporting
// Critical for creator revenue transparency and auditing

type InvoiceRepository interface {
	Create(invoiceItem *model.InvoiceItem) error
	GetByID(id uint) (*model.InvoiceItem, error)
	GetByInvoiceID(invoiceID uint) ([]*model.InvoiceItem, error)
	GetByCreatorID(creatorID uint, limit int) ([]*model.InvoiceItem, error)
	GetUnpaidInvoices(limit int) ([]*model.InvoiceItem, error)
	GetOverdueInvoices(limit int) ([]*model.InvoiceItem, error)
	Update(invoiceItem *model.InvoiceItem) error
	MarkAsPaid(invoiceID uint, paymentID string) error
	GenerateInvoiceNumber() (string, error)
	GetInvoiceAnalytics(startDate, endDate time.Time) ([]struct {
		Date         time.Time
		TotalAmount  float64
		PaidAmount   float64
		UnpaidAmount float64
		TaxCollected float64
	}, error)
}

// PaymentRepository manages payment transaction records
// Tracks all financial transactions for creators and platform
// Supports multiple payment methods and providers
// Essential for payment processing and reconciliation

type PaymentRepository interface {
	Create(payment *model.Payment) error
	GetByID(id uint) (*model.Payment, error)
	GetByTransactionID(transactionID string) (*model.Payment, error)
	GetByCreatorID(creatorID uint, limit int) ([]*model.Payment, error)
	GetRecentPayments(limit int) ([]*model.Payment, error)
	GetPaymentsByDateRange(startDate, endDate time.Time) ([]*model.Payment, error)
	GetPaymentsByMethod(paymentMethod string) ([]*model.Payment, error)
	Update(payment *model.Payment) error
	ProcessPayment(paymentID uint, status string) error
	GetPaymentSummary(startDate, endDate time.Time) (float64, float64, float64, error)
}

// ManualExpenseRepository manages offline expenditure records
// Tracks creator expenses and platform reimbursements
// Supports manual expense tracking with detailed categorization
// Critical for expense reporting and tax deduction calculations

type ManualExpenseRepository interface {
	Create(expense *model.ManualExpense) error
	GetByID(id uint) (*model.ManualExpense, error)
	GetByCreatorID(creatorID uint, limit int) ([]*model.ManualExpense, error)
	GetRecentExpenses(limit int) ([]*model.ManualExpense, error)
	GetExpensesByDateRange(startDate, endDate time.Time) ([]*model.ManualExpense, error)
	GetExpensesByCategory(category string) ([]*model.ManualExpense, error)
	GetExpensesByStatus(status string) ([]*model.ManualExpense, error)
	Update(expense *model.ManualExpense) error
	ApproveExpense(id uint, approver string, amount float64) error
	RejectExpense(id uint, reason string) error
	GetExpenseSummary(startDate, endDate time.Time) (float64, float64, float64, error)
}

// BillingRepository defines the complete billing data access layer
// Combines all billing-related repository interfaces
// Provides unified access to subscription, payment, and expense data
// Supports comprehensive billing operations and reporting

// Note: The composite BillingRepository interface was removed due to
// conflicting method signatures between sub-interfaces (Create, GetByID, etc.)
// The individual repository interfaces should be used directly instead.

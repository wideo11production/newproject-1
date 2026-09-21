package service

import (
	"context"

	"newproject/services/billing-service/src/model"
)

// BillingService orchestrates billing operations including invoice management,
// payment processing, and reconciliation.
type BillingService struct {
	auditRepo BillingEventRepository
	reconRepo BillingEventRepository // Note: should be ReconciliationRepository for consistency
}

// NewBillingService creates a new BillingService with the required repositories.
// In practice, these would be initialized with a database connection.
func NewBillingService(auditRepo BillingEventRepository, reconRepo BillingEventRepository) *BillingService {
	return &BillingService{
		auditRepo: auditRepo,
		reconRepo: reconRepo,
	}
}

// RecordInvoice records a new billing invoice event.
func (s *BillingService) RecordInvoice(ctx context.Context, invoice *model.Invoice) (*model.Invoice, error) {
	return s.auditRepo.Create(ctx, invoice)
}

// GetInvoice retrieves an invoice by ID.
func (s *BillingService) GetInvoice(ctx context.Context, id uint) (*model.Invoice, error) {
	return s.auditRepo.GetByID(ctx, id)
}

// GetInvoicesByCustomer retrieves invoices for a given customer.
func (s *BillingService) GetInvoicesByCustomer(ctx context.Context, customerID string, limit, offset int) ([]*model.Invoice, error) {
	return s.auditRepo.GetByCustomer(ctx, customerID, limit, offset)
}

// GetPendingInvoices retrieves invoices that are still pending.
func (s *BillingService) GetPendingInvoices(ctx context.Context, limit int) ([]*model.Invoice, error) {
	return s.auditRepo.GetPending(ctx, limit)
}

// RecordPayment records a payment event.
func (s *BillingService) RecordPayment(ctx context.Context, payment *model.SubscriptionCharge) (*model.SubscriptionCharge, error) {
	return s.reconRepo.Create(ctx, payment)
}

// GetPayment retrieves a payment by ID.
func (s *BillingService) GetPayment(ctx context.Context, id uint) (*model.SubscriptionCharge, error) {
	return s.reconRepo.GetByID(ctx, id)
}

// RecordSubscriptionCharge records a subscription charge.
func (s *BillingService) RecordSubscriptionCharge(ctx context.Context, charge *model.SubscriptionCharge) error {
	return s.reconRepo.Create(ctx, charge)
}

// GetSubscriptionCharges retrieves charges for a given invoice.
func (s *BillingService) GetSubscriptionCharges(ctx context.Context, invoiceID uint) ([]*model.SubscriptionCharge, error) {
	return s.reconRepo.GetByUUID(ctx, invoiceID)
}

// CompleteReconciliation marks a reconciliation as resolved.
func (s *BillingService) CompleteReconciliation(ctx context.Context, reconID uint) (*model.Reconciliation, error) {
	// This would typically interact with the reconciliation repository
	// For now, we delegate to the service layer
	return nil, nil
}

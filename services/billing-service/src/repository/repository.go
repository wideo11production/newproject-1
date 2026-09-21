package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"newproject/services/billing-service/src/model"
)

var (
	ErrInvoiceNotFound      = errors.New("invoice not found")
	ErrSubscriptionChargeNotFound = errors.New("subscription charge not found")
)

// BillingEventRepository defines the interface for billing event storage
type BillingEventRepository interface {
	Create(ctx context.Context, event *model.Invoice) error
	GetByID(ctx context.Context, id uint) (*model.Invoice, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Invoice, error)
	GetByEventType(ctx context.Context, eventType model.BillingEventType, limit, offset int) ([]*model.Invoice, error)
	GetByCustomer(ctx context.Context, customerID string, limit, offset int) ([]*model.Invoice, error)
	GetPending(ctx context.Context, limit int) ([]*model.Invoice, error)
}

// ReconciliationRepository defines the interface for billing reconciliation
type ReconciliationRepository interface {
	Create(ctx context.Context, record *model.SubscriptionCharge) error
	GetByID(ctx context.Context, id uint) (*model.SubscriptionCharge, error)
	GetByUUID(ctx context.Context, uuid string) (*model.SubscriptionCharge, error)
	GetMismatches(ctx context.Context, recordID uint) ([]*model.SubscriptionCharge, error)
	Update(ctx context.Context, record *model.SubscriptionCharge) error
}

// auditEventRepository implements BillingEventRepository for billing events
type auditEventRepository struct {
	db *gorm.DB
}

func NewAuditEventRepository(db *gorm.DB) BillingEventRepository {
	return &auditEventRepository{db: db}
}

func (r *auditEventRepository) Create(ctx context.Context, event *model.Invoice) error {
	return r.db.WithContext(ctx).Create(event).Error
}

func (r *auditEventRepository) GetByID(ctx context.Context, id uint) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).First(&invoice, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *auditEventRepository) GetByUUID(ctx context.Context, uuid string) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&invoice).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *auditEventRepository) GetByEventType(ctx context.Context, eventType model.BillingEventType, limit, offset int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("event_type = ?", eventType).Order("created_at desc").Limit(limit).Offset(offset).Find(&invoices).Error
	return invoices, err
}

func (r *auditEventRepository) GetByCustomer(ctx context.Context, customerID string, limit, offset int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("customer_id = ?", customerID).Order("created_at desc").Limit(limit).Offset(offset).Find(&invoices).Error
	return invoices, err
}

func (r *auditEventRepository) GetPending(ctx context.Context, limit int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("status = ?", "pending").Order("created_at asc").Limit(limit).Find(&invoices).Error
	return invoices, err
}

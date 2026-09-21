package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"newproject/services/billing-service/src/model"
)

var (
	ErrInvoiceNotFound        = errors.New("invoice not found")
	ErrInvoiceItemNotFound    = errors.New("invoice item not found")
	ErrPaymentNotFound        = errors.New("payment not found")
	ErrSubscriptionNotFound   = errors.New("subscription not found")
	ErrSubscriptionPlanNotFound = errors.New("subscription plan not found")
	ErrTaxRateNotFound        = errors.New("tax rate not found")
	ErrManualExpenseNotFound  = errors.New("manual expense not found")
)

// SubscriptionPlanRepository defines the interface for subscription plan storage
type SubscriptionPlanRepository interface {
	Create(ctx context.Context, plan *model.SubscriptionPlan) error
	GetByID(ctx context.Context, id uint) (*model.SubscriptionPlan, error)
	GetByCode(ctx context.Context, code string) (*model.SubscriptionPlan, error)
	List(ctx context.Context, activeOnly bool, limit, offset int) ([]*model.SubscriptionPlan, error)
	Update(ctx context.Context, plan *model.SubscriptionPlan) error
	Delete(ctx context.Context, id uint) error
}

// SubscriptionRepository defines the interface for subscription storage
type SubscriptionRepository interface {
	Create(ctx context.Context, sub *model.Subscription) error
	GetByID(ctx context.Context, id uint) (*model.Subscription, error)
	GetByUserID(ctx context.Context, userID uint) (*model.Subscription, error)
	Cancel(ctx context.Context, userID uint, reason string) error
	GetExpiring(ctx context.Context, days int) ([]*model.Subscription, error)
	Update(ctx context.Context, sub *model.Subscription) error
	List(ctx context.Context, status model.SubscriptionStatus, limit, offset int) ([]*model.Subscription, error)
}

// TaxRateRepository defines the interface for tax rate storage
type TaxRateRepository interface {
	Create(ctx context.Context, rate *model.TaxRate) error
	GetByID(ctx context.Context, id uint) (*model.TaxRate, error)
	GetByCode(ctx context.Context, code string) (*model.TaxRate, error)
	List(ctx context.Context, country string) ([]*model.TaxRate, error)
	Update(ctx context.Context, rate *model.TaxRate) error
	Delete(ctx context.Context, id uint) error
	GetByCountryAndRegion(ctx context.Context, country, region string) ([]*model.TaxRate, error)
}

// InvoiceRepository defines the interface for invoice storage
type InvoiceRepository interface {
	Create(ctx context.Context, invoice *model.Invoice) error
	GetByID(ctx context.Context, id uint) (*model.Invoice, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Invoice, error)
	GetByNumber(ctx context.Context, number string) (*model.Invoice, error)
	ListByCustomerID(ctx context.Context, customerID string, limit, offset int) ([]*model.Invoice, error)
	GetOverdue(ctx context.Context, days int) ([]*model.Invoice, error)
	Update(ctx context.Context, invoice *model.Invoice) error
	Delete(ctx context.Context, id uint) error
}

// InvoiceItemRepository defines the interface for invoice item storage
type InvoiceItemRepository interface {
	Create(ctx context.Context, item *model.InvoiceItem) error
	CreateBatch(ctx context.Context, items []*model.InvoiceItem) error
	GetByID(ctx context.Context, id uint) (*model.InvoiceItem, error)
	GetByUUID(ctx context.Context, uuid string) (*model.InvoiceItem, error)
	ListByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error)
	Update(ctx context.Context, item *model.InvoiceItem) error
	DeleteByInvoiceID(ctx context.Context, invoiceID uint) error
	Delete(ctx context.Context, id uint) error
}

// PaymentRepository defines the interface for payment storage
type PaymentRepository interface {
	Create(ctx context.Context, payment *model.Payment) error
	GetByID(ctx context.Context, id uint) (*model.Payment, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Payment, error)
	GetByPaymentNumber(ctx context.Context, number string) (*model.Payment, error)
	ListByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.Payment, error)
	ListByCustomerID(ctx context.Context, customerID string, limit, offset int) ([]*model.Payment, error)
	Update(ctx context.Context, payment *model.Payment) error
	Refund(ctx context.Context, id uint) (*model.Payment, error)
	Delete(ctx context.Context, id uint) error
}

// ManualExpenseRepository defines the interface for manual expense storage
type ManualExpenseRepository interface {
	Create(ctx context.Context, expense *model.ManualExpense) error
	GetByID(ctx context.Context, id uint) (*model.ManualExpense, error)
	GetByUUID(ctx context.Context, uuid string) (*model.ManualExpense, error)
	List(ctx context.Context, category string, limit, offset int) ([]*model.ManualExpense, error)
	Update(ctx context.Context, expense *model.ManualExpense) error
	Delete(ctx context.Context, id uint) error
}

// SubscriptionPlanRepository implementation
type subscriptionPlanRepository struct {
	db *gorm.DB
}

func NewSubscriptionPlanRepository(db *gorm.DB) SubscriptionPlanRepository {
	return &subscriptionPlanRepository{db: db}
}

func (r *subscriptionPlanRepository) Create(ctx context.Context, plan *model.SubscriptionPlan) error {
	plan.UUID = uuid.New()
	return r.db.WithContext(ctx).Create(plan).Error
}

func (r *subscriptionPlanRepository) GetByID(ctx context.Context, id uint) (*model.SubscriptionPlan, error) {
	var plan model.SubscriptionPlan
	err := r.db.WithContext(ctx).First(&plan, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionPlanNotFound
		}
		return nil, err
	}
	return &plan, nil
}

func (r *subscriptionPlanRepository) GetByCode(ctx context.Context, code string) (*model.SubscriptionPlan, error) {
	var plan model.SubscriptionPlan
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&plan).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionPlanNotFound
		}
		return nil, err
	}
	return &plan, nil
}

func (r *subscriptionPlanRepository) List(ctx context.Context, activeOnly bool, limit, offset int) ([]*model.SubscriptionPlan, error) {
	var plans []*model.SubscriptionPlan
	query := r.db.WithContext(ctx)
	if activeOnly {
		query = query.Where("is_active = ?", true)
	}
	err := query.Order("sort_order ASC, created_at DESC").Limit(limit).Offset(offset).Find(&plans).Error
	return plans, err
}

func (r *subscriptionPlanRepository) Update(ctx context.Context, plan *model.SubscriptionPlan) error {
	plan.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(plan).Error
}

func (r *subscriptionPlanRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.SubscriptionPlan{}, id).Error
}

// SubscriptionRepository implementation
type subscriptionRepository struct {
	db *gorm.DB
}

func NewSubscriptionRepository(db *gorm.DB) SubscriptionRepository {
	return &subscriptionRepository{db: db}
}

func (r *subscriptionRepository) Create(ctx context.Context, sub *model.Subscription) error {
	sub.UUID = uuid.New()
	sub.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(sub).Error
}

func (r *subscriptionRepository) GetByID(ctx context.Context, id uint) (*model.Subscription, error) {
	var sub model.Subscription
	err := r.db.WithContext(ctx).Preload("Plan").First(&sub, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) GetByUserID(ctx context.Context, userID uint) (*model.Subscription, error) {
	var sub model.Subscription
	err := r.db.WithContext(ctx).Preload("Plan").Where("user_id = ?", userID).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) Cancel(ctx context.Context, userID uint, reason string) error {
	var sub model.Subscription
	err := r.db.WithContext(ctx).Where("user_id = ? AND status = ?", userID, model.SubscriptionStatusActive).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSubscriptionNotFound
		}
		return err
	}
	sub.Status = model.SubscriptionStatusCancelled
	sub.CanceledAt = time.Now()
	sub.CancelReason = reason
	return r.db.WithContext(ctx).Save(&sub).Error
}

func (r *subscriptionRepository) GetExpiring(ctx context.Context, days int) ([]*model.Subscription, error) {
	var subs []*model.Subscription
	cutoff := time.Now().AddDate(0, 0, days)
	err := r.db.WithContext(ctx).Where("current_period_end <= ? AND status = ?", cutoff, model.SubscriptionStatusActive).
		Preload("Plan").
		Order("current_period_end ASC").
		Find(&subs).Error
	return subs, err
}

func (r *subscriptionRepository) Update(ctx context.Context, sub *model.Subscription) error {
	sub.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(sub).Error
}

func (r *subscriptionRepository) List(ctx context.Context, status model.SubscriptionStatus, limit, offset int) ([]*model.Subscription, error) {
	var subs []*model.Subscription
	query := r.db.WithContext(ctx).Where("status = ?", status)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}
	return subs, query.Preload("Plan").Order("created_at DESC").Find(&subs).Error
}

// TaxRateRepository implementation
type taxRateRepository struct {
	db *gorm.DB
}

func NewTaxRateRepository(db *gorm.DB) TaxRateRepository {
	return &taxRateRepository{db: db}
}

func (r *taxRateRepository) Create(ctx context.Context, rate *model.TaxRate) error {
	rate.UUID = uuid.New()
	return r.db.WithContext(ctx).Create(rate).Error
}

func (r *taxRateRepository) GetByID(ctx context.Context, id uint) (*model.TaxRate, error) {
	var rate model.TaxRate
	err := r.db.WithContext(ctx).First(&rate, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTaxRateNotFound
		}
		return nil, err
	}
	return &rate, nil
}

func (r *taxRateRepository) GetByCode(ctx context.Context, code string) (*model.TaxRate, error) {
	var rate model.TaxRate
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&rate).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTaxRateNotFound
		}
		return nil, err
	}
	return &rate, nil
}

func (r *taxRateRepository) List(ctx context.Context, country string) ([]*model.TaxRate, error) {
	var rates []*model.TaxRate
	query := r.db.WithContext(ctx).Where("is_active = ?", true)
	if country != "" {
		query = query.Where("country = ?", country)
	}
	err := query.Order("country, priority ASC, name ASC").Find(&rates).Error
	return rates, err
}

func (r *taxRateRepository) Update(ctx context.Context, rate *model.TaxRate) error {
	rate.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(rate).Error
}

func (r *taxRateRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.TaxRate{}, id).Error
}

func (r *taxRateRepository) GetByCountryAndRegion(ctx context.Context, country, region string) ([]*model.TaxRate, error) {
	var rates []*model.TaxRate
	err := r.db.WithContext(ctx).Where("country = ? AND region = ? AND is_active = ?", country, region, true).
		Order("priority ASC").Find(&rates).Error
	return rates, err
}

// InvoiceRepository implementation
type invoiceRepository struct {
	db *gorm.DB
}

func NewInvoiceRepository(db *gorm.DB) InvoiceRepository {
	return &invoiceRepository{db: db}
}

func (r *invoiceRepository) Create(ctx context.Context, invoice *model.Invoice) error {
	invoice.UUID = uuid.New()
	invoice.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(invoice).Error
}

func (r *invoiceRepository) GetByID(ctx context.Context, id uint) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).Preload("Items").Preload("Payments").Preload("Subscription").First(&invoice, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *invoiceRepository) GetByUUID(ctx context.Context, uuidStr string) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).Preload("Items").Preload("Payments").Preload("Subscription").Where("uuid = ?", uuidStr).First(&invoice).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *invoiceRepository) GetByNumber(ctx context.Context, number string) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).Preload("Items").Preload("Payments").Preload("Subscription").Where("invoice_number = ?", number).First(&invoice).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *invoiceRepository) ListByCustomerID(ctx context.Context, customerID string, limit, offset int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).
		Where("customer_id = ?", customerID).
		Preload("Items").Preload("Payments").
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&invoices).Error
	return invoices, err
}

func (r *invoiceRepository) GetOverdue(ctx context.Context, days int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	cutoff := time.Now().AddDate(0, 0, -days)
	err := r.db.WithContext(ctx).
		Where("status = ? AND due_date < ? AND status != ?", model.InvoiceStatusPaid, cutoff, model.InvoiceStatusPaid).
		Preload("Items").
		Order("due_date ASC").
		Find(&invoices).Error
	return invoices, err
}

func (r *invoiceRepository) Update(ctx context.Context, invoice *model.Invoice) error {
	invoice.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(invoice).Error
}

func (r *invoiceRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Invoice{}, id).Error
}

// InvoiceItemRepository implementation
type invoiceItemRepository struct {
	db *gorm.DB
}

func NewInvoiceItemRepository(db *gorm.DB) InvoiceItemRepository {
	return &invoiceItemRepository{db: db}
}

func (r *invoiceItemRepository) Create(ctx context.Context, item *model.InvoiceItem) error {
	item.UUID = uuid.New()
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *invoiceItemRepository) CreateBatch(ctx context.Context, items []*model.InvoiceItem) error {
	for i := range items {
		items[i].UUID = uuid.New()
	}
	return r.db.WithContext(ctx).Create(items).Error
}

func (r *invoiceItemRepository) GetByID(ctx context.Context, id uint) (*model.InvoiceItem, error) {
	var item model.InvoiceItem
	err := r.db.WithContext(ctx).Preload("TaxRate").First(&item, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceItemNotFound
		}
		return nil, err
	}
	return &item, nil
}

func (r *invoiceItemRepository) GetByUUID(ctx context.Context, uuidStr string) (*model.InvoiceItem, error) {
	var item model.InvoiceItem
	err := r.db.WithContext(ctx).Preload("TaxRate").Where("uuid = ?", uuidStr).First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceItemNotFound
		}
		return nil, err
	}
	return &item, nil
}

func (r *invoiceItemRepository) ListByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error) {
	var items []*model.InvoiceItem
	err := r.db.WithContext(ctx).Where("invoice_id = ?", invoiceID).
		Preload("TaxRate").
		Order("sort_order ASC, created_at ASC").
		Find(&items).Error
	return items, err
}

func (r *invoiceItemRepository) Update(ctx context.Context, item *model.InvoiceItem) error {
	return r.db.WithContext(ctx).Save(item).Error
}

func (r *invoiceItemRepository) DeleteByInvoiceID(ctx context.Context, invoiceID uint) error {
	return r.db.WithContext(ctx).Where("invoice_id = ?", invoiceID).Delete(&model.InvoiceItem{}).Error
}

func (r *invoiceItemRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.InvoiceItem{}, id).Error
}

// PaymentRepository implementation
type paymentRepository struct {
	db *gorm.DB
}

func NewPaymentRepository(db *gorm.DB) PaymentRepository {
	return &paymentRepository{db: db}
}

func (r *paymentRepository) Create(ctx context.Context, payment *model.Payment) error {
	payment.UUID = uuid.New()
	payment.CreatedAt = time.Now()
	payment.ProcessedAt = time.Now()
	return r.db.WithContext(ctx).Create(payment).Error
}

func (r *paymentRepository) GetByID(ctx context.Context, id uint) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).Preload("Invoice").First(&payment, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &payment, nil
}

func (r *paymentRepository) GetByUUID(ctx context.Context, uuidStr string) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).Preload("Invoice").Where("uuid = ?", uuidStr).First(&payment).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &payment, nil
}

func (r *paymentRepository) GetByPaymentNumber(ctx context.Context, number string) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).Preload("Invoice").Where("payment_number = ?", number).First(&payment).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &payment, nil
}

func (r *paymentRepository) ListByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.Payment, error) {
	var payments []*model.Payment
	err := r.db.WithContext(ctx).Where("invoice_id = ?", invoiceID).
		Order("created_at DESC").
		Find(&payments).Error
	return payments, err
}

func (r *paymentRepository) ListByCustomerID(ctx context.Context, customerID string, limit, offset int) ([]*model.Payment, error) {
	var payments []*model.Payment
	err := r.db.WithContext(ctx).Where("customer_id = ?", customerID).
		Preload("Invoice").
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&payments).Error
	return payments, err
}

func (r *paymentRepository) Update(ctx context.Context, payment *model.Payment) error {
	payment.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(payment).Error
}

func (r *paymentRepository) Refund(ctx context.Context, id uint) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).First(&payment, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	payment.RefundAmount = payment.AmountPaid
	payment.Status = "refunded"
	payment.UpdatedAt = time.Now()
	err = r.db.WithContext(ctx).Save(&payment).Error
	return &payment, err
}

func (r *paymentRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Payment{}, id).Error
}

// ManualExpenseRepository implementation
type manualExpenseRepository struct {
	db *gorm.DB
}

func NewManualExpenseRepository(db *gorm.DB) ManualExpenseRepository {
	return &manualExpenseRepository{db: db}
}

func (r *manualExpenseRepository) Create(ctx context.Context, expense *model.ManualExpense) error {
	expense.UUID = uuid.New()
	expense.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(expense).Error
}

func (r *manualExpenseRepository) GetByID(ctx context.Context, id uint) (*model.ManualExpense, error) {
	var expense model.ManualExpense
	err := r.db.WithContext(ctx).First(&expense, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrManualExpenseNotFound
		}
		return nil, err
	}
	return &expense, nil
}

func (r *manualExpenseRepository) GetByUUID(ctx context.Context, uuidStr string) (*model.ManualExpense, error) {
	var expense model.ManualExpense
	err := r.db.WithContext(ctx).Where("uuid = ?", uuidStr).First(&expense).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrManualExpenseNotFound
		}
		return nil, err
	}
	return &expense, nil
}

func (r *manualExpenseRepository) List(ctx context.Context, category string, limit, offset int) ([]*model.ManualExpense, error) {
	var expenses []*model.ManualExpense
	query := r.db.WithContext(ctx)
	if category != "" {
		query = query.Where("category = ?", category)
	}
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&expenses).Error
	return expenses, err
}

func (r *manualExpenseRepository) Update(ctx context.Context, expense *model.ManualExpense) error {
	expense.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(expense).Error
}

func (r *manualExpenseRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.ManualExpense{}, id).Error
}

// generateInvoiceNumber creates a unique invoice number for tracking
func generateInvoiceNumber() string {
	return "INV-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:8]
}

// generatePaymentNumber creates a unique payment number for tracking
func generatePaymentNumber() string {
	return "PAY-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:8]
}
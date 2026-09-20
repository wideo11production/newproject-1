package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
)

var (
	ErrPlanNotFound         = errors.New("subscription plan not found")
	ErrSubscriptionNotFound = errors.New("subscription not found")
	ErrInvoiceNotFound      = errors.New("invoice not found")
	ErrTaxRateNotFound      = errors.New("tax rate not found")
	ErrPaymentNotFound      = errors.New("payment not found")
	ErrItemNotFound         = errors.New("invoice item not found")
)

type SubscriptionPlanRepository interface {
	Create(ctx context.Context, plan *model.SubscriptionPlan) error
	GetByID(ctx context.Context, id uint) (*model.SubscriptionPlan, error)
	GetByCode(ctx context.Context, code string) (*model.SubscriptionPlan, error)
	GetByUUID(ctx context.Context, uuid string) (*model.SubscriptionPlan, error)
	List(ctx context.Context, limit, offset int) ([]*model.SubscriptionPlan, error)
	ListActive(ctx context.Context, limit, offset int) ([]*model.SubscriptionPlan, error)
	Update(ctx context.Context, plan *model.SubscriptionPlan) error
}

type SubscriptionRepository interface {
	Create(ctx context.Context, sub *model.Subscription) error
	GetByID(ctx context.Context, id uint) (*model.Subscription, error)
	GetByUserID(ctx context.Context, userID uint) (*model.Subscription, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Subscription, error)
	GetActive(ctx context.Context, userID uint) (*model.Subscription, error)
	GetExpiring(ctx context.Context, before time.Time) ([]*model.Subscription, error)
	Update(ctx context.Context, sub *model.Subscription) error
}

type TaxRateRepository interface {
	Create(ctx context.Context, rate *model.TaxRate) error
	GetByID(ctx context.Context, id uint) (*model.TaxRate, error)
	GetByCode(ctx context.Context, code string) (*model.TaxRate, error)
	List(ctx context.Context) ([]*model.TaxRate, error)
	ListByCountry(ctx context.Context, country string) ([]*model.TaxRate, error)
	Update(ctx context.Context, rate *model.TaxRate) error
}

type InvoiceRepository interface {
	Create(ctx context.Context, invoice *model.Invoice) error
	GetByID(ctx context.Context, id uint) (*model.Invoice, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Invoice, error)
	GetByNumber(ctx context.Context, number string) (*model.Invoice, error)
	GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.Invoice, error)
	GetByStatus(ctx context.Context, status model.InvoiceStatus, limit int) ([]*model.Invoice, error)
	GetOverdue(ctx context.Context, before time.Time) ([]*model.Invoice, error)
	Update(ctx context.Context, invoice *model.Invoice) error
}

type InvoiceItemRepository interface {
	Create(ctx context.Context, item *model.InvoiceItem) error
	GetByID(ctx context.Context, id uint) (*model.InvoiceItem, error)
	GetByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error)
}

type PaymentRepository interface {
	Create(ctx context.Context, payment *model.Payment) error
	GetByID(ctx context.Context, id uint) (*model.Payment, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Payment, error)
	GetByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.Payment, error)
	Update(ctx context.Context, payment *model.Payment) error
}

type subscriptionPlanRepository struct {
	db *gorm.DB
}

func NewSubscriptionPlanRepository(db *gorm.DB) SubscriptionPlanRepository {
	return &subscriptionPlanRepository{db: db}
}

func (r *subscriptionPlanRepository) Create(ctx context.Context, plan *model.SubscriptionPlan) error {
	return r.db.WithContext(ctx).Create(plan).Error
}

func (r *subscriptionPlanRepository) GetByID(ctx context.Context, id uint) (*model.SubscriptionPlan, error) {
	var plan model.SubscriptionPlan
	err := r.db.WithContext(ctx).First(&plan, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlanNotFound
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
			return nil, ErrPlanNotFound
		}
		return nil, err
	}
	return &plan, nil
}

func (r *subscriptionPlanRepository) GetByUUID(ctx context.Context, uuid string) (*model.SubscriptionPlan, error) {
	var plan model.SubscriptionPlan
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&plan).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPlanNotFound
		}
		return nil, err
	}
	return &plan, nil
}

func (r *subscriptionPlanRepository) List(ctx context.Context, limit, offset int) ([]*model.SubscriptionPlan, error) {
	var plans []*model.SubscriptionPlan
	err := r.db.WithContext(ctx).Order("sort_order asc, price asc").Limit(limit).Offset(offset).Find(&plans).Error
	return plans, err
}

func (r *subscriptionPlanRepository) ListActive(ctx context.Context, limit, offset int) ([]*model.SubscriptionPlan, error) {
	var plans []*model.SubscriptionPlan
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Order("sort_order asc, price asc").Limit(limit).Offset(offset).Find(&plans).Error
	return plans, err
}

func (r *subscriptionPlanRepository) Update(ctx context.Context, plan *model.SubscriptionPlan) error {
	return r.db.WithContext(ctx).Save(plan).Error
}

type subscriptionRepository struct {
	db *gorm.DB
}

func NewSubscriptionRepository(db *gorm.DB) SubscriptionRepository {
	return &subscriptionRepository{db: db}
}

func (r *subscriptionRepository) Create(ctx context.Context, sub *model.Subscription) error {
	return r.db.WithContext(ctx).Create(sub).Error
}

func (r *subscriptionRepository) GetByID(ctx context.Context, id uint) (*model.Subscription, error) {
	var sub model.Subscription
	err := r.db.WithContext(ctx).First(&sub, id).Error
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
	err := r.db.WithContext(ctx).Where("user_id = ? AND status IN ?", userID, []string{"active", "trial"}).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) GetByUUID(ctx context.Context, uuid string) (*model.Subscription, error) {
	var sub model.Subscription
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) GetActive(ctx context.Context, userID uint) (*model.Subscription, error) {
	var sub model.Subscription
	err := r.db.WithContext(ctx).Where("user_id = ? AND status IN ?", userID, []string{"active", "trial"}).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) GetExpiring(ctx context.Context, before time.Time) ([]*model.Subscription, error) {
	var subs []*model.Subscription
	err := r.db.WithContext(ctx).Where("end_date <= ? AND status IN ?", before, []string{"active", "trial"}).Find(&subs).Error
	return subs, err
}

func (r *subscriptionRepository) Update(ctx context.Context, sub *model.Subscription) error {
	return r.db.WithContext(ctx).Save(sub).Error
}

type taxRateRepository struct {
	db *gorm.DB
}

func NewTaxRateRepository(db *gorm.DB) TaxRateRepository {
	return &taxRateRepository{db: db}
}

func (r *taxRateRepository) Create(ctx context.Context, rate *model.TaxRate) error {
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

func (r *taxRateRepository) List(ctx context.Context) ([]*model.TaxRate, error) {
	var rates []*model.TaxRate
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Find(&rates).Error
	return rates, err
}

func (r *taxRateRepository) ListByCountry(ctx context.Context, country string) ([]*model.TaxRate, error) {
	var rates []*model.TaxRate
	err := r.db.WithContext(ctx).Where("is_active = ? AND country = ?", true, country).Find(&rates).Error
	return rates, err
}

func (r *taxRateRepository) Update(ctx context.Context, rate *model.TaxRate) error {
	return r.db.WithContext(ctx).Save(rate).Error
}

type invoiceRepository struct {
	db *gorm.DB
}

func NewInvoiceRepository(db *gorm.DB) InvoiceRepository {
	return &invoiceRepository{db: db}
}

func (r *invoiceRepository) Create(ctx context.Context, invoice *model.Invoice) error {
	return r.db.WithContext(ctx).Create(invoice).Error
}

func (r *invoiceRepository) GetByID(ctx context.Context, id uint) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).First(&invoice, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *invoiceRepository) GetByUUID(ctx context.Context, uuid string) (*model.Invoice, error) {
	var invoice model.Invoice
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&invoice).Error
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
	err := r.db.WithContext(ctx).Where("invoice_number = ?", number).First(&invoice).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

func (r *invoiceRepository) GetByUserID(ctx context.Context, userID uint, limit, offset int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at desc").Limit(limit).Offset(offset).Find(&invoices).Error
	return invoices, err
}

func (r *invoiceRepository) GetByStatus(ctx context.Context, status model.InvoiceStatus, limit int) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("status = ?", status).Order("created_at asc").Limit(limit).Find(&invoices).Error
	return invoices, err
}

func (r *invoiceRepository) GetOverdue(ctx context.Context, before time.Time) ([]*model.Invoice, error) {
	var invoices []*model.Invoice
	err := r.db.WithContext(ctx).Where("due_date <= ? AND status IN ?", before, []string{"draft", "issued"}).Find(&invoices).Error
	return invoices, err
}

func (r *invoiceRepository) Update(ctx context.Context, invoice *model.Invoice) error {
	return r.db.WithContext(ctx).Save(invoice).Error
}

type invoiceItemRepository struct {
	db *gorm.DB
}

func NewInvoiceItemRepository(db *gorm.DB) InvoiceItemRepository {
	return &invoiceItemRepository{db: db}
}

func (r *invoiceItemRepository) Create(ctx context.Context, item *model.InvoiceItem) error {
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *invoiceItemRepository) GetByID(ctx context.Context, id uint) (*model.InvoiceItem, error) {
	var item model.InvoiceItem
	err := r.db.WithContext(ctx).First(&item, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrItemNotFound
		}
		return nil, err
	}
	return &item, nil
}

func (r *invoiceItemRepository) GetByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error) {
	var items []*model.InvoiceItem
	err := r.db.WithContext(ctx).Where("invoice_id = ?", invoiceID).Find(&items).Error
	return items, err
}

type paymentRepository struct {
	db *gorm.DB
}

func NewPaymentRepository(db *gorm.DB) PaymentRepository {
	return &paymentRepository{db: db}
}

func (r *paymentRepository) Create(ctx context.Context, payment *model.Payment) error {
	return r.db.WithContext(ctx).Create(payment).Error
}

func (r *paymentRepository) GetByID(ctx context.Context, id uint) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).First(&payment, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &payment, nil
}

func (r *paymentRepository) GetByUUID(ctx context.Context, uuid string) (*model.Payment, error) {
	var payment model.Payment
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&payment).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &payment, nil
}

func (r *paymentRepository) GetByInvoiceID(ctx context.Context, invoiceID uint) ([]*model.Payment, error) {
	var payments []*model.Payment
	err := r.db.WithContext(ctx).Where("invoice_id = ?", invoiceID).Find(&payments).Error
	return payments, err
}

func (r *paymentRepository) Update(ctx context.Context, payment *model.Payment) error {
	return r.db.WithContext(ctx).Save(payment).Error
}

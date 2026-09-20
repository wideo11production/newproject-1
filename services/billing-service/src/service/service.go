package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

type BillingService struct {
	planRepo       repository.SubscriptionPlanRepository
	subRepo        repository.SubscriptionRepository
	taxRepo        repository.TaxRateRepository
	invoiceRepo    repository.InvoiceRepository
	itemRepo       repository.InvoiceItemRepository
	paymentRepo    repository.PaymentRepository
}

func NewBillingService(
	planRepo repository.SubscriptionPlanRepository,
	subRepo repository.SubscriptionRepository,
	taxRepo repository.TaxRateRepository,
	invoiceRepo repository.InvoiceRepository,
	itemRepo repository.InvoiceItemRepository,
	paymentRepo repository.PaymentRepository,
) *BillingService {
	return &BillingService{
		planRepo:      planRepo,
		subRepo:       subRepo,
		taxRepo:       taxRepo,
		invoiceRepo:   invoiceRepo,
		itemRepo:      itemRepo,
		paymentRepo:   paymentRepo,
	}
}

func (s *BillingService) CreatePlan(ctx context.Context, name, code, description, price, currency string, cycle model.BillingCycle, interval, trialDays int, features string) (*model.SubscriptionPlan, error) {
	_, err := s.planRepo.GetByCode(ctx, code)
	if err == nil {
		return nil, fmt.Errorf("plan with code %s already exists", code)
	}
	if err != repository.ErrPlanNotFound {
		return nil, err
	}

	priceDec, err := decimal.NewFromString(price)
	if err != nil {
		return nil, errors.New("invalid price")
	}

	plan := &model.SubscriptionPlan{
		UUID:        uuid.New(),
		Name:        name,
		Code:        code,
		Description: description,
		Price:       priceDec,
		Currency:    currency,
		Cycle:       cycle,
		Interval:    interval,
		TrialDays:   trialDays,
		SortOrder:   0,
		IsActive:    true,
		Features:    features,
	}

	if err := s.planRepo.Create(ctx, plan); err != nil {
		return nil, err
	}
	return plan, nil
}

func (s *BillingService) GetPlan(ctx context.Context, id uint) (*model.SubscriptionPlan, error) {
	return s.planRepo.GetByID(ctx, id)
}

func (s *BillingService) GetPlanByCode(ctx context.Context, code string) (*model.SubscriptionPlan, error) {
	return s.planRepo.GetByCode(ctx, code)
}

func (s *BillingService) ListPlans(ctx context.Context, activeOnly bool, limit, offset int) ([]*model.SubscriptionPlan, error) {
	if activeOnly {
		return s.planRepo.ListActive(ctx, limit, offset)
	}
	return s.planRepo.List(ctx, limit, offset)
}

func (s *BillingService) UpdatePlan(ctx context.Context, plan *model.SubscriptionPlan) error {
	return s.planRepo.Update(ctx, plan)
}

func (s *BillingService) Subscribe(ctx context.Context, userID uint, planCode string, autoRenew bool) (*model.Subscription, error) {
	plan, err := s.planRepo.GetByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if !plan.IsActive {
		return nil, errors.New("plan is not active")
	}

	_, err = s.subRepo.GetActive(ctx, userID)
	if err == nil {
		return nil, errors.New("user already has an active subscription")
	}
	if err != repository.ErrSubscriptionNotFound {
		return nil, err
	}

	now := time.Now().UTC()

	status := model.SubStatusTrial
	if plan.TrialDays > 0 {
		endDate := now.AddDate(0, 0, plan.TrialDays)
		status = model.SubStatusTrial
		_ = endDate
	} else {
		status = model.SubStatusActive
	}

	endDate := s.calculateEndDate(plan, now)

	sub := &model.Subscription{
		UUID:       uuid.New(),
		UserID:     userID,
		PlanID:     plan.ID,
		Status:     status,
		StartDate:  now,
		EndDate:    endDate,
		AutoRenew:  autoRenew,
	}

	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}

	return sub, nil
}

func (s *BillingService) calculateEndDate(plan *model.SubscriptionPlan, start time.Time) time.Time {
	switch plan.Cycle {
	case model.CycleMonthly:
		return start.AddDate(0, plan.Interval, 0)
	case model.CycleYearly:
		return start.AddDate(plan.Interval, 0, 0)
	case model.CycleQuarterly:
		return start.AddDate(0, plan.Interval*3, 0)
	default:
		return start.AddDate(0, 1, 0)
	}
}

func (s *BillingService) GetSubscription(ctx context.Context, id uint) (*model.Subscription, error) {
	return s.subRepo.GetByID(ctx, id)
}

func (s *BillingService) GetSubscriptionByUser(ctx context.Context, userID uint) (*model.Subscription, error) {
	return s.subRepo.GetByUserID(ctx, userID)
}

func (s *BillingService) CancelSubscription(ctx context.Context, userID uint, reason string) (*model.Subscription, error) {
	sub, err := s.subRepo.GetActive(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	sub.Status = model.SubStatusCancelled
	sub.CanceledAt = &now
	sub.CancelReason = reason

	if err := s.subRepo.Update(ctx, sub); err != nil {
		return nil, err
	}

	return sub, nil
}

func (s *BillingService) GetExpiringSubscriptions(ctx context.Context, beforeDays int) ([]*model.Subscription, error) {
	before := time.Now().AddDate(0, 0, beforeDays)
	return s.subRepo.GetExpiring(ctx, before)
}

func (s *BillingService) CreateTaxRate(ctx context.Context, name, code, rate, rateType, country, region string, isCompound bool) (*model.TaxRate, error) {
	_, err := s.taxRepo.GetByCode(ctx, code)
	if err == nil {
		return nil, fmt.Errorf("tax rate with code %s already exists", code)
	}
	if err != repository.ErrTaxRateNotFound {
		return nil, err
	}

	rateDec, err := decimal.NewFromString(rate)
	if err != nil {
		return nil, errors.New("invalid rate")
	}

	tax := &model.TaxRate{
		UUID:      uuid.New(),
		Name:      name,
		Code:      code,
		Rate:      rateDec,
		Type:      rateType,
		Country:   country,
		Region:    region,
		IsCompound: isCompound,
		IsActive:  true,
	}

	if err := s.taxRepo.Create(ctx, tax); err != nil {
		return nil, err
	}
	return tax, nil
}

func (s *BillingService) GetTaxRate(ctx context.Context, code string) (*model.TaxRate, error) {
	return s.taxRepo.GetByCode(ctx, code)
}

func (s *BillingService) ListTaxRates(ctx context.Context, country string) ([]*model.TaxRate, error) {
	if country != "" {
		return s.taxRepo.ListByCountry(ctx, country)
	}
	return s.taxRepo.List(ctx)
}

func (s *BillingService) CalculateTax(ctx context.Context, amount decimal.Decimal, country string) (decimal.Decimal, *model.TaxRate, error) {
	rates, err := s.taxRepo.ListByCountry(ctx, country)
	if err != nil {
		return decimal.Zero, nil, err
	}
	if len(rates) == 0 {
		rates, err = s.taxRepo.List(ctx)
		if err != nil {
			return decimal.Zero, nil, err
		}
	}
	if len(rates) == 0 {
		return decimal.Zero, nil, nil
	}

	var totalTax decimal.Decimal
	var appliedRate *model.TaxRate
	for _, rate := range rates {
		var tax decimal.Decimal
		if rate.Type == "percentage" {
			tax = amount.Mul(rate.Rate).Div(decimal.NewFromInt(100))
		} else {
			tax = rate.Rate
		}
		totalTax = totalTax.Add(tax)
		appliedRate = rate
	}

	return totalTax, appliedRate, nil
}

func (s *BillingService) CreateInvoice(ctx context.Context, userID uint, subscriptionID *uint, items []InvoiceItemRequest, country string, dueDate time.Time, notes string) (*model.Invoice, error) {
	var amount, taxAmount, discount, totalAmount decimal.Decimal

	invoice := &model.Invoice{
		UUID:          uuid.New(),
		UserID:        userID,
		InvoiceNumber: fmt.Sprintf("INV-%d-%d", userID, time.Now().UnixNano()),
		Status:        model.InvoiceStatusDraft,
		IssueDate:     time.Now().UTC(),
		DueDate:       dueDate,
		Currency:      "INR",
		Notes:         notes,
	}

	if subscriptionID != nil {
		invoice.SubscriptionID = subscriptionID
	}

	if err := s.invoiceRepo.Create(ctx, invoice); err != nil {
		return nil, err
	}

	for _, item := range items {
		price, err := decimal.NewFromString(item.UnitPrice)
		if err != nil {
			return nil, errors.New("invalid unit_price")
		}
		qty, err := decimal.NewFromString(item.Quantity)
		if err != nil {
			qty = decimal.NewFromInt(1)
		}
		itemAmount := price.Mul(qty)

		itemTax := decimal.Zero
		if item.TaxCode != "" {
			taxRate, err := s.taxRepo.GetByCode(ctx, item.TaxCode)
			if err == nil {
				if taxRate.Type == "percentage" {
					itemTax = itemAmount.Mul(taxRate.Rate).Div(decimal.NewFromInt(100))
				} else {
					itemTax = taxRate.Rate
				}
			}
		}

		itemDiscount := decimal.Zero
		if item.Discount != "" {
			itemDiscount, _ = decimal.NewFromString(item.Discount)
		}

		itemTotal := itemAmount.Add(itemTax).Sub(itemDiscount)

		invoiceItem := &model.InvoiceItem{
			UUID:        uuid.New(),
			InvoiceID:   invoice.ID,
			Description: item.Description,
			Quantity:    qty,
			UnitPrice:   price,
			Amount:      itemAmount,
			TaxAmount:   itemTax,
			Discount:    itemDiscount,
			TotalAmount: itemTotal,
		}

		if err := s.itemRepo.Create(ctx, invoiceItem); err != nil {
			return nil, err
		}

		amount = amount.Add(itemAmount)
		taxAmount = taxAmount.Add(itemTax)
		discount = discount.Add(itemDiscount)
		totalAmount = totalAmount.Add(itemTotal)
	}

	invoice.Amount = amount
	invoice.TaxAmount = taxAmount
	invoice.Discount = discount
	invoice.TotalAmount = totalAmount

	if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
		return nil, err
	}

	return invoice, nil
}

type InvoiceItemRequest struct {
	Description string `json:"description" binding:"required"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unit_price" binding:"required"`
	TaxCode     string `json:"tax_code"`
	Discount    string `json:"discount"`
}

func (s *BillingService) IssueInvoice(ctx context.Context, invoiceID uint) (*model.Invoice, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, invoiceID)
	if err != nil {
		return nil, err
	}

	if invoice.Status != model.InvoiceStatusDraft {
		return nil, errors.New("invoice is not in draft status")
	}

	invoice.Status = model.InvoiceStatusIssued
	if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
		return nil, err
	}

	return invoice, nil
}

func (s *BillingService) GetInvoice(ctx context.Context, id uint) (*model.Invoice, error) {
	return s.invoiceRepo.GetByID(ctx, id)
}

func (s *BillingService) GetInvoiceByUUID(ctx context.Context, uuid string) (*model.Invoice, error) {
	return s.invoiceRepo.GetByUUID(ctx, uuid)
}

func (s *BillingService) GetInvoiceByNumber(ctx context.Context, number string) (*model.Invoice, error) {
	return s.invoiceRepo.GetByNumber(ctx, number)
}

func (s *BillingService) ListInvoices(ctx context.Context, userID uint, limit, offset int) ([]*model.Invoice, error) {
	return s.invoiceRepo.GetByUserID(ctx, userID, limit, offset)
}

func (s *BillingService) GetOverdueInvoices(ctx context.Context, beforeDays int) ([]*model.Invoice, error) {
	before := time.Now().AddDate(0, 0, -beforeDays)
	return s.invoiceRepo.GetOverdue(ctx, before)
}

func (s *BillingService) GetInvoiceItems(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error) {
	return s.itemRepo.GetByInvoiceID(ctx, invoiceID)
}

func (s *BillingService) RecordPayment(ctx context.Context, invoiceID uint, userID uint, amount string, method, provider string) (*model.Payment, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, invoiceID)
	if err != nil {
		return nil, err
	}

	paymentAmount, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, errors.New("invalid amount")
	}

	payment := &model.Payment{
		UUID:       uuid.New(),
		InvoiceID:  invoiceID,
		UserID:     userID,
		Amount:     paymentAmount,
		Currency:   invoice.Currency,
		Status:     model.PaymentStatusSuccess,
		Method:     method,
		Provider:   provider,
		ProcessedAt: &time.Time{},
	}
	now := time.Now()
	payment.ProcessedAt = &now

	if err := s.paymentRepo.Create(ctx, payment); err != nil {
		return nil, err
	}

	if paymentAmount.GreaterThanOrEqual(invoice.TotalAmount) {
		invoice.PaymentStatus = "paid"
		invoice.PaidAt = &now
		if invoice.Status == model.InvoiceStatusIssued {
			invoice.Status = model.InvoiceStatusPaid
		}
		if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
			return payment, nil
		}
	}

	return payment, nil
}

func (s *BillingService) GetPayment(ctx context.Context, id uint) (*model.Payment, error) {
	return s.paymentRepo.GetByID(ctx, id)
}

func (s *BillingService) GetPaymentByUUID(ctx context.Context, uuid string) (*model.Payment, error) {
	return s.paymentRepo.GetByUUID(ctx, uuid)
}

func (s *BillingService) GetPaymentsByInvoice(ctx context.Context, invoiceID uint) ([]*model.Payment, error) {
	return s.paymentRepo.GetByInvoiceID(ctx, invoiceID)
}

func (s *BillingService) RefundPayment(ctx context.Context, paymentID uint) (*model.Payment, error) {
	payment, err := s.paymentRepo.GetByID(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != model.PaymentStatusSuccess {
		return nil, errors.New("payment is not in success status")
	}

	payment.Status = model.PaymentStatusRefunded
	if err := s.paymentRepo.Update(ctx, payment); err != nil {
		return nil, err
	}

	return payment, nil
}

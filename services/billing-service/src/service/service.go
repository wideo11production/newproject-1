package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// BillingService orchestrates billing operations including invoice management,
// payment processing, and reconciliation.
type BillingService struct {
	planRepo     repository.SubscriptionPlanRepository
	subRepo      repository.SubscriptionRepository
	taxRepo      repository.TaxRateRepository
	invoiceRepo  repository.InvoiceRepository
	itemRepo     repository.InvoiceItemRepository
	paymentRepo  repository.PaymentRepository
	expenseRepo  repository.ManualExpenseRepository
}

// NewBillingService creates a new BillingService with all required repositories.
func NewBillingService(
	planRepo repository.SubscriptionPlanRepository,
	subRepo repository.SubscriptionRepository,
	taxRepo repository.TaxRateRepository,
	invoiceRepo repository.InvoiceRepository,
	itemRepo repository.InvoiceItemRepository,
	paymentRepo repository.PaymentRepository,
	expenseRepo repository.ManualExpenseRepository,
) *BillingService {
	return &BillingService{
		planRepo:    planRepo,
		subRepo:     subRepo,
		taxRepo:     taxRepo,
		invoiceRepo: invoiceRepo,
		itemRepo:    itemRepo,
		paymentRepo: paymentRepo,
		expenseRepo: expenseRepo,
	}
}

// InvoiceItemRequest represents a request to create an invoice item
type InvoiceItemRequest struct {
	Description string `json:"description" binding:"required"`
	Quantity    int    `json:"quantity" binding:"required,min:1"`
	UnitPrice   string `json:"unit_price" binding:"required"`
	TaxRateCode string `json:"tax_rate_code"`
}

// CreatePlan creates a new subscription plan.
func (s *BillingService) CreatePlan(ctx context.Context, name, code, description, price, currency string, cycle model.BillingCycle, interval, trialDays int, features string) (*model.SubscriptionPlan, error) {
	priceDec, err := decimal.NewFromString(price)
	if err != nil {
		return nil, fmt.Errorf("invalid price format: %w", err)
	}
	
	plan := &model.SubscriptionPlan{
		Name:        name,
		Code:        code,
		Description: description,
		Price:       priceDec,
		Currency:    currency,
		Cycle:       cycle,
		Interval:    interval,
		TrialDays:   trialDays,
		Features:    features,
		IsActive:    true,
	}
	
	if err := s.planRepo.Create(ctx, plan); err != nil {
		return nil, err
	}
	return plan, nil
}

// GetPlan retrieves a subscription plan by ID.
func (s *BillingService) GetPlan(ctx context.Context, id uint) (*model.SubscriptionPlan, error) {
	return s.planRepo.GetByID(ctx, id)
}

// GetPlanByCode retrieves a subscription plan by its code.
func (s *BillingService) GetPlanByCode(ctx context.Context, code string) (*model.SubscriptionPlan, error) {
	return s.planRepo.GetByCode(ctx, code)
}

// ListPlans lists all subscription plans with optional filtering.
func (s *BillingService) ListPlans(ctx context.Context, activeOnly bool, limit, offset int) ([]*model.SubscriptionPlan, error) {
	return s.planRepo.List(ctx, activeOnly, limit, offset)
}

// UpdatePlan updates an existing subscription plan.
func (s *BillingService) UpdatePlan(ctx context.Context, plan *model.SubscriptionPlan) error {
	return s.planRepo.Update(ctx, plan)
}

// Subscribe creates a new subscription for a user.
func (s *BillingService) Subscribe(ctx context.Context, userID uint, planCode string, autoRenew bool) (*model.Subscription, error) {
	plan, err := s.planRepo.GetByCode(ctx, planCode)
	if err != nil {
		return nil, err
	}
	
	_, _ = s.subRepo.GetByUserID(ctx, userID)
	
	now := time.Now()
	var periodStart, periodEnd time.Time
	
	switch plan.Cycle {
	case model.BillingCycleMonthly:
		periodStart = now
		periodEnd = now.AddDate(0, 1, 0)
	case model.BillingCycleQuarterly:
		periodStart = now
		periodEnd = now.AddDate(0, 3, 0)
	case model.BillingCycleAnnually:
		periodStart = now
		periodEnd = now.AddDate(1, 0, 0)
	default:
		periodStart = now
		periodEnd = now.AddDate(1, 0, 0)
	}
	
	sub := &model.Subscription{
		UserID:            userID,
		PlanID:            plan.ID,
		Status:            model.SubscriptionStatusActive,
		StartDate:         now,
		EndDate:           now.AddDate(0, 1, 0),
		CurrentPeriodStart: periodStart,
		CurrentPeriodEnd:   periodEnd,
		AutoRenew:          autoRenew,
		PaymentProvider:    model.PaymentProviderStripe,
		PaymentMethod:      model.PaymentMethodCreditCard,
	}
	
	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}
	
	return sub, nil
}

// GetSubscription retrieves a subscription by ID.
func (s *BillingService) GetSubscription(ctx context.Context, id uint) (*model.Subscription, error) {
	return s.subRepo.GetByID(ctx, id)
}

// GetSubscriptionByUser retrieves a subscription by user ID.
func (s *BillingService) GetSubscriptionByUser(ctx context.Context, userID uint) (*model.Subscription, error) {
	return s.subRepo.GetByUserID(ctx, userID)
}

// CancelSubscription cancels a user's subscription.
func (s *BillingService) CancelSubscription(ctx context.Context, userID uint, reason string) (*model.Subscription, error) {
	err := s.subRepo.Cancel(ctx, userID, reason)
	if err != nil {
		return nil, err
	}
	return s.subRepo.GetByUserID(ctx, userID)
}

// GetExpiringSubscriptions retrieves subscriptions expiring within a given number of days.
func (s *BillingService) GetExpiringSubscriptions(ctx context.Context, days int) ([]*model.Subscription, error) {
	return s.subRepo.GetExpiring(ctx, days)
}

// CreateTaxRate creates a new tax rate configuration.
func (s *BillingService) CreateTaxRate(ctx context.Context, name, code, rate, taxType, country, region string, isCompound bool) (*model.TaxRate, error) {
	rateDec, err := decimal.NewFromString(rate)
	if err != nil {
		return nil, fmt.Errorf("invalid rate format: %w", err)
	}
	
	taxRate := &model.TaxRate{
		Name:       name,
		Code:       code,
		Rate:       rateDec,
		Type:       model.TaxType(taxType),
		Country:    country,
		Region:     region,
		IsCompound: isCompound,
		IsActive:   true,
	}
	
	if err := s.taxRepo.Create(ctx, taxRate); err != nil {
		return nil, err
	}
	return taxRate, nil
}

// GetTaxRate retrieves a tax rate by code.
func (s *BillingService) GetTaxRate(ctx context.Context, code string) (*model.TaxRate, error) {
	return s.taxRepo.GetByCode(ctx, code)
}

// ListTaxRates lists all tax rates, optionally filtered by country.
func (s *BillingService) ListTaxRates(ctx context.Context, country string) ([]*model.TaxRate, error) {
	return s.taxRepo.List(ctx, country)
}

// CreateInvoice creates a new invoice from scratch with multiple items.
func (s *BillingService) CreateInvoice(ctx context.Context, userID uint, subscriptionID *uint, items []InvoiceItemRequest, currency string, dueDate time.Time, notes string) (*model.Invoice, error) {
	invoiceNumber := generateInvoiceNumber()
	
	invoice := &model.Invoice{
		UUID:           uuid.New(),
		InvoiceNumber:  invoiceNumber,
		InvoiceType:    "standard",
		CustomerID:     fmt.Sprintf("user-%d", userID),
		SubscriptionID: subscriptionID,
		Status:         model.InvoiceStatusPending,
		TotalAmount:    decimal.NewFromInt(0),
		TaxAmount:      decimal.NewFromInt(0),
		Currency:       currency,
		DueDate:        dueDate,
		IssueDate:      time.Now(),
		Notes:          notes,
		CreatedAt:      time.Now(),
	}
	
	if err := s.invoiceRepo.Create(ctx, invoice); err != nil {
		return nil, err
	}
	
	for i, itemReq := range items {
		unitPrice, err := decimal.NewFromString(itemReq.UnitPrice)
		if err != nil {
			return nil, fmt.Errorf("invalid unit price for item %d: %w", i+1, err)
		}
		
		var taxRate *model.TaxRate
		if itemReq.TaxRateCode != "" {
			taxRate, _ = s.taxRepo.GetByCode(ctx, itemReq.TaxRateCode)
		}
		
		itemTotal := unitPrice.Mul(decimal.NewFromInt(int64(itemReq.Quantity)))
		var itemTax decimal.Decimal
		
		if taxRate != nil {
			itemTax = itemTotal.Mul(taxRate.Rate).Div(decimal.NewFromInt(100))
		}
		
		total := itemTotal.Add(itemTax)
		
		invoiceItem := &model.InvoiceItem{
			UUID:        uuid.New(),
			InvoiceID:   invoice.ID,
			Description: itemReq.Description,
			Quantity:    itemReq.Quantity,
			UnitPrice:   unitPrice,
			TaxRateID:   nil,
			TaxRate:     taxRate,
			TaxAmount:   itemTax,
			Total:       total,
			SortOrder:   i,
			CreatedAt:   time.Now(),
			UpdatedAt:  time.Now(),
		}
		
		if taxRate != nil && taxRate.ID != 0 {
			invoiceItem.TaxRateID = &taxRate.ID
		}
		
		if err := s.itemRepo.Create(ctx, invoiceItem); err != nil {
			return nil, fmt.Errorf("failed to create invoice item %d: %w", i+1, err)
		}
	}
	
	createdItems, err := s.itemRepo.ListByInvoiceID(ctx, invoice.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to load invoice items: %w", err)
	}
	
	var totalAmount, taxAmount decimal.Decimal
	for _, item := range createdItems {
		totalAmount = totalAmount.Add(item.Total)
		taxAmount = taxAmount.Add(item.TaxAmount)
	}
	
	invoice.TotalAmount = totalAmount
	invoice.TaxAmount = taxAmount
	invoice.UpdatedAt = time.Now()
	
	if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
		return nil, err
	}
	
	return invoice, nil
}

// GetInvoice retrieves an invoice by ID.
func (s *BillingService) GetInvoice(ctx context.Context, id uint) (*model.Invoice, error) {
	return s.invoiceRepo.GetByID(ctx, id)
}

// GetInvoiceByUUID retrieves an invoice by UUID.
func (s *BillingService) GetInvoiceByUUID(ctx context.Context, uuidStr string) (*model.Invoice, error) {
	return s.invoiceRepo.GetByUUID(ctx, uuidStr)
}

// GetInvoiceByNumber retrieves an invoice by its number.
func (s *BillingService) GetInvoiceByNumber(ctx context.Context, number string) (*model.Invoice, error) {
	return s.invoiceRepo.GetByNumber(ctx, number)
}

// ListInvoices lists all invoices for a user.
func (s *BillingService) ListInvoices(ctx context.Context, userID uint, limit, offset int) ([]*model.Invoice, error) {
	customerID := fmt.Sprintf("user-%d", userID)
	return s.invoiceRepo.ListByCustomerID(ctx, customerID, limit, offset)
}

// GetOverdueInvoices retrieves invoices that are past due.
func (s *BillingService) GetOverdueInvoices(ctx context.Context, days int) ([]*model.Invoice, error) {
	return s.invoiceRepo.GetOverdue(ctx, days)
}

// GetInvoiceItems retrieves all items for an invoice.
func (s *BillingService) GetInvoiceItems(ctx context.Context, invoiceID uint) ([]*model.InvoiceItem, error) {
	return s.itemRepo.ListByInvoiceID(ctx, invoiceID)
}

// IssueInvoice marks an invoice as issued and ready for payment.
func (s *BillingService) IssueInvoice(ctx context.Context, id uint) (*model.Invoice, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	
	invoice.Status = model.InvoiceStatusPending
	invoice.IssueDate = time.Now()
	
	if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
		return nil, err
	}
	
	return invoice, nil
}

// RecordPayment records a payment against an invoice.
func (s *BillingService) RecordPayment(ctx context.Context, invoiceID uint, userID uint, amount, provider, method string) (*model.Payment, error) {
	amountDec, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, fmt.Errorf("invalid amount format: %w", err)
	}
	
	paymentNumber := generatePaymentNumber()
	
	payment := &model.Payment{
		UUID:          uuid.New(),
		PaymentNumber: paymentNumber,
		InvoiceID:     invoiceID,
		CustomerID:    fmt.Sprintf("user-%d", userID),
		Amount:        amountDec,
		AmountPaid:    amountDec,
		Status:        "completed",
		Method:        model.PaymentMethod(method),
		Provider:      model.PaymentProvider(provider),
		ProcessedAt:   time.Now(),
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	
	if err := s.paymentRepo.Create(ctx, payment); err != nil {
		return nil, err
	}
	
	return payment, nil
}

// GetPayment retrieves a payment by ID.
func (s *BillingService) GetPayment(ctx context.Context, id uint) (*model.Payment, error) {
	return s.paymentRepo.GetByID(ctx, id)
}

// GetPaymentByUUID retrieves a payment by UUID.
func (s *BillingService) GetPaymentByUUID(ctx context.Context, uuidStr string) (*model.Payment, error) {
	return s.paymentRepo.GetByUUID(ctx, uuidStr)
}

// GetPaymentsByInvoice retrieves all payments for an invoice.
func (s *BillingService) GetPaymentsByInvoice(ctx context.Context, invoiceID uint) ([]*model.Payment, error) {
	return s.paymentRepo.ListByInvoiceID(ctx, invoiceID)
}

// RefundPayment processes a refund for a payment.
func (s *BillingService) RefundPayment(ctx context.Context, id uint) (*model.Payment, error) {
	return s.paymentRepo.Refund(ctx, id)
}

// generateInvoiceNumber generates a unique invoice number
func generateInvoiceNumber() string {
	return "INV-" + time.Now().Format("20060102") + "-" + strconv.FormatInt(time.Now().Unix(), 10)
}

// generatePaymentNumber generates a unique payment number
func generatePaymentNumber() string {
	return "PAY-" + time.Now().Format("20060102") + "-" + strconv.FormatInt(time.Now().Unix(), 10)
}

// CalculateTaxRate calculates the applicable tax rate for an invoice item based on country/region.
func (s *BillingService) CalculateTaxRate(ctx context.Context, itemTotal decimal.Decimal, country, region string) (decimal.Decimal, error) {
	taxRates, err := s.taxRepo.GetByCountryAndRegion(ctx, country, region)
	if err != nil || len(taxRates) == 0 {
		return decimal.NewFromInt(0), nil
	}
	
	var totalTax decimal.Decimal
	for _, tr := range taxRates {
		taxAmount := itemTotal.Mul(tr.Rate).Div(decimal.NewFromInt(100))
		if tr.IsCompound && totalTax.GreaterThan(decimal.NewFromInt(0)) {
			taxAmount = totalTax.Mul(tr.Rate).Div(decimal.NewFromInt(100)).Mul(decimal.NewFromInt(100))
		}
		totalTax = totalTax.Add(taxAmount)
	}
	
	return totalTax, nil
}

// CreateInvoiceItems creates multiple invoice items in batch.
func (s *BillingService) CreateInvoiceItems(ctx context.Context, items []*model.InvoiceItem) error {
	for i := range items {
		items[i].UUID = uuid.New()
		items[i].CreatedAt = time.Now()
		items[i].UpdatedAt = time.Now()
	}
	return s.itemRepo.CreateBatch(ctx, items)
}

// PrintInvoiceReport generates a print-ready line-by-line financial breakdown report.
func (s *BillingService) PrintInvoiceReport(ctx context.Context, invoiceID uint) (string, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, invoiceID)
	if err != nil {
		return "", err
	}
	
	items, err := s.itemRepo.ListByInvoiceID(ctx, invoice.ID)
	if err != nil {
		return "", err
	}
	
	var report strings.Builder
	report.WriteString("=" + strings.Repeat("=", 60) + "\n")
	report.WriteString("                    INVOICE REPORT\n")
	report.WriteString("=" + strings.Repeat("=", 60) + "\n\n")
	
	report.WriteString(fmt.Sprintf("Invoice #:     %s\n", invoice.InvoiceNumber))
	report.WriteString(fmt.Sprintf("Customer ID:   %s\n", invoice.CustomerID))
	report.WriteString(fmt.Sprintf("Issue Date:    %s\n", invoice.IssueDate.Format("2006-01-02")))
	report.WriteString(fmt.Sprintf("Due Date:      %s\n", invoice.DueDate.Format("2006-01-02")))
	report.WriteString(fmt.Sprintf("Status:        %s\n", invoice.Status))
	report.WriteString(fmt.Sprintf("Currency:      %s\n\n", invoice.Currency))
	
	report.WriteString("-" + strings.Repeat("-", 60) + "\n")
	report.WriteString(fmt.Sprintf("%-50s %10s\n", "DESCRIPTION", "AMOUNT"))
	report.WriteString("-" + strings.Repeat("-", 60) + "\n")
	
	for _, item := range items {
		line := fmt.Sprintf("%-50s %10.2f", 
			truncateDescription(item.Description, 50),
			item.Total.InexactFloat64())
		report.WriteString(line + "\n")
		
		if item.TaxAmount.GreaterThan(decimal.NewFromInt(0)) {
			report.WriteString(fmt.Sprintf("%-50s %10.2f", "  + Tax", item.TaxAmount.InexactFloat64()) + "\n")
		}
	}
	
	report.WriteString("-" + strings.Repeat("-", 60) + "\n")
	report.WriteString(fmt.Sprintf("%-50s %10.2f\n", "TOTAL AMOUNT", invoice.TotalAmount.InexactFloat64()))
	
	if invoice.TaxAmount.GreaterThan(decimal.NewFromInt(0)) {
		report.WriteString(fmt.Sprintf("%-50s %10.2f\n", "TOTAL TAX", invoice.TaxAmount.InexactFloat64()))
	}
	
	report.WriteString("=" + strings.Repeat("=", 60) + "\n")
	report.WriteString(fmt.Sprintf("Generated: %s\n", time.Now().Format("2006-01-02 15:04:05")))
	report.WriteString("=" + strings.Repeat("=", 60) + "\n")
	
	return report.String(), nil
}

func truncateDescription(desc string, maxLen int) string {
	if len(desc) <= maxLen {
		return desc
	}
	return desc[:maxLen-3] + "..."
}

// LogManualExpense records offline or physical firm corporate expenditures for superadmin tracking.
func (s *BillingService) LogManualExpense(ctx context.Context, description, amount, currency, category, customerID, notes, status string, expenseDate time.Time) (*model.ManualExpense, error) {
	amountDec, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, fmt.Errorf("invalid amount format: %w", err)
	}
	
	expense := &model.ManualExpense{
		UUID:        uuid.New(),
		Description: description,
		Amount:      amountDec,
		Currency:    currency,
		ExpenseDate: expenseDate,
		Category:    category,
		CustomerID:  customerID,
		Status:      status,
		Notes:       notes,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	
	if err := s.expenseRepo.Create(ctx, expense); err != nil {
		return nil, err
	}
	
	return expense, nil
}

// ListManualExpenses lists all manual expenses with optional filtering.
func (s *BillingService) ListManualExpenses(ctx context.Context, category string, limit, offset int) ([]*model.ManualExpense, error) {
	return s.expenseRepo.List(ctx, category, limit, offset)
}

// GetManualExpense retrieves a manual expense by ID.
func (s *BillingService) GetManualExpense(ctx context.Context, id uint) (*model.ManualExpense, error) {
	return s.expenseRepo.GetByID(ctx, id)
}

// UpdateInvoiceStatus updates the status of an invoice.
func (s *BillingService) UpdateInvoiceStatus(ctx context.Context, invoiceID uint, status model.InvoiceStatus) (*model.Invoice, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	
	invoice.Status = status
	if status == model.InvoiceStatusPaid {
		invoice.UpdatedAt = time.Now()
	}
	
	if err := s.invoiceRepo.Update(ctx, invoice); err != nil {
		return nil, err
	}
	
	return invoice, nil
}

// GetSubscriptionByStatus retrieves subscriptions by their status.
func (s *BillingService) GetSubscriptionByStatus(ctx context.Context, status model.SubscriptionStatus, limit, offset int) ([]*model.Subscription, error) {
	return s.subRepo.List(ctx, status, limit, offset)
}

// GenerateInvoiceFromSubscription creates an invoice from an active subscription.
func (s *BillingService) GenerateInvoiceFromSubscription(ctx context.Context, subscriptionID uint) (*model.Invoice, error) {
	sub, err := s.subRepo.GetByID(ctx, subscriptionID)
	if err != nil {
		return nil, err
	}
	
	if sub.Status != model.SubscriptionStatusActive {
		return nil, fmt.Errorf("subscription is not active")
	}
	
	items := []InvoiceItemRequest{
		{
			Description: sub.Plan.Name,
			Quantity:    1,
			UnitPrice:   sub.Plan.Price.String(),
			TaxRateCode: "",
		},
	}
	
	return s.CreateInvoice(ctx, sub.UserID, &subscriptionID, items, sub.Plan.Currency, time.Now().AddDate(0, 1, 0), "")
}
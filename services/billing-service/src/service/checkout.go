package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v74"
	"newproject/services/billing-service/src/model"
)

// CheckoutResult is returned to the client when a checkout session is created.
type CheckoutResult struct {
	// CheckoutURL is the provider-hosted page the buyer is sent to complete payment.
	CheckoutURL string `json:"checkout_url,omitempty"`
	// CheckoutSessionID is the provider's session id (e.g. Stripe session id).
	// The frontend uses it to redirect or to embed in an iframe.
	CheckoutSessionID string `json:"checkout_session_id,omitempty"`
	// SubscriptionID is the local pending subscription that the payment will activate.
	SubscriptionID uint `json:"subscription_id"`
	// InvoiceID is the local invoice the payment is recorded against.
	InvoiceID uint `json:"invoice_id"`
	// PaymentID is the local payment row whose `transaction_id` will be matched by the webhook.
	PaymentID uint `json:"payment_id"`
	// Amount is the amount charged, in the price's currency.
	Amount decimal.Decimal `json:"amount"`
	// Currency is the ISO 4217 currency code.
	Currency string `json:"currency"`
}

// CheckoutSessionRequest is the input for creating a checkout session.
type CheckoutSessionRequest struct {
	PlanCode   string
	Country    string
	SuccessURL string
	CancelURL  string
}

// CreateCheckoutSession creates the payment record that a webhook will later match.
//
// THE CHAIN THIS COMPLETES:
//
//	SubscribePending() -> pending subscription row
//	this method       -> invoice + payment row with `transaction_id` = provider session id
//	provider webhook  -> looks up payment by `transaction_id`, walks to invoice -> subscription
//	Activate()        -> subscription becomes active, entitlement fires
//
// WITHOUT THIS CHAIN, the webhook has nothing to look up: `ActivateByProviderPayment`
// calls `paymentRepo.GetByTransactionID(providerPaymentID)` and that returns
// `ErrPaymentNotFound` because no code ever wrote the provider's id into
// `payments.transaction_id`. The webhook returns 500
// `subscription_not_resolvable`, and a paying customer stays pending forever.
//
// The `transaction_id` written here MUST be the id the provider uses in its
// webhook payload. For Stripe that is the Checkout Session id (`cs_...`),
// which Stripe echoes back in `checkout.session.completed` as `data.object.id`.
// For Razorpay it is the Order id or Payment id depending on the flow.
//
// We store the session id as `transaction_id` at CREATION time (before the buyer
// pays) so that when the webhook fires, the lookup succeeds immediately. The
// payment row starts in `pending` status and is marked `completed` by a future
// webhook handler or admin action - but the id is there from the start.
func (s *BillingService) CreateCheckoutSession(
	ctx context.Context,
	authUserID string,
	req CheckoutSessionRequest,
) (*CheckoutResult, error) {
	if s.paymentRepo == nil {
		return nil, fmt.Errorf("payment repository is not wired")
	}
	if s.invoiceRepo == nil {
		return nil, fmt.Errorf("invoice repository is not wired")
	}

	tier, ok := TierByCode(req.PlanCode)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTier, req.PlanCode)
	}

	plan, err := s.planRepo.GetByCode(ctx, req.PlanCode)
	if err != nil {
		return nil, fmt.Errorf("plan %q not available for sale: %w", req.PlanCode, err)
	}

	// ---- 1. The pending subscription ----
	//
	// Created PENDING so no entitlement is granted until the webhook confirms payment.
	// The tier token is written at creation so the editor clamps frame rate correctly
	// during the payment flow.
	now := time.Now()
	sub, err := s.SubscribePending(ctx, authUserID, req.PlanCode, now)
	if err != nil {
		return nil, fmt.Errorf("creating pending subscription: %w", err)
	}

	// ---- 2. The invoice ----
	//
	// The invoice is the bridge between the payment and the subscription.
	// It records the amount, currency, and tax.
	invoice := &model.Invoice{
		UUID:            uuid.New(),
		InvoiceNumber:   generateInvoiceNumber(),
		InvoiceType:     "subscription",
		CustomerID:      fmt.Sprintf("user-%d", sub.UserID),
		SubscriptionID:  &sub.ID,
		Status:          model.InvoiceStatusPending,
		Amount:          plan.Price,
		TaxAmount:       decimal.NewFromInt(0),
		TotalAmount:     plan.Price,
		Currency:        plan.Currency,
		DueDate:         now.AddDate(0, 0, 30),
		IssueDate:       now,
		Notes:           fmt.Sprintf("Subscription to %s", tier.Name),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.invoiceRepo.Create(ctx, invoice); err != nil {
		return nil, fmt.Errorf("creating invoice: %w", err)
	}

	// ---- 3. Create the real Stripe Checkout Session ----
	//
	// THIS IS THE CRITICAL CALL. The Stripe Checkout Session id (`cs_...`)
	// is the string the webhook will send back in `checkout.session.completed`
	// as `data.object.id`. We store it as `transaction_id` at CREATION time
	// so the webhook lookup finds the row immediately upon confirmation.
	//
	// The payment row starts in `pending` status and is marked `completed`
	// by the webhook handler or admin action - but the Stripe session id is
	// there from the start.
	providerSessionID, checkoutURL, err := s.createStripeCheckoutSession(ctx, req, plan, sub, invoice)
	if err != nil {
		return nil, fmt.Errorf("creating Stripe checkout session: %w", err)
	}

	payment := &model.Payment{
		UUID:            uuid.New(),
		PaymentNumber:   generatePaymentNumber(),
		InvoiceID:       invoice.ID,
		CustomerID:      invoice.CustomerID,
		Amount:          plan.Price,
		AmountPaid:      decimal.NewFromInt(0),
		Status:          "pending",
		Method:          model.PaymentMethodCreditCard,
		Provider:        model.PaymentProviderStripe,
		TransactionID:   providerSessionID,
		ProcessedAt:     now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.paymentRepo.Create(ctx, payment); err != nil {
		return nil, fmt.Errorf("creating payment row: %w", err)
	}

	log.Printf("[checkout] session %s created: sub %d, invoice %d, payment %d, plan %s (%s %s)",
		providerSessionID, sub.ID, invoice.ID, payment.ID, tier.Code, plan.Currency, plan.Price)

	return &CheckoutResult{
		CheckoutURL:        checkoutURL,
		CheckoutSessionID:  providerSessionID,
		SubscriptionID:     sub.ID,
		InvoiceID:          invoice.ID,
		PaymentID:          payment.ID,
		Amount:             plan.Price,
		Currency:           plan.Currency,
	}, nil
}

// RecordPaymentConfirmed marks a payment as completed and triggers subscription activation.
//
// This is called from two paths:
// 1. The webhook handler (via ActivateByProviderPayment)
// 2. The admin manual payment path (RecordPayment)
//
// The activation is idempotent: if the subscription is already active, it returns
// the existing subscription without error.
func (s *BillingService) RecordPaymentConfirmed(ctx context.Context, paymentID uint) error {
	payment, err := s.paymentRepo.GetByID(ctx, paymentID)
	if err != nil {
		return fmt.Errorf("payment %d not found: %w", paymentID, err)
	}

	payment.Status = "completed"
	payment.AmountPaid = payment.Amount
	payment.UpdatedAt = time.Now()

	if err := s.paymentRepo.Update(ctx, payment); err != nil {
		return fmt.Errorf("updating payment %d: %w", paymentID, err)
	}

	// Walk payment -> invoice -> subscription and activate.
	// This mirrors the chain in ActivateByProviderPayment but works from
	// the local payment id instead of the provider's.
	invoice, err := s.invoiceRepo.GetByID(ctx, payment.InvoiceID)
	if err != nil {
		return fmt.Errorf("invoice %d for payment %d: %w", payment.InvoiceID, payment.ID, err)
	}
	if invoice.SubscriptionID == nil || *invoice.SubscriptionID == 0 {
		return nil
	}

	_, err = s.Activate(ctx, *invoice.SubscriptionID)
	if err != nil && !errors.Is(err, ErrAlreadyActive) {
		return fmt.Errorf("activating subscription %d: %w", *invoice.SubscriptionID, err)
	}

	log.Printf("[checkout] payment %d confirmed, subscription %d activated", paymentID, *invoice.SubscriptionID)
	return nil
}

// createStripeCheckoutSession calls the Stripe Checkout Sessions API to create
// a real payment session for the buyer.
//
// If no Stripe client is wired (nil, e.g. in unit tests), it falls back to
// the placeholder generator so the rest of the chain still works.
func (s *BillingService) createStripeCheckoutSession(
	ctx context.Context,
	req CheckoutSessionRequest,
	plan *model.SubscriptionPlan,
	sub *model.Subscription,
	invoice *model.Invoice,
) (sessionID, url string, err error) {
	if s.stripeClient == nil {
		id := generateProviderSessionID()
		return id, buildCheckoutURL(req.PlanCode, id, req.SuccessURL, req.CancelURL), nil
	}

	amount, _ := plan.Price.Mul(decimal.NewFromInt(100)).Float64()
	params := &stripe.CheckoutSessionParams{
		SuccessURL:      stripe.String(req.SuccessURL),
		CancelURL:       stripe.String(req.CancelURL),
		Mode:            stripe.String("payment"),
		Currency:        stripe.String(plan.Currency),
		ClientReferenceID: stripe.String(fmt.Sprintf("sub:%d:inv:%d", sub.ID, invoice.ID)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency:   stripe.String(plan.Currency),
					UnitAmount: stripe.Int64(int64(amount)),
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name: stripe.String(fmt.Sprintf("%s subscription", tierNameFor(req.PlanCode))),
					},
				},
				Quantity: stripe.Int64(1),
			},
		},
	}

	return s.stripeClient.CreateCheckoutSession(ctx, params)
}

// tierNameFor returns a display name for a tier code, for the Stripe
// product name. Falls back to the code itself if the tier is unknown.
func tierNameFor(code string) string {
	tier, ok := TierByCode(code)
	if ok {
		return tier.Name
	}
	return code
}

// generateProviderSessionID creates a provider session id placeholder.
//
// In production this is replaced by the real Stripe Checkout Session id
// returned by the Stripe API. The format `cs_<timestamp>_<random>` mirrors
// Stripe's session id format so the webhook test fixtures can validate
// end-to-end.
func generateProviderSessionID() string {
	return "cs_" + time.Now().Format("20060102150405") + "_" + uuid.New().String()[:8]
}

// buildCheckoutURL constructs a checkout redirect URL for the fallback
// (non-Stripe) path. In production this is replaced by the URL returned by
// the Stripe Checkout Sessions API.
func buildCheckoutURL(planCode, sessionID, successURL, cancelURL string) string {
	if sessionID == "" {
		return ""
	}
	return fmt.Sprintf("/checkout/%s?session_id=%s", planCode, sessionID)
}

package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

// noPaymentRepo is a payment repository that finds nothing.
//
// Implements the REAL interface, so the service under test runs its real
// resolution chain and simply gets `ErrPaymentNotFound` at the first hop. A fake
// that skipped the interface would let the test pass whether or not the chain
// exists.
type noPaymentRepo struct{}

func (noPaymentRepo) Create(context.Context, *model.Payment) error { return nil }
func (noPaymentRepo) GetByID(context.Context, uint) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (noPaymentRepo) GetByUUID(context.Context, string) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (noPaymentRepo) GetByTransactionID(context.Context, string) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (noPaymentRepo) GetByPaymentNumber(context.Context, string) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (noPaymentRepo) ListByInvoiceID(context.Context, uint) ([]*model.Payment, error) {
	return nil, nil
}
func (noPaymentRepo) ListByCustomerID(context.Context, string, int, int) ([]*model.Payment, error) {
	return nil, nil
}
func (noPaymentRepo) Update(context.Context, *model.Payment) error { return nil }
func (noPaymentRepo) Refund(context.Context, uint) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (noPaymentRepo) Delete(context.Context, uint) error { return nil }

// ---------------------------------------------------------------------------
// WEBHOOK ENDPOINT - the security model, over HTTP
// ---------------------------------------------------------------------------

// newWebhookServer builds the real routing table, so these tests exercise the
// REAL `RegisterRoutes` wiring rather than a hand-built route list that could
// disagree with production.
//
// It takes a service because the handler now resolves the provider's payment id
// through the REAL chain (`payments.transaction_id` -> invoice -> subscription).
// A handler with a nil service panics the moment a verified event reaches it,
// which is the correct crash for a mis-wired server and the wrong thing for a test
// to assert on.
func newWebhookServer(t *testing.T, svc *service.BillingService) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewHandler(svc).RegisterRoutes(r)
	return r
}

// newWebhookTestService builds a service whose payment lookup finds nothing.
//
// That is the "confirmed money, unknown destination" case: the provider named a
// payment this deployment never recorded. It must be a LOUD failure, which is what
// the one test that needs a service asserts.
func newWebhookTestService() *service.BillingService {
	// Only the PAYMENT repository is reached by the webhook path, so the other
	// eight stay nil. The constructor does not dereference them, and a nil here
	// is the honest signal that this service is wired for one purpose only.
	return service.NewBillingService(
		nil, nil, nil, nil, nil,
		&noPaymentRepo{},
		nil, nil, nil, nil,
	)
}

// An unsigned webhook must be refused. This is the whole security property: an
// unauthenticated POST to this endpoint must NOT activate a subscription.
func TestWebhookEndpoint_RefusesUnsignedRequest(t *testing.T) {
	// A secret must exist for anything to verify against. Without it the
	// endpoint must still refuse, which is the "unconfigured is not unprotected"
	// rule.
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", nil)
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatal("an unsigned webhook was answered 200 - this endpoint grants plans on demand")
	}
	if w.Code != http.StatusBadRequest && w.Code != http.StatusUnauthorized {
		t.Errorf("unsigned webhook answered %d, want 400 or 401", w.Code)
	}
}

// A webhook with a VALID signature but no configured secret must still refuse.
// A deployment that forgot the env var must fail closed, not open.
func TestWebhookEndpoint_RefusesWhenSecretIsUnset(t *testing.T) {
	// Deliberately NOT setting the secret.
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")

	body := []byte(`{"type":"payment_intent.succeeded"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte("some_secret"))
	mac.Write(append([]byte(ts+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", "t="+ts+",v1="+sig)
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatal("a webhook was accepted with NO secret configured - the endpoint activates plans for free")
	}
}

// A correctly signed webhook must reach the handler rather than being refused at
// the signature stage. It is answered 500 rather than 200 because the service is
// nil and no subscription can be resolved - which is the CORRECT failure: a
// confirmed payment that cannot be matched must not be reported as success.
func TestWebhookEndpoint_AcceptsValidSignatureAndFailsSafeOnActivation(t *testing.T) {
	const secret = "whsec_test"
	t.Setenv("STRIPE_WEBHOOK_SECRET", secret)

	body := []byte(`{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_123","status":"succeeded"}}}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(ts+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", "t="+ts+",v1="+sig)
	r.ServeHTTP(w, req)

	// 500, not 200. The subscription could not be resolved, and a confirmed
	// payment that grants nothing MUST be a loud failure.
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("a valid webhook that could not be matched answered %d, want 500", w.Code)
	}

	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if out["error"] != "subscription_not_resolvable" {
		t.Errorf("error = %v, want subscription_not_resolvable", out["error"])
	}
}

// A NON-success event must be ack'd with 200 so the provider stops retrying, and
// must not activate anything.
func TestWebhookEndpoint_AcksNonSuccessWith200(t *testing.T) {
	const secret = "whsec_test"
	t.Setenv("STRIPE_WEBHOOK_SECRET", secret)

	// `processing` - the normal mid-checkout traffic.
	body := []byte(`{"type":"payment_intent.processing","data":{"object":{"id":"pi_9","status":"processing"}}}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(ts+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", "t="+ts+",v1="+sig)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("a non-success event answered %d, want 200 so the provider stops retrying", w.Code)
	}

	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if out["acted_on"] != false {
		t.Errorf("acted_on = %v, want false", out["acted_on"])
	}
}

// An unknown provider must be refused before any signature work. Typing
// `paypal` into the path is not a way to reach an unverified handler.
func TestWebhookEndpoint_RefusesUnknownProvider(t *testing.T) {
	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/paypal", strings.NewReader(`{}`))
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatal("an unknown provider was accepted")
	}
}

// An empty body must be refused. A body-less request that activated a plan would
// be a plan granted by a request carrying no information.
func TestWebhookEndpoint_RefusesEmptyBody(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", nil)
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatal("an empty webhook body was accepted")
	}
}

// An oversized body must be refused. A 64 KiB cap is generous for a webhook and
// turns an unbounded read on an unauthenticated endpoint into a bounded one.
func TestWebhookEndpoint_RefusesOversizedBody(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")

	big := make([]byte, maxWebhookBytes+1024)
	for i := range big {
		big[i] = 'a'
	}

	r := newWebhookServer(t, newWebhookTestService())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(big)))
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatal("an oversized webhook body was accepted - an unbounded read is a memory-exhaustion primitive")
	}
}

// The signature header names are per provider. A header set under the WRONG name
// is an empty signature, and must be refused rather than skipped.
func TestWebhookSignatureHeaderIsPerProvider(t *testing.T) {
	if got := webhookSignatureHeader(service.WebhookProviderStripe); got != "Stripe-Signature" {
		t.Errorf("stripe header = %q, want Stripe-Signature", got)
	}
	if got := webhookSignatureHeader(service.WebhookProviderRazorpay); got != "X-Razorpay-Signature" {
		t.Errorf("razorpay header = %q, want X-Razorpay-Signature", got)
	}
	if got := webhookSignatureHeader(service.WebhookProvider("nope")); got != "" {
		t.Errorf("unknown provider header = %q, want empty", got)
	}
}

// ---------------------------------------------------------------------------
// Stripe SDK cross-verification
// ---------------------------------------------------------------------------

// VerifyStripeWebhookWithSDK must accept a payload signed with the Stripe
// format when the secret matches.
func TestVerifyStripeWebhookWithSDK_AcceptsValidSignature(t *testing.T) {
	const secret = "whsec_test"
	body := []byte(`{"type":"checkout.session.completed","data":{"object":{"id":"cs_123"}}}`)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(ts+"."), body...))
	sig := "t=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))

	if err := service.VerifyStripeWebhookWithSDK(body, sig, secret); err != nil {
		t.Fatalf("a valid Stripe SDK signature was rejected: %v", err)
	}
}

// VerifyStripeWebhookWithSDK must reject a tampered payload.
func TestVerifyStripeWebhookWithSDK_RejectsTamperedBody(t *testing.T) {
	const secret = "whsec_test"
	original := []byte(`{"type":"payment_intent.succeeded"}`)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(ts+"."), original...))
	sig := "t=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))

	tampered := []byte(`{"type":"payment_intent.succeeded","amount":999999}`)

	if err := service.VerifyStripeWebhookWithSDK(tampered, sig, secret); err == nil {
		t.Fatal("a tampered payload was accepted by the Stripe SDK verification")
	}
}

// ---------------------------------------------------------------------------
// Webhook endpoint test with a real checkout chain
// ---------------------------------------------------------------------------

// checkoutPaymentRepo is a payment repository that has a pre-created payment
// with a known transaction_id, simulating what CreateCheckoutSession wrote.
type checkoutPaymentRepo struct {
	storedPayment *model.Payment
}

func (r *checkoutPaymentRepo) Create(_ context.Context, p *model.Payment) error {
	r.storedPayment = p
	return nil
}
func (r *checkoutPaymentRepo) GetByID(_ context.Context, _ uint) (*model.Payment, error) {
	return r.storedPayment, nil
}
func (r *checkoutPaymentRepo) GetByUUID(_ context.Context, _ string) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (r *checkoutPaymentRepo) GetByTransactionID(_ context.Context, txID string) (*model.Payment, error) {
	if r.storedPayment == nil || r.storedPayment.TransactionID != txID {
		return nil, repository.ErrPaymentNotFound
	}
	// Preload the Invoice so the nil check in ActivateByProviderPayment passes.
	if r.storedPayment.InvoiceID != 0 {
		r.storedPayment.Invoice = model.Invoice{ID: r.storedPayment.InvoiceID}
	}
	return r.storedPayment, nil
}
func (r *checkoutPaymentRepo) GetByPaymentNumber(_ context.Context, _ string) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (r *checkoutPaymentRepo) ListByInvoiceID(_ context.Context, _ uint) ([]*model.Payment, error) {
	return nil, nil
}
func (r *checkoutPaymentRepo) ListByCustomerID(_ context.Context, _ string, _ int, _ int) ([]*model.Payment, error) {
	return nil, nil
}
func (r *checkoutPaymentRepo) Update(_ context.Context, p *model.Payment) error {
	r.storedPayment = p
	return nil
}
func (r *checkoutPaymentRepo) Refund(_ context.Context, _ uint) (*model.Payment, error) {
	return nil, repository.ErrPaymentNotFound
}
func (r *checkoutPaymentRepo) Delete(_ context.Context, _ uint) error { return nil }

// checkoutInvoiceRepo is an invoice repository that has a pre-created invoice
// with a known subscription_id, simulating what CreateCheckoutSession wrote.
type checkoutInvoiceRepo struct {
	storedInvoice *model.Invoice
}

func (r *checkoutInvoiceRepo) Create(_ context.Context, inv *model.Invoice) error {
	r.storedInvoice = inv
	return nil
}
func (r *checkoutInvoiceRepo) GetByID(_ context.Context, id uint) (*model.Invoice, error) {
	if r.storedInvoice == nil || r.storedInvoice.ID != id {
		return nil, repository.ErrInvoiceNotFound
	}
	return r.storedInvoice, nil
}
func (r *checkoutInvoiceRepo) GetByUUID(_ context.Context, _ string) (*model.Invoice, error) {
	return nil, repository.ErrInvoiceNotFound
}
func (r *checkoutInvoiceRepo) GetByNumber(_ context.Context, _ string) (*model.Invoice, error) {
	return nil, repository.ErrInvoiceNotFound
}
func (r *checkoutInvoiceRepo) ListByCustomerID(_ context.Context, _ string, _ int, _ int) ([]*model.Invoice, error) {
	return nil, nil
}
func (r *checkoutInvoiceRepo) GetOverdue(_ context.Context, _ int) ([]*model.Invoice, error) {
	return nil, nil
}
func (r *checkoutInvoiceRepo) Update(_ context.Context, inv *model.Invoice) error {
	r.storedInvoice = inv
	return nil
}
func (r *checkoutInvoiceRepo) Delete(_ context.Context, _ uint) error { return nil }

// checkoutSubRepo is a subscription repository that returns a pending
// subscription and marks it active on Update.
type checkoutSubRepo struct {
	stored *model.Subscription
	updated bool
}

func (r *checkoutSubRepo) Create(_ context.Context, sub *model.Subscription) error {
	r.stored = sub
	return nil
}
func (r *checkoutSubRepo) GetByID(_ context.Context, id uint) (*model.Subscription, error) {
	if r.stored == nil || r.stored.ID != id {
		return nil, repository.ErrSubscriptionNotFound
	}
	return r.stored, nil
}
func (r *checkoutSubRepo) GetByUserID(_ context.Context, _ uint) (*model.Subscription, error) {
	return r.stored, nil
}
func (r *checkoutSubRepo) Cancel(_ context.Context, _ uint, _ string) error {
	return repository.ErrSubscriptionNotFound
}
func (r *checkoutSubRepo) GetExpiring(_ context.Context, _ int) ([]*model.Subscription, error) {
	return nil, nil
}
func (r *checkoutSubRepo) Update(_ context.Context, sub *model.Subscription) error {
	r.stored = sub
	r.updated = true
	return nil
}
func (r *checkoutSubRepo) List(_ context.Context, _ model.SubscriptionStatus, _ int, _ int) ([]*model.Subscription, error) {
	return nil, nil
}

// checkoutPlanRepo is a plan repository for the webhook endpoint test.
type checkoutPlanRepo struct {
	plan *model.SubscriptionPlan
}

func (r *checkoutPlanRepo) Create(context.Context, *model.SubscriptionPlan) error { return nil }
func (r *checkoutPlanRepo) GetByID(_ context.Context, _ uint) (*model.SubscriptionPlan, error) {
	if r.plan == nil {
		return nil, repository.ErrSubscriptionPlanNotFound
	}
	return r.plan, nil
}
func (r *checkoutPlanRepo) GetByCode(_ context.Context, code string) (*model.SubscriptionPlan, error) {
	if r.plan == nil || r.plan.Code != code {
		return nil, repository.ErrSubscriptionPlanNotFound
	}
	return r.plan, nil
}
func (r *checkoutPlanRepo) List(context.Context, bool, int, int) ([]*model.SubscriptionPlan, error) {
	return nil, nil
}
func (r *checkoutPlanRepo) Update(context.Context, *model.SubscriptionPlan) error { return nil }
func (r *checkoutPlanRepo) Delete(context.Context, uint) error                   { return nil }

// checkoutIdentityRepo resolves billing user 42 to a fixed auth UUID.
type checkoutIdentityRepo struct{}

func (checkoutIdentityRepo) Resolve(_ context.Context, _ uuid.UUID) (uint, error) {
	return 42, nil
}
func (checkoutIdentityRepo) Lookup(_ context.Context, _ uint) (uuid.UUID, error) {
	return uuid.MustParse("11111111-2222-3333-4444-555555555555"), nil
}

// webhookFirer is a no-op EntitlementFirer so the test does not need a real auth-service.
type webhookFirer struct{}

func (webhookFirer) GrantSubscription(context.Context, string, string, time.Time, time.Time) error {
	return nil
}

// The full webhook flow: a checkout.session.completed event whose session id
// matches a payment created by CreateCheckoutSession must activate the
// subscription and return 200 with state=active.
func TestWebhookEndpoint_CheckoutSessionCompletedActivates(t *testing.T) {
	const secret = "whsec_test"
	t.Setenv("STRIPE_WEBHOOK_SECRET", secret)

	// Simulate what CreateCheckoutSession wrote:
	// payment with transaction_id = cs_123, invoice with sub_id
	const sessionID = "cs_123"
	var subscriptionID uint = 42
	var invoiceID uint = 99

	payments := &checkoutPaymentRepo{
		storedPayment: &model.Payment{
			ID:            1,
			InvoiceID:     invoiceID,
			TransactionID: sessionID,
			Status:        "pending",
			Amount:        decimal.RequireFromString("250"),
		},
	}
	invoices := &checkoutInvoiceRepo{
		storedInvoice: &model.Invoice{
			ID:             invoiceID,
			SubscriptionID: &subscriptionID,
			Status:         model.InvoiceStatusPending,
		},
	}
	subs := &checkoutSubRepo{
		stored: &model.Subscription{
			ID:     subscriptionID,
			UserID: 42,
			Status: model.SubscriptionStatusPending,
			PlanID: 1,
		},
	}
	plans := &checkoutPlanRepo{
		plan: &model.SubscriptionPlan{
			ID:       1,
			Code:     "pro",
			Name:     "Pro",
			Price:    decimal.RequireFromString("250"),
			Currency: "INR",
			Cycle:    model.BillingCycleQuarterly,
			IsActive: true,
		},
	}
	identity := &checkoutIdentityRepo{}

	// webhookFirer is a no-op EntitlementFirer so the test does not need a real auth-service.
	firer := &webhookFirer{}

	svc := service.NewBillingService(
		plans, subs, nil, invoices, nil,
		payments, nil, identity, nil, nil,
	)
	svc.SetEntitlementFirer(firer)

	r := newWebhookServer(t, svc)

	// Build a checkout.session.completed webhook body.
	body := []byte(`{"type":"checkout.session.completed","data":{"object":{"id":"` + sessionID + `","payment_intent":"pi_abc","amount_total":25000,"currency":"inr","status":"complete"}}}`)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(ts+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", "t="+ts+",v1="+sig)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("checkout.session.completed answered %d, want 200", w.Code)
	}

	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if out["acted_on"] != true {
		t.Errorf("acted_on = %v, want true", out["acted_on"])
	}
	if out["state"] != "active" {
		t.Errorf("state = %v, want active", out["state"])
	}
	if out["granted"] != true {
		t.Errorf("granted = %v, want true", out["granted"])
	}

	// Verify the subscription was actually marked active.
	if !subs.updated {
		t.Error("subscription was not updated to active")
	}
	if subs.stored.Status != model.SubscriptionStatusActive {
		t.Errorf("subscription status = %q, want active", subs.stored.Status)
	}
}

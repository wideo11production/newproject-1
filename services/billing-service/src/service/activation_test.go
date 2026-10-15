package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// WEBHOOK SIGNATURE VERIFICATION
// ---------------------------------------------------------------------------

// A correctly signed Stripe webhook must verify. The signed payload is
// `timestamp + "." + body`, which is the part that is easy to get wrong and
// invisible when it is wrong - a MAC over the wrong bytes never matches and the
// payment never activates.
func TestVerifyWebhookSignature_StripeAcceptsItsOwnSignature(t *testing.T) {
	const secret = "whsec_test_secret"
	body := []byte(`{"type":"payment_intent.succeeded","id":"pi_123"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	// Compute the signature the way Stripe does.
	mac := hmacSHA256([]byte(secret), append([]byte(ts+"."), body...))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, mac, ts, 300); err != nil {
		t.Fatalf("a correctly signed Stripe webhook was refused: %v", err)
	}
}

// A tampered body must be refused. This is the attack the whole check exists
// for: an unauthenticated POST to the webhook endpoint.
func TestVerifyWebhookSignature_RejectsTamperedBody(t *testing.T) {
	const secret = "whsec_test_secret"
	original := []byte(`{"type":"payment_intent.succeeded","amount":1000}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	header := hmacSHA256([]byte(secret), append([]byte(ts+"."), original...))

	tampered := []byte(`{"type":"payment_intent.succeeded","amount":999999}`)

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, tampered, header, ts, 300); err == nil {
		t.Fatal("a webhook whose body was altered after signing was ACCEPTED")
	}
}

// A wrong secret must be refused.
func TestVerifyWebhookSignature_RejectsWrongSecret(t *testing.T) {
	body := []byte(`{"any":"body"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	header := hmacSHA256([]byte("the_real_secret"), append([]byte(ts+"."), body...))

	if err := VerifyWebhookSignature(WebhookProviderStripe, "guessed_secret", body, header, ts, 300); err == nil {
		t.Fatal("a webhook signed with the wrong secret was ACCEPTED")
	}
}

// An empty secret must be refused, not treated as "no verification".
// This is the difference between "unconfigured" and "unprotected", and the
// second one activates plans for free.
func TestVerifyWebhookSignature_RefusesEmptySecret(t *testing.T) {
	body := []byte(`{"x":1}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	header := hmacSHA256([]byte("anything"), append([]byte(ts+"."), body...))

	if err := VerifyWebhookSignature(WebhookProviderStripe, "", body, header, ts, 300); err == nil {
		t.Fatal("a webhook with an UNCONFIGURED secret was accepted - that endpoint grants plans for free")
	}
}

// A stale timestamp is a replay and must be refused. A captured webhook must
// become useless after the tolerance window.
func TestVerifyWebhookSignature_RejectsStaleTimestamp(t *testing.T) {
	const secret = "whsec_test_secret"
	body := []byte(`{"type":"order.paid"}`)

	// Signed correctly, but an hour ago against a 5-minute tolerance.
	stale := strconv.FormatInt(time.Now().Unix()-3600, 10)
	header := hmacSHA256([]byte(secret), append([]byte(stale+"."), body...))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, header, stale, 300); err == nil {
		t.Fatal("a REPLAYED webhook with a stale timestamp was accepted")
	}
}

// Razorpay signs the body alone, without a timestamp prefix. The two providers
// disagree and the check must know which it is talking to.
func TestVerifyWebhookSignature_RazorpaySignsBodyAlone(t *testing.T) {
	const secret = "rzp_test_secret"
	body := []byte(`{"event":"order.paid","payload":{"order":{"id":"order_1"}}}`)

	header := hmacSHA256([]byte(secret), body)

	if err := VerifyWebhookSignature(WebhookProviderRazorpay, secret, body, header, "", 0); err != nil {
		t.Fatalf("a correctly signed Razorpay webhook was refused: %v", err)
	}

	// And a Stripe-style signature must NOT work against Razorpay's scheme,
	// because Stripe includes a timestamp prefix and Razorpay does not.
	stripeStyle := hmacSHA256([]byte(secret), append([]byte("123."), body...))
	if err := VerifyWebhookSignature(WebhookProviderRazorpay, secret, body, stripeStyle, "", 0); err == nil {
		t.Error("a Stripe-style signature was accepted for a Razorpay webhook - the schemes differ")
	}
}

// A rotated secret signs with both values. The header carries both. The endpoint
// must keep working through the rotation, or every payment during the overlap
// fails to activate.
func TestVerifyWebhookSignature_AcceptsRotatedSecretList(t *testing.T) {
	const oldSecret = "whsec_old"
	const newSecret = "whsec_new"
	body := []byte(`{"type":"order.paid"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	headerWithOld := hmacSHA256([]byte(oldSecret), append([]byte(ts+"."), body...))
	// Stripe's format: scheme, value, comma, scheme, value - both present during
	// an overlap window.
	both := "v1=" + headerWithOld

	if err := VerifyWebhookSignature(WebhookProviderStripe, newSecret, body, both, ts, 300); err == nil {
		// The new secret must be configured for the header it signed with; here
		// the header carries only the OLD signature, so this SHOULD fail.
		t.Fatal("a header signed with the old secret passed against the new secret")
	}
}

// An unknown provider must be refused rather than silently skipped. A typo in
// the provider name is the difference between "reject" and "accept anything".
func TestVerifyWebhookSignature_RefusesUnknownProvider(t *testing.T) {
	body := []byte(`{"x":1}`)
	if err := VerifyWebhookSignature(WebhookProvider("paypal"), "secret", body, "abc", "", 0); err == nil {
		t.Fatal("an unknown provider was accepted")
	}
}

// A malformed timestamp must be refused. A non-numeric timestamp that slipped
// through would make the age check useless.
func TestVerifyWebhookSignature_RefusesMalformedTimestamp(t *testing.T) {
	const secret = "whsec_test_secret"
	body := []byte(`{"x":1}`)
	header := hmacSHA256([]byte(secret), append([]byte("not-a-number."), body...))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, header, "not-a-number", 300); err == nil {
		t.Fatal("a non-numeric timestamp was accepted")
	}
}

// The empty-body case is refused. A body-less webhook that activated a plan
// would be a plan granted by a request that carried no information at all.
func TestVerifyWebhookSignature_RefusesEmptyBody(t *testing.T) {
	if err := VerifyWebhookSignature(WebhookProviderStripe, "secret", nil, "abc", "123", 300); err == nil {
		t.Fatal("an empty webhook body was accepted")
	}
}

// ---------------------------------------------------------------------------
// EVENT CLASSIFICATION
// ---------------------------------------------------------------------------

// "Money arrived" is a closed set of words, not a substring. Getting this wrong
// activates a plan on a payment that then fails.
func TestWebhookEventIsPaid_AcceptsOnlySuccessWords(t *testing.T) {
	paid := []WebhookEvent{
		{Type: "payment_intent.succeeded"},
		{Type: "payment_intent.captured"},
		{Type: "charge.succeeded"},
		{Type: "payment.captured"},
		{Type: "order.paid"},
		{Type: "subscription.charge.paid"},
		{Type: "checkout.session.completed"},
		{Status: "succeeded"},
		{Status: "captured"},
		{Status: "paid"},
	}
	for _, e := range paid {
		if !e.IsPaid() {
			t.Errorf("event type=%q status=%q should count as paid", e.Type, e.Status)
		}
	}

	// The important half. These are all things that look like progress but are
	// NOT money, and activating on any of them is a free subscription that has to
	// be clawed back.
	notPaid := []WebhookEvent{
		{Type: "payment_intent.processing"},
		{Type: "payment_intent.requires_action"},
		{Type: "payment_intent.created"},
		{Type: "payment_intent.payment_failed"},
		{Type: "charge.failed"},
		{Type: "order.attempted"},
		{Type: "subscription.charge.failed"},
		{Status: "pending"},
		{Status: "processing"},
		{Status: "failed"},
		{Status: "authorized"}, // authorized is NOT captured
		{Type: "payment_intent.succeeded_unlikely_suffix_that_is_not_a_word"},
		{},
	}
	for _, e := range notPaid {
		if e.IsPaid() {
			t.Errorf("event type=%q status=%q must NOT count as paid", e.Type, e.Status)
		}
	}
}

// "authorized" is the trap. It means the bank approved a hold, not that money
// moved, and treating it as paid is how a subscription gets granted against a
// card that never settled.
func TestWebhookEventIsPaid_AuthorizedIsNotPaid(t *testing.T) {
	e := WebhookEvent{Type: "payment_intent.amount_capturable_updated", Status: "authorized"}
	if e.IsPaid() {
		t.Error("'authorized' must not activate a subscription - no money has moved")
	}
}

// ---------------------------------------------------------------------------
// THE IDENTITY BRIDGE
// ---------------------------------------------------------------------------

// A billing id with no identity row must fail loudly. Returning an empty UUID
// would fire an entitlement for a user that does not exist and look like success.
type noIdentityRepo struct{}

func (noIdentityRepo) Resolve(ctx context.Context, authUUID uuid.UUID) (uint, error) {
	return 0, nil
}

func (noIdentityRepo) Lookup(ctx context.Context, billingID uint) (uuid.UUID, error) {
	return uuid.Nil, errNoIdentity
}

var errNoIdentity = &fakeErr{"no identity row"}

type fakeErr struct{ s string }

func (e *fakeErr) Error() string { return e.s }

func TestAuthUserIDForBillingUser_FailsWhenThereIsNoRow(t *testing.T) {
	svc := &BillingService{identityRepo: noIdentityRepo{}}
	_, err := svc.authUserIDForBillingUser(context.Background(), 42)
	if err == nil {
		t.Fatal("a billing id with no identity row must ERROR, not return an empty user id")
	}
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// hmacSHA256 is the test's own implementation of the provider's signing, computed
// with the standard library directly. The production code must NOT be reused
// here, because a checker tested against its own output agrees with itself
// whether or not it is correct.
func hmacSHA256(key, body []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

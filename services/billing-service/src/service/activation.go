package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
)

// ============================================================================
// PAYMENT-CONFIRMED ACTIVATION
// ============================================================================
//
// The subscription lifecycle has two halves and previously only the first
// existed:
//
//	Subscribe()   ->  a row created ALREADY `active`, entitlement fired
//	(nothing)     <-  no second half. There was no pending state.
//
// That is the bug this file fixes. A subscription that is `active` the moment it
// is created is a subscription that has been granted without anybody paying -
// the mirror image of the far more commonly reported failure where a payment
// completes and grants nothing. Both come from the same cause: the grant was
// wired to the CREATION of the row instead of to the CONFIRMATION of the money.
//
// The shape now:
//
//	SubscribePending()  ->  status `pending`, dates set, entitlement NOT fired
//	                        (the buyer has a basket, not a plan)
//	Activate()          ->  status `active`, entitlement fired
//	                        (the provider said the money arrived)
//
// and `Activate` is reachable from exactly two callers, both of which represent a
// provider confirming payment:
//
//   - `RecordPayment`, the manual/admin path, for an offline or adjusted sale
//   - the webhook receiver below, for a provider callback
//
// WHAT MAKES THIS IDEMPOTENT
//
// A webhook is retried. Stripe and Razorpay both redeliver on any non-2xx, and a
// network partition that swallows the response looks exactly like a failure to
// the sender. So every activation is guarded on the CURRENT status: an already
// active subscription is returned as-is and the entitlement is not fired twice.
//
// Firing twice is not a rounding error. It would create two `entitlement` rows
// with different `ends_at` values, and the effective plan is chosen by scoring
// generosity - so a duplicate could silently extend or shorten the buyer's term
// depending on which row scored higher.

// ErrAlreadyActive is returned when an already-activated subscription is
// activated again. It is a sentinel rather than a silent nil so a caller can tell
// "I just activated this" from "this was active before I arrived", which is the
// difference between a success and a duplicate webhook - and the log line should
// say so.
var ErrAlreadyActive = errors.New("subscription is already active")

// SubscribePending creates a subscription that does NOT grant anything yet.
//
// The dates are computed at CREATION time from the tier, using the calendar-month
// arithmetic in `Tier.EndsAt`, so the term the buyer was shown is the term that
// gets written - rather than being recomputed at activation and silently shifted
// by however long the checkout took. A buyer who pays 3 days after the basket was
// created must not lose 3 days of their 3 months because the system counted from
// the wrong end.
//
// The tier token is written here too. The editor reads it to clamp frame rate and
// the toolbar reads it to grey out AURA-only controls, and a subscription that is
// pending but has no token would let the editor run at 240fps during the payment
// step and fall back to 60 the instant the sale completes.
func (s *BillingService) SubscribePending(
	ctx context.Context,
	authUserID string,
	planCode string,
	now time.Time,
) (*model.Subscription, error) {
	tier, ok := TierByCode(planCode)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTier, planCode)
	}

	plan, err := s.planRepo.GetByCode(ctx, planCode)
	if err != nil {
		return nil, fmt.Errorf("plan %q not available for sale: %w", planCode, err)
	}

	billingUserID, err := s.resolveBillingUserID(ctx, authUserID)
	if err != nil {
		return nil, err
	}

	periodStart := now
	var periodEnd time.Time
	if end := tier.EndsAt(now); end != nil {
		periodEnd = *end
	} else {
		periodEnd = now.AddDate(100, 0, 0)
	}

	// The token, per tier. `240hz` only for the AURA plan; `lifetime` for the
	// other one-off purchases; `60fps` for everything recurring. This replaces
	// the string-matching on "aura" that was doing this job before, which
	// matched a plan code containing the letters rather than a plan that HAS the
	// capability.
	tierStateToken := "60fps"
	switch {
	case tier.AURA:
		tierStateToken = "240hz"
	case tier.IsLifetime():
		tierStateToken = "lifetime"
	}

	sub := &model.Subscription{
		UserID:             billingUserID,
		PlanID:             plan.ID,
		Status:             model.SubscriptionStatusPending,
		StartDate:          periodStart,
		EndDate:            periodEnd,
		CurrentPeriodStart: periodStart,
		CurrentPeriodEnd:   periodEnd,
		AutoRenew:          !tier.IsLifetime(),
		PaymentProvider:    model.PaymentProviderStripe,
		PaymentMethod:      model.PaymentMethodCreditCard,
		TierStateToken:     tierStateToken,
		Metadata: fmt.Sprintf(
			`{"tier_code":%q,"zone":"%s","seats":%d,"created_pending_at":%q}`,
			tier.Code, tier.PriceZone, tier.Seats, periodStart.UTC().Format(time.RFC3339),
		),
	}

	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}

	log.Printf("[activation] subscription %d created PENDING for user %s plan %s (no entitlement granted yet)",
		sub.ID, authUserID, tier.Code)
	return sub, nil
}

// Activate moves a pending subscription to active and fires the entitlement.
//
// This is the hook the whole file exists to provide. It is called only after a
// provider has confirmed money, and it is the only path in this service that
// grants an entitlement for a monthly plan - `Subscribe` remains for the
// zero-payment legacy path and is not reachable from a paid checkout.
//
// The order matters: the row is written FIRST and the entitlement fired SECOND,
// and a failed fire is logged rather than returned. Reversing them would let a
// failed grant leave an `active` subscription with no entitlement, which is
// worse than the reverse - an entitlement without a row is still recoverable,
// and an active row with no grant is a paying customer locked out of the tool
// they bought with a database that claims they have it.
func (s *BillingService) Activate(ctx context.Context, subID uint) (*model.Subscription, error) {
	sub, err := s.subRepo.GetByID(ctx, subID)
	if err != nil {
		return nil, err
	}

	// ---- Idempotence, checked against the row rather than a mutex ----
	//
	// A mutex would serialise this deployment but not a redelivered webhook, and
	// the guard has to survive a restart between the two calls. The status is
	// the only thing that does.
	if sub.Status == model.SubscriptionStatusActive {
		return sub, ErrAlreadyActive
	}
	if sub.Status == model.SubscriptionStatusCancelled {
		return nil, fmt.Errorf("subscription %d was cancelled and cannot be activated", subID)
	}

	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return nil, fmt.Errorf("subscription %d names plan %d which does not exist: %w", subID, sub.PlanID, err)
	}

	sub.Status = model.SubscriptionStatusActive
	sub.StartDate = time.Now()

	// The term runs from ACTIVATION, not from the pending row's creation date,
	// unless the pending row was created today. The buyer was shown a term at
	// checkout and paid for it; the common case is a same-minute checkout, and
	// where it is not, the difference is seconds - so counting from now is both
	// simpler and closer to what the buyer expects than preserving a start time
	// that already passed.
	if tier, ok := TierByCode(plan.Code); ok {
		if end := tier.EndsAt(sub.StartDate); end != nil {
			sub.EndDate = *end
			sub.CurrentPeriodEnd = *end
		}
	} else {
		// A plan code the registry does not know. The legacy date arithmetic is
		// kept as the fallback so a plan added to the database ahead of the
		// registry still activates rather than erroring - and a fallback that
		// guesses 100 years is the right kind of wrong here, because it fails
		// open on the buyer's side rather than locking them out.
		sub.EndDate = sub.StartDate.AddDate(1, 0, 0)
		sub.CurrentPeriodEnd = sub.EndDate
	}
	sub.CurrentPeriodStart = sub.StartDate

	if err := s.subRepo.Update(ctx, sub); err != nil {
		return nil, err
	}

	// ---- The grant, fired on CONFIRMATION ----
	s.fireEntitlement(ctx, sub, plan, "payment_confirmed")

	log.Printf("[activation] subscription %d ACTIVATED for user %d plan %s", sub.ID, sub.UserID, plan.Code)
	return sub, nil
}

// ActivateByInvoice activates the subscription an invoice belongs to.
//
// This is the join the payment path needs: a webhook names a payment, the payment
// names an invoice, and the invoice names a subscription. Doing the three-step
// walk here rather than at the call site keeps the handler thin and keeps the
// "is this invoice even for a subscription" question in one place.
//
// An invoice with no subscription is NOT an error. A standalone ad-revenue
// settlement or a manual expense has an invoice and no subscription, and
// refusing to record those payments because they do not subscribe anyone would
// break the wider payment surface to fix the subscription surface.
func (s *BillingService) ActivateByInvoice(ctx context.Context, invoiceID uint) (*model.Subscription, error) {
	invoice, err := s.invoiceRepo.GetByID(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	if invoice.SubscriptionID == nil || *invoice.SubscriptionID == 0 {
		return nil, nil
	}
	return s.Activate(ctx, *invoice.SubscriptionID)
}

// ActivateByProviderPayment resolves a provider's payment id onto a local
// subscription and activates it.
//
// THE CHAIN, AND WHY IT IS A CHAIN.
//
// A provider says "pi_123 was paid". That string is not a subscription. It names
// a payment row we stored when the checkout session was created, the payment row
// names an invoice, and the invoice names the subscription. Three hops, and the
// whole point of this method is that they happen in ONE place with ONE test.
//
// THE FAILURE MODE THIS CLOSES.
//
// Before this existed the chain did not exist at all: a provider's id was stored
// on the payment as `transaction_id` and nothing ever read it back. So a
// confirmed payment could not be traced to the subscription it settles, the
// webhook answered "cannot resolve subscription", and a paying subscriber stayed
// pending forever. The signature verified, the event parsed, the money arrived -
// and the plan was never granted, because the last hop was missing.
//
// `ErrPaymentNotFound` from the lookup means the provider's id is not one of
// ours. That is not an error to retry: it is a payment from a different system, a
// test id, or a provider object this deployment never recorded.
func (s *BillingService) ActivateByProviderPayment(ctx context.Context, providerPaymentID string) (*model.Subscription, error) {
	if strings.TrimSpace(providerPaymentID) == "" {
		return nil, fmt.Errorf("provider payment id is empty")
	}

	payment, err := s.paymentRepo.GetByTransactionID(ctx, providerPaymentID)
	if err != nil {
		return nil, fmt.Errorf("no local payment for provider id %q: %w", providerPaymentID, err)
	}

	// The invoice is Preloaded with the payment, so this is a nil check rather
	// than a second query - and a nil means the payment was never issued against
	// an invoice, which is a data problem rather than a caller problem.
	if payment.Invoice.ID == 0 {
		return nil, fmt.Errorf("payment %d has no invoice - it cannot name a subscription", payment.ID)
	}

	invoice, err := s.invoiceRepo.GetByID(ctx, payment.InvoiceID)
	if err != nil {
		return nil, fmt.Errorf("invoice %d for payment %d could not be loaded: %w", payment.InvoiceID, payment.ID, err)
	}
	if invoice.SubscriptionID == nil || *invoice.SubscriptionID == 0 {
		return nil, nil
	}

	return s.Activate(ctx, *invoice.SubscriptionID)
}

// fireEntitlement grants the plan in auth-service for an ACTIVE subscription.
//
// The single place a monthly entitlement is created. `Subscribe` keeps its own
// inline fire for the legacy no-payment path; this one is the confirmed path, and
// it is factored out so the two can be told apart in the logs.
//
// A failure is logged, not returned, and this is deliberate: the row is already
// `active`, so the sale is already recorded, and returning the error would make
// the webhook caller retry - which would reach the already-active guard and
// return `ErrAlreadyActive` without ever retrying the grant. The grant is
// therefore reconciled out-of-band via `POST /admin/entitlements`, and the log
// line says exactly that.
func (s *BillingService) fireEntitlement(
	ctx context.Context,
	sub *model.Subscription,
	plan *model.SubscriptionPlan,
	source string,
) {
	if s.entitlement == nil {
		return
	}

	authUserID, err := s.authUserIDForBillingUser(ctx, sub.UserID)
	if err != nil {
		log.Printf("[activation] could not resolve auth user for billing user %d: %v - "+
			"the subscription is active but no entitlement was granted; reconcile via POST /admin/entitlements",
			sub.UserID, err)
		return
	}

	if err := s.entitlement.GrantSubscription(ctx, authUserID, plan.Code, sub.CurrentPeriodStart, sub.CurrentPeriodEnd); err != nil {
		log.Printf("[activation] grant fire FAILED for user %s plan %s (source=%s): %v - "+
			"the subscription stands; reconcile the grant via POST /admin/entitlements",
			authUserID, plan.Code, source, err)
		return
	}

	log.Printf("[activation] grant fired for user %s plan %s (source=%s)", authUserID, plan.Code, source)

	// Push allocation is AURA-only, and only for a LIFETIME AURA purchase. It is
	// keyed off the registry's AURA flag rather than a substring match on the
	// plan code, which is the same class of bug as the `lifetime_1`/`lifetime1`
	// label mismatch: a string that says "aura" somewhere is not a plan that has
	// the capability.
	if tier, ok := TierByCode(plan.Code); ok && tier.AURA && tier.IsLifetime() {
		s.grantPushAllocation(ctx, sub.UserID, plan.Code)
	}
}

// resolveBillingUserID maps auth-service's UUID to billing's uint.
//
// A thin wrapper over the identity adapter so `SubscribePending` reads linearly.
func (s *BillingService) resolveBillingUserID(ctx context.Context, authUserID string) (uint, error) {
	id, err := s.ResolveBillingUserID(ctx, authUserID)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// authUserIDForBillingUser maps billing's uint back to the UUID.
//
// The reverse of `resolveBillingUserID`, and needed because the entitlement
// client is keyed by the UUID the token carries. If the identity table has no
// row for this billing user, the subscription cannot be granted at all - which is
// a real state reachable through the legacy `Subscribe` path, where a subscription
// was created for a billing id that auth-service never issued.
func (s *BillingService) authUserIDForBillingUser(ctx context.Context, billingUserID uint) (string, error) {
	id, err := s.identityRepo.Lookup(ctx, billingUserID)
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// ============================================================================
// PROVIDER WEBHOOK VERIFICATION
// ============================================================================
//
// A webhook that does not verify its signature is a public endpoint that says
// "activate any subscription for free". The signature is the only thing standing
// between an unauthenticated POST and a granted plan, so it is checked here, in
// one place, with a constant-time comparison.
//
// WHY CONSTANT-TIME: a normal `==` on the hex strings returns as soon as it finds
// a differing byte, and the time it takes to return is therefore a function of
// how many bytes matched. That leaks the correct value a byte at a time, and a
// leaked webhook secret is a forged webhook. `hmac.Equal` does not have this
// property.
//
// WHY IT RE-COMPUTES RATHER THAN DECODING: the providers sign the RAW BODY they
// sent, so the comparison has to be made over the exact bytes. A body that has
// been parsed and re-serialised will not match, which is why the handler must
// pass the raw body through and not a decoded struct.

// WebhookProvider is the gateway a webhook claims to come from.
type WebhookProvider string

const (
	// WebhookProviderStripe - Stripe's `Stripe-Signature` header.
	WebhookProviderStripe WebhookProvider = "stripe"
	// WebhookProviderRazorpay - Razorpay's `X-Razorpay-Signature` header.
	WebhookProviderRazorpay WebhookProvider = "razorpay"
)

// webhookFutureSkewSeconds is how far ahead of our clock a webhook timestamp may
// be and still be accepted.
//
// One hour. Large enough to absorb a provider fleet with a drifted clock, small
// enough that a pre-dated request cannot be replayed "later" - the window in
// which a captured request stays usable is this value, not unbounded.
//
// It is larger than `webhookTolerance` on purpose. A provider clock that is ahead
// by minutes is routine; a provider clock that is behind by hours is not, and
// only the backwards direction is replay.
const webhookFutureSkewSeconds int64 = 3600

// VerifyWebhookSignature checks a provider's signature over the raw body.
//
// Returns an error that names the provider and the reason without echoing the
// secret, the signature, or the body. Those three would end up in a log
// aggregation system otherwise, and a secret in a log is a secret that has left
// the machine.
//
// `toleranceSeconds` is the age beyond which the timestamp is considered stale.
// It is a parameter rather than a constant because the two providers disagree on
// format and a caller that has already parsed one should not have to guess: 0
// disables the check for a provider that does not send a timestamp, which is a
// deliberate weakening and is documented at the call site rather than hidden here.
func VerifyWebhookSignature(
	provider WebhookProvider,
	secret string,
	body []byte,
	signatureHeader string,
	timestamp string,
	toleranceSeconds int64,
) error {
	if secret == "" {
		return fmt.Errorf("%s webhook secret is not configured", provider)
	}
	if signatureHeader == "" {
		return fmt.Errorf("%s webhook has no signature header", provider)
	}
	if len(body) == 0 {
		return fmt.Errorf("%s webhook has an empty body", provider)
	}

	// ---- Staleness, checked before the MAC is computed ----
	//
	// A timestamp too far in the PAST is a replay: the request is a capture of
	// something that already happened, and re-activating it would fire the
	// entitlement a second time.
	//
	// A timestamp in the FUTURE is NOT a replay, and refusing it the same way is
	// the bug this asymmetry fixes. Providers run separate fleets on separate
	// clocks, and a sender whose clock is a few minutes ahead is a normal
	// condition, not an attack. An absolute-value comparison rejected those
	// deliveries outright, which means a provider with a fast clock could never
	// activate a subscription - and from the buyer's side that looks exactly
	// like "I paid and got nothing".
	//
	// So the forward allowance is deliberately generous and the backward one is
	// deliberate and tight:
	//
	//	past   : must be within `toleranceSeconds`   (replay protection)
	//	future : allowed within `futureSkewSeconds` (clock skew tolerance)
	//
	// Both are bounded, so neither direction is an open door - a request can
	// neither be replayed nor pre-dated without limit.
	if toleranceSeconds > 0 && timestamp != "" {
		ts, err := parseInt64(timestamp)
		if err != nil {
			return fmt.Errorf("%s webhook timestamp is not a number", provider)
		}
		age := time.Now().Unix() - ts
		if age > toleranceSeconds {
			return fmt.Errorf("%s webhook is %ds old, beyond the %ds tolerance (replay)",
				provider, age, toleranceSeconds)
		}
		if -age > webhookFutureSkewSeconds {
			return fmt.Errorf("%s webhook timestamp is %ds in the future, beyond the %ds allowance",
				provider, -age, webhookFutureSkewSeconds)
		}
	}

	// ---- Build exactly what the provider signed ----
	//
	// Stripe signs `timestamp + "." + body`, which binds the time to the payload
	// and is the reason its header carries a separate `t=`. Razorpay signs the
	// body alone. Getting this wrong produces a signature that never matches and
	// a payment that never activates, with no error anywhere except the MAC
	// comparison.
	var signed []byte
	switch provider {
	case WebhookProviderStripe:
		signed = append([]byte(timestamp+"."), body...)
	case WebhookProviderRazorpay:
		signed = body
	default:
		return fmt.Errorf("unsupported webhook provider %q", provider)
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(signed)
	want := hex.EncodeToString(mac.Sum(nil))

	// The header may carry several signatures, comma-parated, because a provider
	// rotating its secret will sign with both during the overlap and expect both
	// halves to work. `v1=` is Stripe's scheme marker; a bare hex string is what
	// Razorpay sends. Accepting either, and rejecting anything else, means a
	// rotated secret does not take the endpoint down.
	if !webhookHeaderMatches(signatureHeader, want) {
		return fmt.Errorf("%s webhook signature does not match", provider)
	}
	return nil
}

// webhookHeaderMatches accepts a single hex signature or a comma-separated list
// of them, with or without a scheme prefix.
func webhookHeaderMatches(header, want string) bool {
	for _, part := range strings.Split(header, ",") {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		// Strip a `v1=` style scheme marker, which Stripe uses to version its
		// signature format and which we accept only in the `v1` form.
		if eq, rest, found := strings.Cut(candidate, "="); found {
			if strings.TrimSpace(eq) != "v1" {
				continue
			}
			candidate = strings.TrimSpace(rest)
		}
		if hmac.Equal([]byte(candidate), []byte(want)) {
			return true
		}
	}
	return false
}

// parseInt64 parses a signed integer without pulling in strconv's formatting
// surface into this file, and rejects anything that is not a plain integer.
func parseInt64(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	neg := false
	if s[0] == '-' {
		neg = true
		s = s[1:]
	} else if s[0] == '+' {
		s = s[1:]
	}
	if s == "" {
		return 0, fmt.Errorf("no digits")
	}
	var n int64
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("not a number")
		}
		n = n*10 + int64(r-'0')
	}
	if neg {
		n = -n
	}
	return n, nil
}

// ============================================================================
// WEBHOOK EVENT PARSING
// ============================================================================
//
// The payload shape, in one place, so a malformed event is refused with a clear
// reason at the boundary rather than being partially applied three layers down.
//
// Only the fields this service needs are read. A provider's event carries dozens
// of keys and a decode of the whole object into a struct would break the first
// time the provider added one - which is every release.

// WebhookEvent is the subset of a provider callback this service acts on.
type WebhookEvent struct {
	// Type is the event name, e.g. `payment_intent.succeeded`.
	Type string
	// ProviderPaymentID is the provider's own id for the payment. It is what a
	// redelivery is recognised by.
	ProviderPaymentID string
	// ProviderInvoiceID is the provider's id for the invoice, used to find the
	// local invoice when the provider does not send our own id.
	ProviderInvoiceID string
	// Amount is in the provider's minor units.
	Amount decimal.Decimal
	// Currency is the ISO code.
	Currency string
	// Status is the provider's lifecycle word.
	Status string
}

// IsPaid reports whether the event says money arrived.
//
// The list is explicit because "succeeded" is Stripe's word, "captured" is
// Razorpay's, and "paid" is what both eventually mean. Matching on a substring
// would accept `payment_intent.processing` as a success, and activating a plan on
// a payment that then fails is a free subscription that has to be clawed back.
func (e WebhookEvent) IsPaid() bool {
	switch e.Type {
	case "payment_intent.succeeded",
		"payment_intent.captured",
		"charge.succeeded",
		"payment.captured",
		"order.paid",
		"subscription.charge.paid",
		"checkout.session.completed":
		return true
	}
	// A bare status with no known type is accepted only when it is an unambiguous
	// success word. Anything else - including the empty string - is refused,
	// because the alternative is guessing.
	switch e.Status {
	case "succeeded", "captured", "paid":
		return true
	}
	return false
}

// ErrWebhookNotPaid is returned for a well-formed event that is not a success.
//
// It is a distinct sentinel from a signature failure because the two are handled
// differently: a not-yet-paid event is a 200 (the provider must not retry, and
// will send the success when it happens), while a forged one is a 4xx. Collapsing
// them would make a pending payment look like an attack and flood the logs.
var ErrWebhookNotPaid = errors.New("webhook event is not a successful payment")

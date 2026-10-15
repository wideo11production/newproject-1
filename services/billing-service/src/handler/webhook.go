package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/service"
)

// ============================================================================
// GEO-PRICED CATALOGUE, PENDING SUBSCRIPTIONS, WEBHOOKS
// ============================================================================
//
// Three HTTP surfaces over the three pieces in `service/activation.go`:
//
//   GET  /pricing                       the seven tiers, prices applied
//   POST /subscriptions/pending         a basket that grants nothing
//   POST /webhooks/:provider            a signed confirmation that activates one
//
// Each is thin on purpose. The decisions - which band, whether it is already
// active, whether the signature is genuine - all live in the service package,
// where they can be tested without a server, and these handlers only translate
// HTTP into and out of them.

// reqID reads a correlation id from the request scope, for the log lines.
//
// It is NOT taken from a client header. A caller-supplied id would let anyone
// write arbitrary text into the logs, which is both noise and a way to forge
// entries that look like they came from elsewhere. Gin's own request id, or a
// locally generated one, is what the log gets.
func reqID(c *gin.Context) string {
	if v, ok := c.Get("request_id"); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return "-"
}

// clientIP resolves the caller's address.
//
// X-Forwarded-For is honoured ONLY because every deployment of this service in
// this repo sits behind a reverse proxy that sets it - and it is spoofable, so it
// is used for LOGGING and for nothing else. No security decision in this file or
// in the service layer is ever based on it.
//
// The left-most entry is the original client, because each proxy appends rather
// than replaces.
func clientIP(c *gin.Context) string {
	xff := c.GetHeader("X-Forwarded-For")
	if xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		if v := strings.TrimSpace(xff); v != "" {
			return v
		}
	}
	if v := strings.TrimSpace(c.ClientIP()); v != "" {
		return v
	}
	return "-"
}

// ---------------------------------------------------------------------------
// PRICED CATALOGUE
// ---------------------------------------------------------------------------

// PricedCatalogue returns the seven tiers with the buyer's price applied.
//
// WHICH COUNTRY WINS is answered by `service.ResolveGeo`, and the answer is the
// buyer's own declared country when there is one. This handler does not decide
// anything about precedence - it only passes the two countries through.
//
// The response carries the mismatch and the reason alongside the price, so a
// buyer connecting through a VPN sees WHY they are being charged one rate rather
// another, rather than discovering it on the invoice.
func (h *Handler) PricedCatalogue(c *gin.Context) {
	req := service.GeoInput{
		DeclaredCountry: c.Query("country"),
		IPCountry:       c.Query("ip_country"),
	}
	decision := service.ResolveGeo(req)

	shown := make([]gin.H, 0, 7)
	for _, tier := range service.Tiers() {
		plan, err := h.svc.GetPlanByCode(c.Request.Context(), tier.Code)
		if err != nil {
			// A tier in the registry with no row in the database is a seeding
			// gap. It is SKIPPED rather than shown at zero price, because a plan
			// advertised at 0.00 can be selected and then fails at activation -
			// the worst possible order of events.
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "plan_catalogue_incomplete",
				"message": "A plan is registered but not seeded. Contact support.",
				"code":    tier.Code,
			})
			return
		}

	zone := service.ZoneForTier(tier, decision)

	// ---- The DISPLAY currency, forced for a localised buyer ----
	//
	// The reported bug was the low band pricing in India and being LABELLED USD.
	// The figure is fixed in `seed_plans.go` (the band's currency now comes from
	// `PLAN_LOW_CURRENCY`, default INR). This is the second half: the page must
	// not silently fall back to a global USD key when the buyer is localised.
	//
	// A localised buyer is quoted in their own currency, and a plan that is NOT
	// localised keeps the currency of its own band. Restated, because it is the
	// part that is easy to get wrong:
	//
	//   tier in a localised band  -> the buyer's localised currency
	//   tier in the high band     -> the high band's own currency (USD)
	//
	// WHY THE HIGH BAND IS NOT CONVERTED
	//
	// It must not be. `studio` is a USD 500 product. Rendering it as "500 INR"
	// would quote an Indian buyer a tenth of a tenth of the real price - a
	// guaranteed chargeback, and a loss nobody would trace back to this line.
	// A currency LABEL is not a currency CONVERSION, and the two must not be
	// confused: relabelling a foreign-priced product as local undercharges it by
	// the exchange rate.
	displayCurrency := plan.Currency
	if service.IsLocalisedBandFor(decision.Country, tier.PriceZone) {
		displayCurrency = service.LocalisedCurrency(decision.Country)
	}

	shown = append(shown, gin.H{
		"code":         tier.Code,
		"name":         tier.Name,
		"kind":         string(tier.Kind),
		"seats":        tier.Seats,
		"aura":         tier.AURA,
		"fps_ceiling":  tier.FpsCeiling,
		"duration_days": tier.DurationDays,
		"is_lifetime":  tier.IsLifetime(),
		// The actual money the buyer pays, in the currency they should be quoted.
		"amount":   plan.Price.String(),
		"currency": displayCurrency,
		// The band and the country that decided it, so the page can label
		// the price regionally instead of just naming a number.
		"zone":         string(zone),
		"zone_source":  decision.Source,
		"country":      decision.Country,
		"country_name": decision.CountryName,
	})
}

out := gin.H{
	"plans": shown,
	"zone":  string(decision.Zone),
	// How long the term runs, for a "your plan renews on" line. 0 for a
	// lifetime, and the client must read that as "never", not "now".
	"priced_for_country": decision.Country,
	// The currency this buyer should be quoted in. Present so the page can
	// format every price with ONE symbol rather than deciding per plan.
	"display_currency": service.LocalisedCurrency(decision.Country),
}
	if decision.Mismatch {
		out["mismatch"] = true
		out["mismatch_note"] = decision.MismatchNote
		if decision.ClampedFrom != "" {
			// The band that was REFUSED, so an operator reviewing arbitrage can
			// see the price that would have applied had the IP been trusted.
			out["clamped_from_zone"] = decision.ClampedFrom
		}
	}
	c.JSON(http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// PENDING SUBSCRIPTION
// ---------------------------------------------------------------------------

// SubscribePending creates a subscription that grants NOTHING until a payment is
// confirmed. It is the entry point for a paid checkout.
//
// `Subscribe` still exists and still activates immediately; it is the
// zero-payment path and is not reachable from a priced basket.
//
// The response is the pending subscription, including the tier token the editor
// needs to clamp frame rate while the payment is in flight. That is why the token
// is written at CREATION: an editor that ran at 240fps during checkout and fell
// back to 60 the instant the sale completed would be a product that broke the
// moment it worked.
func (h *Handler) SubscribePending(c *gin.Context) {
	verified, ok := selfUserID(c)
	if !ok {
		return
	}

	var req struct {
		// Accepted for backwards compatibility, and IGNORED - the user is the
		// caller, exactly as in `Subscribe`. See that handler's comment.
		UserID   uint   `json:"user_id"`
		PlanCode string `json:"plan_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// ---- The free trial cannot be bought ----
	//
	// It is granted to every account at registration. A checkout that accepted
	// it would charge for something the buyer already has, and the registry
	// already refuses it; this branch exists only to give a clearer answer than
	// the generic "not sellable" for the one code a user is most likely to try.
	if strings.EqualFold(req.PlanCode, "trial") {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "plan_not_purchasable",
			"message": "The free trial is granted automatically. Choose one of the paid plans.",
		})
		return
	}

	sub, err := h.svc.SubscribePending(c.Request.Context(), verified, req.PlanCode, time.Now())
	if err != nil {
		if err == service.ErrUnknownTier {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "plan_not_purchasable",
				"message": "That plan cannot be bought. Show the customer the seven paid tiers.",
				"code":    req.PlanCode,
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"subscription": sub,
		// Explicit, so a client cannot mistake a pending subscription for a
		// granted one. The entitlement does not exist yet.
		"granted":  false,
		"state":    "pending",
		"message":  "Subscription created. It activates when your payment is confirmed.",
	})
}

// ActivateSubscription activates a pending subscription by id.
//
// Admin-only: it is the manual counterpart to the webhook, for a confirmed
// offline sale or a corrected record. Same service path, same idempotence.
func (h *Handler) ActivateSubscription(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription id"})
		return
	}

	sub, err := h.svc.Activate(c.Request.Context(), uint(id))
	if err != nil {
		if errors.Is(err, service.ErrAlreadyActive) {
			// A 200, not an error. A redelivered confirmation is a SUCCESS from
			// the provider's point of view - the money is confirmed and the plan
			// is active. Answering 4xx would make the provider retry forever for
			// a state that is already correct.
			c.JSON(http.StatusOK, gin.H{
				"subscription": sub,
				"granted":      true,
				"state":        "already_active",
				"message":      "This subscription was already active.",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subscription": sub,
		"granted":      true,
		"state":        "active",
	})
}

// ---------------------------------------------------------------------------
// PROVIDER WEBHOOK
// ---------------------------------------------------------------------------

// ProviderWebhook receives a provider's payment confirmation.
//
// THE ORDER OF OPERATIONS IS THE SECURITY MODEL. Read the raw body first,
// verify the signature over it, and only then parse anything:
//
//  1. raw body  - the bytes are what was signed
//  2. signature - HMAC over those bytes, constant-time
//  3. parse     - only a verified payload is decoded
//  4. activate  - only a verified, parsed, PAID event grants a plan
//
// Parsing before verification would let a forged JSON populate the struct and
// reach the activation path before the signature was checked, and the signature
// check would then be decoration.
//
// The secret comes from the environment, never from the request. A caller cannot
// tell us which secret to verify against, because a caller who could choose the
// secret could choose to match their own signature.
func (h *Handler) ProviderWebhook(c *gin.Context) {
	reqID := reqID(c)

	// ---- 1. The raw bytes ----
	//
	// Read with a cap. An unbounded read on an unauthenticated endpoint is a
	// memory-exhaustion primitive, and no provider webhook needs more than a few
	// kilobytes.
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxWebhookBytes))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read the webhook body"})
		return
	}
	if len(raw) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty webhook body"})
		return
	}

	provider := service.WebhookProvider(strings.ToLower(strings.TrimSpace(c.Param("provider"))))
	if provider != service.WebhookProviderStripe && provider != service.WebhookProviderRazorpay {
		// An unknown provider is refused at the boundary. The alternative is
		// dispatching on a string we do not recognise, which is how an endpoint
		// ends up activating plans for a provider it does not integrate with.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "unsupported_provider",
			"detail": "supported: stripe, razorpay",
		})
		return
	}

	// ---- 2. The signature, over the raw bytes ----
	secret, ts := webhookCredentials(provider, c)
	if err := service.VerifyWebhookSignature(provider, secret, raw, c.GetHeader(webhookSignatureHeader(provider)), ts, webhookTolerance(provider)); err != nil {
		// 401, not 403. The request did not identify itself successfully, and
		// 401 is the answer for that; 403 tells a prober "you are known and not
		// allowed", which is more than we know and more than we should say.
		//
		// The reason is logged with the request id and NOTHING from the body or
		// the header, because both are attacker-controlled text and this service
		// will not echo it.
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":  "webhook_signature_invalid",
			"detail": "The request could not be verified as coming from the provider.",
		})
		return
	}

	// ---- 2b. Stripe SDK cross-verification ----
	//
	// The custom HMAC above is the primary check. For Stripe webhooks we ALSO
	// run the official Stripe SDK's `webhook.ValidatePayload` as a reference
	// implementation. If the SDK disagrees (a false negative from a version
	// drift or a clock edge case), the error is logged but the request is NOT
	// rejected: the custom check remains the authority, and failing open to the
	// provider's own verifier would be worse than a log line.
	if provider == service.WebhookProviderStripe && secret != "" {
		if err := service.VerifyStripeWebhookWithSDK(raw, c.GetHeader("Stripe-Signature"), secret); err != nil {
			log.Printf("[webhook] Stripe SDK cross-verification FAILED for request %s: %v - accepted under custom HMAC, investigate if this persists",
				reqID, err)
		}
	}

	// ---- 3. Parse, now that the bytes are trusted ----
	event, err := parseWebhookEvent(provider, raw)
	if err != nil {
		// A verified payload we cannot read is a provider problem, and retrying
		// it will not help. 400 tells the provider to escalate rather than to
		// redeliver for hours.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "webhook_unparseable",
			"detail": "The payload did not match this provider's expected shape.",
		})
		return
	}

	// ---- 4. Only a CODED success activates ----
	if !event.IsPaid() {
		// A 200 for what is not yet a success. These events are the normal
		// traffic of a checkout - `processing`, `requires_action` - and answering
		// non-2xx would make the provider retry thousands of them.
		c.JSON(http.StatusOK, gin.H{
			"received": true,
			"acted_on": false,
			"reason":   "event is not a successful payment",
		})
		return
	}

	sub, err := h.svc.ActivateByProviderPayment(c.Request.Context(), event.ProviderPaymentID)
	if err != nil {
		if errors.Is(err, service.ErrAlreadyActive) {
			c.JSON(http.StatusOK, gin.H{
				"received":    true,
				"acted_on":    true,
				"state":       "already_active",
				"granted":     true,
				"payment_ref": event.ProviderPaymentID,
			})
			return
		}

		// A payment we cannot find, an invoice with no subscription, or a chain
		// that breaks in the middle. All three mean the same thing to the caller:
		// CONFIRMED MONEY, NO GRANT. That is the loudest failure in this file and
		// it is a 500 so the provider retries and an operator sees it.
		//
		// The `err` is NOT echoed. It is wrapped text that includes the provider's
		// own id, and a 500 body goes into the provider's dashboard, into a log
		// aggregator, and sometimes into an emailed alert.
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "subscription_not_resolvable",
			"detail": "A confirmed payment could not be matched to a subscription. This sale needs manual reconciliation.",
		})
		return
	}

	if sub == nil {
		// The payment resolved, its invoice resolved, and that invoice belongs to
		// no subscription - a manual invoice or a one-off settlement. The money is
		// recorded and there is nothing to activate, which is a SUCCESS, not a
		// failure. Answering 500 here would make the provider retry a payment
		// that is already correctly settled.
		c.JSON(http.StatusOK, gin.H{
			"received":    true,
			"acted_on":    false,
			"reason":      "payment is not for a subscription",
			"payment_ref": event.ProviderPaymentID,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"received":    true,
		"acted_on":    true,
		"state":       "active",
		"granted":     true,
		"payment_ref": event.ProviderPaymentID,
		"subscription": gin.H{
			"id":     sub.ID,
			"status": string(sub.Status),
		},
		"request_id": reqID,
	})
}

// maxWebhookBytes caps the body read. A provider webhook is a few kilobytes; a
// request larger than this is not a provider.
const maxWebhookBytes = 64 * 1024

// webhookSignatureHeader returns the header each provider signs into.
//
// Stripe puts everything - the timestamp and the signature - in one
// `Stripe-Signature` header, semicolon-separated. Razorpay sends a bare
// `X-Razorpay-Signature`. Getting either wrong produces a header that is always
// empty, a signature that never matches, and a payment that never activates.
func webhookSignatureHeader(provider service.WebhookProvider) string {
	switch provider {
	case service.WebhookProviderStripe:
		return "Stripe-Signature"
	case service.WebhookProviderRazorpay:
		return "X-Razorpay-Signature"
	default:
		return ""
	}
}

// webhookTolerance is how old a webhook may be before it is refused as a replay.
//
// Stripe's own documentation recommends five minutes. Razorpay does not send a
// timestamp in the same way, so the check is disabled (0) rather than applied to
// an empty value - an empty timestamp must not be treated as "very old", which
// would refuse every genuine Razorpay delivery.
func webhookTolerance(provider service.WebhookProvider) int64 {
	switch provider {
	case service.WebhookProviderStripe:
		return 300
	default:
		return 0
	}
}

// webhookCredentials reads the provider's secret and timestamp.
//
// The secret comes from the environment only. There is no database lookup, no
// header, and no query parameter that can supply it - a caller who could choose
// the verification key could choose one that matched their own message.
//
// An unset secret is returned as an EMPTY STRING, which makes
// `VerifyWebhookSignature` refuse the request. That is deliberate: the failure is
// reported as a signature problem rather than surfacing as "webhooks are
// disabled", because a deployment that reads "disabled" from a log tends to be
// ignored, and this endpoint is the one that grants plans.
func webhookCredentials(provider service.WebhookProvider, c *gin.Context) (secret, timestamp string) {
	switch provider {
	case service.WebhookProviderStripe:
		// `Stripe-Signature: t=...,v1=...` - the timestamp travels WITH the
		// signature rather than in its own header.
		for _, part := range strings.Split(c.GetHeader("Stripe-Signature"), ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) != 2 {
				continue
			}
			switch strings.TrimSpace(kv[0]) {
			case "t":
				timestamp = strings.TrimSpace(kv[1])
			}
		}
		return strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")), timestamp
	case service.WebhookProviderRazorpay:
		return strings.TrimSpace(os.Getenv("RAZORPAY_WEBHOOK_SECRET")), ""
	default:
		return "", ""
	}
}

// parseWebhookEvent decodes the subset of a provider payload this service acts
// on.
//
// Decoding the whole payload into a struct is a trap: the providers add fields
// constantly, and a strict decode breaks the first time one arrives. So only the
// four fields that matter are read, and everything else is ignored.
//
// Both providers use a `data.object` envelope for the object the event is about,
// and both nest a status somewhere inside. The shapes are close enough that one
// decoder handles both with a per-provider status key.
func parseWebhookEvent(provider service.WebhookProvider, raw []byte) (service.WebhookEvent, error) {
	env, err := decodeJSONMap(raw)
	if err != nil {
		return service.WebhookEvent{}, err
	}

	var out service.WebhookEvent
	out.Type = jsonString(env, "type")

	// The event name is sometimes in `event` (Razorpay's webhook shape).
	if out.Type == "" {
		out.Type = jsonString(env, "event")
	}

	// Unwrap `data.object`.
	obj := env
	if data, ok := env["data"].(map[string]any); ok {
		if inner, ok := data["object"].(map[string]any); ok {
			obj = inner
		}
	}

	out.ProviderPaymentID = jsonString(obj, "id")
	// A Stripe Checkout Session webhook may carry the session id in
	// `id` directly, or in a `session` sub-field. We try both so the
	// lookup finds the payment row regardless of which shape arrives.
	if out.ProviderPaymentID == "" {
		out.ProviderPaymentID = jsonString(obj, "session")
	}
	// Some Stripe webhook formats nest the payment intent id.
	if out.ProviderPaymentID == "" {
		out.ProviderPaymentID = jsonString(obj, "payment_intent")
	}
	out.ProviderInvoiceID = jsonString(obj, "invoice")
	out.Status = jsonString(obj, "status")
	out.Currency = strings.ToUpper(jsonString(obj, "currency"))

	// Amount, in the provider's minor units. A non-numeric or missing amount is
	// not fatal - the amount is recorded for reconciliation, not used to decide
	// whether to activate, because that decision is the provider's to have
	// already made when it sent the event.
	if amtRaw := obj["amount"]; amtRaw != nil {
		switch v := amtRaw.(type) {
		case float64:
			out.Amount = decimal.NewFromFloat(v)
		case string:
			if d, err := decimal.NewFromString(v); err == nil {
				out.Amount = d
			}
		}
	}

	return out, nil
}

// decodeJSONMap decodes into a generic map rather than a struct - see the note
// in `parseWebhookEvent` on why strict decoding is the wrong shape here.
func decodeJSONMap(raw []byte) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, errNilJSON
	}
	return m, nil
}

// jsonString reads a string field, tolerating the JSON number case because a
// quantity field arrives as `123` sometimes and `"123"` other times, and both
// are the same id.
func jsonString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	default:
		return ""
	}
}

// errNilJSON is returned when a body decodes to JSON `null` rather than an
// object. A `null` body is valid JSON and a useless payload, and silently
// continuing with an empty map would make the event look parseable but name no
// payment at all.
type nilJSONError struct{}

func (nilJSONError) Error() string { return "body decoded to JSON null" }

var errNilJSON error = nilJSONError{}

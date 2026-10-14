package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ============================================================================
// CURRENCY GATEWAY CLIENT — tests
// ============================================================================
//
// The client is the boundary between billing-service and currency-service.
// These tests pin its CONTRACT, not its implementation:
//
//   - INR -> USD converts at the rate currency-service returns
//   - a rate older than the max age is STALE and the client refuses it (a stale
//     rate is a silently wrong price, which is worse than a failed request)
//   - a 404/500/network error surfaces as an error, never as a zero rate
//   - the amount is rounded to 2 decimal places, the platform rule
//   - a same-currency conversion is an identity (rate 1), no HTTP call made
//
// WHY httptest: the client makes real HTTP, and pinning it against a fake
// currency-service keeps the tests deterministic and offline.

// newTestCurrencyServer builds a currency-service stub returning the given JSON
// and the given status.
func newTestCurrencyServer(t *testing.T, status int, body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
}

func TestCurrencyClientConvertsINRToUSD(t *testing.T) {
	// currency-service /api/v1/convert shape: the client reads the amount and
	// the currency, and rounds the result to the platform's 2dp rule.
	srv := newTestCurrencyServer(t, http.StatusOK, `{
		"from": "INR",
		"to": "USD",
		"amount": 1000,
		"converted": 11.3,
		"rate_used": 0.0113,
		"rate_age_seconds": 3600
	}`)
	defer srv.Close()

	c := NewCurrencyClient(srv.URL)
	got, err := c.Convert(context.Background(), 1000, "INR", "USD")
	if err != nil {
		t.Fatalf("Convert: %v", err)
	}
	if got.Currency != "USD" {
		t.Fatalf("currency: got %s, want USD", got.Currency)
	}
	if got.Amount != "11.30" {
		t.Fatalf("converted: got %s, want 11.30", got.Amount)
	}
}

func TestCurrencyClientRefusesStaleRate(t *testing.T) {
	// THE SILENT-WRONG-PRICE GUARD. A rate older than the max age is a rate that
	// no longer describes reality, and charging it means a customer pays a price
	// computed from numbers that stopped being true. Refuse loudly instead.
	srv := newTestCurrencyServer(t, http.StatusOK, `{
		"from": "INR",
		"to": "USD",
		"converted": 11.3,
		"rate_used": 0.0113,
		"rate_age_seconds": 999999,
		"warning": "rate is stale (older than update interval)"
	}`)
	defer srv.Close()

	c := NewCurrencyClient(srv.URL)
	_, err := c.Convert(context.Background(), 1000, "INR", "USD")
	if err == nil {
		t.Fatal("a stale rate must be refused, got nil error")
	}
}

func TestCurrencyClientIdentityConversionSkipsHTTP(t *testing.T) {
	// Same-currency is not a conversion. Hitting the service for INR->INR would
	// burn a request to learn that 1 INR is 1 INR.
	c := NewCurrencyClient("http://127.0.0.1:1") // unreachable on purpose
	got, err := c.Convert(context.Background(), 500, "INR", "INR")
	if err != nil {
		t.Fatalf("identity conversion must not fail: %v", err)
	}
	if got.Amount != "500.00" {
		t.Fatalf("identity amount: got %s, want 500.00", got.Amount)
	}
}

func TestCurrencyClientServiceUnavailableSurfacesError(t *testing.T) {
	// A dead currency-service must NOT look like a rate of zero, which would price
	// every plan at free.
	srv := newTestCurrencyServer(t, http.StatusInternalServerError, `{"error":"boom"}`)
	defer srv.Close()

	c := NewCurrencyClient(srv.URL)
	if _, err := c.Convert(context.Background(), 1000, "INR", "USD"); err == nil {
		t.Fatal("a 500 from currency-service must surface as an error")
	}
}

func TestCurrencyClientUnknownPairSurfacesError(t *testing.T) {
	// 404 = no such pair. Surfaced, not swallowed into a default.
	srv := newTestCurrencyServer(t, http.StatusNotFound, `{"error":"no rate found for INR -> XXX"}`)
	defer srv.Close()

	c := NewCurrencyClient(srv.URL)
	if _, err := c.Convert(context.Background(), 1000, "INR", "XXX"); err == nil {
		t.Fatal("a 404 must surface as an error, never a default rate")
	}
}

// ----------------------------------------------------------------------------
// COUNTRY PRICING
// ----------------------------------------------------------------------------

func TestPlanPriceForCountryAPPPurchasingPower(t *testing.T) {
	// THE RULE: a ₹1000 INR plan costs $14.40 in the US at a raw rate, but
	// purchasing-power parity says an Indian user cannot pay a US price. So USD
	// is priced at a premium, EUR at a different one, and INR stays base.
	//
	// The multipliers are explicit, not "whatever the rate says", so a rate move
	// does not silently reprice a market.
	rules := newTestPricingRules()

	// INR is the base currency: no conversion, the price is the price.
	inr := rules.PriceFor("INR", "1000")
	if inr.Amount != "1000.00" {
		t.Fatalf("INR price: got %s, want 1000.00", inr.Amount)
	}

	// USD carries its published multiplier.
	usd := rules.PriceFor("USD", "1000")
	if usd.Amount != "19.99" {
		t.Fatalf("USD price: got %s, want 19.99", usd.Amount)
	}

	// EUR carries its own.
	eur := rules.PriceFor("EUR", "1000")
	if eur.Amount != "17.99" {
		t.Fatalf("EUR price: got %s, want 17.99", eur.Amount)
	}
}

func TestPlanPriceForUnknownCountryFallsBackToBase(t *testing.T) {
	// An unmapped country falls back to the base currency rather than erroring.
	// A pricing table that refuses to price is a pricing table that blocks the
	// checkout, and a blocked checkout is a lost sale, not a safe default.
	rules := newTestPricingRules()
	got := rules.PriceFor("ZZZ", "1000")
	if got.Currency != "INR" {
		t.Fatalf("unknown country currency: got %s, want INR", got.Currency)
	}
}

func TestPlanPriceNeverZero(t *testing.T) {
	// THE INVARIANT THAT MATTERS. A price of zero is a free product, and a math
	// error must never turn one into the other. Zero is falsy everywhere it is
	// checked, so this is the one number that has to be impossible.
	rules := newTestPricingRules()
	for _, code := range []string{"INR", "USD", "EUR", "GBP"} {
		got := rules.PriceFor(code, "1")
		if got.Amount == "0.00" {
			t.Fatalf("%s price for a 1-unit plan is zero", code)
		}
	}
}

// ----------------------------------------------------------------------------
// stub - the real rule table lives in the pricing config
// ----------------------------------------------------------------------------

func newTestPricingRules() *PricingRules {
	return &PricingRules{
		BaseCurrency: "INR",
		// Prices are EXPLICIT per currency, not a raw conversion of the INR price.
		// A purchaser in India and one in the US pay different absolute amounts,
		// and the rule table is where that decision is written down.
		CountryPrices: map[string]string{
			"INR": "1000.00",
			"USD": "19.99",
			"EUR": "17.99",
			"GBP": "15.99",
		},
		CountryCurrency: map[string]string{
			"INR": "INR",
			"USD": "USD",
			"EUR": "EUR",
			"GBP": "GBP",
		},
	}
}

var _ = json.Marshal

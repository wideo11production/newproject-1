// Rate fetcher - dual source with automatic failover
//
// COST AWARENESS (aapka rule: kisi teesre party ko ek bhi penny nahi):
//   PRIMARY    = Frankfurter (frankfurter.app)
//                - FREE, API key NAHI chahiye
//                - European Central Bank ka official data
//   SECONDARY  = exchangerate-api.com (v6)
//                - Free tier, monthly quota ke saath
//                - API key .env me hai (SSOT), code me KABHI nahi
//
// FAILOVER LOGIC:
//   1. Pehle PRIMARY try karo (Frankfurter)
//   2. Agar primary fail ho (network error, non-200, invalid JSON) ->
//      SECONDARY try karo (exchangerate-api)
//   3. Dono fail ho gaye -> rates ko UNCHANGED rehne do (purana data
//      stale ho jayega par BREAK nahi hoga) + staleness warning
//
// YE "DO SOURCE" DESIGN KYUN: agar ek free service band ho jaye (ya
// quota khatam ho), to system silently fail nahi hoga - dusra source
// automatically pick up kar lega.
//
// Hinglish comments: har block ka arth
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// RateFetcher do sources manage karta hai
type RateFetcher struct {
	// Base currency jiske against rates chahiye (usually INR)
	baseCurrency string
	// Currencies jinhe fetch karna hai
	targets []string
	// HTTP client - timeout ke saath
	client *http.Client
	// Secondary source ka API key (.env se, kabhi hardcoded nahi)
	apiKey string
}

// NewRateFetcher naya fetcher banata hai
func NewRateFetcher(baseCurrency string, targets []string, timeout time.Duration, apiKey string) *RateFetcher {
	return &RateFetcher{
		baseCurrency: strings.ToUpper(baseCurrency),
		targets:      targets,
		client:        &http.Client{Timeout: timeout},
		apiKey:        apiKey,
	}
}

// FetchAllResult - poora fetch result, source ke saath
type FetchAllResult struct {
	Rates        map[string]float64
	SourceUsed   string
	PrimaryErr   string
	SecondaryErr string
	FetchedAt    time.Time
}

// FetchAll pehle primary try karta hai, phir secondary
//
// RETURN: kon sa source succeed hua + saare rates
func (f *RateFetcher) FetchAll(ctx context.Context) (*FetchAllResult, error) {
	result := &FetchAllResult{
		Rates:     make(map[string]float64),
		FetchedAt: time.Now(),
	}

	// ---- STEP 1: PRIMARY (Frankfurter - free, no key) ----
	// Frankfurter ka API: https://api.frankfurter.app/latest?from=INR
	primaryURL := fmt.Sprintf(
		"https://api.frankfurter.app/latest?from=%s",
		f.baseCurrency,
	)

	rates, err := f.fetchFromFrankfurter(ctx, primaryURL)
	if err == nil && len(rates) > 0 {
		result.Rates = rates
		result.SourceUsed = "frankfurter"
		log.Printf("[CURRENCY-FETCH] PRIMARY source OK: %d rates from frankfurter", len(rates))
		return result, nil
	}

	result.PrimaryErr = err.Error()
	log.Printf("[CURRENCY-FETCH] PRIMARY (frankfurter) FAILED: %v - switching to secondary", err)

	// ---- STEP 2: SECONDARY (exchangerate-api - free tier with key) ----
	// API: https://v6.exchangerate-api.com/v6/{KEY}/latest/{CURRENCY}
	if f.apiKey == "" {
		result.SecondaryErr = "no API key configured for secondary source"
		log.Printf("[CURRENCY-FETCH] SECONDARY unavailable: %s", result.SecondaryErr)
		return result, fmt.Errorf("primary failed (%v) and secondary not configured", err)
	}

	secondaryURL := fmt.Sprintf(
		"https://v6.exchangerate-api.com/v6/%s/latest/%s",
		f.apiKey,
		f.baseCurrency,
	)

	rates, err = f.fetchFromExchangeRateAPI(ctx, secondaryURL)
	if err == nil && len(rates) > 0 {
		result.Rates = rates
		result.SourceUsed = "exchangerate-api"
		log.Printf("[CURRENCY-FETCH] SECONDARY source OK: %d rates from exchangerate-api (failover worked)", len(rates))
		return result, nil
	}

	result.SecondaryErr = err.Error()
	log.Printf("[CURRENCY-FETCH] SECONDARY (exchangerate-api) ALSO FAILED: %v", err)

	return result, fmt.Errorf("both sources failed - primary: %v | secondary: %v",
		result.PrimaryErr, result.SecondaryErr)
}

// fetchFromFrankfurter Frankfurter API se rates laata hai
//
// Response shape: { "amount": 1, "base": "INR", "date": "...", "rates": { "USD": 0.012, ... } }
func (f *RateFetcher) fetchFromFrankfurter(ctx context.Context, url string) (map[string]float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 status: %d", res.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var payload struct {
		Base  string             `json:"base"`
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	if len(payload.Rates) == 0 {
		return nil, fmt.Errorf("empty rates in response")
	}

	// Base currency ka rate hamesha 1.0 hota hai
	rates := make(map[string]float64, len(payload.Rates)+1)
	for code, rate := range payload.Rates {
		// Sirf wahi currencies rakho jo humein chahiye
		for _, target := range f.targets {
			if target == code {
				rates[code] = rate
				break
			}
		}
	}
	rates[f.baseCurrency] = 1.0

	return rates, nil
}

// fetchFromExchangeRateAPI exchangerate-api.com se rates laata hai
//
// Response shape: { "result": "success", "conversion_rates": { "USD": 83.2, ... }, ... }
// NOTE: ye API base currency ko INVERT karta hai - ye rates batati hain ki
// "1 unit of TARGET = X base". Hum isliye 1/X karke apna base->target rate banate hain.
func (f *RateFetcher) fetchFromExchangeRateAPI(ctx context.Context, url string) (map[string]float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 status: %d", res.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var payload struct {
		Result           string             `json:"result"`
		ErrorType        string             `json:"error-type"`
		ConversionRates  map[string]float64 `json:"conversion_rates"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	if payload.Result != "success" {
		return nil, fmt.Errorf("API returned error: %s", payload.ErrorType)
	}

	if len(payload.ConversionRates) == 0 {
		return nil, fmt.Errorf("empty conversion_rates in response")
	}

	rates := make(map[string]float64, len(f.targets)+1)
	for _, target := range f.targets {
		raw, ok := payload.ConversionRates[target]
		if !ok || raw == 0 {
			continue
		}

		// Ye API inverse deta hai (1 target = X base), humein chahiye
		// (1 base = X target), isliye 1/raw karte hain.
		// Base khud hamesha 1.0
		if target == f.baseCurrency {
			rates[target] = 1.0
		} else {
			rates[target] = 1.0 / raw
		}
	}

	return rates, nil
}

package service

// ============================================================================
// CURRENCY CLIENT - billing-service ka currency-service se bridge
// ============================================================================
//
// PURPOSE: Plan prices INR me store hote hain (base currency). Jab user US ya
// EUR se buy karta hai, price uske local currency me convert hota hai - aur WOHI
// currency-service se aata hai, kisi hardcoded rate se nahi.
//
// KYUN EK CLIENT: currency-service hi SSOT hai rates ka. Billing khud koi rate
// nahi rakhta, warna do jagah se rate aayega aur ek din mismatch hoga.
//
// FAIL-CLOSED DESIGN (ye zaroori hai): agar currency-service down hai ya rate
// STALE hai, to client ERROR deta hai. Zero rate nahi. Kyunki zero rate ka
// matlab "plan free hai" - aur ek network glitch ki wajah se koi paid plan free
// ho jaana sabse mehengi bug ho sakti hai.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

// CurrencyClient currency-service se convert karta hai.
type CurrencyClient struct {
	baseURL string
	client  *http.Client
	maxAge  time.Duration
}

// NewCurrencyClient naya client banata hai.
func NewCurrencyClient(baseURL string) *CurrencyClient {
	return &CurrencyClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  &http.Client{Timeout: 10 * time.Second},
		// A rate older than 48 ghante stale maana jaata hai. Currency-service
		// 24h par refresh karta hai, to 48h matlab "do consecutive refresh fail
		// hue" - aur tab koi price compute karna galat hoga.
		maxAge: 48 * time.Hour,
	}
}

// ConversionResult ek conversion ka result.
type ConversionResult struct {
	// Amount converted value hai, 2 decimal places par round (platform rule).
	Amount string
	// Currency quote currency code.
	Currency string
	// RateUsed actual rate jo laga.
	RateUsed float64
	// AgeSeconds rate ki age.
	AgeSeconds int64
}

// Convert amount ko `from` se `to` me badalta hai.
//
// SAME-CURRENCY SHORT-CIRCUIT: from == to ho to koi HTTP call nahi. Ye sirf
// optimization nahi hai - ye identity conversion hai, aur ek network round trip
// se seekhna ki 1 INR = 1 INR bewakoofi hogi.
func (c *CurrencyClient) Convert(
	ctx context.Context,
	amount int64,
	from, to string,
) (*ConversionResult, error) {
	from = strings.ToUpper(strings.TrimSpace(from))
	to = strings.ToUpper(strings.TrimSpace(to))

	if from == to {
		// Identity. Round to the platform's 2dp rule so the string form matches
		// what a real conversion would return.
		return &ConversionResult{
			Amount:     formatMinor(amount),
			Currency:   to,
			RateUsed:   1.0,
			AgeSeconds: 0,
		}, nil
	}

	// currency-service expects rupees, not paise. Our plan prices are stored in
	// paisa-like minor units (numeric 20,2 is rupees with paise), so convert:
	// 1000 rupees stored as "1000.00".
	reqBody, _ := json.Marshal(map[string]any{
		"amount": minorToRupees(amount),
		"from":   from,
		"to":     to,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/v1/convert", strings.NewReader(string(reqBody)))
	if err != nil {
		return nil, fmt.Errorf("currency convert: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		// FAIL-CLOSED: service down -> error, never a zero rate.
		return nil, fmt.Errorf("currency-service unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("currency-service body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("currency-service %d: %s", resp.StatusCode, string(body))
	}

	var payload struct {
		Converted     float64 `json:"converted"`
		RateUsed      float64 `json:"rate_used"`
		RateAgeSecond int64   `json:"rate_age_seconds"`
		Warning       string  `json:"warning"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("currency-service json: %w", err)
	}

	// STALE GUARD. This is THE check that makes the whole thing safe. A stale
	// rate means the number no longer describes reality, and charging it means
	// someone pays a price computed from data that stopped being true.
	if payload.RateAgeSecond > int64(c.maxAge.Seconds()) {
		return nil, fmt.Errorf("currency rate stale: %ds old (max %ds)",
			payload.RateAgeSecond, int64(c.maxAge.Seconds()))
	}

	return &ConversionResult{
		Amount:     roundTo2(payload.Converted),
		Currency:   to,
		RateUsed:  payload.RateUsed,
		AgeSeconds: payload.RateAgeSecond,
	}, nil
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

// minorToRupees converts a paise-like minor unit to rupees with 2dp.
//
// The plan prices are stored as numeric(20,2) - i.e. rupees - so "1000.00"
// IS 1000 rupees. The "minor unit" naming here is a legacy of the royalty code;
// the value passed in is the rupee figure already.
func minorToRupees(amount int64) float64 {
	return float64(amount)
}

// formatMinor formats rupees as a 2dp string, the platform rule.
func formatMinor(amount int64) string {
	return roundTo2(float64(amount))
}

// roundTo2 rounds to 2 decimal places, half-up (platform rule).
func roundTo2(v float64) string {
	shift := math.Pow(10, 2)
	rounded := math.Round(v*shift) / shift
	return fmt.Sprintf("%.2f", rounded)
}

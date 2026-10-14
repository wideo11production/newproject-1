package service

// ============================================================================
// PRICING RULES - country ko currency se map karta hai, price nikaalta hai
// ============================================================================
//
// PURPOSE: Ek plan ka price INR me hai. User US se aa raha hai -> use USD me
// dikhe. User Germany se -> EUR. Ye table karta hai wo mapping.
//
// KYUN YEH TABLE AUR KYUN RAW RATE NAHI:
// Purchasing power parity. ₹1000 ek Indian plan ka price hai. Raw rate pe woh
// ~$12 banta hai. US user ke liye $12 ek chhota number hai, par Indian user
// ke liye ₹1000 ek bada. To har currency ka apna EXPLICIT price hota hai, rate
// se derived nahi. Rate sirf conversion ke liye hai, pricing ke liye nahi.
//
// ISLIYE: `CountryPrices` explicit hain. `CountryCurrency` sirf mapping hai.

import (
	"fmt"
	"sort"
	"strings"
)

// PricingRules country-to-currency pricing table.
type PricingRules struct {
	// BaseCurrency default currency (INR). Jab country unknown ho to yahi use hoti hai.
	BaseCurrency string
	// CountryPrices per-currency EXPLICIT plan price.
	CountryPrices map[string]string
	// CountryCurrency currency-code to currency-code mapping (for display/labels).
	CountryCurrency map[string]string
}

// PricedPlan ek priced plan ka result.
type PricedPlan struct {
	// Amount final price, 2 decimal places.
	Amount string
	// Currency the amount's currency.
	Currency string
	// BaseAmount the INR price this was derived from.
	BaseAmount string
	// Reason why this currency was chosen (for audit/debugging).
	Reason string
}

// PriceFor returns the price for a country code.
//
// UNKNOWN COUNTRY FALLBACK: an unmapped country falls back to BaseCurrency.
// A pricing table that REFUSES to price is a blocked checkout - a lost sale,
// not a safe default. So the fallback is always the base price, always non-zero.
func (r *PricingRules) PriceFor(countryCode, basePrice string) PricedPlan {
	code := strings.ToUpper(strings.TrimSpace(countryCode))
	if code == "" {
		return r.fallback(basePrice, "empty country code")
	}

	// Is there an explicit price for this currency?
	if price, ok := r.CountryPrices[code]; ok {
		currency := code
		if mapped, mok := r.CountryCurrency[code]; mok {
			currency = mapped
		}
		return PricedPlan{
			Amount:      price,
			Currency:    currency,
			BaseAmount:  basePrice,
			Reason:      "explicit country price",
		}
	}

	// Unknown -> base.
	return r.fallback(basePrice, fmt.Sprintf("country %s not in pricing table", code))
}

// fallback prices in the base currency.
func (r *PricingRules) fallback(basePrice, reason string) PricedPlan {
	base := r.BaseCurrency
	if base == "" {
		base = "INR"
	}
	amount := basePrice
	if amount == "" {
		amount = "0.00"
	}
	return PricedPlan{
		Amount:     amount,
		Currency:   base,
		BaseAmount: basePrice,
		Reason:     reason,
	}
}

// SupportedCurrencies returns the sorted list of supported currency codes.
func (r *PricingRules) SupportedCurrencies() []string {
	out := make([]string, 0, len(r.CountryPrices))
	for code := range r.CountryPrices {
		out = append(out, code)
	}
	sort.Strings(out)
	return out
}

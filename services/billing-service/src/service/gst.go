// GST & Payments Engine — fully automated tax + sister share allocation.
//
// YE MODULE India GST ka POORA math implement karta hai:
//   - IGST (interstate): 18% ek compartment me
//   - CGST+SGST (intrastate): 9% + 9% do compartments me
//
// Sister share (5%) NET revenue (post-tax) se nikalta hai —
// kyunki GST platform ka expense hai, deductible hai, isliye
// gross se nahi — net (after-GST) se nikalna hai.
//
// Pure logic — DB/network nahi, isliye unit-testable hai bina
// database ke. (ad-economics.go jaise hi pattern follow karta hai.)
//
// Hinglish comments: har block ka arth
package service

import (
	"fmt"
	"strings"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// GST rates & constants
// ---------------------------------------------------------------------------

// India GST rate for digital services / SaaS: 18%.
// Hinglish: 18% standard rate — most digital services ko yahi rate milta hai.
const IndiaGstRatePercent = 18

// CgstSgstEachPercent: 18% ka half = 9%. Intrastate me CGST + SGST = 18%.
const CgstSgstEachPercent = 9

// ---------------------------------------------------------------------------
// GST config — business ka registered state + GSTIN
// ---------------------------------------------------------------------------

// GstConfig — business ka GST registration state.
//
// Hinglish: agar customer ka state business ke state SE same hai
// to CGST+SGST (intrastate), nahi to IGST (interstate).
// GSTIN sirf invoice pe print ke liye — calculation ke liye
// sirf state code chahiye.
type GstConfig struct {
	// BusinessStateCode — 2-digit GST state code (e.g. "07" = Delhi, "27" = Maharashtra).
	BusinessStateCode string
	// BusinessStateName — human-readable (invoice display ke liye).
	BusinessStateName string
	// Gstin — 15-char business GSTIN (invoice pe print).
	Gstin string
}

// ---------------------------------------------------------------------------
// GSTIN validation (15-char format)
// ---------------------------------------------------------------------------

// ValidateGSTIN 15-character Indian GSTIN format check karta hai.
//
// Format: 2-digit state code + 10-digit PAN + 1-digit entity + "Z" + 1 check digit
// Total: 15 characters, alphanumeric.
//
// Hinglish: ye sirf FORMAT check karta hai — checksum verify nahi karta
// (checksum ke liye ek separate algo hai jo 96-line modulus se hota hai).
// Format check hi security ki zaroorat hai — galat GSTIN = invoice reject.
func ValidateGSTIN(gstin string) error {
	gstin = strings.ToUpper(strings.TrimSpace(gstin))
	if len(gstin) != 15 {
		return fmt.Errorf("gstin must be 15 characters, got %d", len(gstin))
	}
	// State code: first 2 chars digits hona chahiye
	if !isDigits(gstin[:2]) {
		return fmt.Errorf("gstin state code (first 2 chars) must be digits, got %q", gstin[:2])
	}
	// PAN: chars 3-12 (positions 2-11, 10 digits, alphanumeric)
	if !isAlphaNumeric(gstin[2:12]) {
		return fmt.Errorf("gstin PAN segment (chars 3-12) must be alphanumeric")
	}
	// Entity code: char 13 (position 12) — 0-9 or Z
	if !isDigit(gstin[12]) && gstin[12] != 'Z' {
		return fmt.Errorf("gstin entity code (char 13) must be digit or Z, got %q", string(gstin[12]))
	}
	// Char 14 (position 13) — always "Z" for GST
	if gstin[13] != 'Z' {
		return fmt.Errorf("gstin char 14 must be 'Z' for GST, got %q", string(gstin[13]))
	}
	// Check digit: char 15 (position 14) — alphanumeric
	if !isAlphaNumeric(string(gstin[14])) {
		return fmt.Errorf("gstin check digit (char 15) must be alphanumeric")
	}
	return nil
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isDigit(c byte) bool {
	return c >= '0' && c <= '9'
}

func isAlphaNumeric(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// GST rate lookup
// ---------------------------------------------------------------------------

// GstRateForCountry — country code se GST rate nikalta hai.
//
// User directive: India INR = 18% GST, foreign = 0% (no Indian GST).
// Foreign countries apni tax system (VAT/etc) use karte hain —
// India GST engine sirf India ke liye kaam karta hai.
func GstRateForCountry(countryCode string) decimal.Decimal {
	if strings.ToUpper(strings.TrimSpace(countryCode)) == "IN" {
		return decimal.NewFromInt(IndiaGstRatePercent)
	}
	return decimal.Zero // foreign = no Indian GST
}

// ---------------------------------------------------------------------------
// Intra vs Inter state classification
// ---------------------------------------------------------------------------

// IsIntraState — customer aur business same state mein?
//
// Hinglish: same state code = intrastate (CGST+SGST split),
// different = interstate (IGST ek compartment me).
func (cfg *GstConfig) IsIntraState(customerStateCode string) bool {
	return strings.EqualFold(
		strings.TrimSpace(cfg.BusinessStateCode),
		strings.TrimSpace(customerStateCode),
	)
}

// ---------------------------------------------------------------------------
// GST calculation — single item
// ---------------------------------------------------------------------------

// GstBreakdown — ek item ka tax breakdown.
type GstBreakdown struct {
	// Hinglish: ye teeno mein se sirf do non-zero hote hain:
	// intrastate → Cgst+Sgst (IGST zero)
	// interstate → Igst (Cgst+Sgst zero)
	Cgst decimal.Decimal `json:"cgst"`
	Sgst decimal.Decimal `json:"sgst"`
	Igst decimal.Decimal `json:"igst"`
	// TotalGST — always = rate × amount (rounding-safe).
	TotalGst decimal.Decimal `json:"total_gst"`
	// RateApplied — percentage that was applied (e.g. 18 for 18%).
	RateApplied decimal.Decimal `json:"rate_applied"`
	// TaxType — "cgst_sgst" ya "igst".
	TaxType string `json:"tax_type"`
}

// CalculateGstForItem ek item par GST calculate karta hai.
//
// Rules:
//   - Intrastate (same state): 9% CGST + 9% SGST
//   - Interstate (diff state): 18% IGST (ek compartment)
//   - Foreign country: 0% (return empty breakdown)
//   - Non-IN country: 0% (return empty breakdown)
//
// Hinglish: rate lookup → split → rounding fix (CGST+SGST = IGST exactly).
func (cfg *GstConfig) CalculateGstForItem(amount decimal.Decimal, customerStateCode, countryCode string) GstBreakdown {
	rate := GstRateForCountry(countryCode)
	if rate.IsZero() {
		return GstBreakdown{
			Cgst:       decimal.Zero,
			Sgst:       decimal.Zero,
			Igst:       decimal.Zero,
			TotalGst:   decimal.Zero,
			RateApplied: decimal.Zero,
			TaxType:    "none",
		}
	}

	totalTax := money(amount.Mul(rate).Div(decimal.NewFromInt(100)))
	rateApplied := rate

	var cgst, sgst, igst decimal.Decimal
	var taxType string

	if cfg.IsIntraState(customerStateCode) {
		// Intrastate: split equally CGST + SGST
		cgst = money(amount.Mul(decimal.NewFromInt(CgstSgstEachPercent)).Div(decimal.NewFromInt(100)))
		sgst = money(amount.Mul(decimal.NewFromInt(CgstSgstEachPercent)).Div(decimal.NewFromInt(100)))
		igst = decimal.Zero
		taxType = "cgst_sgst"
		// Rounding fix: CGST + SGST should exactly equal totalTax.
		// Agar 1-paisa diff ho to SGST me adjust.
		delta := money(totalTax.Sub(cgst.Add(sgst)))
		if !delta.IsZero() {
			sgst = money(sgst.Add(delta))
		}
	} else {
		// Interstate: IGST ek compartment
		cgst = decimal.Zero
		sgst = decimal.Zero
		igst = totalTax
		taxType = "igst"
	}

	return GstBreakdown{
		Cgst:       cgst,
		Sgst:       sgst,
		Igst:       igst,
		TotalGst:   totalTax,
		RateApplied: rateApplied,
		TaxType:    taxType,
	}
}

// ---------------------------------------------------------------------------
// Complete invoice-level GST computation
// ---------------------------------------------------------------------------

// GstInvoiceItem — ek invoice line item ke saath quantity+price.
type GstInvoiceItem struct {
	Description string
	Quantity    int64
	UnitPrice   decimal.Decimal
}

// GstLineItemBreakdown — line item ke saath uska tax breakdown.
type GstLineItemBreakdown struct {
	GstInvoiceItem
	LineTotal   decimal.Decimal `json:"line_total"`
	Cgst        decimal.Decimal `json:"cgst"`
	Sgst        decimal.Decimal `json:"sgst"`
	Igst        decimal.Decimal `json:"igst"`
	TotalGst    decimal.Decimal `json:"total_gst"`
	LineItemTax decimal.Decimal `json:"line_item_tax"` // = line_total + total_gst
}

// GstInvoiceBreakdown — pura invoice breakdown, tax + amounts.
type GstInvoiceBreakdown struct {
	Items       []GstLineItemBreakdown `json:"items"`
	// Subtotal — all line items ka total (before tax).
	Subtotal      decimal.Decimal `json:"subtotal"`
	// TotalCGST/SGST/IGST — sum of all items.
	TotalCGST     decimal.Decimal `json:"total_cgst"`
	TotalSGST     decimal.Decimal `json:"total_sgst"`
	TotalIGST     decimal.Decimal `json:"total_igst"`
	// TotalGST — sum of all item taxes.
	TotalGST      decimal.Decimal `json:"total_gst"`
	// TotalAmount — subtotal + total_gst.
	TotalAmount   decimal.Decimal `json:"total_amount"`
	// TaxType — "cgst_sgst" ya "igst" (sab items same type hote hain).
	TaxType       string          `json:"tax_type"`
	// RateApplied — rate jise sab items par apply hua (e.g. 18).
	RateApplied   decimal.Decimal `json:"rate_applied"`
}

// CalculateGstInvoice complete invoice ka GST breakdown karta hai.
//
// Hinglish: sab items same state me honge (ek invoice ek customer
// state pe depend karta hai), isliye sabhi items same CGST/SGST ya
// IGST me se ek hi type me hote hain. Rounding: har item alag round
// hota hai, phir totals sum hote hain — industry standard.
func (cfg *GstConfig) CalculateGstInvoice(items []GstInvoiceItem, customerStateCode, countryCode string) GstInvoiceBreakdown {
	rate := GstRateForCountry(countryCode)
	taxType := "none"
	if rate.GreaterThan(decimal.Zero) {
		if cfg.IsIntraState(customerStateCode) {
			taxType = "cgst_sgst"
		} else {
			taxType = "igst"
		}
	}

	breakdown := GstInvoiceBreakdown{
		Items:       make([]GstLineItemBreakdown, 0, len(items)),
		RateApplied: rate,
		TaxType:     taxType,
	}

	for _, item := range items {
		lineTotal := money(decimal.NewFromInt(item.Quantity).Mul(item.UnitPrice))
		gst := cfg.CalculateGstForItem(lineTotal, customerStateCode, countryCode)

		breakdown.Items = append(breakdown.Items, GstLineItemBreakdown{
			GstInvoiceItem: item,
			LineTotal:      lineTotal,
			Cgst:           gst.Cgst,
			Sgst:           gst.Sgst,
			Igst:           gst.Igst,
			TotalGst:       gst.TotalGst,
			LineItemTax:    money(lineTotal.Add(gst.TotalGst)),
		})

		breakdown.Subtotal = breakdown.Subtotal.Add(lineTotal)
		breakdown.TotalCGST = breakdown.TotalCGST.Add(gst.Cgst)
		breakdown.TotalSGST = breakdown.TotalSGST.Add(gst.Sgst)
		breakdown.TotalIGST = breakdown.TotalIGST.Add(gst.Igst)
		breakdown.TotalGST = breakdown.TotalGST.Add(gst.TotalGst)
	}

	breakdown.TotalAmount = money(breakdown.Subtotal.Add(breakdown.TotalGST))
	breakdown.TotalCGST = money(breakdown.TotalCGST)
	breakdown.TotalSGST = money(breakdown.TotalSGST)
	breakdown.TotalIGST = money(breakdown.TotalIGST)
	breakdown.TotalGST = money(breakdown.TotalGST)

	return breakdown
}

// ---------------------------------------------------------------------------
// Sister share integration (5% of NET revenue)
// ---------------------------------------------------------------------------

// GstWithSisterShare — invoice breakdown + 5% sister share calculation.
//
// Hinglish: sister share GROSS se nahi, NET (post-tax) se nikalta hai.
// Kyunki GST platform ka deductible expense hai — sister share us
// net earning pe 5% lega jisme tax pehle se nikal chuka hai.
type GstWithSisterShare struct {
	GstInvoiceBreakdown
	// NetRevenue — TotalAmount minus TotalGST.
	NetRevenue decimal.Decimal `json:"net_revenue"`
	// SisterShareAmount — 5% of NetRevenue.
	SisterShareAmount decimal.Decimal `json:"sister_share_amount"`
	// AfterSisterShare — NetRevenue minus SisterShare.
	// Yehi amount creator/wallet ko milega.
	AfterSisterShare decimal.Decimal `json:"after_sister_share"`
}

// CalculateGstWithSisterShare invoice ke saath 5% sister share bhi compute karta hai.
//
// User directive: "sister share hamesha lagta rahe" (always 5%, never bypassed).
// User directive: "GST & Payments Engine (Fully automated with the mandatory
// 5% sister dynamic revenue share allocation rules)".
func (cfg *GstConfig) CalculateGstWithSisterShare(items []GstInvoiceItem, customerStateCode, countryCode string) GstWithSisterShare {
	gst := cfg.CalculateGstInvoice(items, customerStateCode, countryCode)

	netRevenue := money(gst.Subtotal.Sub(gst.TotalGST))
	// Hinglish: NET = subtotal - tax (GST platform ka expense).
	// Agar negative ho gaya (unlikely, but edge case) to zero.
	if netRevenue.LessThan(decimal.Zero) {
		netRevenue = decimal.Zero
	}

	sisterShare := money(netRevenue.Mul(decimal.NewFromFloat(5.0)).Div(decimal.NewFromInt(100)))
	afterSister := money(netRevenue.Sub(sisterShare))

	return GstWithSisterShare{
		GstInvoiceBreakdown: gst,
		NetRevenue:          netRevenue,
		SisterShareAmount:   sisterShare,
		AfterSisterShare:    afterSister,
	}
}

// ---------------------------------------------------------------------------
// Helper: Indian 2-digit state codes
// ---------------------------------------------------------------------------

// IndianStateCode — common Indian state GST codes.
type IndianStateCode struct {
	Code string
	Name string
}

// MajorIndianStates — top 10 + UT codes for dropdown.
var MajorIndianStates = []IndianStateCode{
	{Code: "01", Name: "Jammu & Kashmir"},
	{Code: "02", Name: "Himachal Pradesh"},
	{Code: "03", Name: "Ladakh"},
	{Code: "05", Name: "Uttarakhand"},
	{Code: "07", Name: "Delhi"},
	{Code: "09", Name: "Uttar Pradesh"},
	{Code: "11", Name: "Bihar"},
	{Code: "16", Name: "Karnataka"},
	{Code: "19", Name: "West Bengal"},
	{Code: "24", Name: "Gujarat"},
	{Code: "27", Name: "Maharashtra"},
	{Code: "29", Name: "Tamil Nadu"},
	{Code: "38", Name: "Telangana"},
}

// LookupStateName — code se state name nikalta hai (invoice display ke liye).
func LookupStateName(code string) string {
	for _, s := range MajorIndianStates {
		if s.Code == strings.TrimSpace(code) {
			return s.Name
		}
	}
	return "Unknown"
}

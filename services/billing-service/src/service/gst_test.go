// GST engine tests — rate lookup, intra/inter-state split, rounding,
// GSTIN validation, sister share integration.
//
// Hinglish: ye tests GST ka poora math lock karte hain — billing me
// galat GST = compliance violation, isliye exhaustive hota hai.
// Pure logic — database ke bina (ad-economics_test.go jaise).
package service

import (
	"testing"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// GST rate lookup
// ---------------------------------------------------------------------------

func TestGstRateForCountry_India18Percent(t *testing.T) {
	rate := GstRateForCountry("IN")
	if !rate.Equal(decimal.NewFromInt(18)) {
		t.Errorf("IN rate: expected 18, got %s", rate.String())
	}
}

func TestGstRateForCountry_ForeignZero(t *testing.T) {
	for _, c := range []string{"US", "GB", "DE", "JP", "AE"} {
		rate := GstRateForCountry(c)
		if !rate.IsZero() {
			t.Errorf("foreign %s: expected 0, got %s", c, rate.String())
		}
	}
}

func TestGstRateForCountry_CaseInsensitive(t *testing.T) {
	if !GstRateForCountry("in").Equal(decimal.NewFromInt(18)) {
		t.Error("lowercase 'in' should still resolve to 18%")
	}
	if !GstRateForCountry("  in  ").Equal(decimal.NewFromInt(18)) {
		t.Error("whitespace 'in' should still resolve to 18%")
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Intra vs Inter state
// ---------------------------------------------------------------------------

func TestIsIntraState_SameState(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27", BusinessStateName: "Maharashtra"}
	if !cfg.IsIntraState("27") {
		t.Error("same state code must be intrastate")
	}
	if !cfg.IsIntraState("  27  ") {
		t.Error("whitespace state code should still match")
	}
	if !cfg.IsIntraState("27") {
		t.Error("case should not matter for state code")
	}
}

func TestIsIntraState_DifferentState(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27", BusinessStateName: "Maharashtra"}
	if cfg.IsIntraState("07") {
		t.Error("different state code must be interstate")
	}
}

// ---------------------------------------------------------------------------
// Single-item GST calculation
// ---------------------------------------------------------------------------

func TestCalculateGstForItem_Intrastate(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"} // Maharashtra
	amount := decimal.NewFromInt(1000)
	gst := cfg.CalculateGstForItem(amount, "27", "IN")

	// CGST + SGST = 9% + 9% = 18%
	if !gst.Cgst.Equal(decimal.NewFromInt(90)) {
		t.Errorf("CGST: expected 90, got %s", gst.Cgst.String())
	}
	if !gst.Sgst.Equal(decimal.NewFromInt(90)) {
		t.Errorf("SGST: expected 90, got %s", gst.Sgst.String())
	}
	if !gst.Igst.IsZero() {
		t.Errorf("IGST must be 0 for intrastate, got %s", gst.Igst.String())
	}
	if !gst.TotalGst.Equal(decimal.NewFromInt(180)) {
		t.Errorf("TotalGST: expected 180, got %s", gst.TotalGst.String())
	}
	if gst.TaxType != "cgst_sgst" {
		t.Errorf("TaxType: expected cgst_sgst, got %s", gst.TaxType)
	}
}

func TestCalculateGstForItem_Interstate(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"} // Maharashtra
	amount := decimal.NewFromInt(1000)
	gst := cfg.CalculateGstForItem(amount, "07", "IN") // Delhi (interstate)

	// IGST = 18%
	if !gst.Igst.Equal(decimal.NewFromInt(180)) {
		t.Errorf("IGST: expected 180, got %s", gst.Igst.String())
	}
	if !gst.Cgst.IsZero() {
		t.Errorf("CGST must be 0 for interstate, got %s", gst.Cgst.String())
	}
	if !gst.Sgst.IsZero() {
		t.Errorf("SGST must be 0 for interstate, got %s", gst.Sgst.String())
	}
	if !gst.TotalGst.Equal(decimal.NewFromInt(180)) {
		t.Errorf("TotalGST: expected 180, got %s", gst.TotalGst.String())
	}
	if gst.TaxType != "igst" {
		t.Errorf("TaxType: expected igst, got %s", gst.TaxType)
	}
}

func TestCalculateGstForItem_ForeignZero(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	amount := decimal.NewFromInt(1000)
	gst := cfg.CalculateGstForItem(amount, "27", "US")

	if !gst.TotalGst.IsZero() {
		t.Errorf("foreign must have zero GST, got %s", gst.TotalGst.String())
	}
	if gst.TaxType != "none" {
		t.Errorf("foreign TaxType must be 'none', got %s", gst.TaxType)
	}
}

func TestCalculateGstForItem_CgstSgstSumEqualsTotal(t *testing.T) {
	// Hinglish: rounding fix ensure karta hai ki CGST+SGST = TotalGST exactly.
	cfg := &GstConfig{BusinessStateCode: "27"}
	amount := decimal.RequireFromString("333.33")
	gst := cfg.CalculateGstForItem(amount, "27", "IN")

	sum := gst.Cgst.Add(gst.Sgst)
	if !sum.Equal(gst.TotalGst) {
		t.Errorf("CGST+SGST (%s) != TotalGST (%s) — rounding fix failed", sum.String(), gst.TotalGst.String())
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Invoice-level GST
// ---------------------------------------------------------------------------

func TestCalculateGstInvoice_IntrastateBreakdown(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
		{Description: "Extra Seats", Quantity: 3, UnitPrice: decimal.NewFromInt(500)}, // 1500
	}
	result := cfg.CalculateGstInvoice(items, "27", "IN")

	// Subtotal: 1000 + 1500 = 2500
	if !result.Subtotal.Equal(decimal.NewFromInt(2500)) {
		t.Errorf("Subtotal: expected 2500, got %s", result.Subtotal.String())
	}
	// TotalGST: 18% of 2500 = 450
	if !result.TotalGST.Equal(decimal.NewFromInt(450)) {
		t.Errorf("TotalGST: expected 450, got %s", result.TotalGST.String())
	}
	// TotalAmount: 2500 + 450 = 2950
	if !result.TotalAmount.Equal(decimal.NewFromInt(2950)) {
		t.Errorf("TotalAmount: expected 2950, got %s", result.TotalAmount.String())
	}
	// Tax type
	if result.TaxType != "cgst_sgst" {
		t.Errorf("expected cgst_sgst, got %s", result.TaxType)
	}
}

func TestCalculateGstInvoice_InterstateBreakdown(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
	}
	result := cfg.CalculateGstInvoice(items, "07", "IN") // interstate

	// IGST = 18% of 1000 = 180
	if !result.TotalIGST.Equal(decimal.NewFromInt(180)) {
		t.Errorf("IGST: expected 180, got %s", result.TotalIGST.String())
	}
	// TotalAmount = 1180
	if !result.TotalAmount.Equal(decimal.NewFromInt(1180)) {
		t.Errorf("TotalAmount: expected 1180, got %s", result.TotalAmount.String())
	}
}

func TestCalculateGstInvoice_ForeignZeroTax(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
	}
	result := cfg.CalculateGstInvoice(items, "27", "US")

	if !result.TotalGST.IsZero() {
		t.Errorf("foreign must have zero GST, got %s", result.TotalGST.String())
	}
	if !result.TotalAmount.Equal(decimal.NewFromInt(1000)) {
		t.Errorf("foreign TotalAmount: expected 1000, got %s", result.TotalAmount.String())
	}
	if result.TaxType != "none" {
		t.Errorf("foreign TaxType: expected none, got %s", result.TaxType)
	}
}

func TestCalculateGstInvoice_EmptyItems(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	result := cfg.CalculateGstInvoice(nil, "27", "IN")

	if !result.Subtotal.IsZero() {
		t.Error("empty items should have zero subtotal")
	}
	if !result.TotalAmount.IsZero() {
		t.Error("empty items should have zero total")
	}
}

func TestCalculateGstInvoice_QuantityAndUnitPrice(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Seats", Quantity: 5, UnitPrice: decimal.NewFromInt(200)}, // 1000
	}
	result := cfg.CalculateGstInvoice(items, "27", "IN")

	// 5 × 200 = 1000, GST 180, total 1180
	if !result.Subtotal.Equal(decimal.NewFromInt(1000)) {
		t.Errorf("Subtotal: expected 1000, got %s", result.Subtotal.String())
	}
	if result.Items[0].LineTotal.Equal(decimal.NewFromInt(1000)) {
		// good
	} else {
		t.Errorf("LineItem: expected 1000, got %s", result.Items[0].LineTotal.String())
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GSTIN validation
// ---------------------------------------------------------------------------

func TestValidateGSTIN_Valid(t *testing.T) {
	// 15 chars: 2-digit state code + 10-char PAN + 1-digit entity + "Z" + 1 check digit
	// Hinglish: "27AABBCCDDEE1Z0" = 27(Maharashtra) + AABBCCDDEE(PAN) + 1(entity) + Z + 0(check)
	if err := ValidateGSTIN("27AABBCCDDEE1Z0"); err != nil {
		t.Errorf("valid GSTIN should pass: %v", err)
	}
}

func TestValidateGSTIN_ValidLowercase(t *testing.T) {
	if err := ValidateGSTIN("27aabbccddee1z0"); err != nil {
		t.Errorf("lowercase GSTIN should pass: %v", err)
	}
}

func TestValidateGSTIN_InvalidLength(t *testing.T) {
	if err := ValidateGSTIN("27ABC"); err == nil {
		t.Error("short GSTIN should fail")
	}
	if err := ValidateGSTIN("27AABBCCDDEE1Z01"); err == nil {
		t.Error("16-char GSTIN should fail (must be exactly 15)")
	}
}

func TestValidateGSTIN_InvalidStateCode(t *testing.T) {
	if err := ValidateGSTIN("ABAABBCCDDEE1Z0"); err == nil {
		t.Error("non-digit state code should fail")
	}
}

func TestValidateGSTIN_InvalidChar14(t *testing.T) {
	// char 14 (position 14, index 13) must be "Z" for GST
	if err := ValidateGSTIN("27AABBCCDDEE1X0"); err == nil {
		t.Error("char 14 != Z should fail")
	}
}

func TestValidateGSTIN_WhitespaceTrimmed(t *testing.T) {
	if err := ValidateGSTIN("  27AABBCCDDEE1Z0  "); err != nil {
		t.Errorf("whitespace-padded GSTIN should pass: %v", err)
	}
}

func TestValidateGSTIN_EntityCodeAcceptsZ(t *testing.T) {
	// char 13 (entity code) can be a digit OR 'Z'
	if err := ValidateGSTIN("27AABBCCDDEEZZ1"); err != nil {
		t.Errorf("entity code 'Z' should pass: %v", err)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sister share integration
// ---------------------------------------------------------------------------

func TestCalculateGstWithSisterShare_Intrastate(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
	}
	result := cfg.CalculateGstWithSisterShare(items, "27", "IN")

	// Subtotal = 1000, GST = 180, NetRevenue = 820
	if !result.NetRevenue.Equal(decimal.NewFromInt(820)) {
		t.Errorf("NetRevenue: expected 820 (1000-180), got %s", result.NetRevenue.String())
	}
	// SisterShare = 5% of 820 = 41
	if !result.SisterShareAmount.Equal(decimal.RequireFromString("41")) {
		t.Errorf("SisterShare: expected 41, got %s", result.SisterShareAmount.String())
	}
	// AfterSisterShare = 820 - 41 = 779
	if !result.AfterSisterShare.Equal(decimal.RequireFromString("779")) {
		t.Errorf("AfterSisterShare: expected 779, got %s", result.AfterSisterShare.String())
	}
}

func TestCalculateGstWithSisterShare_Interstate(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
	}
	result := cfg.CalculateGstWithSisterShare(items, "07", "IN") // interstate

	// NetRevenue = 820 (same as intrastate — GST rate is same)
	if !result.NetRevenue.Equal(decimal.NewFromInt(820)) {
		t.Errorf("NetRevenue: expected 820, got %s", result.NetRevenue.String())
	}
	// SisterShare = 5% of 820 = 41
	if !result.SisterShareAmount.Equal(decimal.RequireFromString("41")) {
		t.Errorf("SisterShare: expected 41, got %s", result.SisterShareAmount.String())
	}
	// TaxType should be IGST
	if result.TaxType != "igst" {
		t.Errorf("expected igst tax type, got %s", result.TaxType)
	}
}

func TestCalculateGstWithSisterShare_ForeignZeroTax(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.NewFromInt(1000)},
	}
	result := cfg.CalculateGstWithSisterShare(items, "27", "US")

	// Foreign: no GST, so NetRevenue = 1000, SisterShare = 50
	if !result.NetRevenue.Equal(decimal.NewFromInt(1000)) {
		t.Errorf("NetRevenue: expected 1000, got %s", result.NetRevenue.String())
	}
	if !result.SisterShareAmount.Equal(decimal.NewFromInt(50)) {
		t.Errorf("SisterShare: expected 50, got %s", result.SisterShareAmount.String())
	}
	if !result.AfterSisterShare.Equal(decimal.NewFromInt(950)) {
		t.Errorf("AfterSisterShare: expected 950, got %s", result.AfterSisterShare.String())
	}
}

func TestCalculateGstWithSisterShare_Rounding(t *testing.T) {
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		// Amount that produces fractional paise: 333.33
		{Description: "Pro Plan", Quantity: 1, UnitPrice: decimal.RequireFromString("333.33")},
	}
	result := cfg.CalculateGstWithSisterShare(items, "27", "IN")

	// 333.33 × 18% = 59.9994 → rounds to 60.00
	// NetRevenue = 333.33 - 60.00 = 273.33
	// SisterShare = 5% of 273.33 = 13.6665 → rounds to 13.67
	// AfterSister = 273.33 - 13.67 = 259.66
	// Check that amounts sum correctly:
	total := result.NetRevenue
	sister := result.SisterShareAmount
	after := result.AfterSisterShare
	if !total.Sub(sister).Equal(after) {
		t.Errorf("rounding mismatch: net(%s) - sister(%s) != after(%s)",
			total.String(), sister.String(), after.String())
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State lookup helper
// ---------------------------------------------------------------------------

func TestLookupStateName_Known(t *testing.T) {
	name := LookupStateName("27")
	if name != "Maharashtra" {
		t.Errorf("expected Maharashtra, got %s", name)
	}
}

func TestLookupStateName_Unknown(t *testing.T) {
	name := LookupStateName("99")
	if name != "Unknown" {
		t.Errorf("expected Unknown, got %s", name)
	}
}

func TestLookupStateName_MumbaiAlias(t *testing.T) {
	// Code 27 = Maharashtra (Mumbai is part of Maharashtra, no separate code)
	name := LookupStateName("27")
	if name != "Maharashtra" {
		t.Errorf("expected Maharashtra, got %s", name)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// money helper test (from service.go)
// ---------------------------------------------------------------------------

func TestMoneyRounding(t *testing.T) {
	// money() should round to 2 decimal places
	val := decimal.RequireFromString("123.456")
	got := money(val)
	if !got.Equal(decimal.RequireFromString("123.46")) {
		t.Errorf("money(123.456) = %s, expected 123.46", got.String())
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Full invoice math — verify all amounts are consistent
// ---------------------------------------------------------------------------

func TestGstWithSisterShare_ConservationLaw(t *testing.T) {
	// User directive: no money created or destroyed.
	// Subtotal = NetRevenue + TotalGST
	// NetRevenue = SisterShare + AfterSisterShare
	cfg := &GstConfig{BusinessStateCode: "27"}
	items := []GstInvoiceItem{
		{Description: "Plan A", Quantity: 2, UnitPrice: decimal.RequireFromString("499.99")},
		{Description: "Seats", Quantity: 5, UnitPrice: decimal.RequireFromString("150.00")},
	}
	result := cfg.CalculateGstWithSisterShare(items, "09", "IN") // interstate (UP)

	// Conservation 1: Subtotal = NetRevenue + GST
	subtotal := result.Subtotal
	netPlusTax := result.NetRevenue.Add(result.TotalGST)
	if !subtotal.Equal(netPlusTax) {
		t.Errorf("CONSERVATION FAIL: Subtotal(%s) != NetRevenue(%s) + GST(%s) = %s",
			subtotal.String(), result.NetRevenue.String(), result.TotalGST.String(), netPlusTax.String())
	}

	// Conservation 2: NetRevenue = SisterShare + AfterSisterShare
	reconstructed := result.SisterShareAmount.Add(result.AfterSisterShare)
	if !reconstructed.Equal(result.NetRevenue) {
		t.Errorf("CONSERVATION FAIL: Sister(%s) + After(%s) = %s != Net(%s)",
			result.SisterShareAmount.String(), result.AfterSisterShare.String(),
			reconstructed.String(), result.NetRevenue.String())
	}

	// Conservation 3: TotalAmount = Subtotal + TotalTax
	if !result.TotalAmount.Equal(subtotal.Add(result.TotalGST)) {
		t.Errorf("CONSERVATION FAIL: TotalAmount mismatch")
	}
}

func TestGstWithSisterShare_AlwaysExactly5Percent(t *testing.T) {
	// User directive: "hamesha lagta rahe" — sister share must ALWAYS be 5%.
	cfg := &GstConfig{BusinessStateCode: "27"}
	amounts := []string{"100", "500", "999.99", "10000", "0.01"}
	for _, amt := range amounts {
		items := []GstInvoiceItem{
			{Description: "X", Quantity: 1, UnitPrice: decimal.RequireFromString(amt)},
		}
		result := cfg.CalculateGstWithSisterShare(items, "27", "IN")
		expected := money(result.NetRevenue.Mul(decimal.NewFromFloat(5.0)).Div(decimal.NewFromInt(100)))
		if !result.SisterShareAmount.Equal(expected) {
			t.Errorf("amount %s: sister share expected %s, got %s (must be exactly 5%%)",
				amt, expected.String(), result.SisterShareAmount.String())
		}
	}
}

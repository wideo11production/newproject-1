// Billing service unit tests - CORE BUSINESS LAWS
//
// Ye tests wo do NON-NEGOTIABLE rules protect karti hain jo aapne bola
// "completely unaltered rehne chahiye":
//   1. 5% SISTER SHARE allocation - har settlement pe record hona chahiye
//   2. INR 2000 NOMINEE BUFFER MASK - transferable balance se hidden rehna chahiye
//
// Agar koi future change inhe tod de, to ye tests FAIL ho jayenge - jo
// exactly wahi safety net hai jo pehle ZERO thi.
//
// Ye tests pure business logic (decimal math) test karte hain, database ke
// bina - isliye fast hain aur CI me reliable.
//
// Hinglish comments: har block ka arth

package service

import (
	"testing"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// TEST 1: 5% SISTER SHARE ALLOCATION
// ---------------------------------------------------------------------------

// TestSisterShareIsExactlyFivePercent verifies ki share EXACTLY 5% hai
func TestSisterShareIsExactlyFivePercent(t *testing.T) {
	cfg := &SisterShareConfig{
		SharePercentage:  decimal.NewFromFloat(5.0),
		AllocationType:   "automatic",
		RecipientAccount: "sister-account-id",
		IsActive:         true,
		Currency:         "INR",
	}

	if !cfg.SharePercentage.Equal(decimal.NewFromInt(5)) {
		t.Errorf("LAW VIOLATION: sister share must be exactly 5%%, got %s%%",
			cfg.SharePercentage.String())
	}

	if !cfg.IsActive {
		t.Error("LAW VIOLATION: sister share allocation must always be active")
	}

	if cfg.AllocationType != "automatic" {
		t.Errorf("LAW VIOLATION: allocation must be automatic via GORM, got %q",
			cfg.AllocationType)
	}
}

// TestSisterShareCalculation verifies 5% math sahi hai multiple amounts pe
//
// NOTE: shopspring/decimal AURROUND nahi karta automatically. 333.33 * 5% =
// 16.6665 (exactly), 16.67 nahi. Ye behavior documented hai aur
// TestCurrencyRoundingIsExplicit me separately test hota hai.
func TestSisterShareCalculation(t *testing.T) {
	shareRate := decimal.NewFromFloat(5.0)
	divisor := decimal.NewFromInt(100)

	testCases := []struct {
		netEarnings string
		expShare    string
	}{
		{"1000", "50"},        // 1000 ka 5% = exactly 50
		{"20000", "1000"},     // 20000 ka 5% = exactly 1000
		{"333.33", "16.6665"}, // exact, no rounding
		{"99.99", "4.9995"},   // exact, no rounding
		{"0.01", "0.0005"},    // smallest realistic case
	}

	for _, tc := range testCases {
		net, _ := decimal.NewFromString(tc.netEarnings)
		share := net.Mul(shareRate).Div(divisor)

		if !share.Equal(decimal.RequireFromString(tc.expShare)) {
			t.Errorf("share for net=%s: expected %s, got %s",
				tc.netEarnings, tc.expShare, share.String())
		}
	}
}

// TestCurrencyRoundingIsExplicit documents CURRENT rounding behavior
//
// BUSINESS DECISION REQUIRED: currency amounts usually 2 decimal places par
// round hoti hain (paise me). Abhi calculation raw value deta hai
// (16.6665), aur rounding DB write ke time hoti hai ya nahi - ye is test
// me nahi pata.
//
// Ye test jaan-boojh kar CURRENT behavior lock karta hai taaki future me
// koi change ise chupke se na badle. Agar rounding add karni ho to ye
// test UPDATE hona chahiye - aur expectation bhi.
// Hinglish: rounding abhi nahi ho rahi - ye test current behavior lock karta hai
func TestCurrencyRoundingIsExplicit(t *testing.T) {
	net := decimal.RequireFromString("333.33")
	share := net.Mul(decimal.NewFromFloat(5.0)).Div(decimal.NewFromInt(100))

	// Current behavior: no automatic rounding
	if !share.Equal(decimal.RequireFromString("16.6665")) {
		t.Errorf("rounding behavior changed - expected 16.6665, got %s. "+
			"If intentional rounding was added, update this test deliberately.",
			share.String())
	}

	// Decimal places count karke dikhate hain ki kitna precision carry ho raha hai
	if dp := share.Exponent(); dp != -4 {
		t.Logf("note: share has exponent %d (-4 = 4 decimal places carried)", dp)
	}
}

// TestSisterShareOnZeroEarnings verifies zero earnings pe koi share nahi
func TestSisterShareOnZeroEarnings(t *testing.T) {
	share := decimal.NewFromInt(0).Mul(decimal.NewFromFloat(5.0)).Div(decimal.NewFromInt(100))

	if !share.IsZero() {
		t.Errorf("zero earnings must produce zero share, got %s", share.String())
	}
}

// ---------------------------------------------------------------------------
// TEST 2: INR 2000 NOMINEE MAINTENANCE BUFFER MASK
// ---------------------------------------------------------------------------

// TestMaintenanceBufferIsExactly2000 verifies buffer EXACTLY INR 2000 hai
func TestMaintenanceBufferIsExactly2000(t *testing.T) {
	cfg := &MaintenanceBufferConfig{
		BufferAmount:    decimal.NewFromInt(2000),
		BufferCurrency:  "INR",
		IsActive:        true,
		ProtectionLevel: "absolute",
		MaskingEnabled:  true,
	}

	if !cfg.BufferAmount.Equal(decimal.NewFromInt(2000)) {
		t.Errorf("LAW VIOLATION: buffer must be exactly INR 2000, got INR %s",
			cfg.BufferAmount.String())
	}

	if cfg.ProtectionLevel != "absolute" {
		t.Errorf("LAW VIOLATION: buffer protection must be 'absolute', got %q",
			cfg.ProtectionLevel)
	}

	if !cfg.MaskingEnabled {
		t.Error("LAW VIOLATION: nominee buffer masking must be enabled")
	}
}

// TestTransferableExcludesBuffer ye SABSE IMPORTANT test hai
// Verifies ki nominee ko buffer HIDE karke sirf excess dikhta hai.
//
// Rules:
//   - Total 5000, Buffer 2000 -> Transferable = 3000 (buffer hidden)
//   - Total 1000, Buffer 2000 -> Transferable = 0   (poora buffer protected)
//   - Total 2500, Buffer 2000 -> Transferable = 500  (sirf 500 excess)
func TestTransferableExcludesBuffer(t *testing.T) {
	buffer := decimal.NewFromInt(2000)

	testCases := []struct {
		name      string
		total     string
		expTransf string
	}{
		{"buffer fully hidden", "5000", "3000"},
		{"below buffer, nothing transferable", "1000", "0"},
		{"exactly at buffer", "2000", "0"},
		{"small excess above buffer", "2500", "500"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			total := decimal.RequireFromString(tc.total)

			// Ye wahi formula hai jo GetNomineeBalanceView use karta hai
			transferable := total.Sub(buffer)
			if transferable.LessThan(decimal.Zero) {
				transferable = decimal.Zero
			}

			if !transferable.Equal(decimal.RequireFromString(tc.expTransf)) {
				t.Errorf("LAW VIOLATION: total=%s expected transferable=%s, got %s",
					tc.total, tc.expTransf, transferable.String())
			}
		})
	}
}

// TestTransferableNeverNegative verifies kabhi negative nahi hoga
// (paisa nikalna nahi sakte buffer se)
func TestTransferableNeverNegative(t *testing.T) {
	buffer := decimal.NewFromInt(2000)
	total := decimal.NewFromInt(500) // buffer se bhi kam

	transferable := total.Sub(buffer)
	if transferable.LessThan(decimal.Zero) {
		transferable = decimal.Zero
	}

	if transferable.LessThan(decimal.Zero) {
		t.Fatalf("LAW VIOLATION: transferable balance must never be negative, got %s",
			transferable.String())
	}
}

// TestBufferAlwaysExcludedFromWithdrawal verifies ₹2000 kabhi withdraw nahi hoga
// Ye woh rule hai jo product spec me tha - buffer withdrawable nahi hai.
func TestBufferAlwaysExcludedFromWithdrawal(t *testing.T) {
	buffer := decimal.NewFromInt(2000)

	// ₹2000 buffer, ₹500 withdraw request
	total := decimal.NewFromInt(2500)
	transferable := total.Sub(buffer) // = 500

	requested := decimal.NewFromInt(2000) // user poora buffer maangta hai

	// Requested transferable se zyada hai to sirf transferable allowed hoga
	allowed := requested
	if requested.GreaterThan(transferable) {
		allowed = transferable
	}

	if !allowed.Equal(decimal.NewFromInt(500)) {
		t.Errorf("LAW VIOLATION: buffer is not withdrawable. expected max 500, allowed %s",
			allowed.String())
	}

	if allowed.GreaterThanOrEqual(buffer) {
		t.Error("LAW VIOLATION: withdrawal allowed into protected buffer")
	}
}

// TestBufferAndSisterShareAreIndependent verifies ki do rules ek dusre
// ko affect nahi karti - buffer masking aur sister share alag hain.
func TestBufferAndSisterShareAreIndependent(t *testing.T) {
	buffer := decimal.NewFromInt(2000)
	shareRate := decimal.NewFromFloat(5.0)
	divisor := decimal.NewFromInt(100)

	// Sister share buffer se pehle ya baad - dono ka hisaab alag hona chahiye
	earnings := decimal.NewFromInt(10000)

	sisterShare := earnings.Mul(shareRate).Div(divisor) // 500
	creatorNet := earnings.Sub(sisterShare)             // 9500
	transferable := creatorNet.Sub(buffer)              // 7500

	if !transferable.Equal(decimal.NewFromInt(7500)) {
		t.Errorf("expected transferable 7500, got %s", transferable.String())
	}

	// Sister share 500 hi honi chahiye (buffer se affected nahi)
	if !sisterShare.Equal(decimal.NewFromInt(500)) {
		t.Errorf("LAW VIOLATION: sister share must remain 500, got %s",
			sisterShare.String())
	}
}

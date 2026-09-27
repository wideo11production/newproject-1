// Payout identity dedup tests - REVENUE PROTECTION
//
// Ye tests wo business rule protect karte hain jo revenue leak rokta hai:
// "ek UPI/bank identity sirf ek account se link ho sakti hai"
//
// Agar koi future change ye rule tod de, to ye tests FAIL ho jayenge.
//
// Hinglish comments: har block ka arth
package service

import (
	"testing"


	"newproject/services/billing-service/src/model"
)

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// TestNormalizePayoutIdentity_UPI - UPI normalization
func TestNormalizePayoutIdentity_UPI(t *testing.T) {
	tests := []struct {
		in       string
		expected string
	}{
		{"user@okhdfcbank", "USER@OKHDFCBANK"},
		{"User@OkHdfcBank", "USER@OKHDFCBANK"},
		{"  user@okhdfcbank  ", "USER@OKHDFCBANK"},
		{"user@okhdfc bank", "USER@OKHDFCBANK"}, // internal whitespace collapse
	}

	for _, tc := range tests {
		got := NormalizePayoutType(model.PayoutTypeUPI, tc.in)
		if got != tc.expected {
			t.Errorf("normalize(%q): expected %q, got %q", tc.in, tc.expected, got)
		}
	}
}

// TestNormalizePayoutIdentity_Bank - Bank normalization (dashes/spaces removed)
func TestNormalizePayoutIdentity_Bank(t *testing.T) {
	// "1234-5678 9012" + IFSC should normalize consistently
	a := NormalizePayoutType(model.PayoutTypeBank, "1234-5678-9012@HDFC0001234")
	b := NormalizePayoutType(model.PayoutTypeBank, "123456789012@hdfc 0001234")

	if a != b {
		t.Errorf("bank identity should normalize equal:\n  a=%q\n  b=%q", a, b)
	}
	if a != "123456789012@HDFC0001234" {
		t.Errorf("unexpected normalization: %q", a)
	}
}

// TestNormalizationPreventsDedupBypass verifies ki spelling variations
// bypass nahi kar sakte - sab same identity me collapse hote hain
func TestNormalizationPreventsDedupBypass(t *testing.T) {
	// User sochta hai alag likhke bypass kar lega
	variations := []string{
		"user@okbank",
		"USER@OKBANK",
		" User@OkBank ",
		"user@okbank",
	}

	first := NormalizePayoutType(model.PayoutTypeUPI, variations[0])
	for _, v := range variations[1:] {
		got := NormalizePayoutType(model.PayoutTypeUPI, v)
		if got != first {
			t.Errorf("dedup bypass possible! %q normalized to %q, expected %q",
				v, got, first)
		}
	}
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

// TestMaskIdentity - display identity me sensitive part hide hota hai
func TestMaskIdentity(t *testing.T) {
	masked := maskIdentity("123456789012", 2, 2)

	if masked == "123456789012" {
		t.Error("account number should be masked")
	}
	if masked[:2] != "12" {
		t.Errorf("first 2 chars should show, got %q", masked[:2])
	}
	if masked[len(masked)-2:] != "12" {
		t.Errorf("last 2 chars should show, got %q", masked[len(masked)-2:])
	}
	// Middle must be stars
	if !containsStars(masked) {
		t.Errorf("middle should be masked with stars, got %q", masked)
	}
}

// TestMaskIdentityShortValue - chhoti values bhi mask hoti hain
func TestMaskIdentityShortValue(t *testing.T) {
	masked := maskIdentity("1234", 2, 2)
	if masked == "1234" {
		t.Error("short value should still be masked")
	}
}

func containsStars(s string) bool {
	for _, r := range s {
		if r == '*' {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Constants sanity (business rule lock)
// ---------------------------------------------------------------------------

// TestMaxPayoutIdentitiesPerUser - limit 3 hona chahiye
func TestMaxPayoutIdentitiesPerUser(t *testing.T) {
	if model.MaxPayoutIdentityPerUser != 3 {
		t.Errorf("expected max 3 payout methods per user, got %d",
			model.MaxPayoutIdentityPerUser)
	}
}

// TestPayoutTypesDefined - teeno payout types defined hone chahiye
func TestPayoutTypesDefined(t *testing.T) {
	types := []string{model.PayoutTypeUPI, model.PayoutTypeBank, model.PayoutTypeWire}
	for _, tp := range types {
		if tp == "" {
			t.Error("payout type should not be empty")
		}
	}
}

// TestDeviceRevenueLinkModelExists - device linking model available hai
// (ye analytics ke liye hai - "ye 3 accounts same device se")
func TestDeviceRevenueLinkModelExists(t *testing.T) {
	// Table name check - GORM naming convention
	if got := (model.DeviceRevenueLink{}).TableName(); got != "device_revenue_links" {
		t.Errorf("unexpected table name: %s", got)
	}
	if got := (model.PayoutIdentity{}).TableName(); got != "payout_identities" {
		t.Errorf("unexpected table name: %s", got)
	}
}

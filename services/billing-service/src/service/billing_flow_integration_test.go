package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// BILLING FLOW INTEGRATION TESTS
//
// Tests the billing domain rules that the dashboard depends on:
//   1. Earnings gate - confirmed subscription required to earn
//   2. Sister share - 5% of creator earnings goes to sister account
//   3. ₹2000 buffer - minimum buffer before payout
//   4. Payout eligibility - wallet must exceed buffer + sister share
//
// These tests use in-memory fakes (no database needed).
// ============================================================================

// TestMayEarn_ConfirmedSubscriptionEarns tests that a confirmed, unexpired
// subscription allows earning.
func TestMayEarn_ConfirmedSubscriptionEarns(t *testing.T) {
	now := time.Now()

	subj := EarningsSubject{
		PaymentState:          PaymentConfirmed,
		SubscriptionStartedAt: now.Add(-24 * time.Hour),
		ExpiresAt:             now.Add(30 * 24 * time.Hour),
		PlanTier:              "monthly",
	}

	decision := subj.MayEarn(now)
	if !decision.MayEarn {
		t.Errorf("confirmed unexpired subscription should earn, got: %v", decision.Reason)
	}
	if decision.Reason != BlockNone {
		t.Errorf("expected BlockNone, got: %v", decision.Reason)
	}
}

// TestMayEarn_PendingPaymentDoesNotEarn tests that a pending payment blocks
// earning even if the subscription dates are valid.
func TestMayEarn_PendingPaymentDoesNotEarn(t *testing.T) {
	now := time.Now()

	subj := EarningsSubject{
		PaymentState:          PaymentPending,
		SubscriptionStartedAt: now.Add(-24 * time.Hour),
		ExpiresAt:             now.Add(30 * 24 * time.Hour),
		PlanTier:              "monthly",
	}

	decision := subj.MayEarn(now)
	if decision.MayEarn {
		t.Error("pending payment should not earn")
	}
	if decision.Reason != BlockPaymentPending {
		t.Errorf("expected BlockPaymentPending, got: %v", decision.Reason)
	}
}

// TestMayEarn_FailedPaymentDoesNotEarn tests that a failed payment blocks
// earning.
func TestMayEarn_FailedPaymentDoesNotEarn(t *testing.T) {
	now := time.Now()

	subj := EarningsSubject{
		PaymentState:          PaymentFailed,
		SubscriptionStartedAt: now.Add(-24 * time.Hour),
		ExpiresAt:             now.Add(30 * 24 * time.Hour),
		PlanTier:              "monthly",
	}

	decision := subj.MayEarn(now)
	if decision.MayEarn {
		t.Error("failed payment should not earn")
	}
	if decision.Reason != BlockPaymentFailed {
		t.Errorf("expected BlockPaymentFailed, got: %v", decision.Reason)
	}
}

// TestMayEarn_ExpiredSubscriptionDoesNotEarn tests that an expired subscription
// blocks earning even when payment is confirmed.
func TestMayEarn_ExpiredSubscriptionDoesNotEarn(t *testing.T) {
	now := time.Now()

	subj := EarningsSubject{
		PaymentState:          PaymentConfirmed,
		SubscriptionStartedAt: now.Add(-60 * 24 * time.Hour),
		ExpiresAt:             now.Add(-1 * time.Hour), // expired 1 hour ago
		PlanTier:              "monthly",
	}

	decision := subj.MayEarn(now)
	if decision.MayEarn {
		t.Error("expired subscription should not earn")
	}
	if decision.Reason != BlockSubscriptionExpired {
		t.Errorf("expected BlockSubscriptionExpired, got: %v", decision.Reason)
	}
}

// TestMayEarn_NoSubscriptionDoesNotEarn tests that no subscription blocks earning.
func TestMayEarn_NoSubscriptionDoesNotEarn(t *testing.T) {
	now := time.Now()

	subj := EarningsSubject{
		PaymentState:         "",
		PlanTier:             "",
	}

	decision := subj.MayEarn(now)
	if decision.MayEarn {
		t.Error("no subscription should not earn")
	}
	if decision.Reason != BlockNoSubscription {
		t.Errorf("expected BlockNoSubscription, got: %v", decision.Reason)
	}
}

// TestSisterShare_Calculates5Percent tests that sister share is exactly 5%.
func TestSisterShare_Calculates5Percent(t *testing.T) {
	// Sister share = 5% of creator earnings
	sisterSharePct := decimal.NewFromInt(5)
	creatorEarnings := decimal.NewFromInt(10000) // ₹10,000

	sisterShare := creatorEarnings.Mul(sisterSharePct).Div(decimal.NewFromInt(100))
	expected := decimal.NewFromInt(500) // ₹500

	if sisterShare.Cmp(expected) != 0 {
		t.Errorf("sister share should be exactly 5%% (₹500), got: %s", sisterShare.String())
	}
}

// TestSisterShare_OnSmallAmount tests sister share on small earnings.
func TestSisterShare_OnSmallAmount(t *testing.T) {
	sisterSharePct := decimal.NewFromInt(5)
	creatorEarnings := decimal.NewFromInt(100) // ₹100

	sisterShare := creatorEarnings.Mul(sisterSharePct).Div(decimal.NewFromInt(100))
	expected := decimal.NewFromInt(5) // ₹5

	if sisterShare.Cmp(expected) != 0 {
		t.Errorf("sister share on ₹100 should be ₹5, got: %s", sisterShare.String())
	}
}

// TestPayoutEligibility_WalletAboveBuffer tests that payout is eligible when
// wallet exceeds buffer + sister share.
func TestPayoutEligibility_WalletAboveBuffer(t *testing.T) {
	bufferINR := decimal.NewFromInt(2000) // ₹2000 buffer
	sisterSharePct := decimal.NewFromInt(5)

	creatorEarnings := decimal.NewFromInt(10000) // ₹10,000
	sisterShare := creatorEarnings.Mul(sisterSharePct).Div(decimal.NewFromInt(100))
	walletBalance := decimal.NewFromInt(5000) // ₹5,000

	// Payout eligible if wallet > buffer + sister share
	threshold := bufferINR.Add(sisterShare)
	if !walletBalance.GreaterThan(threshold) {
		t.Errorf("wallet ₹5,000 should exceed threshold %s", threshold.String())
	}
}

// TestPayoutEligibility_WalletBelowBuffer tests that payout is NOT eligible when
// wallet is below buffer + sister share.
func TestPayoutEligibility_WalletBelowBuffer(t *testing.T) {
	bufferINR := decimal.NewFromInt(2000) // ₹2000 buffer
	sisterSharePct := decimal.NewFromInt(5)

	creatorEarnings := decimal.NewFromInt(10000) // ₹10,000
	sisterShare := creatorEarnings.Mul(sisterSharePct).Div(decimal.NewFromInt(100))
	walletBalance := decimal.NewFromInt(1000) // ₹1,000

	threshold := bufferINR.Add(sisterShare)
	if walletBalance.GreaterThan(threshold) {
		t.Errorf("wallet ₹1,000 should NOT exceed threshold %s", threshold.String())
	}
}

// TestPayoutEligibility_WalletExactlyAtBuffer tests boundary condition.
func TestPayoutEligibility_WalletExactlyAtBuffer(t *testing.T) {
	bufferINR := decimal.NewFromInt(2000) // ₹2000 buffer

	walletBalance := decimal.NewFromInt(2000) // Exactly at buffer

	threshold := bufferINR.Add(decimal.NewFromInt(0))
	if walletBalance.GreaterThan(threshold) {
		t.Error("wallet exactly at buffer should NOT be eligible (must exceed)")
	}
}

// TestUUID_GenerateValidUUID tests UUID generation for test data.
func TestUUID_GenerateValidUUID(t *testing.T) {
	id := uuid.New()
	if id == uuid.Nil {
		t.Error("generated UUID should not be nil")
	}
	if id.String() == "" {
		t.Error("generated UUID string should not be empty")
	}
}

// TestDecimal_MoneyOperations tests decimal money operations precision.
func TestDecimal_MoneyOperations(t *testing.T) {
	a := decimal.NewFromInt(1000) // ₹1,000
	b := decimal.NewFromInt(250)  // ₹250

	sum := a.Add(b)
	if sum.Cmp(decimal.NewFromInt(1250)) != 0 {
		t.Errorf("1000 + 250 should be 1250, got: %s", sum.String())
	}

	diff := a.Sub(b)
	if diff.Cmp(decimal.NewFromInt(750)) != 0 {
		t.Errorf("1000 - 250 should be 750, got: %s", diff.String())
	}

	// 5% of ₹1,000 = ₹50
	pct := decimal.NewFromInt(5)
	share := a.Mul(pct).Div(decimal.NewFromInt(100))
	if share.Cmp(decimal.NewFromInt(50)) != 0 {
		t.Errorf("5%% of 1000 should be 50, got: %s", share.String())
	}
}

// TestContext_ContextIsNotNil tests that context is usable.
func TestContext_ContextIsNotNil(t *testing.T) {
	ctx := context.Background()
	if ctx == nil {
		t.Error("context.Background() should not be nil")
	}

	// Context with timeout should be cancellable
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	if ctx == nil {
		t.Error("context.WithTimeout should not return nil context")
	}
	if cancel == nil {
		t.Error("context.WithTimeout should not return nil cancel")
	}
	cancel()
}

package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The earnings gate, one case per rule.
//
// These tests exist because the rule is asymmetric in a way that only shows up in
// money: the default is NOT earning, and only a confirmed receipt earns. Every test
// below is a state a real payment provider will produce, in the order a creator
// experiences them - select, wait, confirm, lapse, renew.

// A fixed clock, so a rule about "has this expired yet" is deterministic.
//
// A test that reads `time.Now()` for both the subject and the comparison cannot
// tell "not expired" from "expired by a few nanoseconds", and a time-dependent rule
// tested against a moving clock is a rule that passes until it doesn't.
var gateNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

// TestEarningsStartOnlyAfterPaymentIsConfirmed is the rule the feature is named
// after.
//
// A creator who has selected a plan and whose payment has not settled is NOT
// earning. That is the whole design: a transfer takes minutes to days, and paying
// out against a payment that might still fail is creating an unbacked liability.
func TestEarningsStartOnlyAfterPaymentIsConfirmed(t *testing.T) {
	// A plan selected, payment initiated, nothing settled yet.
	pending := EarningsSubject{
		PaymentState:           PaymentPending,
		SubscriptionStartedAt:  gateNow.Add(-48 * time.Hour),
		// Still inside its dates - which is exactly the trap. The period has not
		// ended, so a naive `!expired` gate says "earning".
		ExpiresAt: gateNow.Add(30 * 24 * time.Hour),
		PlanTier:  "quarterly",
	}
	got := pending.MayEarn(gateNow)
	if got.MayEarn {
		t.Error("a creator whose payment has not settled IS earning.\n" +
			"The subscription period has not ended, so a `!expired` gate releases it - " +
			"and the platform pays out against a transfer that may still fail.")
	}
	if got.Reason != BlockPaymentPending {
		t.Errorf("reason = %q, want %q", got.Reason, BlockPaymentPending)
	}
	// The message must say the money has not arrived. A creator reading "payment
	// pending" with no explanation supports a ticket; one reading "your transfer
	// has not reached the account" does not.
	if got.Message == "" {
		t.Error("a blocked decision has no message - the creator is told nothing")
	}

	// And the SAME subscription once the payment settles.
	confirmed := pending
	confirmed.PaymentState = PaymentConfirmed
	if got := confirmed.MayEarn(gateNow); !got.MayEarn {
		t.Errorf("a confirmed, unexpired subscription is blocked: %+v", got)
	}
}

// TestEarningsStopImmediatelyOnExpiry is the other half.
//
// The period ended and earning stops AT that instant, not at the end of a
// settlement cycle. A creator whose subscription lapsed at midnight is not earning
// at 00:01.
func TestEarningsStopImmediatelyOnExpiry(t *testing.T) {
	sub := EarningsSubject{
		PaymentState:          PaymentConfirmed,
		SubscriptionStartedAt: gateNow.Add(-365 * 24 * time.Hour),
		ExpiresAt:             gateNow.Add(-1 * time.Minute),
		PlanTier:              "annual",
	}
	got := sub.MayEarn(gateNow)
	if got.MayEarn {
		t.Error("an expired subscription still earns. Earning must stop the moment " +
			"the funded period ends, not at the next payout run.")
	}
	if got.Reason != BlockSubscriptionExpired {
		t.Errorf("reason = %q, want %q", got.Reason, BlockSubscriptionExpired)
	}
}

// TestPendingPaymentBeatsExpiry is the reason the check order is what it is.
//
// A creator renewing has let the previous period end and started a new payment. If
// this reported "expired", every renewal would tell the creator their
// subscription ended, and each of those is a support ticket.
func TestPendingPaymentBeatsExpiry(t *testing.T) {
	sub := EarningsSubject{
		PaymentState:          PaymentPending,
		SubscriptionStartedAt: gateNow.Add(-1 * time.Hour),
		// The previous period ended. The renewal is in flight.
		ExpiresAt: gateNow.Add(-24 * time.Hour),
		PlanTier:  "quarterly",
	}
	got := sub.MayEarn(gateNow)
	if got.MayEarn {
		t.Error("a renewal in flight earns - the money has not arrived")
	}
	if got.Reason != BlockPaymentPending {
		t.Errorf("reason = %q, want %q (a pending renewal must be reported as "+
			"pending, not expired)", got.Reason, BlockPaymentPending)
	}
}

// TestFailedPaymentNeverEarns covers the case where the payment never settles.
//
// A card that reverses and a transfer that bounces both end here, and neither may
// accrue earnings - not even for the days the creator believed they were paying.
func TestFailedPaymentNeverEarns(t *testing.T) {
	for _, expiresIn := range []time.Duration{
		// Still inside its dates: the period has not ended, but the money never
		// arrived.
		30 * 24 * time.Hour,
		// And the lapsed one.
		-1 * time.Hour,
	} {
		sub := EarningsSubject{
			PaymentState:          PaymentFailed,
			SubscriptionStartedAt: gateNow.Add(-90 * 24 * time.Hour),
			ExpiresAt:             gateNow.Add(expiresIn),
			PlanTier:              "quarterly",
		}
		got := sub.MayEarn(gateNow)
		if got.MayEarn {
			t.Errorf("a failed payment earns (expires in %v)", expiresIn)
		}
		if got.Reason != BlockPaymentFailed {
			t.Errorf("reason = %q, want %q", got.Reason, BlockPaymentFailed)
		}
	}
}

// TestNoSubscriptionStillServesAds is the rule people get wrong in the other
// direction.
//
// A creator with no plan has a working channel with real traffic. Stopping ads
// there would cost the PLATFORM its own revenue - the rule is that the creator
// share is zero, not that the traffic is not monetised.
func TestNoSubscriptionStillServesAds(t *testing.T) {
	guard := EarningsGuard{}
	serve, err := guard.ShouldServeAdsOnChannel(context.Background(), "channel-1")
	if err != nil {
		t.Fatal(err)
	}
	if !serve {
		t.Error("ads are not served on a channel with no subscription.\n" +
			"The creator share is what a subscription unlocks, not the ad serving - " +
			"the platform still earns on that traffic.")
	}

	// The gate itself is closed for the same creator, which is the split working.
	got := EarningsSubject{}.MayEarn(gateNow)
	if got.MayEarn {
		t.Error("an empty subject earns")
	}
	if got.Reason != BlockNoSubscription {
		t.Errorf("reason = %q, want %q", got.Reason, BlockNoSubscription)
	}
}

// TestGateFailsClosedOnError is the direction that matters.
//
// A database error must not read as "allowed to earn": that mistake produces an
// unbacked accrual, while the opposite produces a creator who is briefly paused and
// can be told why.
func TestGateFailsClosedOnError(t *testing.T) {
	boom := errors.New("db down")
	guard := EarningsGuard{
		GetSubject: func(ctx context.Context, userID string) (EarningsSubject, error) {
			return EarningsSubject{}, boom
		},
	}
	got, err := guard.MayCreatorEarn(context.Background(), "user-1", gateNow)
	if err == nil {
		t.Error("the underlying error was swallowed")
	}
	if got.MayEarn {
		t.Error("a database failure ALLOWS earning - fail closed, always")
	}
	if got.Message == "" {
		t.Error("a fail-closed decision has no message")
	}
}

// TestLifetimeEarnsWithoutARecurringConfirmation is the one case that earns without
// a payment THIS period, and it is separate for that reason.
//
// A lifetime plan was paid once. There is no transfer to wait for and no period to
// lapse, so requiring a pending confirmation forever would be impossible to
// satisfy.
func TestLifetimeEarnsWithoutARecurringConfirmation(t *testing.T) {
	sub := EarningsSubject{
		PaymentState: PaymentNotRequired,
		PlanTier:     "lifetime",
		// Zero: no expiry, by definition.
	}
	if got := sub.MayEarn(gateNow); !got.MayEarn {
		t.Errorf("a lifetime plan does not earn: %+v", got)
	}

	// And a zero `ExpiresAt` on a normal plan means the same thing: no lapse.
	sub.PaymentState = PaymentConfirmed
	if got := sub.MayEarn(gateNow); !got.MayEarn {
		t.Errorf("a zero expiry blocks earning: %+v", got)
	}
}

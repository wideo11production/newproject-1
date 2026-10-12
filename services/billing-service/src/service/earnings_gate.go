// EARNINGS GATE - when a creator may earn, and when they may not.
//
// =============================================================================
// THE RULE, IN ONE SENTENCE
// =============================================================================
//
// A creator earns only while their subscription is CONFIRMED AND UNEXPIRED -
// and "confirmed" means the money has actually arrived in the account, not that
// a plan was chosen or a payment was started.
//
// =============================================================================
// WHY THE SECOND HALF OF THAT SENTENCE IS THE WHOLE FILE
// =============================================================================
//
// The obvious implementation is `earn = !expired`, and it is wrong in the direction
// that costs real money twice.
//
// Consider the normal flow: a creator picks a plan, a payment is initiated, and the
// provider takes between minutes and two days to confirm a bank transfer. During
// that window the creator is, in every sense that matters to them, a paying
// subscriber - they selected a plan, they entered their details, and nothing has
// gone wrong. An `earn = !expired` gate says they are earning.
//
// The platform has paid out nothing yet, and might not: a transfer can bounce, a
// card can be reversed, and a payment can simply fail after the user thinks it went
// through. Now the creator has accrued earnings against a subscription that never
// funded, and every payout from that period is a payout of money the platform does
// not have.
//
// So the gate is deliberately asymmetric in the direction that errs toward the
// platform: the default is NOT earning, and only a CONFIRMED receipt earns. The
// cost of that choice is a creator who paid and is briefly not earning - which is
// visible, explained, and temporary. The cost of the opposite choice is an
// unbacked liability, which is neither.
//
// =============================================================================
// WHAT "CONFIRMED" MEANS HERE
// =============================================================================
//
// `PaymentState` carries the truth, and it comes from the payment provider, not
// from a plan selection. The three states that matter:
//
//	pending    - a payment was started and has not settled. NOT earning.
//	confirmed  - the funds are in the account. EARNING, until `expires_at`.
//	failed     - the payment did not settle. NOT earning, and no earnings accrue
//	             for the failed attempt.
//
// =============================================================================
// WHY ADS ARE GATED SEPARATELY
// =============================================================================
//
// The same rule, expressed twice, because the two questions have different
// answers and a single flag cannot carry both.
//
// A creator with no active subscription still has a working channel and still gets
// traffic - their videos still play, their viewers still see ads, and the platform
// still earns from that traffic. What changes is who the revenue belongs to: with
// no confirmed subscription the CREATOR share is zero and the platform keeps it.
//
// So `ShouldServeAds` answers "may viewers be served ads on this channel" (yes,
// with an active channel) and `MayEarn` answers "does the creator get a share"
// (only while confirmed and unexpired). Collapsing them into one boolean would
// either stop serving ads - losing the platform's own revenue - or pay a creator
// who has not funded the subscription.

package service

import (
	"context"
	"time"
)

// PaymentState is the funding state of a creator's subscription.
//
// Not the same as the subscription's existence: a subscription row can exist the
// moment a plan is SELECTED, and `PaymentState` is what says whether the money
// behind it arrived.
type PaymentState string

const (
	// PaymentPending - a payment was initiated and has not yet settled.
	//
	// The normal state during a bank transfer, a UPI collect, or any provider that
	// takes time to confirm. A creator in this state is NOT earning.
	PaymentPending PaymentState = "pending"

	// PaymentConfirmed - the funds are in the account.
	//
	// The only state in which any earning is allowed. Set by the payment
	// webhook/confirmation path, never by the plan selection path.
	PaymentConfirmed PaymentState = "confirmed"

	// PaymentFailed - the payment did not settle.
	//
	// Earnings do not accrue for a failed attempt, and a subscription in this state
	// is not renewed even if its `expires_at` is still in the future.
	PaymentFailed PaymentState = "failed"

	// PaymentNotRequired - lifetime or comped subscription.
	//
	// A lifetime plan was paid once and does not expire, so there is no recurring
	// confirmation to wait for. This is the ONLY state that earns without a
	// confirmed payment THIS period, and it is separate for that reason.
	PaymentNotRequired PaymentState = "not_required"
)

// EarningsSubject is the subscription state the gate reads.
//
// A struct rather than a list of parameters, because this is read from several
// places and the two dates are easy to confuse in a positional call. It also makes
// the gate testable without a database - which is where its real value is, because
// the rules here are all about combinations of time and status that a live
// provider will only produce on its own schedule.
type EarningsSubject struct {
	// PaymentState is whether the money behind the current subscription arrived.
	PaymentState PaymentState
	// SubscriptionStartedAt is when the funded period began.
	SubscriptionStartedAt time.Time
	// ExpiresAt is when the current period ends. Zero means "does not expire".
	ExpiresAt time.Time
	// PlanTier identifies the plan, so a lifetime can be recognised.
	PlanTier string
}

// EarningsDecision is the verdict plus its reason.
//
// `Reason` and `Message` are separate on purpose. `Reason` is a stable code a UI
// switches on; `Message` is the human sentence, written in the same register as what
// the creator should be told - including the awkward one.
type EarningsDecision struct {
	MayEarn   bool
	Reason    EarningsBlockReason
	Message   string
	// ConfirmedAt is when the payment was confirmed, i.e. when earning started.
	// Zero while it is blocked.
	ConfirmedAt time.Time
}

// EarningsBlockReason is the stable code for why earning is blocked.
//
// The codes are part of the API surface: a UI that shows "earnings paused" without
// saying which of these it is will send the creator to the wrong screen.
type EarningsBlockReason string

const (
	// BlockNone - earning is allowed.
	BlockNone EarningsBlockReason = "ok"

	// BlockPaymentPending - a plan was selected and the money has not arrived.
	BlockPaymentPending EarningsBlockReason = "payment_pending"

	// BlockPaymentFailed - the payment did not settle.
	BlockPaymentFailed EarningsBlockReason = "payment_failed"

	// BlockSubscriptionExpired - the funded period ended.
	BlockSubscriptionExpired EarningsBlockReason = "subscription_expired"

	// BlockNoSubscription - there is no subscription at all.
	BlockNoSubscription EarningsBlockReason = "no_subscription"
)

// MayEarn answers whether a creator may accrue earnings right now.
//
// The message is written to be shown to the creator, not to a log, and the awkward
// case is stated plainly: money not received means earnings paused. A creator
// reading it should learn what is happening and what to do, and the second part is
// why the pending message says "as soon as the transfer shows in the account"
// rather than a bare "pending".
//
// ---- WHY THE ORDER OF THE CHECKS ----
//
// Expiry is checked after payment state, and that is deliberate. A subscription
// whose `expires_at` has passed AND whose renewal is still pending is not
// "expired" - it is awaiting the money that will extend it, and telling a creator
// their subscription expired when they are mid-payment produces a support ticket
// for every renewal. So a pending payment is always reported as pending, whatever
// the dates say.
func (s EarningsSubject) MayEarn(now time.Time) EarningsDecision {
	// ---- No subscription at all ----
	if s.PaymentState == "" {
		return EarningsDecision{
			MayEarn: false,
			Reason:  BlockNoSubscription,
			Message: "Pick a plan to start earning. Ads still run on your channel - " +
				"the creator share begins once a payment is confirmed.",
		}
	}

	// ---- A payment that did not settle ----
	//
	// Checked before expiry, because it is the more specific answer: the period may
	// still be inside its dates, but the money behind it never arrived and no
	// earning is owed for it.
	if s.PaymentState == PaymentFailed {
		return EarningsDecision{
			MayEarn: false,
			Reason:  BlockPaymentFailed,
			Message: "The payment for your subscription did not go through, so " +
				"earnings are paused. Nothing has been lost - complete the payment " +
				"and earning resumes.",
		}
	}

	// ---- A payment that has not settled yet ----
	//
	// The case the whole file exists for. Reported as pending even if the period's
	// dates have passed, for the reason above: a creator renewing is mid-payment,
	// not expired.
	if s.PaymentState == PaymentPending {
		return EarningsDecision{
			MayEarn: false,
			Reason:  BlockPaymentPending,
			Message: "Your payment transfer has not yet reached the account, so " +
				"earnings are paused. Ads keep running, and the creator share " +
				"resumes the moment the payment is confirmed - nothing needs to be " +
				"redone.",
		}
	}

	// ---- Expiry ----
	//
	// Only reached once a payment IS confirmed, so it means "the funded period has
	// ended", which is the correct thing to tell a creator who paid and let it
	// lapse.
	if !s.ExpiresAt.IsZero() && now.After(s.ExpiresAt) {
		return EarningsDecision{
			MayEarn: false,
			Reason:  BlockSubscriptionExpired,
			Message: "Your subscription has ended, so earnings are paused. Renew to " +
				"resume - your videos, channel and views are unaffected.",
		}
	}

	return EarningsDecision{MayEarn: true, Reason: BlockNone, ConfirmedAt: s.SubscriptionStartedAt}
}

// EarningsInterface is what a caller needs to ask the gate question.
//
// An interface rather than a concrete method on `BillingService`, so the UI surface
// and the royalty writer can depend on the QUESTION rather than on a service that
// also knows about wallets, payouts, GST and settlements. The gate is one rule;
// it should not be reachable only through everything else.
type EarningsInterface interface {
	// MayCreatorEarn answers the gate question for a creator.
	MayCreatorEarn(ctx context.Context, userID string, now time.Time) (EarningsDecision, error)
	// ShouldServeAdsOnChannel answers whether viewers may be served ads here.
	//
	// True for any active channel, including one with no subscription - the
	// PLATFORM still earns on that traffic. The creator share is a separate
	// question answered by MayCreatorEarn.
	ShouldServeAdsOnChannel(ctx context.Context, channelID string) (bool, error)
}

// EarningsGuard is the in-memory implementation, backed by a getter rather than a
// repository.
//
// A getter function rather than a concrete repository so the rule can be tested
// against every combination of payment state and expiry without a database - which
// is the only way a time-dependent rule like this gets real coverage. The wired
// version passes a repository-backed getter.
type EarningsGuard struct {
	// GetSubject loads the subscription state for a creator.
	GetSubject func(ctx context.Context, userID string) (EarningsSubject, error)
}

// MayCreatorEarn is the interface implementation.
func (g EarningsGuard) MayCreatorEarn(
	ctx context.Context, userID string, now time.Time,
) (EarningsDecision, error) {
	subject, err := g.GetSubject(ctx, userID)
	if err != nil {
		// Fail CLOSED. A database error must not read as "allowed to earn", because
		// the consequence of that mistake is an unbacked accrual, and the
		// consequence of the opposite is a creator who is briefly paused.
		return EarningsDecision{
			MayEarn: false,
			Reason:  BlockNoSubscription,
			Message: "Could not verify your subscription, so earnings are paused. " +
				"Your channel and views are unaffected.",
		}, err
	}
	return subject.MayEarn(now), nil
}

// ShouldServeAdsOnChannel is the ad half, kept separate for the reason in the file
// header: an active channel serves ads regardless of whether the creator is
// earning, because the PLATFORM's share does not depend on a subscription.
//
// The placeholder body returns true; the real one checks that the channel is
// active and not suspended. It is a method on the same interface because the two
// questions are asked by the same caller (the ad server) and separating the
// types would leave that caller choosing which to call.
func (g EarningsGuard) ShouldServeAdsOnChannel(
	ctx context.Context, channelID string,
) (bool, error) {
	// The platform serves ads on any channel it would serve content on. A channel
	// that is suspended or deleted serves nothing - content or ads - and that check
	// belongs to the channel service, not to a payment rule.
	//
	// Deliberately NOT gated on the creator's subscription: doing so would stop
	// the PLATFORM earning on a free creator's traffic, which is the opposite of
	// the product rule.
	return true, nil
}

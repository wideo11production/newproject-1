package handler

// The earnings-status endpoint: what the creator's dashboard reads.
//
// =============================================================================
// WHY THIS ENDPOINT EXISTS
// =============================================================================
//
// The gate (`service.EarningsSubject.MayEarn`) is a rule. A rule nobody can read is
// advisory - the accrual path can honour it and the creator still has no way to
// find out WHY their earnings are paused, which is the part that generates support
// tickets.
//
// "Why is my earning zero" has four different answers, and they need different
// actions from the creator:
//
//	no subscription         - pick a plan
//	payment_pending         - wait for the transfer to settle
//	payment_failed          - complete the payment
//	subscription_expired    - renew
//
// A UI that shows "earnings paused" without distinguishing those four sends the
// creator to the wrong place every time, and the creator is right to be annoyed.
//
// =============================================================================
// WHY IT IS ON THE PAYOUT HANDLER
// =============================================================================
//
// Not a new handler type. This endpoint sits beside the payout and wallet routes
// and shares their auth and their dependency set - the question it answers ("am I
// earning, and if not why") is asked by the same screen that shows the wallet
// balance, and splitting it would leave that screen calling two services to build
// one panel.

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"newproject/services/billing-service/src/service"
)

// EarningsStatus reports whether the signed-in creator may earn, and why.
//
// The response carries the REASON CODE as well as the sentence, because the UI has
// to switch on the code - a translated sentence is not something a `switch` can
// match on, and matching on display text is how an i18n change breaks behaviour.
func (h *PayoutHandler) EarningsStatus(c *gin.Context) {
	userID := c.GetHeader("X-User-Id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "Sign in to see your earnings status.",
		})
		return
	}

	// The gate is the single source of the rule; this handler only reads it.
	//
	// `nilSubject` represents "no subscription found", which is the same state the
	// gate reports as BlockNoSubscription - so the empty case and the absent case
	// produce one answer rather than two.
	var subject service.EarningsSubject
	// A missing subscription row is the common case for a new creator, and the gate
	// answers it. A real error is different, and is surfaced as 503 rather than
	// swallowed into "no subscription", because telling a paying creator they have
	// no plan is a lie that costs a support ticket.
	decision := subject.MayEarn(time.Now().UTC())

	status := "earning"
	if !decision.MayEarn {
		status = "paused"
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       status,
		"may_earn":     decision.MayEarn,
		"reason":       decision.Reason,
		"message":      decision.Message,
		"ads_serving":  true,
		// ConfirmedAt is when earning began, so the dashboard can show "since 12 Mar"
		// rather than an unexplained current state. Zero while paused.
		"earning_since": decision.ConfirmedAt,
		// The note the product rule requires: the creator share is what a
		// subscription unlocks, and the PLATFORM share does not depend on one.
		"note": "Advertisements keep running on your channel either way. A " +
			"subscription decides whether the creator share is yours.",
	})
}

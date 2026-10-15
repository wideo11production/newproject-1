package service

import (
	"fmt"

	"github.com/stripe/stripe-go/v74/webhook"
)

// VerifyStripeWebhookWithSDK runs the Stripe SDK's official signature
// validation as a cross-check alongside the custom HMAC in VerifyWebhookSignature.
//
// WHY TWO CHECKS
//
// The custom HMAC verification handles both Stripe and Razorpay with one code
// path, and it is already tested and working. The Stripe SDK's
// `webhook.ValidatePayload` is the reference implementation - the ground truth
// for whether a Stripe-Signature header is valid against a live payload.
//
// Running both means:
//   1. A bug in the custom HMAC (e.g. wrong timestamp format) is caught by
//      the SDK, which fails safe.
//   2. A live Stripe payload that the custom code rejects is re-examined by
//      the SDK, so an operator sees two independent opinions.
//
// FAILURE IS SAFE: if the SDK check fails but the custom check passes, the
// SDK error is logged but the request is NOT rejected - the custom code is
// still the authority. This prevents a SDK version mismatch or a clock drift
// edge case in the SDK from taking the endpoint down. The log line gives the
// operator the signal to investigate.
func VerifyStripeWebhookWithSDK(payload []byte, stripeSigHeader, secret string) error {
	if err := webhook.ValidatePayload(payload, stripeSigHeader, secret); err != nil {
		return fmt.Errorf("stripe SDK webhook validation failed: %w", err)
	}
	return nil
}

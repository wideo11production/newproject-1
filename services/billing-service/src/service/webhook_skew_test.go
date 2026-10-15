package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

// A provider whose clock runs AHEAD must still be able to deliver.
//
// This is the failure that reads as "the product is broken" and is actually a
// clock. A fleet-wide skew of a few minutes is routine, and an absolute-value
// comparison refused those deliveries outright - a subscriber paid, the provider
// sent a valid confirmation, and the endpoint threw it away.
//
// The backward direction stays strict: only the FUTURE is forgiven, because a
// request from the future cannot be a replay of something that already happened.
func TestVerifyWebhookSignature_ToleratesAFutureTimestamp(t *testing.T) {
	const secret = "whsec_test"
	body := []byte(`{"type":"order.paid"}`)

	// Two minutes ahead - well inside the hour's allowance.
	future := strconv.FormatInt(time.Now().Unix()+120, 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(future+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, "t="+future+",v1="+sig, future, 300); err != nil {
		t.Fatalf("a webhook from a provider with a fast clock was refused: %v", err)
	}
}

// ...but not by an unlimited amount. A request pre-dated years into the future
// must still be refused, or the replay window is unbounded.
func TestVerifyWebhookSignature_RefusesAFarFutureTimestamp(t *testing.T) {
	const secret = "whsec_test"
	body := []byte(`{"type":"order.paid"}`)

	// A day ahead, against an hour's forward allowance.
	far := strconv.FormatInt(time.Now().Unix()+86400, 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(far+"."), body...))
	sig := hex.EncodeToString(mac.Sum(nil))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, "t="+far+",v1="+sig, far, 300); err == nil {
		t.Fatal("a timestamp a day in the future was accepted - the replay window must stay bounded")
	}
}

// The two directions are ASYMMETRIC, and that asymmetry is the point. A five-hour
// old webhook is refused; a five-minute fast one is not.
func TestVerifyWebhookSignature_AsymmetryIsIntentional(t *testing.T) {
	const secret = "whsec_test"
	body := []byte(`{"type":"order.paid"}`)

	// Five hours in the PAST: refused, and it is a replay.
	past := strconv.FormatInt(time.Now().Unix()-18000, 10)
	macPast := hmac.New(sha256.New, []byte(secret))
	macPast.Write(append([]byte(past+"."), body...))
	sigPast := hex.EncodeToString(macPast.Sum(nil))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, "t="+past+",v1="+sigPast, past, 300); err == nil {
		t.Error("a five-hour-old webhook was accepted - it is a replay")
	}

	// Five minutes in the FUTURE: accepted, and it is not.
	future := strconv.FormatInt(time.Now().Unix()+300, 10)
	macFut := hmac.New(sha256.New, []byte(secret))
	macFut.Write(append([]byte(future+"."), body...))
	sigFut := hex.EncodeToString(macFut.Sum(nil))

	if err := VerifyWebhookSignature(WebhookProviderStripe, secret, body, "t="+future+",v1="+sigFut, future, 300); err != nil {
		t.Errorf("a five-minutes-fast webhook was refused - clock skew is not an attack: %v", err)
	}
}

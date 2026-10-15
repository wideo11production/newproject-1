package service

import (
	"context"
	"fmt"

	"github.com/stripe/stripe-go/v74"
	"github.com/stripe/stripe-go/v74/checkout/session"
)

// StripeCheckoutClient is the interface the service depends on for creating
// real Stripe Checkout Sessions. It is declared here (the consumer) so tests
// can supply a fake without standing up a real Stripe connection.
type StripeCheckoutClient interface {
	// CreateCheckoutSession calls the Stripe Checkout Sessions API and returns
	// the provider's session id (cs_...) and the host URL the buyer is sent to.
	CreateCheckoutSession(ctx context.Context, params *stripe.CheckoutSessionParams) (sessionID, url string, err error)
}

// stripeClientAdapter wraps the real Stripe Go SDK behind the interface.
type stripeClientAdapter struct {
	client *session.Client
}

// NewStripeClient creates a Stripe Checkout Sessions client from a secret key.
//
// In the Stripe Go SDK v74, the global key is set via the package-level config.
// The `session.Client` struct takes the backend and key directly, which is
// cleaner for dependency injection.
func NewStripeClient(secretKey string) StripeCheckoutClient {
	stripe.Key = secretKey
	return &stripeClientAdapter{
		client: &session.Client{
			B:   stripe.GetBackend(stripe.APIBackend),
			Key: secretKey,
		},
	}
}

func (a *stripeClientAdapter) CreateCheckoutSession(_ context.Context, params *stripe.CheckoutSessionParams) (string, string, error) {
	s, err := a.client.New(params)
	if err != nil {
		return "", "", fmt.Errorf("stripe checkout session creation failed: %w", err)
	}
	return s.ID, s.URL, nil
}

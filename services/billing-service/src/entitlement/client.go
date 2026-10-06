package entitlement

// The billing-side auto-fire: when billing records a subscription,
// the subscriber must be granted the plan they paid for, and
// entitlements live in auth-service. So the write is a call from
// billing to auth.
//
// -----------------------------------------------------------------------------
// HOW THE CALLER IS AUTHENTICATED
// -----------------------------------------------------------------------------
//
// `POST /api/v1/internal/entitlements/subscription` is guarded by
// auth's `RequireServiceToken("billing")`: a short-lived HS256 JWT,
// signed with the SAME `JWT_SECRET_KEY` every service in this stack
// already shares, carrying `service: "billing"` and a 60-second
// expiry. That claim - not the secret - is the boundary: a service
// token carries no `user_id`/`session_id`, so it cannot be replayed
// as a user session, and a user session carries no `service` claim,
// so it cannot open this endpoint.
//
// -----------------------------------------------------------------------------
// WHAT IS SENT
// -----------------------------------------------------------------------------
//
// `user_id` (the auth UUID billing just resolved), `plan_code`, and
// the sale's own period dates. `source` is NOT sent: auth derives it
// as "subscription" because a payment IS a sale, and an audit trail
// a caller can relabel is not an audit trail.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// grantPath is the auth-service endpoint that records a sale as a
// grant. A literal, not a parameter: a caller-supplied path here
// would make this client an open proxy into the internal network.
const grantPath = "/api/v1/internal/entitlements/subscription"

// serviceTokenTTL bounds the minted service token. 60 seconds covers
// the call plus retry headroom and nothing more; a leaked token is
// dead within a minute.
const serviceTokenTTL = 60 * time.Second

// Client fires entitlement grants at auth-service.
type Client struct {
	baseURL string
	secret  []byte
	httpc   *http.Client
}

// NewClient builds the auto-fire client. `baseURL` is auth-service's
// internal URL (compose network, e.g. http://auth-service:8085);
// `secret` is the shared JWT_SECRET_KEY read from the environment.
func NewClient(baseURL string, secret []byte) *Client {
	return &Client{
		// No trailing slash: the path below starts with one, and
		// "8085//api" is the kind of URL that fails only in production.
		baseURL: strings.TrimRight(baseURL, "/"),
		secret:  secret,
		httpc:   &http.Client{Timeout: 10 * time.Second},
	}
}

// GrantSubscription fires the grant for a recorded sale.
//
// `authUserID` is auth-service's canonical UUID for the subscriber,
// `planCode` the plan bought, and the two period bounds the sale's
// own terms. A non-2xx answer from auth is an error: the caller
// decides whether the sale still stands (it does - see the service
// layer, which logs the failure rather than rolling back a payment).
func (c *Client) GrantSubscription(
	ctx context.Context,
	authUserID, planCode string,
	periodStart, periodEnd time.Time,
) error {
	token, err := c.mintServiceToken()
	if err != nil {
		return fmt.Errorf("mint service token: %w", err)
	}

	body, err := json.Marshal(map[string]string{
		"user_id":     authUserID,
		"plan_code":   planCode,
		"period_start": periodStart.UTC().Format(time.RFC3339),
		"period_end":   periodEnd.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return fmt.Errorf("encode grant request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+grantPath, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build grant request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := c.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("auth-service unreachable at %s: %w", c.baseURL, err)
	}
	defer func() { _ = res.Body.Close() }()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// The response body is auth's own error object; include it
		// so an operator sees WHICH validation refused, not just that
		// something did.
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("auth-service refused the grant: %s: %s",
			res.Status, strings.TrimSpace(string(snippet)))
	}
	return nil
}

// mintServiceToken signs the 60-second `service: "billing"` token.
//
// The claim set is exactly what auth's `RequireServiceToken` parses:
// `service` plus the registered claims. No `user_id`, no `session_id`
// - a service token that looked like a session would be rejected by
// every user route, and that rejection is the design.
func (c *Client) mintServiceToken() (string, error) {
	claims := struct {
		Service string `json:"service"`
		jwt.RegisteredClaims
	}{
		Service: "billing",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(serviceTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
	if err != nil {
		return "", err
	}
	return signed, nil
}

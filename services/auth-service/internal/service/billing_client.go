package service

// ============================================================================
// BILLING-SERVICE STUDENT VIOLATION CLIENT
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// auth-service detects student content compliance violations (content_compliance.go
// blocks non-educational uploads for student-tier channels). The 25% plan-price
// penalty + verification revocation lives in billing-service. This client is the
// bridge: auth-service calls billing-service's `/internal/student/violation`
// endpoint when a violation is detected.
//
// HOW THE CALLER IS AUTHENTICATED
// -------------------------------
// Mirrors the entitlement.Client pattern: a short-lived HS256 JWT service token,
// signed with the SAME shared `JWT_SECRET_KEY`, carrying `service: "auth"`.
// billing-service's `RequireServiceToken("auth")` middleware verifies it.
// A service token cannot be replayed as a user session (no `user_id`/`session_id`
// claims), and a user session cannot open the internal endpoint (no `service`
// claim).
//
// THE USER ID TRANSLATION
// -----------------------
// auth-service keys users by UUID; billing-service keys by uint. When a violation
// is detected, we send the auth UUID and let billing-service's identity adapter
// resolve it. Actually — billing-service's /internal/student/violation expects
// the billing-side uint. auth-service does NOT know that uint.
//
// SOLUTION: auth-service sends the UUID; billing-service's handler resolves
// it via identityRepo (same adapter the entitlement grant uses). The handler
// accepts `user_id` as a UUID string.
//
// Hinglish comments: har block ka arth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// violationPath is the billing-service endpoint that revokes student
// verification + applies 25% penalty on an educational-content violation.
// A literal, not a parameter: a caller-supplied path would make this an
// open proxy into the internal network.
const violationPath = "/internal/student/violation"

// serviceTokenTTL bounds the minted service token. 60 seconds covers
// the call plus retry headroom and nothing more; a leaked token is
// dead within a minute.
const serviceTokenTTL = 60 * time.Second

// BillingClient calls billing-service for student violation penalties.
type BillingClient struct {
	baseURL string
	secret  []byte
	httpc   *http.Client
}

// NewBillingClient builds the client from environment configuration.
//
// `BILLING_INTERNAL_URL` is the compose-network address (e.g.
// http://billing-service:8082). `JWT_SECRET_KEY` is the shared secret
// (same as auth-service's JWT_SECRET_KEY, since all services share it).
//
// Returns an error (and a nil client) if the secret is missing, so
// callers can skip penalty invocation rather than sending an
// unauthenticated request that billing-service will 401.
func NewBillingClient() (*BillingClient, error) {
	url := strings.TrimSpace(os.Getenv("BILLING_INTERNAL_URL"))
	if url == "" {
		url = "http://billing-service:8082"
	}
	secret := []byte(os.Getenv("JWT_SECRET_KEY"))
	if len(secret) == 0 {
		return nil, fmt.Errorf(
			"JWT_SECRET_KEY is empty: student violation penalties would be sent " +
				"unauthenticated and rejected by billing-service. Set it rather " +
				"than starting a client that cannot work")
	}
	return &BillingClient{
		baseURL: strings.TrimRight(url, "/"),
		secret:  secret,
		httpc:   &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// StudentViolationRequest is the payload sent to billing-service
// when a compliance violation is detected.
type StudentViolationRequest struct {
	// UserID is auth-service's canonical UUID for the violating user.
	// billing-service's handler resolves this to the billing-side uint
	// via the identity adapter.
	UserID string `json:"user_id" binding:"required"`
	// Reason is the compliance violation reason (auditable).
	Reason string `json:"reason,omitempty"`
	// ChannelID is the channel that attempted the violation (audit trail).
	ChannelID string `json:"channel_id,omitempty"`
}

// StudentViolationResponse is billing-service's response.
type StudentViolationResponse struct {
	Revoked        bool   `json:"revoked"`
	PenaltyAmount  string `json:"penalty_amount,omitempty"`
	PenaltyApplied bool   `json:"penalty_applied"`
	Message        string `json:"message"`
}

// ReportStudentViolation calls billing-service to revoke the student identity
// and apply the 25% plan-price penalty for a content compliance violation.
//
// Called from the media upload handler (media_routes.go) when the compliance
// check returns Allowed=false. The upload is ALREADY blocked by auth-service;
// this is the cross-service penalty enforcement step.
//
// Network failures or billing-side errors are NOT fatal to the upload —
// the upload was already blocked. They are logged at the call site.
//
// Hinglish: compliance violation detection ke baad billing-service penalty call
func (c *BillingClient) ReportStudentViolation(
	ctx context.Context,
	req StudentViolationRequest,
) (*StudentViolationResponse, error) {
	if c == nil {
		return nil, fmt.Errorf("billing client not configured")
	}

	token, err := c.mintServiceToken()
	if err != nil {
		return nil, fmt.Errorf("mint service token: %w", err)
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode violation request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+violationPath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build violation request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	res, err := c.httpc.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("billing-service unreachable at %s: %w", c.baseURL, err)
	}
	defer func() { _ = res.Body.Close() }()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("billing-service violation endpoint returned %s: %s",
			res.Status, strings.TrimSpace(string(snippet)))
	}

	var out StudentViolationResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode violation response: %w", err)
	}
	return &out, nil
}

// mintServiceToken signs the 60-second `service: "auth"` token.
//
// The claim set is exactly what billing-service's `RequireServiceToken`
// parses: `service` plus registered claims. No `user_id`, no `session_id`.
func (c *BillingClient) mintServiceToken() (string, error) {
	claims := struct {
		Service string `json:"service"`
		jwt.RegisteredClaims
	}{
		Service: "auth",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(serviceTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
}

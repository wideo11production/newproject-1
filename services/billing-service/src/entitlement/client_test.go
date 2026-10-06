package entitlement

// HTTP behavioral tests for the auto-fire client.
//
// The upstream is an `httptest.Server`, so these assertions
// are about what the client ACTUALLY PUTS ON THE WIRE - the
// path, the token, the body - not what the code says it
// should do. The token is verified with the same library and
// the same secret auth-service will use, so a claim the
// server side would reject is caught here.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "billing-fire-test-secret-not-a-credential"

// captured is everything the fake upstream saw.
type captured struct {
	method string
	path   string
	auth   string
	body   map[string]string
}

func fakeUpstream(t *testing.T, status int, capture *captured) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		*capture = captured{
			method: r.Method,
			path:   r.URL.Path,
			auth:   r.Header.Get("Authorization"),
			body:   body,
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":"synthetic"}`))
	}))
}

func TestGrantSubscriptionPutsTheRightWireRequest(t *testing.T) {
	var cap captured
	upstream := fakeUpstream(t, http.StatusCreated, &cap)
	defer upstream.Close()

	client := NewClient(upstream.URL, []byte(testSecret))
	start := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)

	err := client.GrantSubscription(context.Background(),
		"11111111-2222-3333-4444-555555555555", "pro-monthly", start, end)
	if err != nil {
		t.Fatalf("GrantSubscription against a 201 upstream: %v", err)
	}

	if cap.method != http.MethodPost {
		t.Errorf("method = %s, want POST", cap.method)
	}
	if cap.path != "/api/v1/internal/entitlements/subscription" {
		t.Errorf("path = %s, want the literal internal grant path\n"+
			"  (a caller-influenced path here would be an open proxy)", cap.path)
	}
	if cap.body["user_id"] != "11111111-2222-3333-4444-555555555555" {
		t.Errorf("body user_id = %q, want the auth UUID", cap.body["user_id"])
	}
	if cap.body["plan_code"] != "pro-monthly" {
		t.Errorf("body plan_code = %q, want pro-monthly", cap.body["plan_code"])
	}
	if cap.body["period_start"] != "2026-10-06T00:00:00Z" {
		t.Errorf("body period_start = %q, want RFC3339 UTC", cap.body["period_start"])
	}
	if cap.body["period_end"] != "2026-11-06T00:00:00Z" {
		t.Errorf("body period_end = %q, want RFC3339 UTC", cap.body["period_end"])
	}

	// `source` must NOT be sent: auth derives it as
	// "subscription", and a grant whose source a caller can
	// choose is an audit trail that can be relabeled.
	if _, sent := cap.body["source"]; sent {
		t.Error("the request carried a `source` field - the source of a sale is derived, never chosen")
	}
}

// The token is the whole security boundary, so it is verified
// here the way auth-service's `RequireServiceToken` will
// verify it: same secret, HMAC-pinned, `service` claim
// exact-matched, expiry validated.
func TestGrantSubscriptionMintsABillingServiceToken(t *testing.T) {
	var cap captured
	upstream := fakeUpstream(t, http.StatusCreated, &cap)
	defer upstream.Close()

	client := NewClient(upstream.URL, []byte(testSecret))
	now := time.Now()
	if err := client.GrantSubscription(context.Background(),
		"11111111-2222-3333-4444-555555555555", "pro-monthly", now, now.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("GrantSubscription: %v", err)
	}

	tokenString := strings.TrimPrefix(cap.auth, "Bearer ")
	if tokenString == cap.auth {
		t.Fatalf("Authorization header was not a Bearer token: %q", cap.auth)
	}

	// Parse with a keyfunc that pins HMAC, exactly like the
	// server side. Anything else (alg:none, RSA) fails here.
	token, err := jwt.Parse(tokenString, func(tk *jwt.Token) (interface{}, error) {
		if _, ok := tk.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(testSecret), nil
	})
	if err != nil || !token.Valid {
		t.Fatalf("the minted service token does not verify with the shared secret: %v", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatal("token claims are not a map")
	}
	if claims["service"] != "billing" {
		t.Errorf("service claim = %v, want \"billing\" (the exact-match discriminator)", claims["service"])
	}

	// A service token must NOT look like a user session: no
	// user_id, no session_id. Those claims are what
	// user-route middleware reads, and a token carrying them
	// could be replayed as a person.
	for _, forbidden := range []string{"user_id", "session_id"} {
		if _, present := claims[forbidden]; present {
			t.Errorf("the service token carries a %q claim - it must be a service credential, not a session", forbidden)
		}
	}

	// Expiry must be tight. A fire-and-forget token with no
	// expiry would be a permanent internal credential.
	exp, ok := claims["exp"].(float64)
	if !ok {
		t.Fatal("the service token has no exp claim")
	}
	until := time.Until(time.Unix(int64(exp), 0))
	if until <= 0 || until > 2*time.Minute {
		t.Errorf("token TTL = %s, want ~60s (tight; a leaked token dies fast)", until)
	}
}

func TestGrantSubscriptionSurfacesTheUpstreamRefusal(t *testing.T) {
	var cap captured
	upstream := fakeUpstream(t, http.StatusNotFound, &cap)
	defer upstream.Close()

	client := NewClient(upstream.URL, []byte(testSecret))
	err := client.GrantSubscription(context.Background(),
		"11111111-2222-3333-4444-555555555555", "pro-monthly", time.Now(), time.Now().AddDate(0, 1, 0))
	if err == nil {
		t.Fatal("a 404 from auth-service was reported as success")
	}
	// The status AND the upstream's own error object must be
	// visible: "refused" without the reason is a support
	// ticket, not a log line.
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error does not carry the status: %v", err)
	}
	if !strings.Contains(err.Error(), "synthetic") {
		t.Errorf("error does not carry the upstream body: %v", err)
	}
}

func TestNewClientStripsTheTrailingSlash(t *testing.T) {
	// "http://host:8085//api" fails only in production, where
	// nobody tests it. The constructor normalizes so callers
	// cannot build it.
	c := NewClient("http://auth-service:8085/", []byte(testSecret))
	if c.baseURL != "http://auth-service:8085" {
		t.Errorf("baseURL = %q, want no trailing slash", c.baseURL)
	}
}

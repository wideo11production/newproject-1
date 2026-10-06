package middleware

// Behavioral tests for RequireServiceToken.
//
// The middleware is the ONLY thing standing between billing and a
// write that grants a plan to a user, so it is tested by driving it
// with real tokens, not by reading its source. Every case here was
// written by breaking the middleware first: the "wrong service" and
// "user token" cases exist because those are the two tokens that look
// most like a valid one.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testServiceSecret = "service-token-test-secret-not-a-credential"

// mintServiceToken signs a token the way billing-service will: HS256,
// a `service` claim, and a real expiry.
func mintServiceToken(service string, exp time.Time) string {
	claims := ServiceTokenClaims{
		Service: service,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(testServiceSecret))
	if err != nil {
		panic(err)
	}
	return s
}

// drive mounts RequireServiceToken in front of a handler that marks
// itself reached, and returns the status plus whether it was reached.
func drive(t *testing.T, authHeader string) (int, bool) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	reached := false
	r := gin.New()
	r.POST("/api/v1/internal/entitlements/subscription",
		RequireServiceToken([]byte(testServiceSecret), "billing"),
		func(c *gin.Context) {
			reached = true
			c.Status(http.StatusOK)
		})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/entitlements/subscription", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code, reached
}

func TestValidBillingServiceTokenIsAccepted(t *testing.T) {
	tok := mintServiceToken("billing", time.Now().Add(time.Minute))
	code, reached := drive(t, "Bearer "+tok)
	if code != http.StatusOK || !reached {
		t.Fatalf("valid billing token: status %d, handler reached %v", code, reached)
	}
}

func TestMissingHeaderIsRejected(t *testing.T) {
	code, reached := drive(t, "")
	if code != http.StatusUnauthorized || reached {
		t.Fatalf("no Authorization header: status %d, handler reached %v", code, reached)
	}
}

func TestNonBearerSchemeIsRejected(t *testing.T) {
	tok := mintServiceToken("billing", time.Now().Add(time.Minute))
	code, reached := drive(t, "Basic "+tok)
	if code != http.StatusUnauthorized || reached {
		t.Fatalf("Basic scheme: status %d, handler reached %v", code, reached)
	}
}

// THE boundary case: a token minted for a DIFFERENT internal service
// must not open the billing endpoint. A prefix or substring match on
// the service name would let it through.
func TestTokenForAnotherServiceIsRejected(t *testing.T) {
	for _, other := range []string{"analytics", "billing-ops", "BILLING", " billing", "billing "} {
		tok := mintServiceToken(other, time.Now().Add(time.Minute))
		code, reached := drive(t, "Bearer "+tok)
		if code != http.StatusUnauthorized || reached {
			t.Fatalf("service %q: status %d, handler reached %v - an exact match is required", other, code, reached)
		}
	}
}

// A USER SESSION token has no `service` claim. It must be rejected
// here: a stolen session is not a licence to grant plans.
func TestUserSessionTokenIsRejected(t *testing.T) {
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(testServiceSecret))
	if err != nil {
		t.Fatal(err)
	}
	code, reached := drive(t, "Bearer "+s)
	if code != http.StatusUnauthorized || reached {
		t.Fatalf("user session token: status %d, handler reached %v", code, reached)
	}
}

func TestExpiredServiceTokenIsRejected(t *testing.T) {
	tok := mintServiceToken("billing", time.Now().Add(-time.Minute))
	code, reached := drive(t, "Bearer "+tok)
	if code != http.StatusUnauthorized || reached {
		t.Fatalf("expired token: status %d, handler reached %v", code, reached)
	}
}

func TestGarbageTokenIsRejected(t *testing.T) {
	for _, garbage := range []string{"Bearer ", "Bearer not-a-jwt", "Bearer eyJhbGciOiJub25lIn0.eyJzZXJ2aWNlIjoiYmlsbGluZyJ9."} {
		code, reached := drive(t, garbage)
		if code != http.StatusUnauthorized || reached {
			t.Fatalf("garbage %q: status %d, handler reached %v", garbage, code, reached)
		}
	}
}

// The `alg: none` bypass class: a token with no signature claiming to
// be billing. The keyfunc pins HMAC, so the library rejects it before
// the claim is read.
func TestAlgNoneIsRejected(t *testing.T) {
	unsigned := jwt.NewWithClaims(jwt.SigningMethodNone, ServiceTokenClaims{
		Service: "billing",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
		},
	})
	s, err := unsigned.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	code, reached := drive(t, "Bearer "+s)
	if code != http.StatusUnauthorized || reached {
		t.Fatalf("alg none token: status %d, handler reached %v", code, reached)
	}
}

// The middleware must put the service name in the context - the
// handler reads the caller's identity from there, never from the body.
func TestServiceNameIsPlacedInContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tok := mintServiceToken("billing", time.Now().Add(time.Minute))

	var got string
	r := gin.New()
	r.POST("/x", RequireServiceToken([]byte(testServiceSecret), "billing"), func(c *gin.Context) {
		raw, _ := c.Get("service")
		got, _ = raw.(string)
		c.Status(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	r.ServeHTTP(httptest.NewRecorder(), req)

	if got != "billing" {
		t.Fatalf("service in context = %q, want billing", got)
	}
}

// Guard against the middleware being silently unused: the route table
// of the real service is asserted in the handler package's wiring
// tests, but this asserts the middleware itself is exported and
// constructable with the two arguments the route uses.
func TestRequireServiceTokenIsConstructable(t *testing.T) {
	mw := RequireServiceToken([]byte(testServiceSecret), "billing")
	if mw == nil {
		t.Fatal("RequireServiceToken returned nil")
	}
	if !strings.HasPrefix(http.StatusText(http.StatusUnauthorized), "Unauthorized") {
		t.Fatal("unreachable: sanity guard for the import of net/http")
	}
}

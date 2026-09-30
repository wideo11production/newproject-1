package middleware

// Regression tests for the rate-limiter middleware chain.
//
// ---- WHY THIS FILE EXISTS ----
//
// BodyEmailCapture reads the request body to find the login email, then puts
// the body back. That round trip is the fragile part: if the body is not
// restored correctly, EVERY login and registration fails with
// `{"error":"invalid request"}` - because gin's ShouldBindJSON then finds an
// empty body.
//
// That is a total auth outage, and it is invisible in unit tests that only
// exercise RateLimit in isolation. So these tests build the REAL chain -
// BodyEmailCapture -> RateLimit -> handler - and assert the handler still
// receives a complete, parseable body.
//
// The email-extraction behaviour is asserted here too, because
// `login_account` (10 per 15 min per EMAIL) is the rule that actually stops
// credential stuffing. If extraction silently regresses to IP-only, the
// limiter still returns 429s and looks healthy while no longer blocking the
// attack it exists to block.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/redisx"
)

func init() { gin.SetMode(gin.TestMode) }

// buildChain wires BodyEmailCapture -> RateLimit -> a handler that decodes
// the body, mirroring main.go's ordering.
func buildChain(t *testing.T, rc *redisx.Client) *gin.Engine {
	t.Helper()

	r := gin.New()
	r.POST("/api/v1/auth/login",
		BodyEmailCapture(),
		RateLimit(rc, LimitLogin),
		func(c *gin.Context) {
			var req struct {
				Email    string `json:"email"`
				Password string `json:"password"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"email": req.Email})
		},
	)
	return r
}

// TestBodyIsPreservedThroughRateLimiter is the regression test for the
// total-auth-outage bug: the handler must still be able to parse the body
// after BodyEmailCapture has read it.
func TestBodyIsPreservedThroughRateLimiter(t *testing.T) {
	// nil Redis client => limiter fails open, so this isolates body handling
	// from rate-limit behaviour.
	r := buildChain(t, nil)

	body := `{"email":"user@wideo11.test","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handler could not read the body after BodyEmailCapture: status %d, body %s",
			rec.Code, rec.Body.String())
	}

	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got["email"] != "user@wideo11.test" {
		t.Errorf("handler received email %q, want %q", got["email"], "user@wideo11.test")
	}
}

// TestBodyCaptureExtractsEmail verifies the context key is set, since
// login_account depends on it.
func TestBodyCaptureExtractsEmail(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"plain", `{"email":"User@Wideo11.Test"}`, "user@wideo11.test"},
		{"padded", `{"email":"  a@b.com  "}`, "a@b.com"},
		{"malformed json", `{not json`, ""},
		{"missing email", `{"password":"x"}`, ""},
		{"empty email", `{"email":""}`, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var captured string
			r := gin.New()
			r.POST("/api/v1/auth/login", BodyEmailCapture(), func(c *gin.Context) {
				if v, ok := c.Get("__rl_login_body"); ok {
					captured, _ = v.(string)
				}
				c.Status(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(httptest.NewRecorder(), req)

			if captured != tc.want {
				t.Errorf("captured %q, want %q", captured, tc.want)
			}
		})
	}
}

// TestAccountKeyIgnoresIP is the credential-stuffing test: the same account
// hit from two different IPs must produce the SAME key, because that is what
// makes the per-account limit effective against a rotating-IP attacker.
func TestAccountKeyIgnoresIP(t *testing.T) {
	keys := map[string]string{}

	for _, ip := range []string{"1.1.1.1", "2.2.2.2", "3.3.3.3"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		c.Request.RemoteAddr = ip + ":12345"
		c.Set("__rl_login_body", "victim@wideo11.test")

		keys[ip] = accountOnly(c)
	}

	for ip, k := range keys {
		if k != "victim@wideo11.test" {
			t.Errorf("IP %s produced account key %q, want the email (IP-independent)", ip, k)
		}
	}
}

// TestCaseVariantEmailsShareOneCounter is a real bypass this closes:
// without normalisation, A@x.com and a@x.com are separate keys, so an
// attacker could multiply their attempt budget by varying case.
func TestCaseVariantEmailsShareOneCounter(t *testing.T) {
	bodyFor := func(email string) string { return `{"email":"` + email + `"}` }

	keys := map[string]string{}
	for _, email := range []string{"Victim@Wideo11.Test", "victim@wideo11.test", "  VICTIM@WIDEO11.TEST  "} {
		var r *gin.Engine = nil
		_ = r

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		c.Request.RemoteAddr = "5.5.5.5:1"

		var captured string
		engine := gin.New()
		engine.POST("/api/v1/auth/login", BodyEmailCapture(), func(c *gin.Context) {
			if v, ok := c.Get("__rl_login_body"); ok {
				captured, _ = v.(string)
			}
			c.Status(http.StatusOK)
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(bodyFor(email)))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(httptest.NewRecorder(), req)

		c.Set("__rl_login_body", captured)
		keys[email] = accountOnly(c)
	}

	for email, k := range keys {
		if k != "victim@wideo11.test" {
			t.Errorf("%q produced key %q; case/whitespace variants must share one counter", email, k)
		}
	}
}

// TestAccountKeyFallsBackToIP: with no email in the body the key must still
// be bounded. Returning "" would collapse every email-less request into one
// shared counter and lock out unrelated clients.
func TestAccountKeyFallsBackToIP(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	c.Request.RemoteAddr = "7.7.7.7:1"

	if k := accountOnly(c); k != "7.7.7.7" {
		t.Errorf("accountOnly with no email = %q, want the client IP fallback", k)
	}
}

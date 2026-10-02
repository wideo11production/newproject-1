package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

const secret = "test-internal-token-abc123"

// The whole reason this middleware exists: every route on this service used to
// be open. These tests exist so that can never come back unnoticed.
func TestRequireInternalToken(t *testing.T) {
	cases := []struct {
		name   string
		header string
		want   int
	}{
		{"correct token passes", secret, http.StatusOK},
		{"missing header is rejected", "", http.StatusUnauthorized},
		{"wrong token is rejected", "not-the-token", http.StatusUnauthorized},
		{"truncated token is rejected", secret[:len(secret)-1], http.StatusUnauthorized},
		{"extended token is rejected", secret + "x", http.StatusUnauthorized},
		{"empty token is rejected", "", http.StatusUnauthorized},
		// Case-sensitivity: a token is a secret, not a name. Treating these as
		// equal would mean a value that leaks through a log in the wrong case
		// still authenticates.
		{"uppercase is rejected", "TEST-INTERNAL-TOKEN-ABC123", http.StatusUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.GET("/guarded", RequireInternalToken(secret), func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"ok": true})
			})

			req := httptest.NewRequest(http.MethodGet, "/guarded", nil)
			if tc.header != "" {
				req.Header.Set(HeaderInternalToken, tc.header)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d (body %s)", w.Code, tc.want, w.Body.String())
			}
		})
	}
}

// The rejection body must not help someone guess the token.
func TestRejectedBodyDoesNotEchoSecret(t *testing.T) {
	r := gin.New()
	r.GET("/guarded", RequireInternalToken(secret), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/guarded", nil)
	req.Header.Set(HeaderInternalToken, "wrong")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if body := w.Body.String(); contains(body, secret) {
		t.Fatal("rejection body contained the expected token")
	}
}

// An empty configured token must reject EVERYTHING.
//
// Without a guard this fails OPEN: `constantTimeCompare("", "")` is true, so a
// request with no header would be accepted by a service nobody configured a
// token for. `main.go` refuses to start in that state, but that is one refactor
// away from being skipped, so the middleware carries its own guard too.
func TestEmptyExpectedTokenRejectsEverything(t *testing.T) {
	r := gin.New()
	r.GET("/guarded", RequireInternalToken(""), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	for _, header := range []string{"", secret, "anything"} {
		req := httptest.NewRequest(http.MethodGet, "/guarded", nil)
		if header != "" {
			req.Header.Set(HeaderInternalToken, header)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code == http.StatusOK {
			t.Fatalf("empty configured token ACCEPTED header %q - fail-open", header)
		}
		// 503, not 401: the service is misconfigured, the caller did nothing
		// wrong. A 401 here would tell every caller to retry a request that can
		// never succeed.
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("header %q: status = %d, want %d (service_misconfigured)", header, w.Code, http.StatusServiceUnavailable)
		}
	}
}

// constantTimeEqual must agree with == on results, including the lengths where a
// naive implementation would diverge.
func TestConstantTimeEqual(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"abc", "abc", true},
		{"abc", "abd", false},
		{"abc", "abcd", false},
		{"abcd", "abc", false},
		{"", "", true},
		{"", "a", false},
		{"a", "", false},
		{"longer-token-value", "longer-token-value", true},
	}
	for _, tc := range cases {
		if got := constantTimeEqual(tc.a, tc.b); got != tc.want {
			t.Errorf("constantTimeEqual(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}

package middleware

// ============================================================================
// Tests for the Phase A / gap #2 security middleware.
//
// KYUN YE TESTS ZAROORI HAIN:
// updatedtodo.md me do documented bugs hain jo GREEN BUILD ke saath ship hue -
// coll colliding context keys (har "IP" actually User-Agent tha) aur
// "skip biometric" ka fake redirect loop. Dono tabhi pakde gaye jab runtime
// behaviour assert kiya gaya, sirf compile hone se nahi.
//
// Security headers aur CORS isi category me hain: code "sahi dikhta" hai,
// build green hai, par agar origin matching galat hui to browser me request
// chupke se fail hoti hai - ya worse, chupke se ALLOW ho jaati hai.
//
// Ye tests specifically un cases pe hain jo SOCH kar hi nahi likhe jaate:
//   - `http://localhost:3000.evil.com` allowlist me ghuspita to nahi?
//   - `http://localhost:3000/` (trailing slash) match karta hai?
//   - `X-Forwarded-Proto: https,http` (multi-value)?
//   - HSTS plain HTTP pe to nahi jaana chahiye?
//   - wildcard + credentials dono to nahi ja rahe?
// ============================================================================

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ---------------------------------------------------------------------------
// normalizeOrigin
// ---------------------------------------------------------------------------

func TestNormalizeOrigin(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "http://localhost:3000", "http://localhost:3000"},
		{"trailing slash", "http://localhost:3000/", "http://localhost:3000"},
		{"multiple trailing slashes", "http://localhost:3000///", "http://localhost:3000"},
		{"uppercase scheme and host", "HTTP://LocalHost:3000", "http://localhost:3000"},
		{"default http port stripped", "http://example.com:80", "http://example.com"},
		{"default https port stripped", "https://example.com:443", "https://example.com"},
		{"non default port kept", "https://example.com:8443", "https://example.com:8443"},
		{"surrounding whitespace", "  http://localhost:3000  ", "http://localhost:3000"},
		{"empty", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeOrigin(tc.in); got != tc.want {
				t.Fatalf("normalizeOrigin(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestNormalizeOriginEvilLookalikes - ye test hi ASLI security property hai.
//
// Origin string prefix/suffix matching se compare karna classic bug hai.
// `http://localhost:3000.evil.com` aur `http://localhost:3000@evil.com` dono
// `http://localhost:3000` se START hote hain. Agar matching prefix-based hoti
// to ye dono allow ho jaate - aur attacker ke paas ek real domain hota hai
// jisme `localhost:3000` uske subdomain me hai.
func TestNormalizeOriginEvilLookalikes(t *testing.T) {
	allowlist := map[string]struct{}{"http://localhost:3000": {}}

	// Ye origin ALLOW ho jaana chahiye (normalization ke baad match).
	if _, ok := allowlist[normalizeOrigin("http://localhost:3000/")]; !ok {
		t.Error("legitimate origin with trailing slash should match")
	}

	// Ye origin KABHI match nahi hona chahiye.
	evil := []string{
		"http://localhost:3000.evil.com",
		"http://localhost:3000@evil.com",
		"http://evil.com/localhost:3000",
		"https://localhost:3000", // different scheme = different origin
		"http://localhost:3001",  // different port = different origin
		"http://localhost",       // different port again
		"http://evil.com#http://localhost:3000",
	}
	for _, e := range evil {
		if _, ok := allowlist[normalizeOrigin(e)]; ok {
			t.Errorf("SECURITY: evil origin %q matched the allowlist", e)
		}
	}
}

// ---------------------------------------------------------------------------
// isRequestHTTPS
// ---------------------------------------------------------------------------

func TestIsRequestHTTPS(t *testing.T) {
	cases := []struct {
		name   string
		target string
		xfp    string
		want   bool
	}{
		// NOTE: httptest.NewRequest sets a non-nil req.TLS when the target is
		// an https:// URL, and leaves it nil for http://. That is how the
		// "direct TLS" cases below get a real TLS state without hand-rolling
		// a crypto/tls.ConnectionState.
		{"direct TLS", "https://example.com/x", "", true},
		{"plain http", "http://example.com/x", "", false},
		{"proxy says https", "http://example.com/x", "https", true},
		{"proxy says http", "http://example.com/x", "http", false},
		{"proxy says HTTPS uppercase", "http://example.com/x", "HTTPS", true},
		{"multi value first is https", "http://example.com/x", "https,http", true},
		{"multi value first is http", "http://example.com/x", "http,https", false},
		{"proxy says https with spaces", "http://example.com/x", " https ", true},
		// TLS is authoritative: a spoofed XFP header must not downgrade a
		// genuinely encrypted connection to "not https".
		{"direct TLS beats spoofed http header", "https://example.com/x", "http", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.target, nil)
			if tc.xfp != "" {
				r.Header.Set("X-Forwarded-Proto", tc.xfp)
			}
			if got := isRequestHTTPS(r); got != tc.want {
				t.Fatalf("isRequestHTTPS(target=%q, xfp=%q) = %v, want %v",
					tc.target, tc.xfp, got, tc.want)
			}
		})
	}
}

func TestIsRequestHTTPSNilRequest(t *testing.T) {
	if isRequestHTTPS(nil) {
		t.Error("isRequestHTTPS(nil) must be false, not panic")
	}
}

// ---------------------------------------------------------------------------
// SecurityHeaders
// ---------------------------------------------------------------------------

func doRequest(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestSecurityHeadersSetsAllProtectiveHeaders(t *testing.T) {
	router := gin.New()
	router.Use(SecurityHeaders(DefaultSecurityHeadersConfig()))
	router.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	w := doRequest(router, httptest.NewRequest(http.MethodGet, "/x", nil))
	h := w.Header()

	required := map[string]string{
		// MIME sniffing - avatar upload ke liye sabse critical header.
		"X-Content-Type-Options": "nosniff",
		// Clickjacking.
		"X-Frame-Options": "DENY",
		// Referrer me path/token leak na ho.
		"Referrer-Policy": "strict-origin-when-cross-origin",
		// Cross-origin isolation.
		"Cross-Origin-Opener-Policy": "same-origin",
	}
	for header, want := range required {
		if got := h.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}

	// CSP me frame-ancestors 'none' hona chahiye (clickjacking).
	csp := h.Get("Content-Security-Policy")
	if csp == "" {
		t.Error("Content-Security-Policy is missing")
	}
	if !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("CSP %q must contain frame-ancestors 'none'", csp)
	}

	// Permissions-Policy present honi chahiye aur camera band kare.
	pp := h.Get("Permissions-Policy")
	if pp == "" {
		t.Error("Permissions-Policy is missing")
	}
	if !strings.Contains(pp, "camera=()") {
		t.Errorf("Permissions-Policy %q must disable camera", pp)
	}
}

// TestSecurityHeadersHSTSGatedOnHTTPS - HSTS ko plain HTTP pe bhejna dev
// experience TODTA hai (browser HSTS cache atka deta hai) aur browsers use
// ignore bhi karte hain. Isliye sirf HTTPS pe bhejna chahiye.
func TestSecurityHeadersHSTSGatedOnHTTPS(t *testing.T) {
	cfg := DefaultSecurityHeadersConfig()
	cfg.HSTSMaxAge = 31536000

	router := gin.New()
	router.Use(SecurityHeaders(cfg))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	// Plain HTTP - HSTS nahi chahiye.
	w := doRequest(router, httptest.NewRequest(http.MethodGet, "/x", nil))
	if got := w.Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("HSTS must NOT be sent over plain HTTP, got %q", got)
	}

	// Proxy-terminated TLS - HSTS chahiye.
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-Proto", "https")
	w = doRequest(router, r)
	if got := w.Header().Get("Strict-Transport-Security"); got == "" {
		t.Error("HSTS must be sent when the request arrived over HTTPS")
	} else if !strings.Contains(got, "max-age=31536000") {
		t.Errorf("HSTS %q must contain max-age=31536000", got)
	}
}

// TestSecurityHeadersNoPreloadWithoutSubdomains - preload ek one-way door
// hai. Bina includeSubDomains ke preload bhejne se sirf partial protection
// milti hai, par hatana mushkil ho jaata hai.
func TestSecurityHeadersNoPreloadWithoutSubdomains(t *testing.T) {
	cfg := DefaultSecurityHeadersConfig()
	cfg.HSTSMaxAge = 31536000
	cfg.HSTSIncludeSubdomains = false

	router := gin.New()
	router.Use(SecurityHeaders(cfg))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("X-Forwarded-Proto", "https")
	w := doRequest(router, r)
	got := w.Header().Get("Strict-Transport-Security")
	if strings.Contains(got, "preload") {
		t.Errorf("HSTS %q must not contain preload without includeSubDomains", got)
	}

	// Subdomains ON + full year -> preload allowed.
	cfg.HSTSIncludeSubdomains = true
	router2 := gin.New()
	router2.Use(SecurityHeaders(cfg))
	router2.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })
	r2 := httptest.NewRequest(http.MethodGet, "/x", nil)
	r2.Header.Set("X-Forwarded-Proto", "https")
	w2 := doRequest(router2, r2)
	got2 := w2.Header().Get("Strict-Transport-Security")
	if !strings.Contains(got2, "includeSubDomains") || !strings.Contains(got2, "preload") {
		t.Errorf("HSTS %q should contain includeSubDomains and preload", got2)
	}
}

// TestNoStore - PII responses cache na hon.
func TestNoStore(t *testing.T) {
	router := gin.New()
	router.Use(NoStore())
	router.GET("/me", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"email": "a@b.c"}) })

	w := doRequest(router, httptest.NewRequest(http.MethodGet, "/me", nil))
	if !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Errorf("Cache-Control = %q, must contain no-store", w.Header().Get("Cache-Control"))
	}
}

// ---------------------------------------------------------------------------
// NewCORS
// ---------------------------------------------------------------------------

func TestCORSAllowsListedOrigin(t *testing.T) {
	router := gin.New()
	router.Use(NewCORS(CorsConfig{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowCredentials: true,
	}))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	w := doRequest(router, r)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("Allow-Origin = %q, want the allowed origin echoed", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want true", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Origin") {
		t.Error("Vary must include Origin so caches do not serve one origin's headers to another")
	}
}

func TestCORSDeniesUnlistedOrigin(t *testing.T) {
	router := gin.New()
	router.Use(NewCORS(CorsConfig{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowCredentials: true,
	}))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "https://evil.com")
	w := doRequest(router, r)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("SECURITY: unlisted origin %q got Allow-Origin %q, want no header",
			"https://evil.com", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("SECURITY: unlisted origin got Allow-Credentials %q", got)
	}
}

// TestCORSPreflight - OPTIONS + Access-Control-Request-Method = preflight.
func TestCORSPreflight(t *testing.T) {
	router := gin.New()
	router.Use(NewCORS(CorsConfig{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowCredentials: true,
	}))
	router.POST("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	r := httptest.NewRequest(http.MethodOptions, "/x", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "content-type,authorization")
	w := doRequest(router, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("preflight Allow-Origin = %q", got)
	}
	// Authorization header preflight me allowed hona chahiye, warna
	// authenticated API calls browser me fail honge.
	allowHeaders := w.Header().Get("Access-Control-Allow-Headers")
	if !strings.Contains(strings.ToLower(allowHeaders), "authorization") {
		t.Errorf("preflight Allow-Headers = %q, must include authorization", allowHeaders)
	}
}

// TestCORSWildcardNeverWithCredentials - `*` + credentials browsers REJECT
// karte hain. Is combination ka matlab hai "credentials mode me koi bhi origin
// allowed". Use nahi hona chahiye.
func TestCORSWildcardNeverWithCredentials(t *testing.T) {
	router := gin.New()
	router.Use(NewCORS(CorsConfig{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: false, // credentials MUST be off in wildcard mode
	}))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "https://anything.example")
	w := doRequest(router, r)

	allowOrigin := w.Header().Get("Access-Control-Allow-Origin")
	allowCreds := w.Header().Get("Access-Control-Allow-Credentials")
	if allowOrigin == "*" && allowCreds == "true" {
		t.Error("SECURITY: wildcard origin combined with credentials - browsers reject this and it allows any site to send credentials")
	}
}

// TestCORSOriginNotInRequest - koi Origin header nahi to koi CORS header nahi
// (same-origin request me bhi browser header nahi bhejta).
func TestCORSOriginNotInRequest(t *testing.T) {
	router := gin.New()
	router.Use(NewCORS(CorsConfig{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowCredentials: true,
	}))
	router.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	w := doRequest(router, httptest.NewRequest(http.MethodGet, "/x", nil))
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin = %q for a request with no Origin header, want empty", got)
	}
}

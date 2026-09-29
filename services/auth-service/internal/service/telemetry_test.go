package service

// Telemetry parsing tests - REAL user-agent strings verify karte hain.
//
// Ye zaroori hain kyunki UA parsing regex/order-sensitive hoti hai: Edge ko
// Chrome se PEHLE check karna hai (warna Edge "Chrome" dikhega), tablet ko
// mobile se pehle (iPad me "Mobile" hota hai), aur bots ko sabse pehle.

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// newRequest - test helper: real *http.Request banata hai headers ke saath
func newRequest(ua string, headers map[string]string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("User-Agent", ua)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestParseDeviceType(t *testing.T) {
	cases := []struct {
		name string
		ua   string
		want string
	}{
		{"windows chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "desktop"},
		{"mac safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "desktop"},
		{"iphone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "mobile"},
		// iPad me "Mobile" hota hai par wo TABLET hai - order test
		{"ipad is tablet not mobile", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "tablet"},
		{"android tablet no mobile", "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "tablet"},
		{"android phone", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "mobile"},
		{"googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot"},
		{"curl", "curl/8.4.0", "bot"},
		{"empty", "", "unknown"},
	}
	for _, c := range cases {
		if got := parseDeviceType(c.ua); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestParseBrowser(t *testing.T) {
	cases := []struct {
		name string
		ua   string
		want string
	}{
		// Edge UA me "Chrome" bhi hota hai - Edge pehle check hona chahiye
		{"edge not chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge 131.0.0.0"},
		{"chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome 131.0.0.0"},
		{"firefox", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133.0"},
		{"safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15", "Safari 17.1"},
		{"empty", "", "unknown"},
	}
	for _, c := range cases {
		if got := parseBrowser(c.ua); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestParseOS(t *testing.T) {
	cases := []struct {
		name string
		ua   string
		want string
	}{
		{"windows 10/11", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows 10/11"},
		{"macos", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS 10.15"},
		{"android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Android 14"},
		{"ios", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "iOS 17.0"},
		{"empty", "", "unknown"},
	}
	for _, c := range cases {
		if got := parseOS(c.ua); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestContinentForCountry(t *testing.T) {
	cases := []struct{ country, want string }{
		{"IN", "AS"},
		{"us", "NA"},
		{"GB", "EU"},
		{"BR", "SA"},
		{"ZA", "AF"},
		{"AU", "OC"},
		// Unknown / empty -> KHAALI (guess nahi karte)
		{"", ""},
		{"ZZ", ""},
	}
	for _, c := range cases {
		if got := continentForCountry(c.country); got != c.want {
			t.Errorf("country %q: got %q, want %q", c.country, got, c.want)
		}
	}
}

// Verify: no geo header -> country khaali (data fabricate nahi hota)
func TestCountryFromHeadersNoHeader(t *testing.T) {
	r := newRequest("Mozilla/5.0 (Windows NT 10.0)", nil)
	if got := countryFromHeaders(r); got != "" {
		t.Errorf("expected empty country with no geo header, got %q", got)
	}
}

// Verify: real geo header populate karta hai
func TestCountryFromHeadersPresent(t *testing.T) {
	r := newRequest("Mozilla/5.0", map[string]string{"CF-IPCountry": "IN"})
	if got := countryFromHeaders(r); got != "IN" {
		t.Errorf("expected IN from CF-IPCountry, got %q", got)
	}
	// Cloudflare "XX" (unknown) ko country NAHI maana jaana chahiye
	r2 := newRequest("Mozilla/5.0", map[string]string{"CF-IPCountry": "XX"})
	if got := countryFromHeaders(r2); got != "" {
		t.Errorf("XX should not be treated as a country, got %q", got)
	}
}

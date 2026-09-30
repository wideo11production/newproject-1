package service

// Tests for Phase A / gap #5 - verification base URL resolution.
//
// The bug being guarded: `localhost` in the verification base URL silently
// produced links that were dead on any device other than the dev machine.
// These tests pin the detection so it cannot regress back to "silently
// broken".

import (
	"net"
	"strings"
	"testing"

	"github.com/wideo11/auth-service/internal/config"
)

func svcWithBaseURL(base string) *AuthService {
	return &AuthService{
		cfg: &config.Config{
			Verification: config.VerificationConfig{BaseURL: base},
		},
	}
}

func TestVerificationBaseURLTrimsTrailingSlashes(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"http://localhost:3000", "http://localhost:3000"},
		{"http://localhost:3000/", "http://localhost:3000"},
		{"http://localhost:3000///", "http://localhost:3000"},
		{"  http://app.example.com  ", "http://app.example.com"},
		// Empty must fall back to the default, never to "".
		// An empty base would produce a relative URL like
		// "/auth/verify?token=..." which is useless in an email.
		{"", DefaultVerificationBaseURL},
		{"   ", DefaultVerificationBaseURL},
	}

	for _, tc := range cases {
		if got := svcWithBaseURL(tc.in).VerificationBaseURL(); got != tc.want {
			t.Errorf("VerificationBaseURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestBuiltURLsUseTheSameBase guards the duplication that existed before:
// three separate call sites each trimmed trailing slashes independently, so
// the link and the email template could disagree.
func TestBuiltURLsUseTheSameBase(t *testing.T) {
	s := svcWithBaseURL("http://app.example.com/")

	plain := s.BuildVerificationURL("tok123")
	if plain != "http://app.example.com/auth/verify?token=tok123" {
		t.Errorf("BuildVerificationURL = %q", plain)
	}
	if strings.Contains(plain, "//auth") {
		t.Errorf("URL has a double slash: %q", plain)
	}

	withEmail := s.BuildVerificationURLWithEmail("tok123", "a+b@example.com")
	if !strings.HasPrefix(withEmail, "http://app.example.com/auth/verify?") {
		t.Errorf("BuildVerificationURLWithEmail base mismatch: %q", withEmail)
	}
	if strings.Contains(withEmail, "//auth") {
		t.Errorf("URL has a double slash: %q", withEmail)
	}
	// '+' must be escaped or it decodes to a space.
	if strings.Contains(withEmail, "a+b@example.com") {
		t.Errorf("email not query-escaped: %q", withEmail)
	}
}

func TestCheckVerificationReachabilityDetectsLoopback(t *testing.T) {
	loopback := []string{
		"http://localhost:3000",
		"http://localhost:3000/",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:8080",
		// IPv6 loopback must be caught too, brackets included.
		"http://[::1]:3000",
		// Uppercase host.
		"http://LOCALHOST:3000",
	}
	for _, base := range loopback {
		r := svcWithBaseURL(base).CheckVerificationReachability()
		if !r.Loopback {
			t.Errorf("base %q should be detected as loopback", base)
		}
		if !r.Fatal {
			t.Errorf("base %q should be flagged fatal (phone links break)", base)
		}
		if r.Message == "" {
			t.Errorf("base %q produced no diagnostic message", base)
		}
	}
}

func TestCheckVerificationReachabilityAcceptsRealHost(t *testing.T) {
	for _, base := range []string{
		"https://app.wideo11.com",
		"https://app.wideo11.com/",
		"http://192.168.1.5:3000",
	} {
		r := svcWithBaseURL(base).CheckVerificationReachability()
		if r.Loopback {
			t.Errorf("base %q must NOT be treated as loopback", base)
		}
		if r.Fatal {
			t.Errorf("base %q must not be fatal, got: %s", base, r.Message)
		}
	}
}

func TestCheckVerificationReachabilityFlagsPlainHTTP(t *testing.T) {
	// Reachable, but tokens travel in a query string over cleartext.
	r := svcWithBaseURL("http://192.168.1.5:3000").CheckVerificationReachability()
	if r.HTTPS {
		t.Error("http:// must not be reported as HTTPS")
	}
	if r.Fatal {
		t.Error("plain HTTP on LAN is a legitimate local choice, should warn not fail")
	}
	if !strings.Contains(r.Message, "https") {
		t.Errorf("message should advise https, got: %s", r.Message)
	}

	secure := svcWithBaseURL("https://app.wideo11.com").CheckVerificationReachability()
	if !secure.HTTPS {
		t.Error("https:// must be reported as HTTPS")
	}
}

func TestCheckVerificationReachabilityRejectsGarbage(t *testing.T) {
	for _, base := range []string{"not a url", "://missing-scheme", "/relative/path"} {
		r := svcWithBaseURL(base).CheckVerificationReachability()
		if !r.Fatal {
			t.Errorf("base %q should be fatal (invalid absolute URL)", base)
		}
		if r.Message == "" {
			t.Errorf("base %q produced no diagnostic", base)
		}
	}
}

// TestLoopbackMessageIsActionable - the whole point of this feature is that
// an operator can act on the log line without reading the source.
func TestLoopbackMessageIsActionable(t *testing.T) {
	r := svcWithBaseURL("http://localhost:3000").CheckVerificationReachability()
	for _, want := range []string{"VERIFICATION_BASE_URL", "phone", "SECURITY_ALLOWED_ORIGINS"} {
		if !strings.Contains(r.Message, want) {
			t.Errorf("message should mention %q, got: %s", want, r.Message)
		}
	}
}

// TestLanHintSkipsVirtualAdapters - the first version of lanHint() returned
// the Docker bridge IP (172.19.x.x), which is unreachable from a phone. That
// made the "do this to fix it" advice actively wrong. This guards the filter.
func TestLanHintSkipsVirtualAdapters(t *testing.T) {
	hint := lanHint()
	if hint == "" || strings.HasPrefix(hint, "<") {
		t.Skip("no usable interface on this machine")
	}
	ip := net.ParseIP(hint)
	if ip == nil {
		t.Fatalf("lanHint() returned a non-IP value: %q", hint)
	}
	if ip.IsLoopback() {
		t.Errorf("lanHint() returned a loopback address %q", hint)
	}
	// Docker, WSL, Hyper-V and vEthernet bridges all live in these ranges.
	// A real LAN can also be private, so this is a heuristic - but 172.16/12
	// is overwhelmingly the container bridge, which is what bit us.
	if strings.HasPrefix(hint, "172.17.") || strings.HasPrefix(hint, "172.18.") ||
		strings.HasPrefix(hint, "172.19.") || strings.HasPrefix(hint, "172.20.") {
		t.Errorf("lanHint() looks like a Docker bridge address: %q", hint)
	}
}

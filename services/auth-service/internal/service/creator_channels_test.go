package service

// Tests for Phase B1 channel management.
//
// Focus is on the two things that are actually dangerous here:
//  1. URL sanitization - the stored-XSS vector
//  2. Postgres error classification - if isCheckViolation silently returns
//     false, DB constraint rejections surface as 500 instead of 4xx

import (
	"strings"
	"testing"
)

// TestSanitizeChannelURLBlocksXSSVectors is the important one.
//
// A channel cover/image URL ends up rendered in `src=` / `background-image`
// in a browser. If a `javascript:` URL can be stored, any panel that renders
// it turns into a script-execution point for whoever controls that channel.
func TestSanitizeChannelURLBlocksXSSVectors(t *testing.T) {
	mustReject := []string{
		"javascript:alert(1)",
		"javascript:alert(document.cookie)",
		"JaVaScRiPt:alert(1)",   // scheme is case-insensitive
		"  javascript:alert(1)", // leading whitespace must not bypass
		"data:text/html,<script>alert(1)</script>",
		"data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==",
		"vbscript:msgbox(1)",
		"file:///etc/passwd",
		"blob:https://evil.com/uuid",
		// Protocol-relative: browser treats this as //evil.com, i.e. an
		// external origin even though it "looks relative".
		"//evil.com/x.png",
		// Path traversal.
		"/../admin/secret.png",
		"/avatars/../../etc/passwd",
	}
	for _, in := range mustReject {
		if _, err := sanitizeChannelURL(in); err == nil {
			t.Errorf("SECURITY: sanitizeChannelURL(%q) was ACCEPTED, want rejected", in)
		}
	}
}

func TestSanitizeChannelURLAcceptsLegitimateValues(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},    // clear
		{"   ", ""}, // whitespace-only = clear
		{"/avatars/abc/1234.png", "/avatars/abc/1234.png"},
		{"http://localhost:9000/avatars/a/b.png", "http://localhost:9000/avatars/a/b.png"},
		{"https://cdn.example.com/cover.webp", "https://cdn.example.com/cover.webp"},
		{"HTTPS://CDN.EXAMPLE.COM/C.PNG", "HTTPS://CDN.EXAMPLE.COM/C.PNG"},
		{"  https://cdn.example.com/c.png  ", "https://cdn.example.com/c.png"},
	}
	for _, tc := range cases {
		got, err := sanitizeChannelURL(tc.in)
		if err != nil {
			t.Errorf("sanitizeChannelURL(%q) returned error %v, want accepted", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("sanitizeChannelURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSanitizeChannelURLEnforcesLength(t *testing.T) {
	long := "https://example.com/" + strings.Repeat("a", 600)
	if _, err := sanitizeChannelURL(long); err == nil {
		t.Error("a URL longer than 500 chars must be rejected")
	}

	// Exactly at the limit must pass.
	atLimit := "https://example.com/" + strings.Repeat("a", 500-len("https://example.com/"))
	if len(atLimit) != 500 {
		t.Fatalf("test setup wrong, len=%d", len(atLimit))
	}
	if _, err := sanitizeChannelURL(atLimit); err != nil {
		t.Errorf("a URL of exactly 500 chars must be accepted, got %v", err)
	}
}

func TestIsCheckViolation(t *testing.T) {
	shouldMatch := []string{
		`ERROR: new row for relation "channels" violates check constraint "ch_handle_format" (SQLSTATE 23514)`,
		`pq: ERROR: 23514`,
	}
	for _, s := range shouldMatch {
		if !isCheckViolation(errors_New(s)) {
			t.Errorf("isCheckViolation should match %q", s)
		}
	}
	shouldNotMatch := []string{
		`ERROR: duplicate key value violates unique constraint (SQLSTATE 23505)`,
		`dial tcp 127.0.0.1:5432: connection refused`,
	}
	for _, s := range shouldNotMatch {
		if isCheckViolation(errors_New(s)) {
			t.Errorf("isCheckViolation should NOT match %q", s)
		}
	}
	if isCheckViolation(nil) {
		t.Error("isCheckViolation(nil) must be false")
	}
}

// TestIsUniqueViolationUnaffected makes sure the new check-violation helper
// did not overlap with the pre-existing unique-violation helper. If they
// both matched the same error, a duplicate handle would be reported as a
// generic 404 instead of the useful 409.
func TestIsUniqueViolationUnaffected(t *testing.T) {
	dupErr := errors_New(`ERROR: duplicate key value violates unique constraint "idx_channels_user_handle" (SQLSTATE 23505)`)
	if !isUniqueViolation(dupErr) {
		t.Error("isUniqueViolation must still detect duplicate handles")
	}
	if isCheckViolation(dupErr) {
		t.Error("a unique violation must not be classified as a check violation")
	}
}

// errors_New - a tiny local helper so the test file does not need the
// errors import shadowed by the service package's own helpers.
func errors_New(msg string) error { return &testErr{msg} }

type testErr struct{ msg string }

func (e *testErr) Error() string { return e.msg }

package main

// Regression tests for the passkey login being a REAL login.
//
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ----------------------------------------------------------------------------
//
// `FinishAuthentication` verified a genuine WebAuthn signature - phishing
// resistant, nothing to steal, the strongest authentication this product can do
// - and then returned:
//
//     {"verified": true, "email": "...", "message": "..."}
//
// No token. No session. No cookie. There was no possible next step, so the
// strongest factor in the system was performed correctly and thrown away, and a
// password was the only way to obtain a session.
//
// The function's own comment claimed the flow was "more secure than a password".
// That was true of the signature and false of the product.
//
// Every signal said it worked. `POST /login/finish` returned 200. The tests
// passed. The doc comment described the property. A source grep for "verified"
// finds it on the success path. This is the same failure shape as the resize
// test that was asserting its own bug, and the scrollbar assertion that was
// always failing: a check that returns OK because it verified the wrong thing.
//
// ----------------------------------------------------------------------------
// WHAT IS ASSERTED, AND WHY IT IS A SOURCE CHECK
// ----------------------------------------------------------------------------
//
// A real end-to-end test needs a real authenticator: a software one, a
// ceremony, a signed assertion. That is genuinely worth having and it is not
// what can run in `go test ./...`.
//
// What CAN run here is the property that actually regressed, and it is a
// property of the SOURCE: does the success path hand back a token pair? That is
// what turns "I was verified" into "I am logged in", and a comment cannot fake
// it. So the assertion is deliberately narrow and deliberately boring:
//
//   1. the success path references tokens
//   2. the success path calls the session-issuing service, not a stub
//   3. the constructor cannot be built without the auth service, so the
//      "verified but logged nowhere" shape is unrepresentable
//   4. both public passkey routes are rate limited
//
// Each of those, if it fails, is the exact bug this file is named after.

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Paths are relative to this package's directory (`cmd/auth-service`), which is
// where `go test` runs - the same convention `routes_test.go` uses for main.go.
const (
	webauthnHandlerPath = "../../internal/handler/webauthn.go"
	mainPath            = "main.go"
)

func readSource(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read %s: %v", path, err)
	}
	return string(b)
}

// funcBody returns the source of a top-level func, brace-matched AND stripped of
// comments.
//
// ---- WHY COMMENTS ARE STRIPPED, AND WHY IT MATTERS HERE ----
//
// The first version of this test asserted `strings.Contains(body,
// "LoginWithWebAuthn")`. It passed with the call REMOVED, because the line
// directly above the removed call read:
//
//	// `LoginWithWebAuthn` re-checks IsActive and IsVerified.
//
// The comment kept the assertion true while the code was broken. This is the
// repository's own recorded lesson, fourth occurrence and counting:
//
//  1. `ticket.upload_url` - a comment-level drift between two copies
//  2. `ALTER COLUMN ... TYPE` - a comment saying "TYPE added", statement had none
//  3. a `# security_profile` comment justifying an omitted COMMENT ON
//  4. `prometheusUrl` - a comment explaining why it must not be sent, on the line
//     above the statement sending it
//  5. this test
//
// A comment explaining a security property is not evidence the property holds.
// The only evidence is a check that fails when the property stops holding - and a
// check that greps source CANNOT be that check unless it ignores comments. So it
// ignores them.
//
// Brace counting is enough for extraction: Go source here has no string literal
// containing an unbalanced brace on the paths being read, and a real parser
// would be a much larger dependency for a test whose job is to notice a missing
// call.
func funcBody(t *testing.T, src, name string) string {
	t.Helper()

	start := regexp.MustCompile(`(?m)^func\s+(\([^)]*\)\s*)?` + regexp.QuoteMeta(name) + `\b`)
	loc := start.FindStringIndex(src)
	if loc == nil {
		t.Fatalf("func %s not found - if it was renamed, this test needs updating", name)
	}

	depth := 0
	seen := false
	for i := loc[1]; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
			seen = true
		case '}':
			depth--
			if seen && depth == 0 {
				return stripComments(src[loc[1] : i+1])
			}
		}
	}
	t.Fatalf("func %s: braces never balanced", name)
	return ""
}

// lineComment matches a `//` comment to end of line.
var lineComment = regexp.MustCompile(`//[^\n]*`)

// blockComment matches a /* ... */ comment, non-greedy.
var blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)

// stripComments removes comments, replacing each with a single space so that
// `a /* x */ b` does not become `ab`.
//
// Not string-aware: a `"http://example"` literal inside a comment-adjacent string
// would be truncated. That is acceptable here and is stated rather than hidden -
// the assertions are about the presence of calls and keys, and truncating a URL
// cannot change either answer. Making this fully correct means writing a Go
// parser, which is a much larger thing to maintain than the property it buys.
func stripComments(s string) string {
	s = blockComment.ReplaceAllString(s, " ")
	return lineComment.ReplaceAllString(s, " ")
}

// TestFinishAuthenticationIssuesASession is the core assertion.
//
// It fails if the success path stops handing back a token pair. That is the
// whole regression: a verified assertion that grants no session.
func TestFinishAuthenticationIssuesASession(t *testing.T) {
	body := funcBody(t, readSource(t, webauthnHandlerPath), "FinishAuthentication")

	if !strings.Contains(body, "LoginWithWebAuthn") {
		t.Fatal("FinishAuthentication no longer calls LoginWithWebAuthn.\n" +
			"That call is what issues the session. Without it this handler verifies a\n" +
			"passkey and then returns a success response that logs nobody in - the\n" +
			"dead-end shape this test exists to prevent.")
	}

	if !strings.Contains(body, "tokenPair") {
		t.Fatal("FinishAuthentication does not reference a token pair.\n" +
			"A verified passkey must return the SAME token pair a password login\n" +
			"returns. See service.AuthService.LoginWithWebAuthn.")
	}

	// The response must actually carry it. `tokens` is the key the web app's BFF
	// reads; a token pair computed and dropped is the same dead end with extra
	// steps.
	if !strings.Contains(body, `"tokens"`) {
		t.Fatal(`FinishAuthentication's response has no "tokens" key.\n` +
			`apps/web reads response.tokens. A differently-named key means the client ` +
			"receives a success and no credential.")
	}
}

// TestWebAuthnHandlerCannotBeBuiltWithoutAnAuthService pins the shape at
// construction time.
//
// The dead end was representable: `NewWebAuthnHandler(svc)` with one argument
// compiled fine, and the resulting handler had no way to issue a session. Making
// the auth service a required constructor parameter means the broken object
// cannot be built at all - the compiler, rather than a comment, is what prevents
// it.
func TestWebAuthnHandlerCannotBeBuiltWithoutAnAuthService(t *testing.T) {
	src := stripComments(readSource(t, webauthnHandlerPath))

	ctor := funcBody(t, src, "NewWebAuthnHandler")
	if !strings.Contains(ctor, "authSvc") {
		t.Fatal("NewWebAuthnHandler does not take an auth service.\n" +
			"Without it the handler can verify a passkey but cannot issue a session,\n" +
			"which is the dead-end bug. The compiler should refuse to build this.")
	}

	if !strings.Contains(ctor, "securitySvc") {
		t.Fatal("NewWebAuthnHandler does not take the security service.\n" +
			"It is needed to report the mandatory PIN/questions/biometric gate state,\n" +
			"so a passkey login cannot skip the gate a password login must pass.")
	}
}

// TestWebAuthnHandlerFailsClosedWithoutServices pins the runtime behaviour.
//
// A nil auth service must produce an error, never `{"verified": true}`. A success
// response that grants nothing is worse than an error: the client falls through
// to the password form and nobody learns the passkey path is broken.
func TestWebAuthnHandlerFailsClosedWithoutServices(t *testing.T) {
	body := funcBody(t, readSource(t, webauthnHandlerPath), "FinishAuthentication")

	if !strings.Contains(body, "authSvc == nil") {
		t.Fatal("FinishAuthentication does not check for a nil auth service.\n" +
			"It must refuse rather than report a verification it cannot convert into a session.")
	}
	if !strings.Contains(body, "StatusServiceUnavailable") {
		t.Fatal("FinishAuthentication does not answer 503 when it cannot issue a session.")
	}

	// The gate check must also fail closed: an unreadable profile is NOT a
	// completed profile.
	securityComplete := funcBody(t, readSource(t, webauthnHandlerPath), "securitySetupComplete")
	if !strings.Contains(securityComplete, "return false") {
		t.Fatal("securitySetupComplete has no failing path.\n" +
			"A passkey must not reach the dashboard without a PIN because the profile\n" +
			"could not be read.")
	}
}

// TestPasskeyLoginRoutesAreRateLimited.
//
// `/webauthn/login/begin` takes an email and answers `no biometric credential
// registered` versus a real challenge. Unthrottled, that is an email-enumeration
// oracle for any address on the internet, with no credential, forever.
//
// `/webauthn/login/finish` mints the session, so unthrottled it is an
// unthrottled challenge-guessing surface.
//
// Both sat next to a password login carrying four policies and had none. A
// strong factor behind an open door is not two-factor authentication.
func TestPasskeyLoginRoutesAreRateLimited(t *testing.T) {
	// Comments stripped, for the same reason `funcBody` does it: the block
	// above these routes is three paragraphs long and describes the rate limits
	// in detail, which is precisely the kind of text that satisfies a substring
	// match while the code has none.
	src := stripComments(readSource(t, mainPath))

	for _, route := range []string{"/login/begin", "/login/finish"} {
		idx := strings.Index(src, `waPublic.POST("`+route+`"`)
		if idx < 0 {
			t.Fatalf("waPublic.POST(%q) not found in main.go", route)
		}

		// Look at the registration call: from the route literal up to the handler
		// reference, so a RateLimit registered on a different line cannot
		// accidentally satisfy this.
		rest := src[idx:]
		end := strings.Index(rest, "waHandler.")
		if end < 0 {
			t.Fatalf("cannot find the handler reference after %q", route)
		}
		call := rest[:end]

		if !strings.Contains(call, "RateLimit") {
			t.Errorf("%s is not rate limited.\n"+
				"It is public by necessity and reachable without a credential, so an\n"+
				"unlimited version is an enumeration or guessing oracle.", route)
		}
	}
}

// TestPasskeyProtectedRoutesCheckRevocation.
//
// `CheckRevoked` was missing from the whole `/webauthn` group. `AuthMiddleware`
// verifies a JWT's signature and expiry, and a token that was revoked at logout
// still passes both - revocation lives in a Redis denylist that
// `AuthMiddleware` does not read.
//
// So a logged-out device could still re-enrol a passkey and read its own
// credential list, until the token happened to expire. Every other protected
// group in this file already carried the check; this one was the omission.
func TestPasskeyProtectedRoutesCheckRevocation(t *testing.T) {
	src := stripComments(readSource(t, mainPath))

	idx := strings.Index(src, `waProtected := auth.Group("/webauthn")`)
	if idx < 0 {
		t.Fatal(`waProtected group not found in main.go`)
	}

	// From the group declaration to the end of its block.
	rest := src[idx:]
	end := strings.Index(rest, "\n\t}")
	if end < 0 {
		end = len(rest)
	}
	block := rest[:end]

	if !strings.Contains(block, "CheckRevoked") {
		t.Error("the /webauthn protected group has no CheckRevoked.\n" +
			"A revoked session's token still passes signature and expiry checks, so\n" +
			"without the denylist lookup a logged-out device keeps full access until\n" +
			"the access token expires on its own.")
	}
}

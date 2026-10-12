package handler

// Test-only helpers shared by the authz tests.
//
// -----------------------------------------------------------------------------
// WHY THESE LIVE IN THEIR OWN FILE
// -----------------------------------------------------------------------------
//
// `passkey_login_test.go` and `revocation_coverage_test.go` each declared their own
// `stripComments`, `lineComment` and `blockComment`, and the package failed to build
// with three "redeclared in this block" errors.
//
// That is the smallest possible version of the mistake this repository keeps making:
// three copies of one helper in one package. It was caught by the compiler here,
// which is the good case. The version that is NOT caught is two copies that drift,
// and then one test strips comments differently from the test that relies on it.
//
// So: one implementation, in one place, used by every test in this package.

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// lineComment matches `//` to end of line, but NOT the `//` inside a URL literal.
//
// The negative lookbehind on `:` is what preserves `http://localhost`. Without it,
// stripping comments from a file containing a URL mangles the URL, and a test that
// then greps for a path finds a half-deleted one.
var lineComment = regexp.MustCompile(`(^|[^:])//[^\n]*`)

// blockComment matches a /* ... */ comment.
var blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)

// stripComments removes comments, replacing each with a single space so that
// `a /* x */ b` does not become `ab`.
//
// COMMENTS ARE STRIPPED BEFORE EVERY SOURCE ASSERTION IN THIS PACKAGE, and that is
// not a style preference. It is the repository's most persistent lesson, and it has
// now bitten six separate times:
//
//   1. `ticket.upload_url` - a comment-level drift between two copies
//   2. `ALTER COLUMN ... TYPE` - a comment saying "TYPE added", statement had none
//   3. a `# security_profile` comment justifying an omitted COMMENT ON
//   4. `prometheusUrl` - a comment explaining why it must not be sent, on the line
//      above the statement sending it
//   5. `TestFinishAuthenticationIssuesASession` - a comment mentioning the call
//      that had been deleted
//   6. `check-icon-decodes` / `check-favicon-updateable` - comments describing the
//      `icons:` key satisfied a substring assertion after the key was removed
//
// A check that matches source text also matches the prose ABOUT that source, and
// this codebase documents itself thoroughly. Every assertion therefore runs on
// code with the prose removed.
//
// Not string-aware: a `//` inside a Go string literal would be treated as a
// comment. That is stated rather than hidden — the assertions in this package match
// identifiers and call shapes, not string contents, and a comment stripped out of a
// string cannot change either answer.
func stripComments(src string) string {
	src = blockComment.ReplaceAllString(src, " ")
	return lineComment.ReplaceAllString(src, "$1")
}

// readHandlerSource reads a sibling file in this package, with comments stripped.
func readHandlerSource(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(".", name))
	if err != nil {
		t.Fatalf("cannot read %s: %v", name, err)
	}
	return stripComments(string(b))
}

// readMainFile reads `main.go` from `cmd/auth-service`, with comments stripped.
// Used by the wiring tests, which assert things about the route table.
//
// The path is `../../cmd/auth-service/main.go` and NOT `../../main.go`.
//
// The comment above this function said "the sibling `main.go` in
// `cmd/auth-service`" from the day it was written, and the path never matched
// that sentence: from `internal/handler/`, `../../main.go` resolves to
// `services/auth-service/main.go`, which does not exist. So every wiring test
// that called this failed at `t.Fatalf("cannot read main.go")` - a failure that
// looks like a missing file rather than a broken assertion, and that was left
// standing long enough to be reported as "two pre-existing failures".
//
// A reader would do well to note which direction this bug fails. These tests
// assert the internal grant route is REGISTERED and GUARDED. A helper that cannot
// read the file cannot assert anything, so the failure is loud and the route stays
// correct. Had the path silently pointed at some OTHER main.go - a second
// service's, say - the assertions would have run, failed, and looked like the
// wiring was broken. Failing to read beats reading the wrong file.
//
// `stripComments` still applies: the assertions match call shapes, and prose
// ABOUT a route is not a route.
func readMainFile(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "cmd", "auth-service", "main.go"))
	if err != nil {
		t.Fatalf("cannot read cmd/auth-service/main.go: %v\n"+
			"  Expected it at internal/handler/../../cmd/auth-service/main.go", err)
	}
	return stripComments(string(b))
}

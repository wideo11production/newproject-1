package main

// Regression tests for revocation coverage on every protected route group.
//
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ----------------------------------------------------------------------------
//
// `CheckRevoked` was present on `protected` and absent on four other groups:
// `/security`, `/admin` (superadmin), `/webauthn`, and the awareness group.
// Every one of those omissions looks identical in review and none of them
// produces an error.
//
// The mechanism is worth spelling out, because "the token is revoked" and "the
// token is invalid" are different claims and only one of them is checked by
// signature:
//
//	AuthMiddleware  -> verifies the JWT signature and its `exp`
//	CheckRevoked    -> asks Redis whether this session id is on the denylist
//
// A token that was revoked at logout still has a VALID signature and a FUTURE
// `exp`. It passes `AuthMiddleware` completely. The only thing that rejects it is
// the denylist lookup - so a group missing that lookup accepts logged-out
// sessions until the access token expires by itself, with no error anywhere.
//
// The severity is not uniform, and that is why this test names each group:
//
//	/admin          every user's security events, session history, device lock,
//	                account purging. Revoking a superadmin session is the
//	                documented incident-response action; on this group it did not
//	                take effect.
//	/security       PIN, security questions, biometric enrolment. A revoked
//	                session could reconfigure the very credentials account
//	                recovery depends on.
//	/webauthn       enrol a new passkey, list credentials.
//	/security/*-protected sub-group   see above.
//
// A group that "should" have it and does not is indistinguishable from one that
// was deliberately left off, and there is no way to tell them apart from the
// outside. So the expectation is written down here, per group, and a new group
// has to be added to the table rather than inheriting the answer by accident.

import (
	"regexp"
	"strings"
	"testing"
)

// groupGuard is the expected revocation guard for one protected group.
type groupGuard struct {
	// The variable main.go assigns the group to.
	variable string
	// What the group exposes, for the failure message.
	protects string
	// The parent group this one is derived from, when the guard is INHERITED
	// rather than attached here.
	//
	// Gin middleware is cumulative down the chain: `protected.Group("/admin")`
	// inherits everything `protected` used. So `adminRBAC` is protected by
	// revocation without mentioning it, and asserting a literal `CheckRevoked` in
	// its block would be asserting something untrue about how gin works - and the
	// fix would be to add a redundant second attachment.
	inherits string
}

// protectedGroups is the table.
//
// APPEND-ONLY for new protected groups. A new group with no entry here is
// untested, which is the whole problem this file exists to solve.
var protectedGroups = []groupGuard{
	{
		variable: "protected",
		protects: "every authenticated route: profile, settings, PIN, rollover",
	},
	{
		variable: "secProtected",
		protects: "PIN / security questions / biometric enrolment - account recovery inputs",
	},
	{
		variable: "waProtected",
		protects: "passkey enrolment and credential listing",
	},
	{
		variable:    "adminRBAC",
		protects:    "RBAC registry and service grants",
		inherits:    "protected",
	},
}

// hasRevocationGuard reports whether a block attaches the revocation check.
//
// Deliberately asserts on `CheckRevoked` ALONE, not on a `revocationStore != nil`
// conditional alongside it.
//
// The first version required both halves and reported `protected` as unprotected -
// a group that has carried the check all along. `protected` attaches it
// unconditionally because `CheckRevoked(nil)` already passes requests through
// (`revocation.go:145`), so a nil guard there is redundant. Requiring the
// conditional would have meant adding dead `if` blocks to three route groups to
// satisfy a test, which is the wrong direction: the assertion exists to catch a
// MISSING guard, not to mandate one particular way of writing a present one.
func hasRevocationGuard(block string) bool {
	return strings.Contains(block, "CheckRevoked(revocationStore)")
}

// groupBlock returns the source of a group's declaration through its closing
// brace, brace-matched.
//
// NOT `strings.Index(rest, "\n\t}")`. That finds the FIRST closing brace at that
// indent, and `protected` contains many nested blocks - so the extracted "block"
// stopped at the end of the first inner block and the assertion below could not
// see the `CheckRevoked` call that is genuinely four lines after the declaration.
// The first version of this test reported `protected` as unprotected, which was
// the test being wrong about a route group that was correct.
//
// This is the same shape as `passkey_login_test.go`'s `funcBody`: the assertion is
// cheap, and getting the extraction wrong produces a confident false negative that
// sends somebody to fix working code.
func groupBlock(t *testing.T, src, variable string) string {
	t.Helper()

	decl := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(variable) + `\s*:=\s*`)
	loc := decl.FindStringIndex(src)
	if loc == nil {
		t.Fatalf("group %q not found in main.go", variable)
	}

	depth := 0
	seen := false
	for i := loc[0]; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
			seen = true
		case '}':
			depth--
			if seen && depth == 0 {
				return src[loc[0] : i+1]
			}
		}
	}
	t.Fatalf("group %q: braces never balanced", variable)
	return ""
}

// TestEveryProtectedGroupChecksRevocation asserts each group in the table attaches
// the guard, or inherits it from a parent that does.
//
// Comments are stripped first. The block above each group is a long explanation of
// why the check is there - and an explanation containing the words "CheckRevoked"
// is precisely what a naive substring assertion matches on when the code is
// missing. This is the same trap as `passkey_login_test.go`, reached by a
// different route: a comment explaining a security property is not the property.
func TestEveryProtectedGroupChecksRevocation(t *testing.T) {
	src := stripComments(readSource(t, mainPath))

	for _, g := range protectedGroups {
		t.Run(g.variable, func(t *testing.T) {
			block := groupBlock(t, src, g.variable)

			// Inherited: assert the PARENT carries it, and assert that this group
			// really is derived from that parent. Both halves - a parent that lost
			// its guard must fail here, not silently weaken the child.
			if g.inherits != "" {
				if !strings.Contains(block, "."+g.inherits+`.Group(`) &&
					!strings.Contains(block, g.inherits+`.Group(`) {
					t.Errorf("%s no longer derives from %s, so it inherits nothing.\n"+
						"  Either re-derive it or add a revocation check of its own.",
						g.variable, g.inherits)
					return
				}
				block = groupBlock(t, src, g.inherits)
				g.protects += " (inherited from " + g.inherits + ")"
			}

			if !hasRevocationGuard(block) {
				t.Errorf("%s has no revocation check; it protects %s.\n"+
					"AuthMiddleware verifies the signature and expiry, and a revoked\n"+
					"token still has both. Only the Redis denylist rejects it, so without\n"+
					"CheckRevoked a logged-out session keeps access until the access token\n"+
					"expires on its own.",
					g.variable, g.protects)
			}
		})
	}
}

// TestSuperadminGroupChecksRevocation covers `/admin/*` separately.
//
// It cannot go in the table because that group is registered from inside
// `internal/handler/superadmin.go`, not from `main.go` - so the middleware is
// passed IN as an argument rather than attached here. Two files, two shapes, one
// rule; the rule is what this test states.
func TestSuperadminGroupChecksRevocation(t *testing.T) {
	// 1. main.go must actually pass the guard in.
	//
	// The call spans several lines, so the slice is brace/paren-matched rather
	// than cut at the first `)`. The first version used `strings.Index(call, ")")`
	// and stopped inside `middleware.CheckRevoked(revocationStore)` - reporting
	// that the guard was absent from a call that contained it.
	src := stripComments(readSource(t, mainPath))

	marker := "superadminHandler.RegisterRoutes("
	idx := strings.Index(src, marker)
	if idx < 0 {
		t.Fatal("superadminHandler.RegisterRoutes(...) not found in main.go")
	}

	depth := 0
	call := ""
	for i := idx + len(marker) - 1; i < len(src); i++ {
		switch src[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				call = src[idx : i+1]
				i = len(src)
			}
		}
	}

	if !hasRevocationGuard(call) {
		t.Error("main.go does not pass a revocation guard to RegisterRoutes.\n" +
			"/admin/* exposes every user's security events, session history, the device\n" +
			"lock and account purging. Revoking a superadmin session is the documented\n" +
			"incident-response action, and without this it does not take effect.\n" +
			"  call was: " + call)
	}

	// 2. The handler must APPLY whatever it is given.
	//
	// Passing the guard and then ignoring it is the shape where the call site
	// looks correct in review and the routes are unprotected at runtime. Both
	// halves are asserted, because only checking the first is how a fix gets
	// credited for working.
	handlerSrc := stripComments(readSource(t, "../../internal/handler/superadmin.go"))
	if !strings.Contains(handlerSrc, "extraMW") {
		t.Error("RegisterRoutes does not accept extra middleware.\n" +
			"The call site passes a revocation guard that the handler then drops.")
	}
	if !regexp.MustCompile(`for\s+_,\s*mw\s*:=\s*range\s+extraMW`).MatchString(handlerSrc) {
		t.Error("RegisterRoutes accepts extra middleware but never applies it.\n" +
			"A guard that is passed in and not used is worse than one that is absent,\n" +
			"because it reads as fixed.")
	}
}

// TestPublicGroupsDoNotCheckRevocation is the negative direction.
//
// `CheckRevoked` on a group that runs BEFORE authentication would reject every
// request, because there is no session id to look up yet. So this table also
// protects against the opposite mistake, and both halves are needed: a codebase
// where the answer to "should this group check revocation?" is always yes has
// simply moved the bug.
func TestPublicGroupsDoNotCheckRevocation(t *testing.T) {
	src := stripComments(readSource(t, mainPath))

	for _, group := range []struct{ variable, why string }{
		{"secGroup", "lockout status and PIN verify - both run before a session exists"},
		{"waPublic", "passkey login - proves identity, so there is nothing to revoke yet"},
	} {
		block := groupBlock(t, src, group.variable)

		if strings.Contains(block, "CheckRevoked") {
			t.Errorf("%s applies CheckRevoked, but %s.\n"+
				"Revocation is looked up by session id, and a request that has not\n"+
				"authenticated has none - so this rejects everything, including\n"+
				"legitimate logins.", group.variable, group.why)
		}
	}
}

package main

// Regression tests for the RBAC wiring.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// -----------------------------------------------------------------------------
//
// `requirePermission` was an UNEXPORTED method on `AuthHandler`. An unexported
// method in package `handler` cannot be called from package `main`, which is the
// only place routes are registered - so it had no reachable call site.
//
// Its own comment, in `main.go`, claimed:
//
//     `requirePermission` IS a middleware, and is applied per-route where it is
//     used, so a handler cannot forget to call it.
//
// That was false for as long as it stood. `grep` found two mentions of
// `requirePermission(`, and BOTH were inside comments.
//
// The consequence was not a latent risk. Fifteen capabilities in `rbac.go`, four
// ranked system roles, an anti-escalation check in `Appoint` that refuses to let
// anyone grant a permission they do not themselves hold - none of it ran, ever.
// Every gate in the product checked a ROLE and nothing else, and any signed-in
// account could create, edit and delete channels regardless of any capability.
//
// -----------------------------------------------------------------------------
// WHY A SOURCE-LEVEL TEST AND NOT AN HTTP TEST
// -----------------------------------------------------------------------------
//
// An HTTP test would prove the wiring works TODAY. This proves it is still wired
// after the next refactor, which is the failure that actually happened: the
// original code passed every test it had, for as long as it had them.
//
// It also cannot be done at runtime here. `RequirePermission` needs a live
// `superadmin_accounts` row and a signed JWT, and asserting "the permission
// middleware is registered on the channel routes" is a statement about the ROUTE
// TABLE, which only the source knows.
//
// The alternative - spinning up the whole service in a test - was rejected because
// it would be a slow test guarding a fast-moving fact, and a slow test guarding
// something important gets skipped.
//
// -----------------------------------------------------------------------------
// COMMENTS ARE STRIPPED BEFORE EVERY ASSERTION
//
// The fifth recorded instance of this repository's most persistent mistake, and the
// one this file exists to not repeat: a check that matches source text also matches
// the comments, and this codebase's comments discuss these very functions at
// length. A version of this test that did not strip comments would pass with every
// route unwired, and would pass with every route mis-wired, and would report
// success the entire time.

import (
	"os"
	"strings"
	"testing"
)

// NOTE: `stripComments`, `lineComment` and `blockComment` are NOT declared here.
//
// They already exist in `passkey_login_test.go`, in the same package. The first
// version of this file declared its own copies and the package failed to build with
// three "redeclared in this block" errors.
//
// Which is the smallest possible version of the mistake this repository keeps
// making: three copies of a comment-stripper in one package. It is caught by the
// compiler here, which is the good case. The version that is NOT caught is two
// copies that drift, and then a test that strips comments differently from the test
// that relies on it.
//
// One implementation, used by both.

func readMain(t *testing.T) (raw, clean string) {
	t.Helper()
	b, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("cannot read main.go: %v", err)
	}
	raw = string(b)
	return raw, stripComments(raw)
}

// routeBlock returns the source of one route registration, from its verb+path to
// the end of the statement.
//
// Brace/paren matching rather than a fixed window, because the first version cut
// at the first `\n\t}` and every one of these registrations sits inside a block
// with nested braces. It reported `protected` as unprotected in
// `revocation_coverage_test.go` - a confident false negative pointing at working
// code, which is the most expensive kind of check failure.
func routeBlock(t *testing.T, src, needle string) string {
	t.Helper()
	idx := strings.Index(src, needle)
	if idx < 0 {
		t.Fatalf("route %q not found in main.go", needle)
	}
	rest := src[idx:]

	// Walk to the end of the call: balance parens from the first `(` after the path.
	open := strings.Index(rest, "(")
	if open < 0 {
		return rest
	}
	depth := 0
	for i := open; i < len(rest); i++ {
		switch rest[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return rest[:i+1]
			}
		}
	}
	return rest
}

// creatorRoutes are the routes that must carry a capability check.
//
// The permission each one needs is named, because "is it protected" is the wrong
// question - `protected` already guarantees a valid session, which is exactly what
// was there before and exactly what was not enough.
var creatorRoutes = []struct {
	name       string
	route      string
	permission string
}{
	{"create a channel", `protected.POST("/channels"`, "PermChannelCreate"},
	{"edit a channel", `protected.PATCH("/channels/:id"`, "PermChannelEdit"},
	{"delete a channel", `protected.DELETE("/channels/:id"`, "PermChannelDelete"},
	{"upload channel cover", `protected.POST("/channels/:id/cover/upload-url"`, "PermMediaUpload"},
	{"finalize channel cover", `protected.POST("/channels/:id/cover/finalize"`, "PermMediaUpload"},
	{"cover upload during create", `protected.POST("/channels/cover/upload-url"`, "PermChannelCreate"},
}

// TestCreatorRoutesRequireAPermission is the core assertion.
func TestCreatorRoutesRequireAPermission(t *testing.T) {
	_, clean := readMain(t)

	for _, r := range creatorRoutes {
		t.Run(r.name, func(t *testing.T) {
			block := routeBlock(t, clean, r.route)

			if !strings.Contains(block, "RequirePermission") {
				t.Errorf("%s carries NO capability check.\n"+
					"  It is on `protected`, which means \"any valid session\" - so any\n"+
					"  signed-in account can do this, whatever its role.\n"+
					"  Expected RequirePermission(service.%s).", r.route, r.permission)
				return
			}

			if !strings.Contains(block, r.permission) {
				t.Errorf("%s is checked, but for the WRONG capability.\n"+
					"  Expected service.%s. A permission gate on the wrong capability is\n"+
					"  worse than none, because it reads as protected.", r.route, r.permission)
			}
		})
	}
}

// TestReadingAChannelNeedsNoPermission guards against over-correcting.
//
// Listing and reading channels are not creator capabilities - every viewer needs
// to see a channel. Adding `channel.create` to the GET routes would lock ordinary
// users out of the product to satisfy a pattern, which is the failure mode of any
// rule applied without asking what it is for.
func TestReadingAChannelNeedsNoPermission(t *testing.T) {
	_, clean := readMain(t)

	for _, route := range []string{
		`protected.GET("/channels"`,
		`protected.GET("/channels/:id"`,
	} {
		block := routeBlock(t, clean, route)
		if strings.Contains(block, "RequirePermission") {
			t.Errorf("%s now requires a capability.\n"+
				"  Reading is not a creator capability. Gating it would lock out every\n"+
				"  viewer, which is a different product than the one that was asked for.",
				route)
		}
	}
}

// TestPermissionMiddlewareIsExported pins the specific bug.
//
// It was `requirePermission`, lowercase. `go vet` does not flag an unused method,
// `go build` does not flag it, and the compiler will not tell you that a security
// control is unreachable from the only place it could be called - it just declines
// to let you call it, from `main`, silently, because you never tried.
//
// So the assertion is that the name is EXPORTED. Lowercase again means no route
// can register it.
func TestPermissionMiddlewareIsExported(t *testing.T) {
	b, err := os.ReadFile("../../internal/handler/rbac.go")
	if err != nil {
		t.Fatalf("cannot read rbac.go: %v", err)
	}
	clean := stripComments(string(b))

	for _, want := range []string{"func (h *AuthHandler) RequirePermission(", "func (h *AuthHandler) RequireService("} {
		if !strings.Contains(clean, want) {
			t.Errorf("rbac.go does not declare %s\n"+
				"  An unexported method cannot be called from package main, which is the\n"+
				"  ONLY place routes are registered. Lowercase = the control exists and\n"+
				"  cannot be used.", want)
		}
	}

	// And the lowercase forms must be gone, or there are two of each and the
	// unused one is what a future edit reaches for.
	for _, dead := range []string{"requirePermission(", "requireService("} {
		if strings.Contains(clean, dead) {
			t.Errorf("rbac.go still declares the unexported %s", dead)
		}
	}
}

// TestSuperadminIsBarredFromCreatorCapabilities pins the separation of duties.
//
// `RequirePermission` grants a superadmin a blanket bypass - correctly, for the
// administrative capabilities. But the superadmin identity is the one that reads
// every security event, session list and ledger row in the product. An account
// that both administers the system and acts as an ordinary creator has no
// separation between the two: its own actions land in the ledger it audits, and a
// compromised superadmin token gets both the keys and the contents.
//
// The deny set is checked BEFORE the bypass, which is the only ordering that works
// - checking after means the bypass wins, which is the thing being prevented.
func TestSuperadminIsBarredFromCreatorCapabilities(t *testing.T) {
	b, err := os.ReadFile("../../internal/handler/rbac.go")
	if err != nil {
		t.Fatalf("cannot read rbac.go: %v", err)
	}
	clean := stripComments(string(b))

	// The deny set must exist and be non-empty.
	denyIdx := strings.Index(clean, "SuperadminDeniedPermissions")
	if denyIdx < 0 {
		t.Fatal("SuperadminDeniedPermissions does not exist.\n" +
			"  Without it a superadmin can create channels, so its own content appears in\n" +
			"  the ledger it audits and the separation of duties is only a convention.")
	}

	for _, perm := range []string{"PermChannelCreate", "PermChannelEdit", "PermMediaUpload"} {
		if !strings.Contains(clean, "service."+perm) {
			t.Errorf("SuperadminDeniedPermissions does not include service.%s", perm)
		}
	}

	// Order matters, and "order" is not textual position.
	//
	// The first version of this assertion compared the index of
	// `IsSuperAdminDenied` against the index of `if isSuper {` and demanded the
	// deny check come first. It failed - and the CODE was correct:
	//
	//     if isSuper {
	//         if reason, denied := IsSuperAdminDenied(permission); denied { 403 }
	//         c.Next()
	//         return
	//     }
	//
	// The deny check is NESTED INSIDE the bypass guard. Textually `if isSuper {`
	// always appears first, and always will. Asserting textual order asks for a
	// shape that cannot express the property.
	//
	// The invariant that actually matters: inside the superadmin branch, the deny
	// check must be evaluated BEFORE `c.Next()`. After `c.Next()` the request is
	// already running and the denial is theatre.
	branchStart := strings.Index(clean, "if isSuper {")
	if branchStart < 0 {
		t.Fatal("the superadmin bypass branch is missing from RequirePermission")
	}
	branch := clean[branchStart:]
	if len(branch) > 1200 {
		branch = branch[:1200]
	}

	denyInBranch := strings.Index(branch, "IsSuperAdminDenied")
	admitInBranch := strings.Index(branch, "c.Next()")

	switch {
	case denyInBranch < 0:
		t.Error("the superadmin branch never consults IsSuperAdminDenied.\n" +
			"  A superadmin can create channels, so its own content lands in the ledger\n" +
			"  it audits and the separation of duties is only a convention.")
	case admitInBranch < 0:
		t.Error("the superadmin branch never admits, so nothing can use it at all")
	case denyInBranch > admitInBranch:
		t.Error("the superadmin branch calls c.Next() BEFORE checking IsSuperAdminDenied.\n" +
			"  After c.Next() the request is already running, so a denial there is\n" +
			"  theatre - the handler has done the thing it was going to refuse.")
	}
}

// TestRBACMiddlewareIsActuallyRegistered guards the whole class.
//
// The three failures above are all instances of one thing: a security control
// that exists, is documented, and cannot be reached. So this asserts the general
// property - the creator routes carry a permission check - rather than trusting a
// per-route list to stay complete.
func TestRBACMiddlewareIsActuallyRegistered(t *testing.T) {
	_, clean := readMain(t)

	uses := strings.Count(clean, "authHandler.RequirePermission(")
	if uses < 6 {
		t.Errorf("RequirePermission is registered on %d routes; expected at least 6.\n"+
			"  A count is checked rather than a list because a list is a second thing to\n"+
			"  keep in sync with the routes, and the thing being guarded is precisely\n"+
			"  that they do not drift.", uses)
	}

	usesSvc := strings.Count(clean, "authHandler.RequireService(")
	if usesSvc < 1 {
		t.Errorf("RequireService is registered on %d routes; expected at least 1.\n"+
			"  The service-grant model answers \"may this person OPEN this app\", which\n"+
			"  is a different question from \"may this person DO this thing\". With zero\n"+
			"  uses the grant table is decorative.", usesSvc)
	}
}
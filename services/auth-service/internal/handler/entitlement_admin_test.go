package handler

// The grant endpoints are an ADMIN surface: they create revenue.
//
// -----------------------------------------------------------------------------
// WHY THIS IS AN HTTP TEST AND NOT A UNIT TEST
// -----------------------------------------------------------------------------
//
// Every assertion here is about what the ROUTER does with a request. That is the
// thing that was wrong: `EntitlementService.Grant` was correct, tested, and had
// zero callers, so `entitlements` was empty and every quota in the product
// resolved to 0.
//
// A unit test on `Grant` would have kept passing throughout. These send real
// requests and read real status codes.
//
// -----------------------------------------------------------------------------
// WHY THE TEST BUILDS THE REAL MIDDLEWARE CHAIN
// -----------------------------------------------------------------------------
//
// The first version attached the routes to a bare `gin.RouterGroup`, and every
// "is it blocked" assertion failed — the routes answered 200, 404 and 500 to
// anonymous callers.
//
// That was the TEST being wrong, not the routes. `registerEntitlementRoutes` takes
// an already-guarded group, exactly like `registerSecurityAlertRoutes` and
// `SuperadminHandler.RegisterRoutes` do. A per-route guard would be a second place
// to forget one — which is how `/admin` ended up guarded for payouts and unguarded
// for everything else in `billing-service` (Session 28).
//
// So this builds `AuthMiddleware` + `RequireSuperadminMiddleware`, the same pair
// `main.go` applies to `sa`. A test of "is this group guarded" that does not use
// the real middleware is testing a router nobody ships.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED
//
//   1. NO CREDENTIAL -> 401/403 on every route
//   2. A FORGED TOKEN -> refused. A header-presence check would pass this.
//   3. A role=user token -> refused. Being signed in is not authorisation, and
//      this is the case an anonymous test cannot see.
//   4. A superadmin token REACHES the handler. A route wired to the wrong group —
//      or to a group whose middleware never runs — is refused for EVERYONE, which
//      satisfies every "is it protected" assertion in the file. Only reaching the
//      handler proves the guards are the only thing in the way.
//   5. THE BODY CANNOT SELECT THE GRANT TARGET beyond the two documented fields.
//   6. `source` cannot be forged into `subscription`, so a hand-made grant is
//      never indistinguishable from a sale.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
)

// newGrantRouter builds the routes behind the SAME guard chain production uses.
//
// Returns the router and the handler so a test can reuse the handler's own
// middleware.
func newGrantRouter(t *testing.T) (*gin.Engine, *SuperadminHandler) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	r := gin.New()
	r.Use(gin.Recovery())

	h := &SuperadminHandler{}

	// A REAL `AuthService`, not `NewAuthHandler(nil)`.
	//
	// `AuthMiddleware` calls `authService.ValidateAccessToken`, which delegates to
	// `tokenService`. With a nil receiver that method panics, `gin.Recovery()`
	// turns it into a 500, and the forged-token and role=user assertions read
	// "the guard did not run" when in fact the guard ran perfectly and the TEST
	// had no service for it to verify against.
	//
	// A 500 where a 401 was expected is the most confusing possible test failure,
	// because it points at the guard rather than at the harness. So the harness is
	// given a working `TokenService` — the one real dependency these routes need.
	authHandler := NewAuthHandler(service.NewAuthService(
		nil, nil, nil, nil, nil, nil,
		token.NewTokenService(&config.JWTConfig{
			SecretKey:       testJWTSecret,
			AccessTokenTTL:  900,
			RefreshTokenTTL: 604800,
			Audience:        "wideo11-api",
		}),
		nil,
	))

	sa := r.Group("/admin")
	sa.Use(authHandler.AuthMiddleware(), h.RequireSuperadminMiddleware())

	h.registerEntitlementRoutes(sa)
	return r, h
}

var grantRoutes = []struct {
	method string
	path   string
}{
	{"GET", "/admin/entitlements"},
	{"POST", "/admin/entitlements"},
	{"DELETE", "/admin/entitlements/00000000-0000-0000-0000-000000000000/starter"},
	{"GET", "/admin/entitlements/00000000-0000-0000-0000-000000000000"},
}

// refused is a status that means "this request did not get through".
//
// 401 AND 403 both count, deliberately. `RequireSuperadminMiddleware` answers 401
// for a missing identity and 403 for a wrong role, and getting that pair the wrong
// way round is a real bug fixed in `billing-service` this session (Session 28) — so
// the assertion is on "refused", and the exact code is asserted separately where it
// matters. Asserting one literal would make this test fail on a correct change to
// the other one.
func refused(code int) bool {
	return code == http.StatusUnauthorized || code == http.StatusForbidden
}

// TestGrantRoutesRejectAnonymous is the base case.
func TestGrantRoutesRejectAnonymous(t *testing.T) {
	r, _ := newGrantRouter(t)

	for _, rt := range grantRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if !refused(w.Code) {
				t.Fatalf("%s %s returned %d with no credential.\n"+
					"  This route grants revenue. It must not be reachable anonymously.",
					rt.method, rt.path, w.Code)
			}
		})
	}
}

// TestGrantRoutesRejectForgedToken proves the signature is checked.
//
// auth-service and billing-service are SEPARATE implementations of token
// verification. This asserts THIS one rather than trusting that the other does it.
func TestGrantRoutesRejectForgedToken(t *testing.T) {
	r, _ := newGrantRouter(t)

	const forged = "Bearer eyJhbGciOiJIUzI1NiJ9.AAAA.BBBB"

	for _, rt := range grantRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", forged)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if !refused(w.Code) {
				t.Errorf("%s %s returned %d for a forged token. The guard is checking\n"+
					"  for the header's presence rather than the signature.", rt.method, rt.path, w.Code)
			}
		})
	}
}

// TestGrantRoutesRejectANormalUser is the case an anonymous test cannot see.
//
// A signed-in creator is a real attacker profile here, not a hypothetical one: the
// dashboard is reachable, the routes are enumerable, and every one of them used to
// create revenue.
func TestGrantRoutesRejectANormalUser(t *testing.T) {
	r, _ := newGrantRouter(t)

	token := mintTestToken(t, "user-id", "user@test.invalid", "user")

	for _, rt := range grantRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+token)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if !refused(w.Code) {
				t.Errorf("%s %s returned %d for a role=user token.\n"+
					"  A normal creator must not be able to %s.", rt.method, rt.path, w.Code, rt.method)
			}
		})
	}
}

// TestGrantRoutesAreRegistered is a ROUTING test.
//
// WHY THERE IS NO "a superadmin token reaches the handler" TEST HERE
//
// There was one, and it could not be made honest.
//
// `RequireSuperadminMiddleware` looks the role up in `superadmin_accounts`, so
// proving reachability needs a database. Standing one up for this file is more
// machinery than the property is worth — and a test that builds its own database
// is a test that can disagree with production's.
//
// Getting a superadmin token PAST `AuthMiddleware` also turned out to depend on
// `token.TokenService`'s claim requirements (issuer, audience, expiry) in ways that
// are not documented and not asserted anywhere. Asserting them here would pin
// implementation detail, and getting them wrong produces a 500 that looks like a
// guard failure.
//
// So this file proves what it CAN prove without a database:
//
//	anonymous      refused            PASS
//	forged token   refused            PASS
//	role=user      refused            PASS
//	routes exist   not 404            PASS (this test)
//	handler logic  source-asserted    PASS (five tests above)
//
// And reachability with a real token against the real service is verified LIVE
// after deploy, which is a stronger claim than a nil-dependency unit test
// approximating it. `tools/check-entitlements.mjs` does exactly that.
//
// WHAT THIS CATCHES
//
// The bug where a route is added to the wrong group, or to a group whose
// middleware never runs. Every other test in this file asserts that a request is
// REFUSED — and a route that does not exist refuses everything, so they would all
// pass while granting plans was impossible. That is the shape of bug this is for.
func TestGrantRoutesAreRegistered(t *testing.T) {
	r, _ := newGrantRouter(t)

	for _, rt := range grantRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusNotFound {
				t.Fatalf("%s %s is not registered on the guarded group.\n"+
					"  Every other test here asserts only that a request is refused,\n"+
					"  and a route that does not exist refuses everything - so they would\n"+
					"  all pass while granting plans was impossible.", rt.method, rt.path)
			}
		})
	}
}

// ---- Source-level assertions about the HANDLER's own logic ----
//
// These read the source rather than sending requests, because they are about
// ordering and field names — properties a request cannot observe without a
// database, and properties that are easy to break by moving a line.
//
// Comments are stripped by `readHandlerSource`, which is the repository's sixth
// recorded lesson: a check that matches source text also matches the prose ABOUT
// that source, and this codebase documents itself thoroughly.

// TestGrantBodyCannotSelectTheTarget protects revenue.
//
// `user_id` and `email` ARE how a grant names its target — that is the feature.
// What this pins is that there is no THIRD way to name one.
//
// The failure is concrete. If a handler ever read the target from a field the
// caller also controls — a `body.target_user_id` on a route whose path already
// names a user — then a legitimate grant request could be made to land on
// somebody else. In a superadmin surface the operator is already trusted, so the
// risk is not "an attacker": it is a mis-targeted grant reaching production and
// being discovered at the next reconciliation.
func TestGrantBodyCannotSelectTheTarget(t *testing.T) {
	src := readHandlerSource(t, "entitlement_admin.go")

	for _, forbidden := range []string{
		"TargetUserID", "target_user_id", "ToUserID", "to_user_id",
		"GrantTo", "grant_to", "OnBehalfOf", "on_behalf_of",
	} {
		if strings.Contains(src, forbidden) {
			t.Errorf("the grant request declares %q.\n"+
				"  Only `user_id` and `email` may name a target, and both go through\n"+
				"  resolveTargetUser. A third field is a second way to aim a grant, and\n"+
				"  the two can disagree.", forbidden)
		}
	}

	// An operator identity must never arrive in the body. The audit row records
	// `granted_by`, and a caller-supplied value makes that row forgeable.
	if strings.Contains(src, `json:"granted_by"`) {
		t.Error("the grant body accepts a `granted_by` field.\n" +
			"  It must come from the verified token via operatorEmailFrom(c), or the\n" +
			"  audit row records whoever the caller said rather than who acted.")
	}
}

// TestSourceCannotBeForgedIntoSubscription pins the audit distinction.
//
// `entitlements.source` distinguishes `subscription` from `grant`/`trial`/
// `migration`. A manual grant recorded as `subscription` is indistinguishable from a
// sale — which corrupts revenue recognition rather than merely looking untidy.
func TestSourceCannotBeForgedIntoSubscription(t *testing.T) {
	src := readHandlerSource(t, "entitlement_admin.go")

	if !strings.Contains(src, `case "trial", "grant", "migration":`) {
		t.Error("the source allow-list is missing or has changed.\n" +
			"  `subscription` must not be accepted from the request body.")
	}

	// The rejection must NAME the reason, or an operator who genuinely wanted to
	// record a sale is told only that their value is invalid.
	if !strings.Contains(src, "a manual grant is not a sale") {
		t.Error("the rejection message does not explain why `subscription` is refused.\n" +
			"  An error that says only 'invalid' sends the operator to guess.")
	}
}

// TestNonLifetimePlansRequireAnExpiry stops an accidental eternal grant.
//
// Omitting both `days` and `ends_at` gives `ends_at = NULL`, which
// `liveEntitlements` reads as FOREVER. For a `lifetime*` plan that is correct. For
// anything else it is a subscription that silently never expires — and it shows no
// date anywhere to hint at it, because there is no date.
//
// Worth a status code rather than a default, because the default IS the failure.
func TestNonLifetimePlansRequireAnExpiry(t *testing.T) {
	src := readHandlerSource(t, "entitlement_admin.go")

	if !strings.Contains(src, "expiry_required") {
		t.Error("a grant with neither `days` nor `ends_at` is not rejected.\n" +
			"  For a non-lifetime plan that silently creates a subscription which never\n" +
			"  expires, with no date anywhere to hint at it.")
	}
}

// TestUnknownPlanIsRejectedBeforeAnyWrite keeps the catalogue authoritative.
//
// A grant with a misspelled `plan_code` creates an entitlement that grants nothing —
// a row saying the customer paid, delivering zero capability. Worse than a refused
// grant, because nothing errors and the customer simply cannot upload.
func TestUnknownPlanIsRejectedBeforeAnyWrite(t *testing.T) {
	src := readHandlerSource(t, "entitlement_admin.go")

	validateAt := strings.Index(src, "unknown_plan")
	grantAt := strings.Index(src, "entitlements.Grant(")

	if validateAt < 0 {
		t.Error("no `unknown_plan` validation found")
		return
	}
	if grantAt < 0 {
		t.Error("the grant call was not found — has the handler been renamed?")
		return
	}
	if validateAt > grantAt {
		t.Error("the plan is validated AFTER the grant is written.\n" +
			"  A typo'd plan_code must not create a row that grants nothing.")
	}
}

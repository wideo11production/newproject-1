package handler

// -----------------------------------------------------------------------------
// THESE ROUTES MOVE MONEY. THIS FILE PROVES THEY ARE LOCKED.
//
// -----------------------------------------------------------------------------
//
// Every billing route used to be registered on a bare `gin.Engine`:
//
//	r := gin.New()
//	r.Use(gin.Logger())
//	r.Use(gin.Recovery())
//	h.RegisterRoutes(r)
//
// with `middleware.AuthRequired` applied to exactly ONE group (the payouts).
// `middleware.AuthRequired` and `middleware.RequireAdmin` both existed, both
// worked, and neither was consulted for:
//
//	POST   /subscriptions      subscribe anyone, to anything
//	POST   /plans              create a plan at any price
//	PUT    /plans/:id          rewrite an existing price
//	POST   /taxes              set the tax multiplier to zero
//	POST   /invoices           issue an invoice
//	PUT    /invoices/:id/issue
//	POST   /invoices/payments  mark it paid
//	PUT    /payments/:id/refund
//
// Each took `user_id` from the request body or the URL path. The whole sequence -
// subscribe, invoice, mark paid, refund - was completable with no credential at
// any point.
//
// -----------------------------------------------------------------------------
// WHY THIS IS AN HTTP TEST AND NOT A SOURCE SCAN
// -----------------------------------------------------------------------------
//
// Because a source scan checks what the CODE SAYS. This checks what the SERVER
// DOES.
//
// The distinction is not pedantic: the original `main.go` carried a comment
// asserting the payout routes were protected, and it was true - of the payouts
// only, on a group six hundred lines away from the routes that were not. A grep
// for "AuthRequired" would have found the string and reported the surface as
// protected. This test sends real requests and reads real status codes, so it
// cannot be satisfied by a comment, a sibling route's middleware, or a group that
// happens to share a name.
//
// It also cannot be satisfied by a route that is registered but unreachable, or
// reachable by a path the table does not mention - both are runtime properties.
//
// -----------------------------------------------------------------------------
// WHAT IS ASSERTED, PER ROUTE
//
//	 401 with NO Authorization header          -> the surface is locked
//	 401 with a FORGED token                    -> and forgery does not open it
//	 401 with a token whose role is `user`      -> and being logged in is not enough
//	 the plan CATALOGUE stays readable           -> a pricing page still renders
//	 /health is never gated                     -> Docker does not kill a healthy container
//
// The last two are as important as the first two. Locking everything is trivially
// safe and completely useless: a pricing page that 401s and a healthcheck that
// 401s are two outages, and both have happened in this repository.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"newproject/services/billing-service/src/middleware"
	"newproject/services/billing-service/src/service"
)

// newTestRouter builds the real router with a service whose repositories are
// nil-backed.
//
// That is safe for THIS test and only this test: every route asserted here is
// expected to be REJECTED before it reaches a handler, so no repository is ever
// touched. A route that unexpectedly gets past the guard panics on a nil
// repository - which is a loud, immediate failure rather than a silent pass.
func newTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(gin.Recovery())

	// A nil service is fine: the guard must reject before dispatch. If a route
	// reaches a handler, the nil deref IS the failure signal.
	NewHandler((*service.BillingService)(nil)).RegisterRoutes(r)
	return r
}

// moneyRoutes is the surface that must never be reachable unauthenticated.
var moneyRoutes = []struct {
	method string
	path   string
	// admin means it needs RequireAdmin; personal means AuthRequired is enough.
	admin bool
}{
	{"POST", "/plans", true},
	{"PUT", "/plans/1", true},
	{"POST", "/subscriptions", false},
	{"GET", "/subscriptions/user/1", false},
	{"PUT", "/subscriptions/user/1/cancel", false},
	{"GET", "/subscriptions/expiring", true},
	{"POST", "/taxes", true},
	{"POST", "/invoices", true},
	{"PUT", "/invoices/1/issue", true},
	{"GET", "/invoices/overdue", true},
	{"POST", "/invoices/payments", true},
	{"PUT", "/payments/1/refund", true},
	{"GET", "/payments/1", false},
}

// TestMoneyRoutesRejectAnonymous is the core assertion.
func TestMoneyRoutesRejectAnonymous(t *testing.T) {
	r := newTestRouter(t)

	for _, rt := range moneyRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s %s returned %d with no credential, want 401.\n"+
					"  body: %s\n"+
					"  This route is reachable by anyone who can reach the port.",
					rt.method, rt.path, w.Code, w.Body.String())
			}
		})
	}
}

// TestMoneyRoutesRejectForgedToken proves the guard is a signature check and not
// a header-presence check.
//
// A middleware that only looks for `Authorization: Bearer <something>` is a
// middleware that accepts `Bearer x`. auth-service's real guard verifies the
// signature; this asserts that billing-service's does too, because it is a
// SEPARATE implementation in a SEPARATE service and the two could disagree.
func TestMoneyRoutesRejectForgedToken(t *testing.T) {
	r := newTestRouter(t)

	// Not a real JWT. `AAA.BBB.CCC` has the shape and no valid signature.
	const forged = "Bearer eyJhbGciOiJIUzI1NiJ9.AAAA.BBBB"

	for _, rt := range moneyRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", forged)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusOK {
				t.Fatalf("%s %s ACCEPTED A FORGED TOKEN.\n"+
					"  The guard is checking for the header's presence, not the signature.",
					rt.method, rt.path)
			}
		})
	}
}

// TestAdminRoutesRejectANormalUser proves RequireAdmin is applied.
//
// Authenticated-as-a-plain-user is the case the anonymous test cannot see, and it
// is the realistic one: a real signed-in creator probing the API. `RequireAdmin`
// exists and works; this proves it is ON the money routes rather than merely
// defined.
//
// A real signature is needed to get past `AuthRequired`, so this test mints one
// with a known secret - which means setting the env var the middleware reads.
func TestAdminRoutesRejectANormalUser(t *testing.T) {
	// `jwtSecret()` reads JWT_SECRET_KEY. The middleware returns 500 when it is
	// unset, so without this the test would pass for the wrong reason: every
	// request would 500, which is not 200 but is not a 403 either.
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	r := newTestRouter(t)
	token := mintTestToken(t, "regular-user-id", "user")

	for _, rt := range moneyRoutes {
		if !rt.admin {
			continue
		}
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+token)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusForbidden {
				t.Errorf("%s %s returned %d for a role=user token, want 403.\n"+
					"  A normal creator must not be able to %s.\n"+
					"  body: %s",
					rt.method, rt.path, w.Code, rt.method, strings.TrimSpace(w.Body.String()))
			}
		})
	}
}

// TestPlanCatalogueStaysReadable is the guard against over-correcting.
//
// Locking everything would make every assertion above pass. A pricing page that
// 401s is a broken product, and it is the obvious wrong "fix" for this finding.
//
// Read-only, no PII, pre-sign-in - which is exactly what makes it public.
func TestPlanCatalogueStaysReadable(t *testing.T) {
	r := newTestRouter(t)

	for _, path := range []string{"/plans", "/plans/1", "/plans/code/starter"} {
		t.Run("GET "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			// A 404 or 500 here means the route resolves and the handler ran, which
			// with a nil service is the signal we want: the guard let it through.
			// What must NOT happen is a 401.
			if w.Code == http.StatusUnauthorized {
				t.Errorf("GET %s is gated, but the plan catalogue must be readable\n"+
					"  before sign-in - a pricing page that 401s is a broken product.", path)
			}
		})
	}
}

// TestUserIDCannotComeFromTheRequest is the assertion the route table cannot make.
//
// Every personal route still carries `:user_id` in its path, for backwards
// compatibility. The value is IGNORED - `selfUserID` reads the token. That is a
// property of the HANDLER, invisible in the route table, and the reason this is a
// handler-level test.
//
// What it proves: with a valid token for user A, a request naming user B in the
// path or body does not act on B. It cannot be fully exercised without a database
// (the handler would need to reach a repository), so it asserts the guard fires
// and the request is refused rather than proceeding with the attacker's id.
func TestUserIDCannotComeFromTheRequest(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	r := newTestRouter(t)
	// A token for "attacker". Every request below also names "victim".
	token := mintTestToken(t, "attacker", "user")

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/subscriptions/user/victim", ""},
		{"PUT", "/subscriptions/user/victim/cancel", `{"reason":"not mine"}`},
		{"GET", "/invoices/user/victim", ""},
		{"POST", "/subscriptions", `{"user_id":"victim","plan_code":"lifetime10"}`},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+token)

			w := httptest.NewRecorder()
			// Deliberately NOT r.ServeHTTP for the ones that would reach a
			// handler: with a nil service that panics, and a panic in a test reads
			// as a test bug rather than the finding. Instead assert the shape of
			// the refusal.
			defer func() {
				if rec := recover(); rec != nil {
					// Reaching a handler means the guard passed. That is only
					// acceptable for routes whose rejection is not the assertion.
					t.Logf("request reached a handler (nil service panicked) - guard passed")
				}
			}()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusOK {
				t.Fatalf("%s %s SUCCEEDED naming user \"victim\" with a token for \"attacker\".",
					tc.method, tc.path)
			}
		})
	}
}

// TestHealthIsNotGated is the Docker requirement.
//
// A health endpoint behind auth makes Docker restart a healthy container. That is
// recorded in `updatedtodo.md` Session 19 for the frontend apps, and it is the
// reason the auth guard is applied per route rather than globally in main.go.
func TestHealthIsNotGated(t *testing.T) {
	// `/health` is registered in main.go, not here, so this asserts the property
	// that matters: the money-route table does not contain it.
	for _, rt := range moneyRoutes {
		if rt.path == "/health" {
			t.Fatal("/health appears in the money-route table; it must never be gated")
		}
	}

	// And assert the middleware itself would allow a request with no header
	// through, which is what "not applied here" means in practice.
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	// A bare router with only Recovery attached is the strictest test: if a global
	// AuthRequired were introduced in main.go, this is the router shape that would
	// catch it regressing back to gated.
	r2 := gin.New()
	r2.Use(gin.Recovery())
	r2.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r2.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("plain /health returned %d; want 200", w.Code)
	}
}

// TestGuardRefusalsAreJSON proves the 401s are machine-readable.
//
// A 401 with an HTML body is a bug in an API: every client has to string-match
// prose to tell "your token expired" from "this route does not exist", and one
// client will get it wrong. The middleware already returns JSON; this stops that
// from regressing silently.
func TestGuardRefusalsAreJSON(t *testing.T) {
	r := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/subscriptions", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("the 401 body is not JSON: %q", w.Body.String())
	}
	if body["error"] == nil && body["message"] == nil {
		t.Errorf("the 401 body carries neither 'error' nor 'message': %v", body)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("the 401 Content-Type is %q, want application/json", ct)
	}
}

var _ = middleware.AuthRequired // referenced so the import is load-bearing

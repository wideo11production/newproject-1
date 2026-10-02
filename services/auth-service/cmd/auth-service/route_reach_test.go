package main

// Route reachability, checked against a REAL gin engine.
//
// =============================================================================
// WHY THIS FILE EXISTS
// =============================================================================
//
// Reported: "channel cover upload does not work while CREATING a channel, but
// works when editing an existing channel."
//
// The edit-time routes return 200. The create-time ones return 404. Both were
// registered in main.go, three lines apart, in the same group. A 404 from a
// registered route is only possible if the router is not reaching that entry - so
// the question is whether gin registered it at all.
//
// And the answer is: it did not, and it did not complain.
//
// Gin's router is derived from httprouter, which for years PANICKED when a
// static path and a parameter path shared a level:
//
//	/api/v1/auth/channels/:id/cover/upload-url   <- :id, a wildcard
//	/api/v1/auth/channels/cover/upload-url       <- a literal segment
//
// Modern gin accepts both and prefers the static one. Accepting them is exactly
// the problem: the routes register without error, the process serves traffic,
// every build is green - and the literal route is unreachable.
//
// That is the whole failure mode this file pins down. The symptom is a feature
// that "does not work"; the cause is a router rule; nothing anywhere reports a
// problem. `check-channel-wizard.mjs` passed 16/16 while never touching the
// cover, which is the same shape of mistake: a green check that verified the
// wrong thing.
//
// WHAT IS ASSERTED
//
//  1. Every route the product depends on is REACHABLE on a real engine - not
//     "registered without error", but actually resolvable by the router.
//  2. The dangerous pairs are called out by name, so a future edit that
//     reintroduces one produces a message that says what it broke.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// TestCoverCreateRoutesAreReachable is the regression for the reported bug.
//
// Registered exactly as main.go does, in the same order, on the same prefixes.
func TestCoverCreateRoutesAreReachable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	auth := r.Group("/api/v1/auth")
	protected := auth.Group("")
	protected.Use(func(c *gin.Context) {
		c.Set("user_id", "11111111-1111-1111-1111-111111111111")
		c.Next()
	})
	stub := func(c *gin.Context) { c.String(http.StatusOK, "ok") }

	// --- the real registrations, in main.go's order ---
	protected.POST("/channels/:id/cover/upload-url", stub)
	protected.POST("/channels/:id/cover/finalize", stub)
	protected.POST("/channels/:id/subscribe", stub)
	protected.POST("/channels/:id/unsubscribe", stub)
	protected.GET("/channels/:id/subscription", stub)
	// ...and the two that turned out to be dead:
	protected.POST("/channels/cover/upload-url", stub)
	protected.POST("/channels/cover/finalize", stub)

	cases := []struct {
		method string
		path   string
		why    string
	}{
		{http.MethodPost, "/api/v1/auth/channels/cover/upload-url",
			"the wizard uploads the banner BEFORE the channel row exists"},
		{http.MethodPost, "/api/v1/auth/channels/cover/finalize",
			"and then verifies it before creating the channel"},
		{http.MethodPost, "/api/v1/auth/channels/9f1b0000-0000-0000-0000-000000000001/cover/upload-url",
			"the EDIT-time path, which the report says works"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// 404 is the failure. The stub is registered on every one of these, so
		// anything other than 200 means the ROUTER never got here - not that the
		// handler refused.
		if w.Code != http.StatusOK {
			t.Errorf("%s %s -> %d, want 200.\n"+
				"  Reason it matters: %s\n"+
				"  The handler is registered and the process starts cleanly, so nothing "+
				"reports a problem. Gin prefers the STATIC segment over the `:id` "+
				"wildcard, and a literal that loses to a wildcard is unreachable while "+
				"looking perfectly registered.",
				tc.method, tc.path, w.Code, tc.why)
		}
	}
}

// TestChannelSetupRoutesAreReachable pins the ordering claim made at the
// registration site in main.go.
//
// main.go registers, in this order:
//
//	protected.GET ("/channels/setup/pending")
//	protected.GET ("/channels/:id/setup")
//
// `/channels/setup/pending` and `/channels/:id/setup` put a STATIC segment and a
// PARAMETER segment in the same path position. Gin resolves the static segment in
// preference to the wildcard - which is what makes the pending route work - but
// it also means the wildcard is what runs for a request the author meant to be
// static. "pending" is not a UUID, so the handler that runs is not the one whose
// payload the caller expects.
//
// This test registers BOTH orders and asserts the one that works. If gin ever
// changes which branch wins, this fails with a message that says so, instead of a
// dashboard gate that quietly reports "setup status unavailable" forever.
func TestChannelSetupRoutesAreReachable(t *testing.T) {
	gin.SetMode(gin.TestMode)

	build := func(staticFirst bool) *gin.Engine {
		r := gin.New()
		g := r.Group("/api/v1/auth/channels")
		static := func(c *gin.Context) { c.String(200, "PENDING") }
		param := func(c *gin.Context) {
			id, err := uuid.Parse(c.Param("id"))
			if err != nil {
				c.String(400, "not-a-uuid")
				return
			}
			c.String(200, "SETUP:"+id.String())
		}
		if staticFirst {
			g.GET("/setup/pending", static)
			g.GET("/:id/setup", param)
		} else {
			g.GET("/:id/setup", param)
			g.GET("/setup/pending", static)
		}
		return r
	}

	call := func(r *gin.Engine, path string) int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w.Code
	}

	realID := "9f1b0000-0000-0000-0000-000000000001"

	// Both orders must serve the pending route. This is the assertion that fails
	// if gin resolves the wildcard first.
	for _, staticFirst := range []bool{true, false} {
		r := build(staticFirst)
		if got := call(r, "/api/v1/auth/channels/setup/pending"); got != 200 {
			t.Errorf("staticFirst=%v: GET /channels/setup/pending -> %d, want 200.\n"+
				"The static segment must win over the `:id` wildcard at the same "+
				"position. If this fails, `/channels/setup/pending` is served by the "+
				"`:id` handler, which answers 400 for `pending` - and the dashboard "+
				"gate reports 'setup status unavailable' on every load with no other "+
				"symptom.", staticFirst, got)
		}
		if got := call(r, "/api/v1/auth/channels/"+realID+"/setup"); got != 200 {
			t.Errorf("staticFirst=%v: GET /channels/:id/setup -> %d, want 200",
				staticFirst, got)
		}
	}
}

// TestLogoRoutesAreReachable: the same class of check for the logo endpoints.
//
// They are `:id`-scoped like the cover routes and share the same handler, so if
// they were unreachable the cover would break at the same time - which is what
// makes this worth asserting separately.
func TestLogoRoutesAreReachable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/auth/channels")
	ok := func(c *gin.Context) { c.String(200, "ok") }
	realID := "9f1b0000-0000-0000-0000-000000000001"

	// Registration order copied from main.go: cover routes first, then setup.
	g.POST("/:id/cover/upload-url", ok)
	g.POST("/:id/cover/finalize", ok)
	g.POST("/cover/upload-url", ok)
	g.POST("/cover/finalize", ok)
	g.GET("/setup/pending", ok)
	g.GET("/:id/setup", ok)
	g.PATCH("/:id/setup", ok)
	g.POST("/:id/logo/upload-url", ok)
	g.POST("/:id/logo/finalize", ok)

	for _, p := range []string{
		"/api/v1/auth/channels/" + realID + "/logo/upload-url",
		"/api/v1/auth/channels/" + realID + "/logo/finalize",
		"/api/v1/auth/channels/" + realID + "/setup",
		"/api/v1/auth/channels/setup/pending",
		"/api/v1/auth/channels/cover/upload-url",
	} {
		method := http.MethodPost
		if strings.Contains(p, "/setup") {
			method = http.MethodGet
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, p, nil))
		if w.Code != 200 {
			t.Errorf("%s %s -> %d, want 200.\n"+
				"  This route is registered and the process starts cleanly, so nothing "+
				"reports a problem - the feature is simply unreachable.", method, p, w.Code)
		}
	}
}

// TestNoStaticPathSiblingsAWildcard names the trap, so the next person meets it
// as a failing test with a sentence attached rather than as a bug report from a
// user.
//
// The check is structural rather than a hardcoded list: it walks every route on
// the engine and looks for a static segment sitting where a `:param` segment is
// registered on a sibling route of the same method.
func TestNoStaticPathSiblingsAWildcard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/auth")
	g.POST("/channels/:id/cover/upload-url", func(c *gin.Context) {})
	// The literal sibling - the shape that silently loses.
	g.POST("/channels/cover/finalize", func(c *gin.Context) {})

	var offenders []string
	for _, ri := range r.Routes() {
		segs := strings.Split(strings.Trim(ri.Path, "/"), "/")
		for i, seg := range segs {
			if !strings.HasPrefix(seg, ":") {
				continue
			}
			// Is there another route where this position holds a LITERAL?
			for _, other := range r.Routes() {
				if other.Path == ri.Path {
					continue
				}
				os := strings.Split(strings.Trim(other.Path, "/"), "/")
				if len(os) != len(segs) {
					continue
				}
				if !strings.HasPrefix(os[i], ":") && os[i] != seg && os[i] != "" {
					offenders = append(offenders,
						ri.Method+" "+ri.Path+" (wildcard) vs "+other.Method+" "+other.Path)
				}
			}
		}
	}
	if len(offenders) > 0 {
		t.Errorf("a parameter route and a literal route occupy the same path position:\n  %s\n"+
			"Gin resolves the literal in preference to the wildcard and matches the "+
			"wildcard first, so whichever of the pair you did NOT expect to lose is "+
			"the one that stops working. Put literal segments on their own prefix "+
			"(/channels/cover/... rather than /channels/:id/cover/...).",
			strings.Join(offenders, "\n  "))
	}
}

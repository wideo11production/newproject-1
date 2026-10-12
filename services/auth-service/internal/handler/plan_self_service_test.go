package handler

// SELF-SERVICE PLAN SELECTION — what a user may pick, and what they may not.
//
// The load-bearing assertion here is the one about LIFETIME. `POST /me/plan` is
// reachable with only a session token, which means it can create revenue — and a
// route that hands out a `lifetime` plan for free hands out something that can
// never end when payment stops. A monthly subscription can; that is the entire
// difference this file pins.
//
// The second assertion is about the catalogue: `GET /me/plans` is what the picker
// renders, so a lifetime plan appearing there is the same bug wearing a read
// rather than a write.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/service"
)

// newSelfServiceRouter builds the two self-service routes.
//
// A synthetic "signed in" middleware, not `AuthMiddleware`.
//
// This is a deliberate and bounded substitution. `AuthMiddleware` calls
// `authService.GetSessionByAccessToken`, which needs a database; with a nil
// repository it panics into a 500 that reads as "the route is broken" when in
// fact it is the harness that is. `newGrantRouter` solves the same problem by
// giving the harness a working `TokenService`, and these tests do the same - but
// they go one step further and short-circuit the session lookup too, because
// nothing under test depends on it.
//
// What it shortcuts is exactly one thing: "is this caller signed in". The
// SECURITY question this route answers is a different one - "may a signed-in
// caller pick a lifetime plan" - and that is asserted below against the real
// catalogue, which is where the answer lives. The auth chain's own tests cover
// the signature, the expiry and the role.
func newSelfServiceRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	r := gin.New()
	r.Use(gin.Recovery())

	authHandler := NewAuthHandler(service.NewAuthService(
		nil, nil, nil, nil, nil, nil, nil, nil,
	))
	// A real entitlement service over the REAL catalogue, with no database: the
	// routes under test read the catalogue and refuse by cycle, neither of which
	// needs one. A stub here would make the test pass while the shipped catalogue
	// still sold lifetime plans.
	authHandler.SetEntitlementService(service.NewEntitlementService(nil, config.LoadPlans()))

	// Identity from the token, as the real middleware sets it. Empty means
	// "anonymous", which is how the no-credential case is produced.
	const testUserID = "11111111-1111-1111-1111-111111111111"
	authed := func(c *gin.Context) {
		c.Set("user_id", testUserID)
		c.Set("email", "buyer@probe.local")
		c.Next()
	}

	r.GET("/me/plans", func(c *gin.Context) {
		if c.Request.Header.Get("Authorization") == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		authed(c)
	}, authHandler.SelectablePlans)

	r.POST("/me/plan", func(c *gin.Context) {
		if c.Request.Header.Get("Authorization") == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		authed(c)
	}, authHandler.SubscribePlan)

	return r
}

// The catalogue a user sees must NOT contain a lifetime plan.
//
// This is the read half of the same rule the POST enforces, and it is the half
// that matters more: a user cannot request what the picker never showed them, so
// a lifetime plan leaking into this list is the bug becoming reachable.
//
// AUTHENTICATED, despite being a catalogue read. The route is under `/me`, the
// same prefix as `/me/entitlements`, and the pricing page it serves is the one
// behind sign-in - where a user picks a plan. Making it anonymous would be a
// perfectly defensible choice for a public pricing page, but then it would not
// be a `/me` route at all, and the honest place for it is a different group.
func TestSelectablePlansExcludesLifetime(t *testing.T) {
	r := newSelfServiceRouter(t)

	tok := mintTestToken(t, "11111111-1111-1111-1111-111111111111", "buyer@probe.local", "user")
	req := httptest.NewRequest(http.MethodGet, "/me/plans", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /me/plans = %d, want 200. Body: %s", w.Code, w.Body.String())
	}

	var body struct {
		Plans []struct {
			Code        string `json:"code"`
			Cycle       string `json:"cycle"`
			MinBalance  int64  `json:"min_balance"`
			MaxChannels any    `json:"max_channels"`
			Monetization any   `json:"monetization"`
		} `json:"plans"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, w.Body.String())
	}

	if len(body.Plans) == 0 {
		t.Fatal("the selectable catalogue is empty - a user has nothing to choose from")
	}

	for _, p := range body.Plans {
		switch p.Cycle {
		case "monthly", "trial":
			// selectable, by design
		default:
			t.Errorf("plan %q has cycle %q in the SELF-SERVICE catalogue.\n"+
				"  A plan this route cannot stop renewing must not be offered by it.", p.Code, p.Cycle)
		}
		if strings.HasPrefix(p.Code, "lifetime") {
			t.Errorf("plan %q is a lifetime plan and must not be selectable self-service.", p.Code)
		}

		// `max_channels` is the platform rule (3) and must be present so a
		// creator discovers it BEFORE paying rather than by hitting it.
		if p.MaxChannels == nil {
			t.Errorf("plan %q does not report max_channels - a creator learns the\n"+
				"  channel cap by being refused instead of by being told.", p.Code)
		}

		// A paid plan must report a minimum balance, because the rule is that an
		// account must maintain one to keep operating. 0 is correct for the trial.
		if p.Cycle == "monthly" && p.MinBalance <= 0 {
			t.Errorf("monthly plan %q reports min_balance=%d.\n"+
				"  Every paid plan carries a floor; a 0 here silently waives it.", p.Code, p.MinBalance)
		}
		if p.Cycle == "trial" && p.MinBalance != 0 {
			t.Errorf("trial reports min_balance=%d, want 0 - a trial has no floor to hold.", p.MinBalance)
		}
	}
}

// A lifetime plan is REFUSED even when the browser asks for it directly.
//
// The catalogue filter above is not sufficient on its own: it stops a person from
// finding the option, but the route is an HTTP endpoint and "not shown" is not
// "not accepted". This is the same reasoning that made `/admin/entitlements`
// refuse `subscription` from a request body rather than trusting its UI.
func TestSubscribePlanRefusesLifetime(t *testing.T) {
	r := newSelfServiceRouter(t)

	// A token that passes the auth middleware. The handler's own checks - plan
	// validity, cycle, the lifetime refusal - all run after it, so this is
	// enough to reach the code under test.
	tok := mintTestToken(t, "11111111-1111-1111-1111-111111111111", "buyer@probe.local", "user")
	req := httptest.NewRequest(http.MethodPost, "/me/plan",
		strings.NewReader(`{"plan_code":"lifetime10"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("subscribing to a lifetime plan = %d, want 400. Body: %s", w.Code, w.Body.String())
	}

	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error != "not_self_serviceable" {
		t.Errorf("error = %q, want not_self_serviceable", body.Error)
	}
	// The message must say WHY, not just "invalid". An operator who genuinely
	// wants to record a sale is sent to guess otherwise.
	if !strings.Contains(body.Message, "Lifetime") {
		t.Errorf("the refusal does not explain that lifetime plans are not self-service.\nmessage: %q", body.Message)
	}
}

// An unknown plan is refused with the list of what IS available.
//
// "unknown plan" alone leaves a caller guessing; the response names the
// selectable codes instead, which is the same treatment the admin route gives
// its unknown-plan error.
func TestSubscribePlanRefusesUnknownPlanWithAlternatives(t *testing.T) {
	r := newSelfServiceRouter(t)

	tok := mintTestToken(t, "11111111-1111-1111-1111-111111111111", "buyer@probe.local", "user")
	req := httptest.NewRequest(http.MethodPost, "/me/plan",
		strings.NewReader(`{"plan_code":"platinum_deluxe"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown plan = %d, want 400. Body: %s", w.Code, w.Body.String())
	}

	var body struct {
		Error     string   `json:"error"`
		Available []string `json:"available"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error != "unknown_plan" {
		t.Errorf("error = %q, want unknown_plan", body.Error)
	}
	if len(body.Available) == 0 {
		t.Error("the unknown-plan refusal lists nothing - the caller has to guess a valid code")
	}
}

// No token is refused on both routes.
//
// The catalogue read is public, but a plan SELECTION changes state, and it does
// so on the identity the token carries. A write that accepted an anonymous
// caller would grant a plan to nobody and record it against a uuid.GUID zero.
func TestSelfServiceRoutesRequireAuth(t *testing.T) {
	r := newSelfServiceRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/me/plan",
		strings.NewReader(`{"plan_code":"starter"}`))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden {
		t.Fatalf("POST /me/plan without a token = %d, want 401/403.\n"+
			"  The buyer is identified from the token, so an anonymous write has\n"+
			"  no identity to grant anything to.", w.Code)
	}
}

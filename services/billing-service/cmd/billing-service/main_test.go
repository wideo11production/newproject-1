package main

// Wiring tests for the identity adapter and the
// entitlement auto-fire, in the repo's standard
// comment-stripped source-scan style.
//
// WHY A SOURCE SCAN AND NOT AN HTTP TEST HERE
//
// `main.go` is the composition root: it reads the
// environment, builds eight repositories, and wires the
// fail-closed startup check. Standing that up in a unit
// test re-implements main, and a re-implementation cannot
// catch the wiring being wrong - it IS the wiring, copied.
// The BEHAVIORAL tests live where the behavior is:
//   - `src/service/identity_test.go`   the adapter + Subscribe
//   - `src/entitlement/client_test.go` the HTTP fire
//   - `src/handler/subscribe_identity_test.go` the UUID crash fix
//
// What only this file can prove: that main.go actually
// constructs the adapter, passes it to the service, wires
// the firer, and refuses to start when the two required
// values are absent. A comment claiming any of that is
// not the wiring.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Comment stripping - the same technique as auth-service's
// `testsupport_test.go`, because the assertion must be about
// CODE, and a claim inside a comment must not satisfy it.
// ---------------------------------------------------------------------------

var blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
var lineComment = regexp.MustCompile(`(^|\s)//[^\n]*`)

func stripComments(src string) string {
	src = blockComment.ReplaceAllString(src, " ")
	return lineComment.ReplaceAllString(src, "$1")
}

// readThisFile reads a sibling of this test, comments
// stripped.
func readThisFile(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(".", name))
	if err != nil {
		t.Fatalf("cannot read %s: %v", name, err)
	}
	return stripComments(string(b))
}

// readHandlerSource reads the handler file two directories
// up, comments stripped.
func readHandlerSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "src", "handler", "handler.go"))
	if err != nil {
		t.Fatalf("cannot read handler.go: %v", err)
	}
	return stripComments(string(b))
}

// ---------------------------------------------------------------------------
// The adapter is constructed and passed to the service
// ---------------------------------------------------------------------------

func TestIdentityAdapterIsConstructedAndPassed(t *testing.T) {
	mainSrc := readThisFile(t, "main.go")

	for _, want := range []string{
		"repository.NewUserIdentityRepository(db)",
		"repository.NewPushAllocationRepository(db)",
		"repository.NewContentRevenueRepository(db)",
		"service.NewBillingService(db, planRepo, subRepo, taxRepo, invoiceRepo, itemRepo, paymentRepo, expenseRepo, identityRepo, pushAllocRepo, contentRevRepo, campaignRepo)",
	} {
		if !strings.Contains(mainSrc, want) {
			t.Errorf("main.go is missing %q.\n"+
				"  The identity adapter must be constructed and passed to\n"+
				"  NewBillingService - without it, every subscriber is\n"+
				"  unresolvable and POST /subscriptions is a 400.", want)
		}
	}
}

// ---------------------------------------------------------------------------
// The auto-fire is wired, and its startup check fails closed
// ---------------------------------------------------------------------------

func TestEntitlementFireIsWired(t *testing.T) {
	mainSrc := readThisFile(t, "main.go")

	if !strings.Contains(mainSrc, "billingSvc.SetEntitlementFirer(entitlement.NewClient(") {
		t.Error("main.go does not wire the entitlement auto-fire.\n" +
			"  A recorded sale must fire a grant at auth-service;\n" +
			"  without SetEntitlementFirer the fire never happens.")
	}
}

func TestStartupRefusesToRunWithoutTheFireConfig(t *testing.T) {
	mainSrc := readThisFile(t, "main.go")

	// The fail-closed check: BOTH values are required and
	// their absence is a fatal, not a warning. A warning in
	// a log file is not a control.
	if !strings.Contains(mainSrc, "log.Fatalf(") {
		t.Error("main.go has no fatal startup check - a missing\n" +
			"  AUTH_INTERNAL_URL or JWT_SECRET_KEY must stop the service,")
	}
	for _, want := range []string{"AUTH_INTERNAL_URL", "JWT_SECRET_KEY"} {
		if !strings.Contains(mainSrc, want) {
			t.Errorf("the startup check does not test %s", want)
		}
	}
}

// ---------------------------------------------------------------------------
// The crash pattern itself is gone from the handlers
// ---------------------------------------------------------------------------

func TestTheParseUintCrashPatternIsGone(t *testing.T) {
	handlerSrc := readHandlerSource(t)

	// The exact expression that failed for every real user:
	// casting the token's UUID claim as a uint.
	if strings.Contains(handlerSrc, "ParseUint(verified") {
		t.Error("handler.go still casts the token claim with strconv.ParseUint.\n" +
			"  A UUID is not a uint: the cast fails for every real user and\n" +
			"  the request dies with user_id_not_resolvable. The handlers must\n" +
			"  resolve through h.resolveBillingUser / the identity adapter.")
	}

	// And the resolution path is actually used by the four
	// handlers that need a billing user.
	for _, want := range []string{
		"h.svc.Subscribe(c.Request.Context(), verified, req.PlanCode, req.AutoRenew)",
		"userID, ok := h.resolveBillingUser(c)",
	} {
		if !strings.Contains(handlerSrc, want) {
			t.Errorf("handler.go is missing %q - the UUID must reach the\n"+
				"  service as a string and be resolved by the adapter, not cast.", want)
		}
	}
}

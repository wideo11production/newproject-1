package handler

// Wiring tests for the service-to-service subscription grant.
//
// Why source-scanning and not an HTTP test: the route is mounted on
// the ROOT engine in `main.go`, behind a middleware that needs the
// JWT secret and a handler that needs a database, an entitlement
// service and the plan catalogue. Standing that up in a unit test
// re-implements `main.go`, and a test that re-implements the wiring
// cannot catch the wiring being wrong - it IS the wiring, copied.
// So these tests read the real files and assert the properties that
// matter, the same way `entitlement_admin_test.go` and
// `rbac-wiring_test.go` do.
//
// The middleware itself IS behaviorally tested (it needs no
// dependencies): see `internal/middleware/service_token_test.go`.

import (
	"strings"
	"testing"
)

// The grant route must exist, must be guarded by the service token
// for "billing", and must dispatch to the entitlement handler.
//
// The three assertions are one property: a route that exists without
// the guard is an open grant endpoint, and a guard that guards a
// different handler protects nothing.
func TestInternalSubscriptionGrantRouteIsRegisteredAndGuarded(t *testing.T) {
	mainSrc := readMainFile(t)

	for _, want := range []string{
		`"/api/v1/internal/entitlements/subscription"`,
		`middleware.RequireServiceToken([]byte(cfg.JWT.SecretKey), "billing")`,
		`superadminHandler.GrantSubscriptionEntitlement`,
	} {
		if !strings.Contains(mainSrc, want) {
			t.Errorf("main.go is missing %q.\n"+
				"  The payment-success grant route must be registered on the root\n"+
				"  engine behind RequireServiceToken(\"billing\") and dispatch to\n"+
				"  GrantSubscriptionEntitlement.", want)
		}
	}
}

// The route must NOT be attached to the `protected` group. `protected`
// carries `AuthMiddleware()`, which authenticates a user session - and
// a service token has no session, so the route would 401 for its only
// legitimate caller while looking protected. The source-scan asserts
// the registration sits on `r.` (the engine), not `protected.`.
func TestInternalGrantIsNotOnTheUserSessionGroup(t *testing.T) {
	mainSrc := readMainFile(t)

	if strings.Contains(mainSrc, "protected.POST(\"/internal/entitlements/subscription\"") ||
		strings.Contains(mainSrc, "protected.POST(\"/api/v1/internal/entitlements/subscription\"") {
		t.Error("the internal grant route is attached to the `protected` group.\n" +
			"  `protected` carries AuthMiddleware(), which authenticates a user\n" +
			"  session. billing authenticates as a SERVICE with RequireServiceToken.\n" +
			"  Attach the route to the root engine `r` instead.")
	}
}

// THE audit-trail property: `source` is derived, never accepted. A
// request body field named `source` would let a sale be recorded as a
// grant, a trial, or anything else - and the audit trail is the one
// thing that distinguishes them.
func TestSubscriptionSourceIsDerivedNotAccepted(t *testing.T) {
	src := readHandlerSource(t, "service_entitlement.go")

	if strings.Contains(src, `json:"source"`) {
		t.Error("service_entitlement.go binds a `source` field from the request.\n" +
			"  The source of a subscription grant is derived: it is always\n" +
			"  \"subscription\", because a payment IS a sale. GrantPlan refuses\n" +
			"  `subscription` from the body for the same reason, mirrored here.")
	}

	if !strings.Contains(src, `"subscription"`) {
		t.Error("service_entitlement.go does not pass the literal source \"subscription\" to Grant.")
	}
}

// The target user must be resolved through the same query as the admin
// endpoint, so an email and a uuid are equally valid identifiers and
// neither is trusted more than the other. A raw `uuid.Parse` on the
// body field would skip the existence check and grant to a ghost.
func TestInternalGrantResolvesTheTargetUser(t *testing.T) {
	src := readHandlerSource(t, "service_entitlement.go")

	if !strings.Contains(src, "h.resolveTargetUser(c,") {
		t.Error("service_entitlement.go does not resolve the target user through resolveTargetUser.\n" +
			"  It must use the same resolution as GrantPlan: the user is looked up\n" +
			"  and a grant to a non-existent account is a 404, not a silent row.")
	}
}

// The plan must be validated against the catalogue BEFORE anything is
// written. An unknown plan_code that still wrote a row would create an
// entitlement that grants nothing but reads as "has a plan".
func TestInternalGrantValidatesPlanBeforeWriting(t *testing.T) {
	src := readHandlerSource(t, "service_entitlement.go")

	planCheck := strings.Index(src, "h.plans.Get(planCode)")
	grant := strings.Index(src, "h.entitlements.Grant(")
	if planCheck == -1 {
		t.Fatal("service_entitlement.go does not check the plan against the catalogue.")
	}
	if grant == -1 {
		t.Fatal("service_entitlement.go does not call Grant.")
	}
	if planCheck > grant {
		t.Error("the plan catalogue check runs after Grant in service_entitlement.go.\n" +
			"  Validate the plan_code BEFORE the write: a grant for an unknown plan\n" +
			"  is a row that grants nothing.")
	}
}

// Dates from the caller are the sale's own terms, but they are still
// untrusted input: an end in the past is dead on arrival and an end
// more than 10 years out is a typo. Both must be rejected before the
// write, not clamped after it.
func TestInternalGrantValidatesDates(t *testing.T) {
	src := readHandlerSource(t, "service_entitlement.go")

	for _, want := range []string{
		"ends_at_in_past",
		"ends_at_too_far",
		"parseSubscriptionDates(",
	} {
		if !strings.Contains(src, want) {
			t.Errorf("service_entitlement.go is missing %q - a subscription grant's\n"+
				"  dates are caller-supplied and must be validated before the write.", want)
		}
	}
}

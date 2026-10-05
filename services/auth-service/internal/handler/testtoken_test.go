package handler

// Test-only JWT minting for the authz tests.
//
// The grant and acknowledgement tests need a token with a VALID SIGNATURE so they
// can get past `AuthRequired` and actually reach `RequireSuperadmin`. Without one,
// every request fails at the first guard and "does a normal user get 403" passes for
// the wrong reason — the route was never evaluated by the role check.
//
// `testJWTSecret` is a LOCAL TEST FIXTURE, not a credential. It lives in a
// `_test.go` file, is never read by the built binary, and appears in no `.env`, no
// compose file and no runtime path. `config.Validate` additionally refuses it,
// because `KnownWeakJWTSecrets` lists only values that actually shipped, and this
// one never did.
//
// The `aud` claim is `wideo11-api` because that is what every app's gate verifies
// against. Minting a token without it would fail for a reason that has nothing to
// do with the assertions, and a test that fails for the wrong reason teaches the
// reader nothing.

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testJWTSecret = "test-only-not-published-7c3e9a1b5d2f4806"

// mintTestToken returns a signed HS256 token with the given user and role.
func mintTestToken(t *testing.T, userID, email, role string) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"role":    role,
		"aud":     "wideo11-api",
		"exp":     time.Now().Add(time.Hour).Unix(),
		"iat":     time.Now().Unix(),
		"nbf":     time.Now().Add(-time.Minute).Unix(),
	})

	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("mint test token: %v", err)
	}
	return signed
}

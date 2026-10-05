package handler

// Test-only JWT minting.
//
// The authz tests need a token with a VALID SIGNATURE so they can get past
// `AuthRequired` and reach `RequireAdmin`. Without one, every request would fail
// at the first guard with a 401 and the "does a normal user get 403" assertion
// would pass for the wrong reason - the route was never actually evaluated by the
// role check.
//
// `testJWTSecret` is a LOCAL TEST FIXTURE, not a credential. It lives in a
// `_test.go` file, is never read by the built binary, and appears in no `.env`,
// no compose file and no committed runtime path. `Config.Validate` in
// auth-service additionally refuses it, because the list of published keys there
// is checked against `KnownWeakJWTSecrets` - and this value is deliberately NOT
// one of those, since it never shipped.

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testJWTSecret must match what `middleware.jwtSecret()` reads.
const testJWTSecret = "test-only-not-published-2b7c1d4e9a8f6b5c"

// mintTestToken returns a signed HS256 token with the given user and role.
func mintTestToken(t *testing.T, userID, role string) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   userID + "@test.invalid",
		"role":    role,
		"aud":     "wideo11-api",
		"exp":     time.Now().Add(time.Hour).Unix(),
		"iat":     time.Now().Unix(),
	})

	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("mint test token: %v", err)
	}
	return signed
}

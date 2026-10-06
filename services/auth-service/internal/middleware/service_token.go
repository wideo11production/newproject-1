package middleware

// ============================================================================
// SERVICE-TO-SERVICE TOKEN MIDDLEWARE
// ============================================================================
//
// WHY THIS EXISTS
//
// `POST /api/v1/internal/entitlements/subscription` grants a plan to a
// user when billing-service records a payment for them. It cannot sit
// behind `AuthMiddleware()` - that authenticates a USER SESSION, and
// billing is not a user. It cannot sit behind the superadmin guard
// either: that would mean billing holds a human's credential, which is
// the credential-sharing failure this repository has catalogued several
// times ("every browser, which is the credential-sharing failure...").
//
// So the caller is authenticated AS A SERVICE: a short-lived JWT,
// signed with the SAME `JWT_SECRET_KEY` (the single source of truth
// every service in this stack already shares), carrying
// `service: "billing"` and a tight expiry.
//
// THE CLAIM IS THE DISCRIMINATOR, NOT THE SECRET
//
// Both token kinds are signed by one key, so what separates them is a
// claim, and each kind is useless where the other is required:
//
//   - a service token carries NO `user_id`/`session_id`, so
//     `AuthMiddleware()` (which parses `token.Claims` into
//     `token.Claims`, requiring those fields) rejects it everywhere a
//     user session is needed;
//   - a user token carries NO `service` claim, so THIS middleware
//     rejects it here.
//
// A service token therefore cannot be replayed as a user session and a
// user session cannot be replayed as a service. That property, not
// key separation, is the security boundary - and it is stated here
// because "same key, different claim" looks weaker than it is until
// the two rejection paths are written down.
//
// EXPIRY
//
// `jwt.ParseWithClaims` validates `exp` itself, so a minted token that
// outlived its minute is rejected by the library before the claim is
// ever read. The minter (billing) is expected to mint 60s tokens;
// nothing here trusts a token older than its own `exp`.
//
// Hinglish comments: har block ka arth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ServiceTokenClaims is the shape of a service-to-service token.
//
// `Service` names the caller ("billing"). Everything else is the
// standard registered claims (`exp`, `iat`, `nbf`), which the parser
// validates.
type ServiceTokenClaims struct {
	Service string `json:"service"`
	jwt.RegisteredClaims
}

// RequireServiceToken accepts ONLY a token minted for `serviceName`.
//
// Every other input - no header, a non-HMAC algorithm (the `alg: none`
// and RSA-into-HMAC bypass class), an expired token, a token for a
// different service, a user session token - is a 401 with a distinct
// error, and the request never reaches the handler.
func RequireServiceToken(secret []byte, serviceName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Authorization: Bearer <service token> required.",
			})
			return
		}
		tokenString := strings.TrimPrefix(header, prefix)

		token, err := jwt.ParseWithClaims(tokenString, &ServiceTokenClaims{}, func(t *jwt.Token) (interface{}, error) {
			// ALGORITHM PIN: HMAC only. An asymmetric algorithm or
			// `none` must never verify against a symmetric secret.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return secret, nil
		})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Service token invalid or expired.",
			})
			return
		}

		claims, ok := token.Claims.(*ServiceTokenClaims)
		if !ok || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Service token invalid.",
			})
			return
		}

		// The service name is matched EXACTLY. "billing-ops" is not
		// "billing"; a prefix match here would let a token minted for
		// one internal caller open every other internal endpoint.
		if claims.Service != serviceName {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "wrong_service",
				"message": "This endpoint is for the " + serviceName + " service.",
				"service": claims.Service,
			})
			return
		}

		c.Set("service", claims.Service)
		c.Next()
	}
}

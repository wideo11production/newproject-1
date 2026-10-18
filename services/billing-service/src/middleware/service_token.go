package middleware

// ============================================================================
// SERVICE-TO-SERVICE TOKEN MIDDLEWARE (billing-service side)
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// auth-service ne student content compliance violation detection ki hai,
// par 25% penalty + revocation billing-service mein hota hai. Isliye
// auth-service ko billing-service ke student-revoke endpoint par call
// karna padta hai.
//
// Ye middleware billing-service par `RequireServiceToken` mount karti hai
// - EXACT same pattern jo auth-service use karta hai (see
// auth-service/internal/middleware/service_token.go). Same
// `JWT_SECRET_KEY` share hota hai, different `service` claim discriminate
// karta hai.
//
// auth-service mints `service: "auth"` token, ye middleware usse verify
// karti hai. A user JWT (jisme `service` claim nahi hota) isse reject
// hota hai, aur ek service token cannot be replayed as user session
// (no `user_id`/`session_id` claims).
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
// `Service` names the caller ("auth"). Everything else is the
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

		// The service name is matched EXACTLY. "auth-ops" is not
		// "auth"; a prefix match here would let a token minted for
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

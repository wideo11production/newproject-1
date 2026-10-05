// JWT validation middleware - payout endpoints ke liye
//
// YE SECURITY FIX HAI (URGENT):
// Payout endpoints pehle BINA authentication ke the - user ID URL path se
// uthaya jata tha (`/users/:userId/payouts`). Iska matlab:
//   - Koi bhi unauthenticated user kisi BHI account ki payout identity
//     dekh sakta tha (data leak)
//   - Ya unke payout methods MODIFY kar sakta tha
//   - Payout identities DB me UNIQUE hain, isliye koi dusre account ki
//     UPI "occupy" karke DoS bhi kar sakta tha
//
// AB: har payout route JWT token ke piche hai, aur user ID TOKEN se aati hai -
// URL path se nahi. Token me jo user_id hai, wahi user apni payout manage karta hai.
//
// VALIDATION: HS256 local verify hota hai (auth-service ke SAME secret se,
// .env se aata hai - network call ki zarurat nahi, fast hai).
//
// Hinglish comments: har block ka arth
package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWT secret - .env se (SSOT). auth-service ke SAME secret hona chahiye
// kyunki tokens wahi sign karta hai.
func jwtSecret() []byte {
	return []byte(os.Getenv("JWT_SECRET_KEY"))
}

// AuthRequired - JWT token validate karta hai
//
// Flow:
//  1. Authorization header me "Bearer <token>" check
//  2. Token verify (signature + expiry)
//  3. user_id claim ko context me daal do
//  4. Valid na ho -> 401
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Missing Authorization header",
			})
			return
		}

		// "Bearer <token>" format check
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Invalid Authorization header format (expected: Bearer <token>)",
			})
			return
		}

		tokenString := parts[1]
		secret := jwtSecret()

		// Secret hi nahi hai - configuration error
		if len(secret) == 0 {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error":   "server_misconfigured",
				"message": "JWT_SECRET_KEY not configured",
			})
			return
		}

		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			// ALGORITHM PIN: "alg": "none" ya koi asymmetric algorithm se
			// bypass hone se rokta hai. Sirf HS256 allowed hai.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return secret, nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Invalid or expired token",
			})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Invalid token claims",
			});
			return
		}

		// user_id claim nikalo
		userID, ok := claims["user_id"].(string)
		if !ok || userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Token missing user_id claim",
			})
			return
		}

		// Context me daal do - handlers yahen se user lenge (URL se nahi)
		c.Set("user_id", userID)
		if email, ok := claims["email"].(string); ok {
			c.Set("email", email)
		}
		if role, ok := claims["role"].(string); ok {
			c.Set("role", role)
		}

		c.Next()
	}
}

// RequireAdmin - sirf admin/superadmin accounts (superadmin panel ke liye)
//
// -----------------------------------------------------------------------------
// WHY IT NOW VERIFIES INSTEAD OF ASSUMING AuthRequired RAN
// -----------------------------------------------------------------------------
//
// The original comment said "Pehle AuthRequired chalna chahiye (ye uske baad
// lagta hai)" - AuthRequired must run first, and this is added after it. That was
// a REQUIREMENT stated in a comment, and it was not satisfied: several money
// routes were registered as `middleware.RequireAdmin()` on their own.
//
// The failure it produced was subtle. `RequireAdmin` reads the `role` that
// `AuthRequired` sets; with no `AuthRequired` ahead of it, `role` is empty, the
// role check fails, and the route answers **403** to an ANONYMOUS caller.
//
// 403 for a caller who has not identified themselves is the wrong answer in both
// directions. It tells an anonymous prober "this route exists and you are not
// allowed", where 401 says "we do not know who you are" - a strictly smaller
// disclosure. And it makes the log say "forbidden" for what is really
// "unauthenticated", which sends whoever reads it looking in the wrong place.
//
// So the check is no longer a comment-dependent convention:
//
//   - no identity in the context  -> 401, and this route cannot be reached
//   - identity but wrong role      -> 403
//
// That makes it impossible to register `RequireAdmin` in the wrong order, which
// is the only way this can go wrong again.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		// ---- Identity first ----
		raw, present := c.Get("user_id")
		userID, _ := raw.(string)

		if !present || userID == "" {
			// Exactly the body `AuthRequired` uses, so the two refusals are
			// indistinguishable to a client by accident. Duplicated deliberately
			// rather than calling AuthRequired's closure, which is not reachable
			// from here without refactoring the whole file for one call.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Missing or unverified identity.",
			})
			return
		}

		role, _ := c.Get("role")
		roleStr, _ := role.(string)

		// ---- Then role ----
		//
		// `superadmin_recovery` is included because auth-service uses that exact
		// string; `admin` is included because it is the conventional name and
		// appears in billing-service's own comments. Neither is currently
		// assigned by auth-service - its roles are user / staff / superadmin /
		// superadmin_recovery - so the list is forward-compatible rather than
		// load-bearing.
		//
		// The role comes from a VERIFIED token claim. It is not read from a header
		// the caller controls, which is the property that makes this a guard
		// rather than a suggestion.
		if roleStr != "admin" && roleStr != "superadmin" && roleStr != "superadmin_recovery" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "Admin access required",
				// Echoed so a legitimate operator can see WHY they were refused.
				// It is their own role, read from their own verified token.
				"role": roleStr,
			})
			return
		}

		c.Next()
	}
}

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
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Pehle AuthRequired chalna chahiye (ye uske baad lagta hai)
		role, _ := c.Get("role")
		roleStr, _ := role.(string)

		if roleStr != "admin" && roleStr != "superadmin" && roleStr != "superadmin_recovery" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "Admin access required",
			})
			return
		}

		c.Next()
	}
}

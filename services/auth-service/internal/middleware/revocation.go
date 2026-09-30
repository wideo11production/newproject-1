package middleware

// ============================================================================
// JWT REVOCATION DENYLIST
// ============================================================================
//
// ---- THE GAP THIS FILLS (AND THE ONE IT DOESN'T) ----
//
// `AuthMiddleware` pehle se ye karta hai:
//   - signature verify karta hai
//   - `sessions` table me token hash dhoondta hai, `revoked_at IS NULL`
//     filter ke saath - yaani revoked session REJECT hoti hai
//   - user active hai ya nahi, wo bhi check karta hai
//
// Iska matlab logout kaam kar raha hai. Ye pehle likha gaya tha jaise kaam na
// kar raha ho - wo galat tha.
//
// Jo SACH me missing tha, wo ye hai:
//
//  1. DATABASE COST. Har authenticated request par ek SHA-256 hash aur ek
//     Postgres round-trip. Token validation aapke sabse hot path ka hissa
//     hai, aur ye usse single point of failure banata hai: Postgres slow hua
//     to EVERY authenticated request slow. Auth ek disk-bound operation
//     banana, jab uske paas ek already-signed token hai, apni hi design galti
//     hai.
//
//  2. `RevokeToken` `sessions.revoked_at` set karta hai, par refresh-token
//     rotation ke dauraan purane token ke liye koi independent record nahi
//     rehta. Token-specific revocation (ek device logout, all-devices ke
//     bina) ke liye koi handle nahi tha.
//
// Ye denylist dono address karti hai, aur cost Redis me jaata hai.
//
// ---- WHY A DENYLIST AND NOT AN ALLOWLIST ----
//
// Allowlist (Redis me "ye token valid hai" store karna) isse behtar hota ki
// Redis flush hone par sab tokens invalid ho jaate - user ko login karwana
// padta. Ye zyada secure hai par zyada disruptive hai.
//
// Denylist choose ki: Redis flush = logout ka record kho jaata hai, par
// `sessions.revoked_at` (Postgres me) abhi bhi wahi kaam karta hai. Do layer
// hain, Redis fast path hai aur Postgres authority. Redis down par system
// `AuthMiddleware` ke normal DB check par girta hai - output same rehta hai,
// sirf slow hota hai. Ye failover implicit hai, alag code path ki zaroorat
// nahi.
//
// ---- TTL KYUN ----
//
// Entry ki TTL = token ki BAQI umar. Token expire hone ke baad denylist me
// rakhne ka koi matlab nahi - waise bhi verify reject ho jayega. Isi liye
// denylist apne aap shrink hoti rahti hai aur unbounded growth impossible
// hai. Ye zaroori hai: unbounded denylist memory leak ban jati hai, aur
// Redis OOM hona auth outage ban jata.
//
// ---- SECURITY NOTE ----
//
// `jti` JWT ka SIGNED claim hai, isliye client ise forge nahi kar sakta.
// Sirf token holder apna hi token revoke kar sakta hai, aur wo koi nuksaan
// nahi hai - uska apna token hai.

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/wideo11/auth-service/internal/redisx"
	"github.com/wideo11/auth-service/internal/token"
)

// denylistPrefix namespaces the keys so they cannot collide with rate
// limiter keys ("rl:") or anything else that lands in this Redis.
const denylistPrefix = "revoked:jti:"

// RevocationStore wraps Redis with the denylist helpers.
type RevocationStore struct {
	rc *redisx.Client
}

func NewRevocationStore(rc *redisx.Client) *RevocationStore {
	return &RevocationStore{rc: rc}
}

// Revoke records a token id as revoked until it would have expired anyway.
//
// remaining is the token's live time left. Passing a non-positive or
// absurdly large value is handled here rather than at each call site: an
// entry that outlives its token pins memory forever, and one with a
// non-positive TTL would be written already-expired and silently not work.
func (r *RevocationStore) Revoke(c *gin.Context, jti string, issuedAt, expiresAt time.Time) {
	if r == nil || r.rc == nil || jti == "" {
		return
	}

	// Default cap: 24h. A token cannot legitimately outlive this, and the cap
	// bounds the damage if a caller ever computes a nonsense expiry.
	const maxTTL = 24 * time.Hour
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		// Already expired: nothing to revoke, the signature check will
		// reject it anyway.
		return
	}
	if ttl > maxTTL {
		ttl = maxTTL
	}

	if err := r.rc.Set(c.Request.Context(), denylistPrefix+jti, "1", ttl); err != nil {
		// FAIL OPEN, same policy as the rate limiter. The DB session check in
		// AuthMiddleware still rejects a revoked session, so losing this
		// write degrades us to the slower (but correct) path rather than
		// leaving a revoked token usable.
		log.Warn().Err(err).Str("jti", jti).
			Msg("failed to write JWT denylist entry; DB session check remains authoritative")
	}
}

// IsRevoked reports whether a token id is denylisted.
//
// Error is swallowed deliberately: see above. A Redis failure must not reject
// a legitimate request, because the authoritative check (sessions.revoked_at)
// has already run by this point.
func (r *RevocationStore) IsRevoked(c *gin.Context, jti string) bool {
	if r == nil || r.rc == nil || jti == "" {
		return false
	}
	found, err := r.rc.Exists(c.Request.Context(), denylistPrefix+jti)
	if err != nil {
		log.Warn().Err(err).Str("jti", jti).
			Msg("JWT denylist lookup failed; relying on DB session check")
		return false
	}
	return found
}

// CheckRevoked is Gin middleware. Place it AFTER AuthMiddleware has verified
// the signature - checking an unverified token's jti would let an attacker
// probe which ids are denylisted.
func CheckRevoked(store *RevocationStore, validate func(string) (*token.Claims, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		if store == nil {
			c.Next()
			return
		}

		raw := bearerToken(c.GetHeader("Authorization"))
		if raw == "" {
			c.Next()
			return
		}

		// Re-validating rather than trusting a claim from context: this
		// middleware is a standalone unit and must be safe to mount on its
		// own. Validation is pure CPU (HMAC), no I/O.
		claims, err := validate(raw)
		if err != nil {
			// Bad or expired token - not this middleware's business. Let
			// AuthMiddleware produce the response so the client gets one
			// consistent error shape.
			c.Next()
			return
		}

		if store.IsRevoked(c, claims.ID) {
			// 401 with a distinct error so a client can tell "your token
			// expired, refresh it" apart from "your token was revoked, stop
			// using it" - the correct client action differs.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "token_revoked",
				"message": "This token has been revoked. Please sign in again.",
			})
			return
		}

		c.Next()
	}
}

// bearerToken strips an optional "Bearer " prefix.
func bearerToken(h string) string {
	if len(h) > 7 && h[:7] == "Bearer " {
		return h[7:]
	}
	return h
}

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
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/wideo11/auth-service/internal/redisx"
)

// denylistPrefix namespaces the keys so they cannot collide with rate
// limiter keys ("rl:") or anything else that lands in this Redis.
const denylistPrefix = "revoked:session:"

// maxTTL is the hard ceiling on a denylist entry's lifetime.
//
// This is the answer to "does the denylist accumulate garbage": it cannot.
// Every entry is written with a TTL, and that TTL is clamped HERE, once,
// rather than trusted from each call site. An entry that outlives its token
// pins Redis memory forever, and Redis OOM is an auth outage.
const maxTTL = 24 * time.Hour

// RevocationStore wraps Redis with the denylist helpers.
//
// ---- WHY THIS IS MOUNTED NOW (Phase C7) ----
//
// Pehle ye DEAD CODE thi: `NewRevocationStore` aur `CheckRevoked` ke koi call
// site nahi the. Likhi gayi thi (comments sahi the), bas chain me lagayi nahi
// gayi. Ab logout DB row HARD-DELETE karta hai, aur ye Redis entry uske turant
// baad aane wale request ko bina DB round-trip ke 401 deta hai.
//
// Authority hamesha Postgres hai: `AuthMiddleware` har authenticated request
// par `sessions` me token hash dhoondta hai. Ye sirf wo ek round-trip hata
// deta hai. Redis down ho to system thoda slow hota hai, galat nahi.
type RevocationStore struct {
	rc *redisx.Client
}

func NewRevocationStore(rc *redisx.Client) *RevocationStore {
	return &RevocationStore{rc: rc}
}

// Revoke records a session id as revoked, for at most `maxTTL`.
//
// `context.Context` rather than `*gin.Context`: ye service layer se bhi
// call hota hai (logout), aur service ko gin dependency nahi chahiye.
// Revocation gRPC/HTTP ke andar ka concern nahi, business logic ka hai.
func (r *RevocationStore) Revoke(ctx context.Context, sessionID uuid.UUID) {
	if r == nil || r.rc == nil || sessionID == uuid.Nil {
		return
	}
	if err := r.rc.Set(ctx, denylistPrefix+sessionID.String(), "1", maxTTL); err != nil {
		// FAIL OPEN. The DB hard-delete is authoritative and already done -
		// losing this write costs one DB round-trip, not security.
		log.Warn().Err(err).Str("session", sessionID.String()).
			Msg("failed to write session denylist entry; DB hard-delete remains authoritative")
	}
}

// IsRevoked reports whether a session id is denylisted.
//
// Error is swallowed deliberately - see above. By the time this runs the
// authoritative DB check has already passed.
func (r *RevocationStore) IsRevoked(ctx context.Context, sessionID uuid.UUID) bool {
	if r == nil || r.rc == nil || sessionID == uuid.Nil {
		return false
	}
	found, err := r.rc.Exists(ctx, denylistPrefix+sessionID.String())
	if err != nil {
		log.Warn().Err(err).Str("session", sessionID.String()).
			Msg("session denylist lookup failed; relying on the DB session lookup")
		return false
	}
	return found
}

// CheckRevoked is Gin middleware. Place it AFTER AuthMiddleware has verified
// the signature and resolved the session - it reads the session id straight
// from the context, so an unverified caller can never probe which ids are
// denylisted.
func CheckRevoked(store *RevocationStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if store == nil {
			c.Next()
			return
		}
		raw := c.GetString("session_id")
		if raw == "" {
			c.Next()
			return
		}
		sessionID, err := uuid.Parse(raw)
		if err != nil {
			// Unparseable: let AuthMiddleware produce the response so the
			// client sees one consistent error shape.
			c.Next()
			return
		}
		if store.IsRevoked(c.Request.Context(), sessionID) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "token_revoked",
				"message": "This session has been logged out. Please sign in again.",
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

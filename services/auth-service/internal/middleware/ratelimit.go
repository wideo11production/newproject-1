package middleware

// ============================================================================
// REDIS-BACKED RATE LIMITING
// ============================================================================
//
// ---- WHY THIS EXISTS AT ALL ----
//
// Rate limiting pehle sirf `apps/web/src/lib/rate-limiter.ts` me tha - yani
// Next.js ke server process ki memory me. Uske teen problems the:
//
//  1. BYPASSABLE. `auth-service` ka port host pe published hai (8085), to koi
//     bhi seedha `localhost:8085/api/v1/auth/login` par POST karke poora
//     limiter skip kar sakta tha. Verify kiya gaya: 6 login attempts, chhah
//     par bhi koi 429 nahi - unlimited password guessing.
//
//  2. RESTART-RESET. `pnpm dev` restart, ya container recreate, saare
//     counters wipe kar deta tha. Brute-force attacker ke liye ye ek
//     "free reset" button hai.
//
//  3. PER-REPLICA. Do Next.js instances chalaye to har ek ka apna counter
//     hota hai - documented limit 8/min, actual 16/min.
//
// In teenon ka ek hi ilaaj hai: counter ko Redis me rakhna. Redis pehle se
// deployed hai, wahi instance rate limiting aur token revocation dono share
// karega (ek connection pool - `internal/redisx` me rationale).
//
// ---- WHY PER-ROUTE, NOT ONE GLOBAL LIMIT ----
//
// Ek global number galat hota hai: ya to bahut loose (login par koi fark
// nahi padta) ya bahut tight (verification email resend block ho jata hai).
// Ye `Policy` struct per-route limit rakhti hai, kyunki routes ka abuse
// profile alag hai:
//
//   - login/register: credential stuffing, chhote window, bahut kam attempts
//   - verify/resend: email bombing, thoda zyada
//   - password reset: account takeover, sabse kam
//   - general API: accidental loops, generous
//
// ---- FAIL OPEN, DELIBERATELY ----
//
// Redis error par request ALLOW hota hai. Reason `internal/redisx` ke package
// comment me detail hai: fail-closed matlab "Redis down => sab log-in fail",
// jo brute-force se bade nuksan ko ek cache outage se badal deta hai. Ye
// `degraded_hits` counter Prometheus alert dekh rakhta hai, taaki kamzori
// chuphe na rahe.
//
// ---- WINDOW: FIXED, NOT SLIDING ----
//
// Fixed window simpler hai, ek Redis key per (route, identity) chahta hai,
// aur memory/perf dono behtar. Classic weakness ye hai ki window boundary
// par user 2x limit spend kar sakta hai (end-of-window + start-of-window).
// Ye jaan-boojh kar swapt kiya gaya hai, kyunki:
//
//   - is limit ka kaam brute-force ko EXPENSIVE banana hai, perfect nahi karna
//   - sliding window ke liye sorted set + Lua chahiye, jo ek extra round-trip
//     aur extra failure mode hai
//   - agar boundary abuse dikhe, tab migrate karna sahi hai - pehle se
//     complex rakhna premature hai
//
// Production me chahiye to yahan `Policy.Sliding bool` add karke Lua script
// se sorted-set window karein, bina caller API badle.
//
// ---- IDENTITY: IP, BUT HONEST ABOUT IT ----
//
// Key = route + client IP. Backend me user identity tabhi pata hoti hai jab
// token valid ho - aur rate limit lagane ka matlab hi token chahiye ye
// circular hai (infinite regress). Isliye IP.
//
// Proxy ke peeche sab clients ek hi IP dikhate hain - `TrustedProxies` me
// ginne ke baad `c.ClientIP()` sahi IP deta hai, aur trusted proxy na hone
// par Gin `X-Forwarded-For` ko IGNORE karta hai (jo sahi hai: warna koi
// `X-Forwarded-For: 1.2.3.4` bhej kar apna limit badha sakta tha).
// NAT ke peeche bhi shared IP hoti hai - trade-off documented hai, isiliye
// limits itne rakhe gaye hain ki shared-office NAT block na ho.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/wideo11/auth-service/internal/redisx"
)

// Policy = ek route ka rate limit.
type Policy struct {
	// Max: window ke andar kitne requests allowed hain.
	Max int
	// Window: kitne second ka ek period.
	Window time.Duration
	// Name: Redis key me use hota hai, aur logs me readable rehta hai.
	// Do routes ka naam same na ho, warna unka limit share ho jayega.
	Name string
	// KeyFunc custom identity banata hai. Nil ho to default IP-based key.
	//
	// ---- KYUN CHAHIYE ----
	//
	// IP-only limiting credential stuffing me KAMZOR hai. Ek attacker
	// jo 500 alag IPs se (botnet, proxy pool, cloud) EK hi account par
	// guess karta hai, har IP par limit ke andar rehta hai - to account
	// par effectively unlimited attempts mil jaate hain.
	//
	// Isiliye login ke liye teen keys chalti hain:
	//   1. ip   - ek IP se kitne accounts (password spray)
	//   2. email - ek account par kitne IPs  <-- ye asli protection hai
	//   3. ip+email - ek specific pair (narrow, jaldi trigger)
	//
	// (2) hi credential stuffing rokta hai. (1) password spray rokta hai.
	// Dono saath chahiye - ek akela adhoora hai.
	//
	// SECURITY: `email` ko LOWERCASE + TRIM karna zaroori hai. Bina iske
	// `A@x.com` aur `a@x.com` alag count hote hain aur attacker case
	// badal-karke limit cross kar sakta hai. Ye ek real bypass tha jab tak
	// normalization nahi ki gayi.
	KeyFunc func(c *gin.Context) string
}

// loginIdentity builds the two keys login needs, normalised.
//
// Truncate kiya gaya hai taaki Redis key lambi na ho: email 254 chars tak
// ho sakta hai, aur unbounded key memory waste karti hai. 100 chars me
// domain + local-part ka enough hissa aa jata hai.
func loginIdentity(c *gin.Context) (pair string, account string) {
	ip := c.ClientIP()

	email := ""
	if req, ok := c.Get("__rl_login_body"); ok {
		if s, ok := req.(string); ok {
			email = s
		}
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if len(email) > 100 {
		email = email[:100]
	}

	if email == "" {
		// Body me email nahi mili (malformed JSON, ya GET). IP-only behaviour
		// sahi hai yahan - account identify hi nahi hua.
		return ip, ""
	}
	return ip + "|" + email, email
}

var (
	// LimitRegister: 3 per 5 min. Ek email se ek hi account banna chahiye;
	// isse zyada matlab bulk signup.
	LimitRegister = Policy{Name: "register", Max: 3, Window: 5 * time.Minute}

	// LimitLogin: 8 per 1 min (per IP+email pair), aur 30 per 15 min
	// (sustained). Do windows chahiye: sirf short window se attacker har
	// minute limit reset karke unlimited total kar sakta hai.
	LimitLogin = Policy{Name: "login", Max: 8, Window: time.Minute, KeyFunc: ipAndEmail}
	LimitLoginSustained = Policy{Name: "login_sustained", Max: 30, Window: 15 * time.Minute, KeyFunc: ipAndEmail}

	// LimitLoginPerAccount: 10 per 15 min per EMAIL (IP se independent).
	//
	// Ye woh rule hai jo credential stuffing ko rokta hai. IP rotate karne
	// se isse koi nahi bach sakta, kyunki key me IP hai hi nahi.
	//
	// 15 min me 10 attempts: ye strict hai lekin legit users ko farak nahi
	// padta - koi apna password 10 baar galat nahi type karta. Aur 15 min
	// me 10 guesses = brute force practically impossible (letters-only
	// 6-char password bhi 10^9+ combinations chahiye).
	LimitLoginPerAccount = Policy{Name: "login_account", Max: 10, Window: 15 * time.Minute, KeyFunc: accountOnly}

	// LimitLoginPerIP: 20 per 5 min per IP (all accounts). Password spray
	// rokta hai - ek IP se 20 se zyada accounts try karna legitimate nahi.
	LimitLoginPerIP = Policy{Name: "login_ip", Max: 20, Window: 5 * time.Minute, KeyFunc: ipOnly}

	// LimitVerify: 10 per 5 min. Verification email bhejna email-bombing
	// aur sender reputation damage karta hai.
	LimitVerify = Policy{Name: "verify", Max: 10, Window: 5 * time.Minute}

	// LimitPasswordReset: 3 per 15 min. Sabse sensitive - ye account
	// takeover ka raasta hai, isliye sabse kam.
	LimitPasswordReset = Policy{Name: "password_reset", Max: 3, Window: 15 * time.Minute}

	// LimitAPI: 200 per minute. Sirf accidental loop rokta hai; ise tight
	// rakhna legit users ko hurt karega bina koi security gain ke.
	LimitAPI = Policy{Name: "api", Max: 200, Window: time.Minute}
)

// ipAndEmail returns "<ip>|<email>" - the narrow per-pair key. Wraps
// loginIdentity, which returns two values.
func ipAndEmail(c *gin.Context) string {
	pair, _ := loginIdentity(c)
	return pair
}

// accountOnly returns just the normalised email, ignoring IP entirely.
func accountOnly(c *gin.Context) string {
	_, acct := loginIdentity(c)
	if acct == "" {
		// No email in body: key on IP so the counter is still bounded and
		// cannot be reset by simply omitting the field.
		return c.ClientIP()
	}
	return acct
}

// ipOnly returns just the client IP.
func ipOnly(c *gin.Context) string { return c.ClientIP() }

// BodyEmailCapture buffers the request body ONCE and stashes the email on
// the gin context, so RateLimit can key on it without consuming the body the
// handler is about to read.
//
// ---- WHY THIS EXISTS ----
//
// gin handler ka `c.ShouldBindJSON` apna hi body padh leta hai - uske baad
// body khaali hota hai. Agar rate-limit middleware pehle body padh le, to
// handler ko "unexpected EOF" mil jayega aur EVERY login fail ho jayegi.
//
// Isiliye body yahan padha jaata hai, email gin context me rakh diya jaata
// hai, aur `c.Request.Body` ko original bytes wapas de diya jaata hai. Handler
// ko bilkul pata bhi nahi chalta.
//
// Buffer 4KB tak cap kiya hai: login body chhoti hoti hai, aur unbounded
// read memory DoS ban jayega. Isse zyada bada body gin ke normal
// `ShouldBindJSON` par fail hoga, jo theek hai.
func BodyEmailCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil || c.Request.Method != http.MethodPost {
			c.Next()
			return
		}
		// Sirf wahi paths jinhe email chahiye. Baaki har request ka body
		// buffer karna pure waste hoga.
		p := c.Request.URL.Path
		if !strings.HasSuffix(p, "/login") &&
			!strings.HasSuffix(p, "/register") &&
			!strings.HasSuffix(p, "/refresh") {
			c.Next()
			return
		}

		const maxBody = 4 << 10
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBody+1))
		if err != nil {
			c.Next()
			return
		}
		_ = c.Request.Body.Close()
		c.Request.Body = io.NopCloser(bytes.NewReader(body))

		// JSON parse best-effort. Valid JSON nahi hua to handler ko apni
		// validation error dekhni chahiye - yahan koi chhupana nahi hai.
		var probe struct {
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &probe); err == nil && probe.Email != "" {
			c.Set("__rl_login_body", strings.ToLower(strings.TrimSpace(probe.Email)))
		}

		c.Next()
	}
}

// RateLimit returns middleware enforcing one or more policies for a route.
//
// Multiple policies pass because "8/min AND 30/15min" dono chahiye hote
// hain, aur ek hi middleware un dono ko ek request me check karta hai - ek
// Redis round-trip per policy, par chainable middleware se bach jaata hai.
func RateLimit(rc *redisx.Client, policies ...Policy) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rc == nil {
			// Redis was never initialised. Degrade, do not crash the service.
			c.Next()
			return
		}

		ctx := c.Request.Context()
		clientIP := c.ClientIP()

		for _, p := range policies {
			// Identity: policy ka custom KeyFunc, warna IP.
			identity := clientIP
			if p.KeyFunc != nil {
				if k := p.KeyFunc(c); k != "" {
					identity = k
				}
			}

			ok, retryAfter, err := allow(ctx, rc, p, identity)

			if err != nil {
				// Fail open. Logged at WARN so it is greppable, and counted by
				// the alert in monitoring/rules/platform.yml.
				log.Warn().Err(err).Str("limit", p.Name).Str("ip", clientIP).
					Msg("rate limiter degraded: Redis unavailable, allowing request")
				continue
			}

			if !ok {
				// Do alag log levels, kyunki do alag situations hain:
				//   WARN  - ek user zyada try kar raha hai (common, benign)
				//   ERROR - ek IP bahut zyada accounts try kar rahi hai, ya ek
				//           account bahut zyada IPs se - ye attack pattern hai
				ipWide := p.Name == "login_ip"
				logFn := log.Warn
				if ipWide {
					logFn = log.Error
				}
				logFn().Str("limit", p.Name).Str("ip", clientIP).
					Str("identity", truncateIdentity(identity)).
					Int("window_seconds", int(p.Window.Seconds())).
					Msg("rate limit exceeded")
				AuditRateLimited(c, p, identity, clientIP)

				c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
				c.Header("X-RateLimit-Limit", strconv.Itoa(p.Max))
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
					"error":   "rate_limited",
					"message": fmt.Sprintf("Too many requests. Try again in %d seconds.", int(retryAfter.Seconds())),
					// `retry_after` seconds me hai. Client isko parse karke
					// countdown dikha sakta hai; string format nahi, taaki JS
					// me parse karne ki zaroorat na pade.
					"retry_after": int(retryAfter.Seconds()),
					"limit":       p.Name,
				})
				return
			}

			// Success par bhi limit header bhejte hain, taaki client apna
			// usage dekh sake aur khud throttle kar sake.
			c.Header("X-RateLimit-Limit", strconv.Itoa(p.Max))
		}

		c.Next()
	}
}

// truncateIdentity logs me email leak na ho. Email ka domain + first 2 chars
// kaafi hai identify karne ke liye, aur user ki PII pura log me nahi jaati.
func truncateIdentity(id string) string {
	if len(id) <= 4 {
		return id
	}
	// email wali keys me '@' hota hai
	if at := strings.Index(id, "@"); at > 0 {
		user := id[:at]
		domain := id[at:]
		if len(user) > 2 {
			user = user[:2] + "***"
		}
		return user + domain
	}
	return id[:4] + "***"
}

// allow checks one policy and reports whether the request may proceed.
func allow(ctx context.Context, rc *redisx.Client, p Policy, clientIP string) (bool, time.Duration, error) {
	key := "rl:" + p.Name + ":" + clientIP

	// EXPIRE sirf nayi key par lagta hai, har hit par nahi:
	//   - har hit par lagta to window slide hoti rehti - fixed window
	//     unbounded ho jata
	//   - TTL pehle se set hai to har hit par dobara lagana waste
	// Redis INCR nayi key par 1 return karta hai, isliye `n == 1` se pata
	// chalta hai ki ye pehla hit hai.
	n, err := rc.INCR(ctx, key)
	if err != nil {
		return true, 0, err
	}

	if n == 1 {
		if err := rc.Expire(ctx, key, p.Window); err != nil {
			// Count badh gaya par TTL set nahi hua - ye key PERMANENT ban
			// jayegi aur user ko hamesha block rahega. Isiliye turant delete
			// karke fail open karte hain: agle hit par dobara try hoga.
			//
			// Ye deliberate trade-off hai. Galat rollback (delete nahi karna)
			// permanent lockout ban jata, jo worse hai. Best-effort delete
			// ke baad bhi delete fail ho to limit khud expire nahi hogi -
			// isliye ye path WARN log karta hai.
			log.Warn().Err(err).Str("limit", p.Name).Str("key", key).
				Msg("failed to set rate limit window; deleting counter to avoid permanent lockout")
			_ = rc.Delete(ctx, key)
			return true, 0, err
		}
	}

	if n > int64(p.Max) {
		// Blocked. Retry-After poori window ke liye - ye conservative hai
		// (user ko thoda zyada wait karna pad sakta hai) par isse repeated
		// hammering banti nahi.
		return false, p.Window, nil
	}

	return true, 0, nil
}

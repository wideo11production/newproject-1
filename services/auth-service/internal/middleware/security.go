package middleware

// ============================================================================
// SECURITY HEADERS  -  Phase A / gap #2
// ============================================================================
//
// KYA THA: koi security header nahi tha. Har response bina kisi protection ke
// ja raha tha.
//
// KYUN ZAROORI HAI - ye headers kya rokte hain:
//
//  1. `X-Content-Type-Options: nosniff`
//     Browser ko MIME sniffing se rokta hai. Iske bina attacker apne
//     `avatar.png` ko actually `text/html` bana sakta hai aur victim usse
//     open karne par uska page render ho sakta hai (stored XSS).
//     Ye SABSE important header hai - is project me avatar upload hota hai,
//     to ye attack surface REAL hai.
//
//  2. `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
//     API ke liye `default-src 'none'` ka matlab hai "koi bhi resource load
//     mat karo" - jo JSON responses ke liye bilkul sahi hai (kuch load karne
//     ki zaroorat hi nahi). `frame-ancestors 'none'` clickjacking rokta hai:
//     koi hamara API response apne iframe me nahi chupa sakta.
//
//  3. `X-Frame-Options: DENY`
//     `frame-ancestors` se pehle ka standard header. Aaj kal modern browsers
//     CSP wala use karte hain, par purane browsers ke liye ye abhi bhi
//     zaroori hai. Dono saath me jaate hain (defence in depth).
//
//  4. `Referrer-Policy: strict-origin-when-cross-origin`
//     Browser `Referer` header me poori URL bhejta hai - jisme tokens ya
//     reset-password jaise secrets ho sakte hain. Ye policy kehti hai "dusri
//     site pe sirf origin bhejo, path mat bhejo". Ye data leak rokta hai.
//
//  5. `Permissions-Policy`
//     Camera/mic/geolocation ko band karta hai. Ye app unka use nahi karti,
//     to koi reason nahi ki koi inject kar sake.
//
//  6. `Strict-Transport-Security` (HSTS)
//     Browser ko force karta hai ki future me HTTP use hi na kare - sirf
//     HTTPS. Isse "http:// se intercept" wala attack (sslstrip) band hota
//     hai. BAHUT IMPORTANT: ye header SIRF HTTPS pe bhejna chahiye. HTTP pe
//     bhejne par browsers IGNORE karte hain, par phir bhi localhost dev me
//     galat impression create hota hai. Isliye `isRequestHTTPS()` check hai.
//
// ---- WHY CONFIGURABLE AND NOT HARDCODED ----
// HSTS max-age, CSP, aur CORS origins har environment me alag hote hain.
// Code me hardcode karne ka matlab hai har deploy me source change - isliye
// sab `.env` se aata hai, defaults ke saath (dev-friendly).
//
// Hinglish: har header ka ek clear kaam hai, config se aata hai

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// SecurityHeadersConfig - security headers ki settings.
type SecurityHeadersConfig struct {
	// HSTSMaxAge - `Strict-Transport-Security` ka max-age (seconds).
	// 0 = HSTS bhejna band.
	HSTSMaxAge int
	// HSTSIncludeSubdomains - `includeSubDomains` directive.
	HSTSIncludeSubdomains bool
	// CSP - Content-Security-Policy. Khaali = default (bahut strict, API ke
	// liye sahi) use hoga.
	CSP string
	// ReferrerPolicy - default `strict-origin-when-cross-origin`.
	ReferrerPolicy string
	// FrameOptions - default `DENY`.
	FrameOptions string
	// PermissionsPolicy - default: camera/mic/geo band.
	PermissionsPolicy string
	// ExtraHeaders - koi aur custom header jo add karna ho.
	ExtraHeaders map[string]string
}

// DefaultSecurityHeadersConfig - secure defaults.
//
// NOTE: HSTS default me 0 (off) hai. Ye service abhi plain HTTP par local
// dev me chalti hai, aur HSTS ne HTTPUI se strict rakhne ke liye bhejne
// pe localhost ka HSTS cache ban jaata hai - jo dev experience TODTA hai.
// Production me `SECURITY_HSTS_MAX_AGE` set karo (31536000 = 1 saal).
func DefaultSecurityHeadersConfig() SecurityHeadersConfig {
	return SecurityHeadersConfig{
		HSTSMaxAge: 0,
		// Sirf tab meaningful jab HSTS on ho - `includeSubDomains` ko
		// `max-age=0` ke saath bhejna browser ko confuse karta hai.
		HSTSIncludeSubdomains: false,
		CSP:                   "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
		FrameOptions:          "DENY",
		PermissionsPolicy:     "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
	}
}

// SecurityHeaders security response headers set karta hai.
//
// Ye FIRST middleware hona chahiye taaki headers SET ho jayein, aur baaki
// handlers unko overwrite na kar sakein. Gin me middleware LIFO chalta hai,
// to ise `r.Use()` me sabse pehle add karna best hai.
func SecurityHeaders(cfg SecurityHeadersConfig) gin.HandlerFunc {
	// Neeche ke helpers pehle se resolve kar lo, taaki har request pe
	// string formatting na ho (ye service har request pe chalti hai).
	referrer := cfg.ReferrerPolicy
	if referrer == "" {
		referrer = "strict-origin-when-cross-origin"
	}
	frame := cfg.FrameOptions
	if frame == "" {
		frame = "DENY"
	}
	permissions := cfg.PermissionsPolicy
	if permissions == "" {
		permissions = DefaultSecurityHeadersConfig().PermissionsPolicy
	}
	csp := cfg.CSP
	if csp == "" {
		csp = DefaultSecurityHeadersConfig().CSP
	}

	hstsValue := ""
	if cfg.HSTSMaxAge > 0 {
		hstsValue = "max-age=" + strconv.Itoa(cfg.HSTSMaxAge)
		if cfg.HSTSIncludeSubdomains {
			hstsValue += "; includeSubDomains"
		}
		// `preload` tabhi add karo jab includeSubDomains bhi ho - preload
		// ek one-way door hai, aadha apply karna behad kharchat hai.
		if cfg.HSTSIncludeSubdomains && cfg.HSTSMaxAge >= 31536000 {
			hstsValue += "; preload"
		}
	}

	return func(c *gin.Context) {
		h := c.Writer.Header()

		// ---- 1. MIME sniffing off (avatar upload attack surface) ----
		h.Set("X-Content-Type-Options", "nosniff")

		// ---- 2. Clickjacking off (CSP + legacy dono) ----
		h.Set("X-Frame-Options", frame)
		h.Set("Content-Security-Policy", csp)

		// ---- 3. Referrer me path leak na ho ----
		h.Set("Referrer-Policy", referrer)

		// ---- 4. Unused powerful browser features band ----
		if permissions != "" {
			h.Set("Permissions-Policy", permissions)
		}

		// ---- 5. HSTS - sirf HTTPS pe ----
		//
		// Ye header HTTP response me bhejne se koi fayda nahi (browser
		// ignore karta hai), aur localhost pe bhejne se dev HSTS cache
		// ban jaata hai jisme user ko `thisisunsafe.com` jana padta hai.
		// Isliye protocol check COMPULSORY hai.
		if hstsValue != "" && isRequestHTTPS(c.Request) {
			h.Set("Strict-Transport-Security", hstsValue)
		}

		// ---- 6. Cross-origin isolation hints ----
		//
		// `same-origin` se is page ka `window.opener` cross-origin pages ko
		// reference nahi kar sakta (tabnabbing attack band).
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		// `same-site` - hamare apne resources (avatar images) cross-site
		// tab me bhi load ho sake, par kisi AUR site ke resources nahi.
		// NOTE: `cross-origin` iske bajay se avatar images BLOCK ho jayenge
		// jabki wo public-read hain - isliye `same-site` sahi hai.
		h.Set("Cross-Origin-Resource-Policy", "same-site")

		// ---- 7. Extra custom headers ----
		for k, v := range cfg.ExtraHeaders {
			h.Set(k, v)
		}

		c.Next()
	}
}

// NoStore middleware - sensitive responses ko cache se rokta hai.
//
// KYUN: `GET /me`, `GET /settings`, `GET /sessions` jaise responses me user
// ka PII hota hai. Koi shared proxy ya browser cache inhe store kar lega to
// agla user (shared device par) previous user ka data dekh sakta hai.
//
// Auth API ke liye caching bilkul zaroorat nahi - responses chhote hain aur
// real-time hone chahiye. Isliye `no-store` karna safe hai.
func NoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
		h.Set("Pragma", "no-cache")
		h.Set("Expires", "0")
		c.Next()
	}
}

// isRequestHTTPS - request HTTPS par aaya ya nahi.
//
// ---- WHY WE MUST TRUST THE PROXY HEADER ----
// Gin's `c.Request.TLS` sirf tab non-nil hota hai jab server par TLS
// TERMINATE hota hai. Production me TLS ingress/reverse proxy par terminate
// hota hai aur Go service ko plain HTTP milta hai - to `Request.TLS` hamesha
// nil rahega, aur HSTS kabhi bhi set NAHI hoga. Ye silent failure hai:
// config me max-age set hai, logs me dikhta nahi, par browser ko HSTS nahi
// mil raha.
//
// Isliye `X-Forwarded-Proto` check bhi karte hain - ye standard header hai
// jo har reverse proxy bhar ta hai.
//
// SECURITY NOTE: `X-Forwarded-Proto` client spoof kar sakta hai agar service
// internet par directly exposed ho. Iska nuksan yah hai ki ek attacker HSTS
// ko "on" karva sakta hai apne domain ke liye - apne aap ko nuksan, humein
// nahi. Zyada bada nuksan ye hota ki wo HSTS ko OFF nahi kar sakta (off
// karne ke liye `max-age=0` bhejna padta, jo hota to logged out ho jaata).
// Isliye ye accept karne se koi real risk nahi hai. Bas `Request.TLS` ko
// PEHLE check karna zaroori hai, taaki genuine TLS par bhi sahi chale.
func isRequestHTTPS(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	// Proxy ne kitni hops bataye? `X-Forwarded-Proto` me multiple values ho
	// sakti hain ("https,http" - har proxy apna add karta hai). PEHLA value
	// client se aaya hota hai, yaani wo ORIGIN protocol hai. Isliye pehla
	// token lo, poora string nahi.
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		return false
	}
	if idx := strings.IndexByte(proto, ','); idx >= 0 {
		proto = proto[:idx]
	}
	return strings.EqualFold(strings.TrimSpace(proto), "https")
}

// ============================================================================
// CORS  -  proper allowlist (pehle `*` + credentials tha)
// ============================================================================

// CorsConfig - CORS allowlist.
type CorsConfig struct {
	// AllowedOrigins - comma separated. `*` KABHI allowed nahi hota jab
	// credentials bhi on hon (browsers ise reject karte hain).
	AllowedOrigins []string
	// AllowCredentials - cookies/Authorization header bhejne ka permission.
	AllowCredentials bool
	// MaxAge - preflight cache (seconds).
	MaxAge int
}

// NewCORS - config se CORS middleware banata hai.
//
// ---- KYUN YE REWRITE HUA ----
// Pehle ye tha:
//
//	Access-Control-Allow-Origin:  *
//	Access-Control-Allow-Credentials: true
//
// Ye do problems ek saath create karte the:
//
//	A) `*` + `Allow-Credentials: true` browser me INVALID hai. Spec kehta
//	   hai credentials ke saath wildcard allowed nahi. Chrome/Firefox ise
//	   refuse karte hain. Matlab ye code credentials wale requests ke liye
//	   kaam hi nahi karta tha - silently.
//
//	B) Agar koi browser (ya curl with credentials) `*` ke saath request bheje,
//	   to credentials KISI BHI origin se allow ho jaate. Ye CSRF ki
//	   precondition hai: attacker ka page victim ke browser se authenticated
//	   request bhej sakta hai.
//
// Ab: exact origin allowlist + credential mode me origin echo hota hai
// (wildcard nahi), reflection tabhi hoti hai jab origin allowlist me hai.
//
// Hinglish: `*` ki jagah proper allowlist
func NewCORS(cfg CorsConfig) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	wildcard := false
	for _, raw := range cfg.AllowedOrigins {
		o := strings.TrimSpace(raw)
		if o == "" {
			continue
		}
		if o == "*" {
			wildcard = true
			continue
		}
		allowed[normalizeOrigin(o)] = struct{}{}
	}

	allowHeaders := strings.Join([]string{
		"Content-Type",
		"Content-Length",
		"Accept",
		"Accept-Encoding",
		"Authorization",
		"Cache-Control",
		"X-Requested-With",
		"X-CSRF-Token",
		"X-Request-ID",
	}, ", ")

	maxAge := cfg.MaxAge
	if maxAge <= 0 {
		maxAge = 600
	}

	// ---- Reflect allowlisted origin ----
	//
	// `Origin` header sirf tab echo karte hain jab wo EXACTLY allowlist me
	// ho. Normalization (trailing slash, case, default port) dono taraf
	// same hoti hai, warna `http://localhost:3000` vs `http://localhost:3000/`
	// jaisi trivial difference par CORS chupke se fail ho jaata.
	reflect := func(origin string) string {
		if origin == "" {
			return ""
		}
		norm := normalizeOrigin(origin)
		if _, ok := allowed[norm]; ok {
			return norm
		}
		return ""
	}

	return func(c *gin.Context) {
		h := c.Writer.Header()
		origin := c.Request.Header.Get("Origin")

		// ---- Preflight ----
		if c.Request.Method == http.MethodOptions && c.Request.Header.Get("Access-Control-Request-Method") != "" {
			if allowedOrigin := reflect(origin); allowedOrigin != "" {
				h.Set("Access-Control-Allow-Origin", allowedOrigin)
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", allowHeaders)
			h.Set("Access-Control-Expose-Headers", "Content-Length, X-Request-ID")
			h.Set("Access-Control-Max-Age", strconv.Itoa(maxAge))
			// NOTE: vary zaroori hai - response cache (browser/proxy) ko
			// batana padta ki ye header `Origin` ke hisaab se badalta hai.
			// Bina iske ek origin ka `Access-Control-Allow-Origin` doosre
			// origin ko mil sakta hai (cache poisoning).
			h.Add("Vary", "Origin")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		// ---- Actual request ----
		//
		// `*` + credentials kabhi allowed nahi. Agar wildcard mode on hai
		// (local dev convenience) to credentials OFF rehne chahiye, warna
		// browser request reject kar dega.
		if wildcard {
			h.Set("Access-Control-Allow-Origin", "*")
			if len(allowed) > 0 {
				// Mixed mode: explicit origins + wildcard fallback.
				if allowedOrigin := reflect(origin); allowedOrigin != "" {
					h.Set("Access-Control-Allow-Origin", allowedOrigin)
					h.Set("Access-Control-Allow-Credentials", "true")
				}
			}
		} else if allowedOrigin := reflect(origin); allowedOrigin != "" {
			h.Set("Access-Control-Allow-Origin", allowedOrigin)
			if cfg.AllowCredentials {
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			h.Add("Vary", "Origin")
		}
		// Origin allowlist me NAHI hai -> koi CORS header nahi bhejte.
		// Browser response block kar dega. Ye correct behaviour hai:
		// allowlisted nahi matlab allowed nahi.

		c.Next()
	}
}

// normalizeOrigin - origin ko canonical form me laata hai.
//
// Handle karta hai:
//   - trailing slash
//   - uppercase scheme/host (`HTTP://LocalHost:3000`)
//   - default port ka hatana (`http://x:80` == `http://x`)
//
// PORTFOLIO POINT: ye match EXACTLY hona chahiye reflection ke time. Tabhi
// legit browser origin match karegi, aur koi evil `http://localhost:3000.evil.com`
// jaisi value match nahi karegi.
func normalizeOrigin(origin string) string {
	o := strings.TrimSpace(origin)
	if o == "" {
		return ""
	}
	o = strings.TrimSuffix(o, "/")

	u, err := url.Parse(o)
	if err != nil || u.Scheme == "" || u.Host == "" {
		// Parse nahi hua ya relative hai - as-is return, allowlist se
		// exact match hi hoga (likely fail, jo safe hai).
		return strings.ToLower(o)
	}

	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Host)

	// Default port hatao taaki `http://x:80` aur `http://x` same treat hon.
	if (scheme == "http" && strings.HasSuffix(host, ":80")) ||
		(scheme == "https" && strings.HasSuffix(host, ":443")) {
		host = strings.TrimSuffix(host, ":80")
		host = strings.TrimSuffix(host, ":443")
	}

	// Path hatao - origin me path hota hi nahi. `url.Parse` ne
	// `http://x:3000/` ko Host="x:3000" bana diya, but defensive rakhna
	// sahi hai agar kabhi koi weird value aaye.
	return fmt.Sprintf("%s://%s", scheme, host)
}

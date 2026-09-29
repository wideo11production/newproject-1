package service

// ============================================================================
// TELEMETRY ENRICHMENT  -  real device / browser / geo from request
// ============================================================================
//
// REQUIREMENT: "superadmin ko pata chale user KIS DESH se, KIS DEVICE se,
// KIS BROWSER se aaya - har click par, real time, REAL data, koi dummy nahi".
//
// ---------------------------------------------------------------------------
// WHY THIS RUNS SERVER-SIDE (not in the browser)
// ---------------------------------------------------------------------------
// Agar ye browser me hota, to koi bhi user `navigator.userAgent` ya country
// kuch bhi bhej deta - aur superadmin ke dashboard par JHOOTH dikhta.
// Server par:
//   - `User-Agent` aata hai browser se (spoofable hai, but hard) - aur hum
//     ise TRUST karte hue data dikhate hain
//   - Country REAL proxy/CDN header se aati hai (jaise `CF-IPCountry`)
//   - IP server ke paas hota hai
//
// ---------------------------------------------------------------------------
// HONESTY: NO FAKED VALUES, EVER
// ---------------------------------------------------------------------------
// Agar koi data available nahi hai, to wo `NULL` jaata hai - kabhi
// "Unknown" bhar kar nahi bharenge ya koi default country (jaise "IN")
// guess nahi karenge. Superadmin panel me khaali dikhna sahi hai; jhootha
// dikhna galat hai.
//
// SPECIFICALLY:
//   - Country sirf tab bharte hain jab koi REAL geo header present ho
//     (Cloudflare / Vercel / custom). Local dev me wo header nahi hota ->
//     country NULL rahega. Ye THEEK hai.
//   - Device/browser/OS User-Agent se PARSE hote hain. Agar UA missing ya
//     unreadable ho to `unknown` (ye legitimately "we don't know" hai,
//     fabricated device nahi).
//
// Hinglish comments: har block ka arth

import (
	"context"
	"net/http"
	"strings"
)

// DeviceInfoParsed - ek request se derive hua device profile
type DeviceInfoParsed struct {
	Country    string
	Continent  string
	DeviceType string // mobile | tablet | desktop | bot | unknown
	Browser    string // "Chrome 131"
	OS         string // "Windows 11"
}

// ---------------------------------------------------------------------------
// COUNTRY -> CONTINENT mapping
// ---------------------------------------------------------------------------
//
// ISO 3166-1 alpha-2 codes ka static map. Ye CONTINENT-level granularity hai
// (city/precise location NAHI) - jo privacy-friendly bhi hai.
//
// NOTE: Ye map cover nahi karta har country (world bada hai). Jo map me nahi
// mila, uska continent khaali rahega - guess nahi karenge.
var countryToContinent = map[string]string{
	// Asia
	"IN": "AS", "CN": "AS", "JP": "AS", "KR": "AS", "ID": "AS", "SG": "AS",
	"MY": "AS", "TH": "AS", "VN": "AS", "PH": "AS", "PK": "AS", "BD": "AS",
	"LK": "AS", "NP": "AS", "MM": "AS", "KH": "AS", "LA": "AS", "MN": "AS",
	// Europe
	"GB": "EU", "IE": "EU", "FR": "EU", "DE": "EU", "ES": "EU", "IT": "EU",
	"PT": "EU", "NL": "EU", "BE": "EU", "CH": "EU", "AT": "EU", "SE": "EU",
	"NO": "EU", "DK": "EU", "FI": "EU", "PL": "EU", "CZ": "EU", "GR": "EU",
	"RO": "EU", "HU": "EU", "UA": "EU", "RU": "EU", "TR": "AS",
	// North America
	"US": "NA", "CA": "NA", "MX": "NA",
	// South America
	"BR": "SA", "AR": "SA", "CL": "SA", "CO": "SA", "PE": "SA",
	// Africa
	"ZA": "AF", "NG": "AF", "KE": "AF", "EG": "AF", "MA": "AF", "GH": "AF",
	// Oceania
	"AU": "OC", "NZ": "OC",
}

// continentForCountry country code se continent nikalta hai.
// Unknown country -> "" (khaali). GUESS kabhi nahi karte.
func continentForCountry(country string) string {
	if country == "" {
		return ""
	}
	return countryToContinent[strings.ToUpper(country)]
}

// ---------------------------------------------------------------------------
// COUNTRY FROM REAL HEADERS
// ---------------------------------------------------------------------------

// countryFromHeaders REAL geo headers padhta hai.
//
// Ye sirf un proxies/CDN ke headers dekhta hai jo geo-location provide karte
// hain. Local dev me koi aisa proxy nahi hota -> country khaali rahegi.
//
// SECURITY: ye client-supplied header NAHI hai (wo spoof ho sakta hai) - ye
// sirf wo headers hain jo hamare TRUSTED proxy/CDN set karte hain. Local
// dev me unhe set nahi koi kar sakta to bhi yahan sirf server par padhe
// ja rahe hain.
func countryFromHeaders(r *http.Request) string {
	// Priority order: trusted CDN headers
	candidates := []string{
		"CF-IPCountry",        // Cloudflare
		"X-Vercel-IP-Country", // Vercel
		"X-Geo-Country",       // generic
		"X-Country-Code",      // generic
		"X-AppEngine-Country", // Google App Engine
	}
	for _, h := range candidates {
		v := strings.TrimSpace(r.Header.Get(h))
		if v == "" {
			continue
		}
		// Cloudflare "XX" ya "T1" (Tor) bhejta hai - wo country NAHI hain
		if strings.EqualFold(v, "XX") || strings.EqualFold(v, "T1") {
			continue
		}
		// Sirf 2 UPPERCASE letters accept karo (ISO 3166-1 alpha-2 shape)
		if len(v) == 2 {
			return strings.ToUpper(v)
		}
	}
	// Koi trusted header nahi -> KHAALI return. Guess nahi karte.
	return ""
}

// ---------------------------------------------------------------------------
// USER-AGENT PARSING
// ---------------------------------------------------------------------------

// parseDeviceType UA se device class nikalta hai.
//
// ORDER MATTERS: bot check PEHLE, kyunki kuch crawlers ke UA me "Mobile"
// jaisa text aa sakta hai. Aur tablet check mobile se PEHLE - kyunki
// iPad UA me "Mobile" hota hai par wo tablet hai.
func parseDeviceType(ua string) string {
	l := strings.ToLower(ua)
	if l == "" {
		return "unknown"
	}

	// ---- 1. Bots / crawlers ----
	// Ye pehle check hota hai taki SEO crawlers "desktop" me na gine.
	for _, b := range []string{
		"bot", "crawler", "spider", "slurp", "headless", "curl", "wget",
		"python-requests", "go-http-client", "okhttp", "axios", "postman",
	} {
		if strings.Contains(l, b) {
			return "bot"
		}
	}

	// ---- 2. Tablet (mobile se PEHLE) ----
	// iPad UA me "Mobile" hota hai - isliye tablet pehle check karna zaroori.
	if strings.Contains(l, "ipad") ||
		strings.Contains(l, "tablet") ||
		(strings.Contains(l, "android") && !strings.Contains(l, "mobile")) {
		return "tablet"
	}

	// ---- 3. Mobile ----
	for _, m := range []string{
		"mobile", "iphone", "ipod", "android", "windows phone", "blackberry",
		"opera mini", "iemobile",
	} {
		if strings.Contains(l, m) {
			return "mobile"
		}
	}

	// ---- 4. Desktop ----
	for _, d := range []string{
		"windows", "macintosh", "mac os", "linux", "x11", "cros",
	} {
		if strings.Contains(l, d) {
			return "desktop"
		}
	}

	// Kuch recognizable nahi mila
	return "unknown"
}

// parseBrowser UA se browser name + version nikalta hai.
//
// NOTE: Edge ka UA me "Edg/" hota hai AUR "Chrome/" bhi hota hai (kyunki
// Edge Chromium-based hai). Isliye Edge ko Chrome se PEHLE check karna
// zaroori hai, warna sab Edge users "Chrome" dikhenge.
func parseBrowser(ua string) string {
	l := strings.ToLower(ua)
	if l == "" {
		return "unknown"
	}

	type matcher struct {
		token string
		name  string
	}
	// Order = priority. Edge/Opera/Samsung pehle (wo Chrome impersonate karte hain)
	matchers := []matcher{
		{"edg/", "Edge"},
		{"edga/", "Edge"},
		{"edgios/", "Edge"},
		{"opr/", "Opera"},
		{"opera", "Opera"},
		{"samsungbrowser/", "Samsung Internet"},
		{"firefox/", "Firefox"},
		{"fxios/", "Firefox"},
		{"crios/", "Chrome"},
		{"chrome/", "Chrome"},
		{"chromium/", "Chromium"},
		{"safari/", "Safari"},
		// Edge ka legacy token
		{"edge/", "Edge"},
	}

	for _, m := range matchers {
		// NOTE: index yahan LOWERCASED string `l` me nikla jaata hai, lekin
		// `ua` (original) me use kiya jaata hai. Ye sahi hai SIRF tab jab
		// lowercase transformation length-preserving ho (jo hai) - par token
		// POSITION nahi badalta, sirf casing badti hai. Isliye original string
		// se version nikalna sahi rehta hai.
		if idx := strings.Index(l, m.token); idx >= 0 {
			version := extractVersionAfter(ua, idx+len(m.token))
			// ---- Safari ka version alag token me hota hai ----
			// Safari UA: `Version/17.1 Safari/605.1.15`
			//   - `Safari/605.1.15` WEBKIT build number hai, browser version
			//     NAHI (saare Safari versions ka WebKit number same hai).
			//   - Real version `Version/17.1` me hota hai.
			// Isliye Safari ke liye `version/` token prefer karte hain.
			if m.name == "Safari" {
				if vIdx := strings.Index(l, "version/"); vIdx >= 0 {
					if v := extractVersionAfter(ua, vIdx+len("version/")); v != "" {
						version = v
					}
				}
			}
			if version == "" {
				version = "?"
			}
			return m.name + " " + version
		}
	}
	return "unknown"
}

// parseOS UA se operating system + version nikalta hai
func parseOS(ua string) string {
	l := strings.ToLower(ua)
	if l == "" {
		return "unknown"
	}

	// ---- Windows ----
	// Windows NT 10.0 = Windows 10 BHI 11 ka bhi yahi token use hota hai
	// (Microsoft ne version number nahi badla). Isliye hum honest generic
	// name dete hain: "Windows 10/11".
	if strings.Contains(l, "windows nt 10.0") {
		return "Windows 10/11"
	}
	if strings.Contains(l, "windows nt 6.3") {
		return "Windows 8.1"
	}
	if strings.Contains(l, "windows nt 6.2") {
		return "Windows 8"
	}
	if strings.Contains(l, "windows nt 6.1") {
		return "Windows 7"
	}
	if strings.Contains(l, "windows phone") {
		return "Windows Phone"
	}
	if strings.Contains(l, "windows") {
		return "Windows"
	}

	// ---- iOS check macOS se PEHLE ----
	// iPhone/iPad UA me "like Mac OS X" hota hai, isliye macOS wala check
	// pehle aa raha tha to iOS ko "macOS" report ho jata tha.
	if strings.Contains(l, "iphone") || strings.Contains(l, "ipad") || strings.Contains(l, "ipod") {
		// `OS 17_0` underscore wala format hai - isliye underscore ko dot
		// me convert karna zaroori hai.
		if idx := strings.Index(l, "os "); idx >= 0 {
			if v := extractVersionAfter(ua, idx+len("os ")); v != "" {
				return "iOS " + strings.ReplaceAll(v, "_", ".")
			}
		}
		return "iOS"
	}

	// ---- macOS ----
	// Mac OS X 10_15_7 -> major.minor
	if idx := strings.Index(l, "mac os x"); idx >= 0 {
		rest := ua[idx+9:]
		parts := strings.Split(rest, "_")
		if len(parts) >= 2 {
			return "macOS " + parts[0] + "." + parts[1]
		}
		return "macOS"
	}
	if strings.Contains(l, "macintosh") {
		return "macOS"
	}

	// ---- Android ----
	// NOTE: `l` (lowercased) me index nikla jaata hai par `ua` (original)
	// me use hota hai. "Android" me 'A' uppercase hai - lowercase karke
	// string ki LENGTH to nahi badti, par isliye original string me usi
	// position se padhna sahi hai. Pehle yahan `strings.Index(ua, ...)`
	// lowercase token dhundh raha tha jo kabhi nahi milta -> version khali
	// aa jata tha.
	if idx := strings.Index(l, "android"); idx >= 0 {
		ver := extractVersionAfter(ua, idx+len("android"))
		if ver != "" {
			return "Android " + ver
		}
		return "Android"
	}

	// ---- Linux ----
	if strings.Contains(l, "linux") {
		return "Linux"
	}
	if strings.Contains(l, "x11") {
		return "Unix"
	}

	return "unknown"
}

// extractVersionAfter version digits nikalta hai, start offset se.
//
// ---------------------------------------------------------------------------
// DO BUGS ISME THE (tests ne pakde):
// ---------------------------------------------------------------------------
//
//  1. LEADING WHITESPACE SKIP NAHI HOTA THA
//     `Android 14; Pixel 8` me `Android` ke turant baad SPACE aata hai. Pehle
//     ka loop space par turant break ho jata tha -> version khali.
//     FIX: pehle non-version chars (space, quote, semicolon) skip karte hain.
//
//  2. UNDERSCORE VERSION SEPARATOR THA
//     Apple `iPhone OS 17_0` likhta hai, `17.0` nahi. Underscore digit/dot
//     me include nahi tha, to sirf "17" milta tha.
//     FIX: `_` bhi separator maankar `.` me convert karte hain.
func extractVersionAfter(s string, start int) string {
	if start < 0 || start >= len(s) {
		return ""
	}

	// ---- 1. Leading non-version characters skip karo ----
	i := start
	for i < len(s) {
		c := s[i]
		if (c >= '0' && c <= '9') || c == '.' || c == '_' {
			break
		}
		i++
	}
	if i >= len(s) {
		return ""
	}

	// ---- 2. Version characters collect karo ----
	out := make([]byte, 0, 8)
	for ; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			out = append(out, c)
		case c == '.' || c == '_':
			// Underscore ko dot me convert karte hain (Apple style fix)
			out = append(out, '.')
		default:
			// Version khatam (jaise ";" ya space)
			goto done
		}
	}
done:
	v := string(out)

	// ---- 3. Trailing separators hata do (jaise "17." ya "17..") ----
	for len(v) > 0 && (v[len(v)-1] == '.' || v[len(v)-1] == '_') {
		v = v[:len(v)-1]
	}
	// Consecutive dots theek karo (defensive - "17..0" ko "17.0")
	for strings.Contains(v, "..") {
		v = strings.ReplaceAll(v, "..", ".")
	}
	return v
}

// ParseTelemetry - ek request ka REAL device/geo profile nikalta hai.
//
// Call kahan karna hai: HAR authenticated handler me, jahan `r *http.Request`
// available hai (register, login, click-ingest).
func ParseTelemetry(r *http.Request) DeviceInfoParsed {
	ua := r.UserAgent()

	country := countryFromHeaders(r)

	return DeviceInfoParsed{
		Country:    country,
		Continent:  continentForCountry(country),
		DeviceType: parseDeviceType(ua),
		Browser:    parseBrowser(ua),
		OS:         parseOS(ua),
	}
}

// ---------------------------------------------------------------------------
// TELEMETRY IN CONTEXT
// ---------------------------------------------------------------------------
//
// Kyun context? Handler ke paas `*http.Request` hota hai, service ko sirf
// `context.Context` milta hai. Signature badalne ke bajaye (jo har caller
// ko affect karega) telemetry ko context me daal dete hain - wahi pattern
// jo `clientInfoFromContext` use karta hai.
//
// SECURITY: ye sirf SERVER par derive hua data hai (UA + trusted geo
// headers). Client ise kabhi set nahi kar sakta, isliye ise bharne wale
// code par bharosa nahi karna chahiye - ye populate hota hai handler par.

type telemetryKey struct{}

// WithTelemetryInContext parsed telemetry ko context me store karta hai.
//
// WARNING: ye sirf INTERNAL use ke liye hai. Caller ko ye value KABHI
// client input se nahi leni chahiye.
func WithTelemetryInContext(ctx context.Context, t DeviceInfoParsed) context.Context {
	return context.WithValue(ctx, telemetryKey{}, t)
}

// telemetryFromContext telemetry nikalta hai. Na mile to zero-value
// (jisme sab khaali strings hain - koi fabricated default NAHI).
func telemetryFromContext(ctx context.Context) DeviceInfoParsed {
	if ctx == nil {
		return DeviceInfoParsed{}
	}
	if t, ok := ctx.Value(telemetryKey{}).(DeviceInfoParsed); ok {
		return t
	}
	return DeviceInfoParsed{}
}

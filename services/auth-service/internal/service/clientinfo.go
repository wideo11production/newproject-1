package service

// ============================================================================
// CLIENT INFO CONTEXT
// ============================================================================
//
// Session me store karne ke liye request metadata (IP + User-Agent) ko
// service layer tak pahunchana hai - bina `Register`/`Login` ke signatures
// badle.
//
// WHY CONTEXT instead of extra parameters:
//   - `Register`/`Login` ke kai callers hain (handlers, tests). Signature
//     badalne se ripple effect aata.
//   - `context.Context` Go ka standard "request-scoped values" carrier hai.
//   - Value MISSING hone par hum safe default dete hain (khali string) - koi
//     crash nahi.
//
// SECURITY NOTE:
//   Ye values SIRF audit/disk display ke liye hain (dashboard "kis device par
//   login hai"). Inhe kabhi authorization decision me use nahi karna chahiye
//   - client inhe spoof kar sakta hai (X-Forwarded-For, User-Agent header).
//   Sirf display + manual review ke liye trustworthy hain.
//
// Hinglish comments: har block ka arth

import "context"

// ---------------------------------------------------------------------------
// CONTEXT KEYS
// ---------------------------------------------------------------------------
//
// ---- YAHAN EK SUBTLE GO BUG THA (aur ye real data corrupt kar raha tha) ----
// Pehle ek hi type use ho raha tha:
//
//	type clientInfoKey struct{}
//	var (
//		clientIPKey clientInfoKey   // == clientInfoKey{}
//		clientUAKey clientInfoKey   // == clientInfoKey{}   <-- SAME VALUE!
//	)
//
// Go me `struct{}{}` ZERO-SIZE hai, isliye `clientIPKey == clientUAKey` TRUE
// hai. Matlab dono keys EQUAL thin!
//
// Iska asar:
//
//	ctx = context.WithValue(ctx, ipKey{}, ip)        // value store
//	ctx = context.WithValue(ctx, uaKey{}, userAgent) // SAME KEY -> OVERWRITE
//
// Net: sirf userAgent store hota tha. Phir `clientInfoFromContext` me
// `ctx.Value(ipKey{})` se WAHIN userAgent padha jata tha - yaani
// `ip` variable me user-agent aa jata tha.
//
// Isi wajah se:
//   - `sessions.ip_address` me 100+ char ka UA string ja raha tha
//   - jo `VARCHAR(45)` me fit nahi hota tha -> register 500 FAIL
//   - aur superadmin panel me "IP" dikhta UA
//
// FIX: har key ka apna ALAG type. Ab `ipKey{} != uaKey{}` compile-time par
// hi guarantee hota hai - bhool kar same type dene ka chance hi nahi.
// (Go me recommended pattern bhi yahi hai.)
type ipKey struct{}
type uaKey struct{}

// WithClientInfo request context me IP + User-Agent daalta hai.
//
// Handler ye har authenticated request ke liye call karta hai (login,
// register) - taaki nayi session me IP/UA save ho sake.
func WithClientInfo(ctx context.Context, ip, userAgent string) context.Context {
	ctx = context.WithValue(ctx, ipKey{}, ip)
	ctx = context.WithValue(ctx, uaKey{}, userAgent)
	return ctx
}

// clientInfoFromContext context se IP + UA nikalta hai.
//
// Safe by design: agar value missing hai ya type galat hai, to khali string
// return karta hai - kabhi panic nahi.
func clientInfoFromContext(ctx context.Context) (ip string, userAgent string) {
	if ctx == nil {
		return "", ""
	}
	if v, ok := ctx.Value(ipKey{}).(string); ok {
		ip = v
	}
	if v, ok := ctx.Value(uaKey{}).(string); ok {
		userAgent = v
	}
	return ip, userAgent
}

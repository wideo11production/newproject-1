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

// context keys - unexported struct type taaki koi doosra package
// jaan-boojh kar same key nahi bana sake (Go me string keys collide kar sakte hain).
type clientInfoKey struct{}

var (
	clientIPKey clientInfoKey
	clientUAKey clientInfoKey
)

// WithClientInfo request context me IP + User-Agent daalta hai.
//
// Handler ye har authenticated request ke liye call karta hai (login,
// register) - taaki nayi session me IP/UA save ho sake.
func WithClientInfo(ctx context.Context, ip, userAgent string) context.Context {
	ctx = context.WithValue(ctx, clientIPKey, ip)
	ctx = context.WithValue(ctx, clientUAKey, userAgent)
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
	if v, ok := ctx.Value(clientIPKey).(string); ok {
		ip = v
	}
	if v, ok := ctx.Value(clientUAKey).(string); ok {
		userAgent = v
	}
	return ip, userAgent
}

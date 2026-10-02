// Internal service-to-service authentication.
//
// WHY THIS FILE IS NEW
// --------------------
// Every route on this service was open. It was never deployed, so nothing was
// exposed - but it records views, clicks, conversions and revenue, and "it was
// never deployed" is luck rather than a security property.
//
// What it protects:
//
//   - WRITE routes (views/clicks/conversions/reach/revenue) take data from
//     clients. Unauthenticated, anyone can inject fake engagement numbers, and
//     anything that pays out on those numbers can be drained.
//   - READ routes return everything recorded. Unauthenticated, that is a data
//     leak rather than a lie.
//
// ----------------------------------------------------------------------------
// WHY A SHARED TOKEN AND NOT A JWT
// ----------------------------------------------------------------------------
//
// Only two callers exist in the whole system: the apps' shared audit handler,
// which writes, and the superadmin app, which reads. Both are server-side and
// both already sit inside this trust boundary.
//
// Verifying JWTs here would mean copying the auth-service signing secret into a
// second service and widening the blast radius of the single most sensitive
// secret in the system, to solve a problem neither caller has. The superadmin
// app already checks the human's session before it calls; this service only
// needs to answer "is this one of ours".
//
// It also means there is exactly ONE mechanism to get wrong here rather than
// two.

package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// HeaderInternalToken is the header callers present.
//
// `X-Internal-Token` rather than `Authorization: Bearer`, on purpose: a bearer
// token in this header would suggest a signed, scoped credential, and this is a
// single shared secret. Naming it for what it is keeps the difference obvious to
// whoever wires up the next caller.
const HeaderInternalToken = "X-Internal-Token"

// constantTimeEqual compares two secrets without leaking, through timing, how
// much of the guess was correct.
//
// Go's `subtle.ConstantTimeCompare` returns 0 immediately when the lengths
// differ, so a naive `if subtle.ConstantTimeCompare(a, b) == 1` leaks the
// secret's LENGTH. That is usually low-stakes, but the fix is two lines and it
// removes the class of bug entirely, so it is done here rather than left for
// whoever copies this file into something that does matter.
func constantTimeEqual(got, want string) bool {
	gotBytes := []byte(got)
	wantBytes := []byte(want)

	if len(gotBytes) != len(wantBytes) {
		// Compare anyway, against equal-length buffers, so the work done is the
		// same either way. The result is deliberately discarded - we already know
		// the answer.
		dummy := make([]byte, len(wantBytes))
		copy(dummy, gotBytes)
		subtle.ConstantTimeCompare(dummy, wantBytes)
		return false
	}

	return subtle.ConstantTimeCompare(gotBytes, wantBytes) == 1
}

// requireToken is the Gin middleware that gates every non-public route.
//
// FAILS CLOSED when `expected` is empty.
//
// Without that guard, `constantTimeCompare("", "")` returns true, so a request
// carrying no header would be ACCEPTED by a service that was never configured
// with a token. `main.go`'s `ValidateForServe` stops the process in that state,
// but a second layer belongs here rather than only there: a startup check is one
// refactor away from being skipped, and the cost of it being skipped is an open
// API. Rejecting on an empty expectation means the failure mode is "everything
// is locked" instead of "everything is open".
func RequireInternalToken(expected string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if expected == "" {
			// Refuse, loudly. A 503 says "this service is not usable", which is
			// the truth, and is distinguishable from a 401 that a caller might
			// start retrying.
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error":   "service_misconfigured",
				"message": "internal token is not configured on this service",
			})
			return
		}

		got := strings.TrimSpace(c.GetHeader(HeaderInternalToken))

		if !constantTimeEqual(got, expected) {
			// 401, not 403: the caller has not proved who it is. 403 would say
			// "you are known but not allowed", which is a different and
			// misleading thing.
			//
			// The body deliberately says nothing about the correct value.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_internal_token",
				"message": "Provide a valid " + HeaderInternalToken + " header.",
			})
			return
		}

		c.Next()
	}
}

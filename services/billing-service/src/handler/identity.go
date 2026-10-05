package handler

// Identity resolution for handlers.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// -----------------------------------------------------------------------------
//
// Four handlers read `user_id` from something the CALLER CONTROLLED:
//
//	Subscribe              req.UserID            <- the request BODY
//	GetSubscriptionByUser  c.Param("user_id")   <- the URL
//	CancelSubscription     c.Param("user_id")   <- the URL
//	ListInvoices           c.Param("user_id")   <- the URL
//
// `AuthRequired` sets `user_id` from the verified token's claim and these handlers
// ignored it. With no auth middleware at all, the consequence was: POST a body with
// somebody else's id and you are subscribed to their account, or PUT their id into
// the path and you cancel their subscription.
//
// The middleware existed and worked. It was simply not consulted.
//
// -----------------------------------------------------------------------------
// WHY THE PATH PARAMETER IS KEPT BUT IGNORED
// -----------------------------------------------------------------------------
//
// `/subscriptions/user/:user_id/cancel` still has `:user_id` in it. Removing it
// would break every existing caller, and a route that 404s for a legitimate
// request is a worse failure than a redundant path segment.
//
// So the parameter is accepted and disregarded. `selfUserID` is the only thing
// these handlers trust.
//
// -----------------------------------------------------------------------------
// A KNOWN ID-SPACE PROBLEM THIS DOES **NOT** FIX
// -----------------------------------------------------------------------------
//
// `billing-service` models `UserID` as `uint`, and its own DB has its own
// auto-increment id space. `auth-service` uses `uuid` throughout. The JWT's
// `user_id` claim is a UUID string.
//
// So `strconv.ParseUint(uuid)` returns an error for every real user, and the
// handlers below that still cast to `uint` will reject a legitimate UUID.
//
// That mismatch predates this change and is a schema question, not a security one.
// It is NOT papered over here: `selfUserID` returns the UUID string as-is, and the
// cast stays where it was, so the failure mode remains a clear "invalid user ID"
// rather than a silent `0` - which would be a far worse outcome, because a zero
// id matches no rows and looks like "you have no subscriptions" rather than an
// error.
//
// Resolving it means deciding which id space owns a user. That is Phase 0 work
// alongside the three-billing-schema reconciliation in the plan.

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// selfUserID returns the caller's verified user id, or 401 if there is none.
//
// It reads the value `AuthRequired` put in the context, which came from the
// token's `user_id` claim after a signature check. It never reads the request.
//
// `middleware.RequireAdmin` also depends on the `role` this same middleware set,
// so the two guards are consistent about who the caller is.
func selfUserID(c *gin.Context) (string, bool) {
	raw, ok := c.Get("user_id")
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "No verified identity on this request.",
		})
		return "", false
	}
	id, _ := raw.(string)
	if id == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "Token carried no user_id claim.",
		})
		return "", false
	}
	return id, true
}

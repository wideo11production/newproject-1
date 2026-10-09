// Superadmin HTTP handlers - awareness, sessions, device lock, test cleanup
//
// Hinglish comments: har block ka arth
package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/redisx"
	"github.com/wideo11/auth-service/internal/service"
)

// SuperadminHandler superadmin endpoints handle karta hai
type SuperadminHandler struct {
	svc     *service.SuperadminService
	authSvc *service.AuthService

	// ---- Added for the entitlement admin surface (`entitlement_admin.go`) ----
	//
	// `entitlements` and `plans` come from `AuthHandler` rather than being
	// constructed again. Two `EntitlementService` instances over one database
	// would each hold their own `plans` snapshot, and a plan added between the two
	// constructions would be visible to one and not the other — so a grant could
	// be refused by a handler that the rest of the product believes accepts it.
	//
	// One catalogue, one service, passed in. `SetEntitlementAdmin` follows the
	// `SetEntitlementService` pattern already used by `AuthHandler`.
	db          *gorm.DB
	entitlements *service.EntitlementService
	plans       config.PlansConfig

	// ---- Rate-limit reset (Redis-backed) ----
	//
	// Nil-safe: a deployment without Redis has no rate limits to reset, and
	// the endpoint answers 503 rather than pretending the operation succeeded.
	// See `ResetRateLimit` below for why this belongs here rather than in the
	// middleware package.
	redisClient *redisx.Client
}

// SetEntitlementAdmin wires the entitlement dependencies.
//
// A setter rather than a constructor argument because `NewSuperadminHandler` is
// called in one place with two arguments today, and adding three more to a
// constructor that is only used by `main.go` trades a contained change for a
// wider one. The established convention in this package is `SetEntitlementService`, so
// this matches it.
func (h *SuperadminHandler) SetEntitlementAdmin(
	db *gorm.DB,
	entitlements *service.EntitlementService,
	plans config.PlansConfig,
) {
	h.db = db
	h.entitlements = entitlements
	h.plans = plans
}

// SetRedisClient wires the rate-limiter's Redis client for the reset endpoint.
//
// A setter, not a constructor argument, for the same reason as
// `SetEntitlementAdmin`: `NewSuperadminHandler` is called before Redis is
// initialised, and forcing the construction order to change for one optional
// dependency is worse than one extra setter call.
func (h *SuperadminHandler) SetRedisClient(rc *redisx.Client) {
	h.redisClient = rc
}

// NewSuperadminHandler naya handler banata hai
func NewSuperadminHandler(
	svc *service.SuperadminService,
	authSvc *service.AuthService,
) *SuperadminHandler {
	return &SuperadminHandler{svc: svc, authSvc: authSvc}
}

// RequireSuperadminMiddleware - exported version (click handler use karta hai).
// SECURITY: ye har protected superadmin endpoint pe lagta hai
func (h *SuperadminHandler) RequireSuperadminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// User ID context se (normal auth middleware ne set kiya)
		raw, ok := c.Get("user_id")
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		uid, err := uuid.Parse(raw.(string))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		user, err := h.authSvc.GetUserByID(c.Request.Context(), uid)
		if err != nil || user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		isSuper, role, err := h.svc.IsSuperadmin(c.Request.Context(), user.Email)
		if err != nil || !isSuper {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "superadmin access required",
			})
			return
		}

		// Context me role daal do (handlers use kar sakte hain)
		c.Set("superadmin_role", role)
		c.Next()
	}
}

// RegisterRoutes superadmin routes register karta hai
func (h *SuperadminHandler) RegisterRoutes(r *gin.RouterGroup, authMW gin.HandlerFunc, extraMW ...gin.HandlerFunc) {
	sa := r.Group("/admin")
	sa.Use(authMW)

	// `CheckRevoked` was MISSING on this group, and it is the worst-placed of the
	// four gaps.
	//
	// These are the most powerful endpoints in the product: every user's security
	// events, every user's session history, the device lock that can cut off
	// accounts, and account purging. `authMW` verifies the token's signature and
	// expiry, and a token revoked at logout still passes both - revocation lives
	// in the Redis denylist that `authMW` does not read.
	//
	// So a superadmin who logged out - or whose session was revoked remotely -
	// kept full administrative access to every user in the system until the token
	// expired on its own. Revoking a superadmin session was the documented
	// incident-response action, and on this group it did not take effect.
	//
	// Passed as `extraMW` rather than constructed here so this package does not
	// need to know about the revocation store, and so the call site in `main.go`
	// is the single place that decides what guards `/admin/*` - which is the same
	// reason every other protected group registers its checks there.
	for _, mw := range extraMW {
		sa.Use(mw)
	}

	// ---- SUPERADMIN ROLE GATE (CRITICAL SECURITY FIX) ----
	//
	// BUG: pehle yahan sirf `authMW` tha - yaani koi bhi logged-in user
	// `/api/v1/admin/*` hit kar sakta tha (security events, device lock,
	// test accounts - sab). Role check KAHAN nahi tha.
	//
	// Kyun Next.js middleware ne bacha nahi: wo sirf `/api/superadmin` aur
	// `/superadmin` path cover karta hai. Ye backend ka `/api/v1/admin/*`
	// alag path hai jo middleware ke scope se BAHAR hai.
	//
	// Defence in depth: middleware (path based) + ye role gate (token based).
	// Dono alag-alag layer hain, isliye ek me bug aaye to doosra rok leta hai.
	sa.Use(RequireSuperadmin())

	// ---- Awareness: security events ----
	sa.GET("/security-events", h.SecurityEvents)

	// ---- Alert acknowledgement (see security_alert_ack.go for why these are a
	// separate table and not columns on the event row) ----
	//
	// Registered HERE, on `sa`, which already carries AuthMiddleware +
	// RequireSuperadmin + CheckRevoked. Not re-guarded per route: a second check
	// is a second thing to forget.
	h.registerSecurityAlertRoutes(sa)

	// ---- Plan grants (see entitlement_admin.go for why nothing could be paid for
	// before this existed) ----
	h.registerEntitlementRoutes(sa)

	// ---- Awareness: per-user activity (sessions, online time) ----
	sa.GET("/activity", h.Activity)
	sa.GET("/activity/all", h.AllActivity)

	// ---- Device lock (retina lock) ----
	sa.GET("/device-lock", h.GetDeviceLock)
	sa.POST("/device-lock", h.SetDeviceLock)

	// ---- Test account management (production cutover) ----
	sa.POST("/test-accounts/mark", h.MarkTestAccount)
	sa.GET("/test-accounts", h.ListTestAccounts)
	sa.POST("/test-accounts/purge", h.PurgeTestAccounts)

	// ---- Rate-limit reset ----
	//
	// WHY THIS EXISTS: a legitimate user whose credentials are correct can
	// still be locked out by a rate limiter that counted the failures of a
	// DIFFERENT problem - a server bug, a database corruption, a misconfigured
	// migration. Without this, the only recovery is to wait for the window to
	// expire, which can be 15 minutes, and during that window the account is
	// unusable and every retry makes it worse.
	//
	// WHY IT IS NARROW: this takes a `key` (the identity string the limiter
	// built) rather than a pattern. A wildcard delete of `rl:*` would be a
	// self-inflicted DoS vector - one angry operator could clear the protection
	// for every account on the platform. The caller must know the exact key
	// they want to clear, which is what the admin UI shows them.
	sa.POST("/rate-limit", h.ResetRateLimit)
}

// ResetRateLimit clears one rate-limit counter.
//
// The body is `{ "key": "rl:login_account:advchashampalup@gmail.com" }` -
// the exact Redis key the limiter wrote. The caller learns that key from the
// rate-limit-exceeded response itself (the `X-RateLimit-*` headers and the
// `limit` field in the body), so this cannot be used to enumerate or wipe
// counters the caller has not already been told about.
//
// SECURITY: this is on the superadmin group (`authMW` + `RequireSuperadmin` +
// `CheckRevoked`), so it requires a live, non-revoked superadmin session. It
// is not a public route that a locked-out user can hit to free themselves -
// that would defeat the rate limiter entirely. A superadmin must act.
func (h *SuperadminHandler) ResetRateLimit(c *gin.Context) {
	if h.redisClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "rate limiting is not configured",
			"detail":  "Redis is not initialised; there are no counters to reset.",
		})
		return
	}

	var req struct {
		Key string `json:"key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Key == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid request",
			"detail": "a non-empty `key` field is required. " +
				"Use the `limit` value from a 429 response, e.g. " +
				"`rl:login_account:user@example.com`.",
		})
		return
	}

	// Reject anything that is not one of our own keys. A `rl:` prefix is the
	// single convention this file owns; rejecting unknown prefixes stops this
	// endpoint being a back door into other Redis data.
	if len(req.Key) < 4 || req.Key[:3] != "rl:" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid key",
			"detail":  "key must start with `rl:` - the rate-limiter namespace.",
		})
		return
	}

	ctx := c.Request.Context()
	if err := h.redisClient.Delete(ctx, req.Key); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "reset failed",
			"detail":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "rate-limit counter cleared",
		"key":      req.Key,
		"cleared":  true,
	})
}

// SecurityEvents - lockouts, failed logins, device breaches
func (h *SuperadminHandler) SecurityEvents(c *gin.Context) {
	limit := 200
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 1000 {
			limit = v
		}
	}

	events, err := h.svc.GetSecurityEventsFrom(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load events"})
		return
	}

	// Critical flag + indicator (awareness page ke liye)
	type flagged struct {
		Event     model.SecurityEvent `json:"event"`
		Critical  bool                `json:"critical"`
		Indicator string              `json:"indicator"`
	}

	criticalTypes := map[string]bool{
		model.EventLockoutTriggered:    true,
		model.EventDeviceLimitExceeded: true,
		model.EventConfigTamper:        true,
		model.EventPINFailed:           true,
	}

	out := make([]flagged, 0, len(events))
	for _, e := range events {
		out = append(out, flagged{
			Event:     e,
			Critical:  criticalTypes[e.EventType],
			Indicator: indicatorFor(e.EventType),
		})
	}

	c.JSON(http.StatusOK, gin.H{"total": len(events), "events": out})
}

// Activity - ek user ka activity detail
func (h *SuperadminHandler) Activity(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email query param required"})
		return
	}

	activity, err := h.svc.GetUserActivity(c.Request.Context(), email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load activity"})
		return
	}

	c.JSON(http.StatusOK, activity)
}

// AllActivity - saare users ka activity
func (h *SuperadminHandler) AllActivity(c *gin.Context) {
	activities, err := h.svc.ListAllActivity(c.Request.Context(), 500)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load activities"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"total": len(activities), "activities": activities})
}

// GetDeviceLock - current device lock status
func (h *SuperadminHandler) GetDeviceLock(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		email = emailFromContext(c)
	}

	account, err := h.svc.GetDeviceLockStatus(c.Request.Context(), email)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "superadmin account not found"})
		return
	}

	c.JSON(http.StatusOK, account)
}

// SetDeviceLock - device lock ON/OFF karta hai
func (h *SuperadminHandler) SetDeviceLock(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		DeviceID string `json:"device_id"`
		Enabled  bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	// Email nahi diya to current superadmin ka
	if req.Email == "" {
		req.Email = emailFromContext(c)
	}

	// Device fingerprint header se bhi le sakte hain
	if req.DeviceID == "" {
		req.DeviceID = c.GetHeader("X-Fingerprint")
	}

	err := h.svc.SetDeviceLock(c.Request.Context(), req.Email, req.DeviceID, req.Enabled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "device lock updated",
		"email":     req.Email,
		"enabled":   req.Enabled,
		"device_id": req.DeviceID,
	})
}

// MarkTestAccount - kisi account ko "testing" mark karta hai
func (h *SuperadminHandler) MarkTestAccount(c *gin.Context) {
	var req struct {
		Email        string  `json:"email"`
		Reason       string  `json:"reason"`
		DummyBalance float64 `json:"dummy_balance_inr"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email required"})
		return
	}

	user, err := h.authSvc.GetUserByEmailForSecurity(c.Request.Context(), req.Email)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if err := h.svc.MarkTestAccount(
		c.Request.Context(), user.ID, user.Email, req.Reason, req.DummyBalance,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "test account marked",
		"email":   user.Email,
		"reason":  req.Reason,
	})
}

// ListTestAccounts - marked test accounts dikhata hai
func (h *SuperadminHandler) ListTestAccounts(c *gin.Context) {
	markers, err := h.svc.ListTestAccounts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"total": len(markers), "accounts": markers})
}

// PurgeTestAccounts - PRODUCTION CUTOVER button
//
// Ye SAB testing accounts delete karta hai, sirf superadmin + recovery bachate hain.
// Default DRY-RUN hai - pehle dekho kya delete hoga, phir confirm karo.
//
// Hinglish: production cutover button - sab test accounts hata do
func (h *SuperadminHandler) PurgeTestAccounts(c *gin.Context) {
	var req struct {
		// DryRun default true - safety first
		DryRun *bool `json:"dry_run"`
	}
	_ = c.ShouldBindJSON(&req)

	// Default = dry run (deletion nahi hoga)
	dryRun := true
	if req.DryRun != nil {
		dryRun = *req.DryRun
	}

	result, err := h.svc.PurgeTestAccounts(c.Request.Context(), dryRun)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func emailFromContext(c *gin.Context) string {
	if v, ok := c.Get("email"); ok {
		return v.(string)
	}
	return ""
}

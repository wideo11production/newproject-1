// Presence: "who is online right now".
//
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// -----------------------------------------------------------------------------
//
// The dashboard's User Activity panel showed, permanently:
//
//     Online Now             0
//     Total Sessions         0
//     Total Seconds Online   0
//     Distinct Devices       0
//
// ...for every user, on a system where people were demonstrably signed in.
//
// The cause was not a broken query. `ListAllActivity` correctly enumerated every
// user and `GetUserActivity` correctly counted `user_sessions` rows. The table was
// EMPTY, because:
//
//   - `SuperadminService.StartSession`, `EndSession` and `HeartbeatSession` had
//     been written, and were correct
//   - and nothing ever called them. Not a handler, not a route, not a worker.
//
// A complete feature with no wire-up. It is the same shape as the seven copies of
// `/api/audit`, the three drifted copies of `/api/health-check`, and the
// `/ui-clicks/targets` endpoint with zero callers: correct code, correct tests,
// correct comments, and no path by which anything reaches it.
//
// -----------------------------------------------------------------------------
// WHY THESE LIVE ON AuthService AND NOT SuperadminService
// -----------------------------------------------------------------------------
//
// Because every signed-in user has a presence, not only superadmins. The existing
// writers sat on the superadmin service, which is why wiring them up there would
// have produced a dashboard that showed the superadmin online and every creator
// offline forever - which is a worse bug than the one being fixed, because it looks
// like working.
//
// `AuthService` is also already on the path of every request, and its context
// carries the real client IP and user-agent via `clientInfoFromContext`. That
// matters: the client is never asked to name its own IP.
//
// -----------------------------------------------------------------------------
// THE CLIENT SENDS NO IDENTITY
//
// Three endpoints, and all three take the user from the verified token. The client
// contributes exactly one thing: "I am still here". Everything else - user, email,
// IP, user agent - comes from the server side of the request.
//
// An endpoint that took `user_id` or `device_id` from a POST body would make every
// number on the dashboard forgeable by anyone who can reach it. The presence
// session id itself is an httpOnly cookie for the same reason the session token is.

package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// PresenceCookie carries the presence session id.
//
// httpOnly because it is a credential-adjacent identifier for a specific user's
// live presence: a script that could read it could heartbeat somebody else's
// session forever and keep a revoked user showing as online.
//
// 8 hours, deliberately shorter than the 7-day login. A presence cookie outliving
// the browser session would leave rows "active" long after the tab closed, which
// is the difference between "online now" and "was online at some point today".
const PresenceCookie = "wideo11_presence"

const presenceCookieTTL = 8 * time.Hour

// Handler owns the presence routes.
type Handler struct {
	db *gorm.DB
}

// NewHandler builds the presence handler.
func NewHandler(db *gorm.DB) *Handler { return &Handler{db: db} }

// RegisterRoutes attaches presence to an already-authenticated group.
//
// It takes a `gin.RouterGroup` rather than registering its own `/presence`
// prefix, because the caller decides that - and because the routes MUST land
// behind an auth middleware. A presence endpoint reachable anonymously would let
// anyone mark anyone online.
//
// `authMW` is a parameter for the same reason `RegisterRoutes` on the superadmin
// handler takes one: this package does not get to decide who is authenticated.
func (h *Handler) RegisterRoutes(r *gin.RouterGroup, authMW gin.HandlerFunc) {
	presence := r.Group("/presence")
	presence.Use(authMW)
	{
		presence.POST("/start", h.Start)
		presence.POST("/heartbeat", h.Heartbeat)
		presence.POST("/end", h.End)
	}
}

// currentUser pulls the verified identity out of the request.
//
// Taken from the context the auth middleware populated, NOT from a body field or a
// query parameter. A presence endpoint that accepted an email would be a
// free "make this user appear online" service.
func currentUser(c *gin.Context) (uuid.UUID, string, bool) {
	raw, ok := c.Get("user_id")
	if !ok {
		return uuid.Nil, "", false
	}
	id, err := uuid.Parse(strings.TrimSpace(toString(raw)))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, "", false
	}
	email, _ := c.Get("email")
	return id, toString(email), true
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case uuid.UUID:
		return t.String()
	default:
		return ""
	}
}

// Start opens a presence row, or refreshes the one already open for this user.
//
// Idempotent: calling it on every page load must not create a row per page view.
// That is not a tidiness concern - "how many devices are using this account right
// now" is the sharing signal, and it is meaningless if a refresh inflates it.
func (h *Handler) Start(c *gin.Context) {
	userID, email, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no verified identity on request"})
		return
	}

	// Device identity comes from the fingerprint the client already sends on every
	// auth call. It is NOT a MAC address and not a hardware ID, because neither is
	// reachable from a browser - the platform gives a web page no hardware
	// identifiers at all, so a MAC-binding requirement cannot be satisfied here by
	// any amount of code. This is the browser-observable equivalent and it is the
	// same value `sessions.device_id` already keys on.
	deviceID := strings.TrimSpace(c.GetHeader("X-Fingerprint"))
	deviceName := c.GetHeader("X-Device-Name")
	platform := c.GetHeader("X-Platform")

	var existing model.UserSession
	err := h.db.WithContext(c.Request.Context()).
		Where("user_id = ? AND is_active = ?", userID, true).
		Order("last_seen_at DESC").
		First(&existing).Error

	now := time.Now().UTC()
	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	if err == nil {
		h.db.WithContext(c.Request.Context()).Model(&model.UserSession{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"last_seen_at": now,
				"ip_address":   ip,
				"user_agent":   truncate(ua, 200),
			})
		setPresenceCookie(c, existing.ID)
		c.JSON(http.StatusOK, gin.H{
			"session_id":  existing.ID,
			"started_at":  existing.StartedAt,
			"last_seen":   now,
			"reused":      true,
		})
		return
	}

	if err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read presence"})
		return
	}

	row := &model.UserSession{
		UserID:     userID,
		Email:      email,
		StartedAt:  now,
		LastSeenAt: now,
		IPAddress:  truncate(ip, 64),
		UserAgent:  truncate(ua, 200),
		DeviceID:   deviceID,
		DeviceName: deviceName,
		Platform:   platform,
		IsActive:   true,
	}
	if err := h.db.WithContext(c.Request.Context()).Create(row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open presence"})
		return
	}

	setPresenceCookie(c, row.ID)
	c.JSON(http.StatusOK, gin.H{
		"session_id": row.ID,
		"started_at": row.StartedAt,
		"last_seen":  now,
		"reused":     false,
	})
}

// Heartbeat keeps the row alive and reports how many distinct devices are open.
//
// The distinct-device count is the reason this endpoint exists rather than a bare
// "touch". One device is a user; two is a user on a laptop and a phone; five is
// somebody sharing a credential, which is the single most useful signal this
// product has and the one it was throwing away.
func (h *Handler) Heartbeat(c *gin.Context) {
	cookie, err := c.Cookie(PresenceCookie)
	if err != nil || cookie == "" {
		// No presence cookie: the client has not started one. 428 rather than 401,
		// because the session IS valid - the client just needs to call /start. The
		// client handles it by starting and then beating.
		c.JSON(http.StatusPreconditionRequired, gin.H{
			"error": "no_presence_session",
			"hint":  "call POST /api/v1/auth/presence/start first",
		})
		return
	}

	sessionID, err := uuid.Parse(cookie)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "malformed presence cookie"})
		return
	}

	var row model.UserSession
	if err := h.db.WithContext(c.Request.Context()).
		Where("id = ?", sessionID).First(&row).Error; err != nil {
		// The row is gone - retention swept it, or the session was ended. The
		// client's correct response is to start again, so say so rather than
		// returning a bare 404 the client cannot interpret.
		c.JSON(http.StatusNotFound, gin.H{
			"error": "presence_gone",
			"hint":  "call POST /api/v1/auth/presence/start",
		})
		return
	}

	if !row.IsActive {
		// Closed, usually by an explicit /end on another tab. Do not silently
		// resurrect it: a row the user deliberately closed reappearing as "online"
		// is worse than a row that needs restarting.
		c.JSON(http.StatusConflict, gin.H{
			"error": "presence_closed",
			"hint":  "call POST /api/v1/auth/presence/start",
		})
		return
	}

	now := time.Now().UTC()
	if err := h.db.WithContext(c.Request.Context()).Model(&model.UserSession{}).
		Where("id = ?", sessionID).
		Updates(map[string]any{
			"last_seen_at": now,
			// Accumulate, not recompute - see the note on
			// `SuperadminService.HeartbeatSession`.
			"duration_seconds": gorm.Expr("duration_seconds + ?", 60),
		}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record heartbeat"})
		return
	}

	var devices int64
	h.db.WithContext(c.Request.Context()).Model(&model.UserSession{}).
		Where("user_id = ? AND is_active = ? AND last_seen_at > ?",
			row.UserID, true, now.Add(-5*time.Minute)).
		Where("device_id IS NOT NULL AND device_id != ''").
		Distinct("device_id").
		Count(&devices)

	// Online means "seen within the idle window", not merely "the row is active".
	// A row left active by a browser that was killed stays `is_active = true`
	// forever, and treating that as online is how a dashboard ends up claiming
	// nine users are present when nobody has been in the building for a week.
	var activeRows int64
	h.db.WithContext(c.Request.Context()).Model(&model.UserSession{}).
		Where("user_id = ? AND is_active = ? AND last_seen_at > ?",
			row.UserID, true, now.Add(-time.Duration(model.SessionIdleTimeoutMinutes)*time.Minute)).
		Count(&activeRows)

	c.JSON(http.StatusOK, gin.H{
		"ok":                   true,
		"last_seen":            now,
		"distinct_devices":     devices,
		"concurrent_sessions":  activeRows,
		"idle_timeout_minutes": model.SessionIdleTimeoutMinutes,
	})
}

// End closes the presence row and records the exact duration.
func (h *Handler) End(c *gin.Context) {
	cookie, err := c.Cookie(PresenceCookie)
	if err != nil || cookie == "" {
		// Nothing to close. 200, not 404: the requested state - not online - is
		// already true, and reporting a failure for it would make a logout path
		// look broken when it did the right thing.
		clearPresenceCookie(c)
		c.JSON(http.StatusOK, gin.H{"ok": true, "note": "no open presence session"})
		return
	}

	if sessionID, perr := uuid.Parse(cookie); perr == nil {
		now := time.Now().UTC()
		var row model.UserSession
		if h.db.WithContext(c.Request.Context()).
			Where("id = ?", sessionID).First(&row).Error == nil {
			// Exact duration wins over the accumulated estimate.
			h.db.WithContext(c.Request.Context()).Model(&model.UserSession{}).
				Where("id = ?", sessionID).
				Updates(map[string]any{
					"ended_at":         &now,
					"last_seen_at":     now,
					"duration_seconds": int64(now.Sub(row.StartedAt).Seconds()),
					"is_active":        false,
				})
		}
	}

	clearPresenceCookie(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func setPresenceCookie(c *gin.Context, id uuid.UUID) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     PresenceCookie,
		Value:    id.String(),
		Path:     "/",
		MaxAge:   int(presenceCookieTTL.Seconds()),
		HttpOnly: true,
		Secure:   c.Request.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearPresenceCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     PresenceCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   0,
		HttpOnly: true,
		Secure:   c.Request.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	})
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ParseSeconds is a helper for tests and any caller that wants the window as a
// number rather than a duration.
func ParseSeconds(d time.Duration) int64 { return int64(d.Seconds()) }


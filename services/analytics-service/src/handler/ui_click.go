package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"newproject/services/analytics-service/src/metrics"
	"newproject/services/analytics-service/src/model"
	"newproject/services/analytics-service/src/telemetry"
)

// uiClickRequest is ONE event, as the browser sends it.
type uiClickRequest struct {
	Timestamp string `json:"timestamp"`
	Page      string `json:"page"`
	Surface   string `json:"surface"`
	Target    string `json:"target"`
	Label     string `json:"label"`
	ElementID string `json:"element_id"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Referrer  string `json:"referrer"`
}

// maxIngestBatch caps one request.
//
// This is the ingest path for every click in the system, so the cap is the only
// thing between a misbehaving client and a table that fills the disk. The
// browser tracker batches 10, so 200 leaves a wide margin for a burst.
const maxIngestBatch = 200

// RecordUIClicks ingests a batch of interface interactions.
//
// ----------------------------------------------------------------------------
// WHY NORMALISATION HAPPENS HERE, SERVER-SIDE
// ----------------------------------------------------------------------------
//
// The page name arrived in two shapes in the old auth_service table: 480 rows
// `/auth/login` and 53 rows `auth/login`. Same page. Any `GROUP BY page` or
// funnel silently undercounted, and nothing looked broken.
//
// Fixing it in the browser would work right up until a new client forgot.
// Normalising at the only door every write passes through means one rule, and a
// future caller gets it for free.
func (h *Handler) RecordUIClicks(c *gin.Context) {
	var payload struct {
		Events []uiClickRequest `json:"events"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		metrics.UIEventsIngested.WithLabelValues("unknown", metrics.OutcomeRejected).Inc()
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	if len(payload.Events) == 0 {
		c.JSON(http.StatusOK, gin.H{"saved": 0})
		return
	}

	// Cap FIRST, before anything is allocated per event.
	events := payload.Events
	if len(events) > maxIngestBatch {
		events = events[:maxIngestBatch]
	}

	// Identity comes from the caller, never from the payload. A client that puts
	// someone else's user id in the body gets ignored; there is no path here that
	// trusts it.
	//
	// WHAT "THE CALLER" MEANS, precisely: the value arrived in a header, on a
	// connection that already presented the internal token. The apps' shared
	// audit handler sets these from the httpOnly session cookie it read
	// server-side. It decodes that JWT WITHOUT verifying the signature, because
	// it is labelling a row, not authorising anything - see
	// `packages/ui/src/jwt-payload.ts`, which says so at the top.
	//
	// So a forged cookie misattributes a click; it does not grant access and
	// cannot reach another user's data through this endpoint. That is an
	// acceptable trade for attribution, and an unacceptable one for permissions
	// - which is why nothing in this file reads these headers to decide whether
	// to serve the request.
	var userID *uuid.UUID
	if raw := c.GetHeader("X-Internal-User-Id"); raw != "" {
		if parsed, err := uuid.Parse(strings.TrimSpace(raw)); err == nil && parsed != uuid.Nil {
			userID = &parsed
		}
	}
	userEmail := strings.TrimSpace(c.GetHeader("X-Internal-User-Email"))
	sessionID := strings.TrimSpace(c.GetHeader("X-Internal-Session-Id"))

	// Geo and device are derived from the REQUEST. Same reason as identity: the
	// client would otherwise be able to place itself in any country.
	geo := geoFromRequest(c.Request)

	rows := make([]model.UIClickEvent, 0, len(events))
	primarySurface := "unknown"

	for _, e := range events {
		surface := metrics.SanitiseSurface(e.Surface)
		primarySurface = surface

		occurred := time.Now().UTC()
		if e.Timestamp != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, e.Timestamp); err == nil {
				occurred = parsed.UTC()
			}
		}

		rows = append(rows, model.UIClickEvent{
			Surface:    surface,
			Page:       normalisePage(e.Page),
			Target:     truncate(e.Target, 255),
			Label:      truncate(e.Label, 255),
			ElementID:  truncate(e.ElementID, 128),
			X:          e.X,
			Y:          e.Y,
			Referrer:   truncate(e.Referrer, 255),
			UserAgent:  truncate(c.Request.UserAgent(), 200),
			IPAddress:  truncate(geo.IP, 64),
			Country:    geo.Country,
			Region:     geo.Region,
			City:       geo.City,
			Device:     geo.Device,
			Browser:    geo.Browser,
			OS:         geo.OS,
			UserID:     userID,
			UserEmail:  truncate(userEmail, 255),
			OccurredAt: occurred,
		})
	}

	if sid, err := uuid.Parse(sessionID); err == nil && sid != uuid.Nil {
		for i := range rows {
			rows[i].SessionID = &sid
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// One transaction for the batch, so a partial write cannot silently
	// under-report the ledger.
	if err := h.uiClicks.CreateBatch(ctx, rows, 100); err != nil {
		metrics.UIEventsIngested.WithLabelValues(primarySurface, metrics.OutcomeError).Inc()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store events"})
		return
	}

	metrics.UIEventsIngested.WithLabelValues(primarySurface, metrics.OutcomeRecorded).Add(float64(len(rows)))
	metrics.EventsInBatch.WithLabelValues(primarySurface).Observe(float64(len(rows)))

	// ---- Publish to the realtime firehose ----
	//
	// AFTER the database write, never before. That order is the whole design:
	//
	//   publish-first would mean a NATS outage silently discards real user
	//   interactions - turning a monitoring problem into data loss.
	//   write-first means a NATS outage costs you the realtime feed and nothing
	//   else. The ledger stays the record; the stream is best-effort.
	//
	// `Publish` never blocks and never returns an error, so there is nothing to
	// handle here and no way for NATS to slow this response down.
	if h.publisher != nil {
		for i := range rows {
			h.publisher.Publish(telemetry.ClickEvent{
				ID:         rows[i].ID.String(),
				Surface:    rows[i].Surface,
				Page:       rows[i].Page,
				Target:     rows[i].Target,
				OccurredAt: rows[i].OccurredAt,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"saved": len(rows), "received": len(payload.Events)})
}

// normalisePage is the one place page names become canonical: always a leading
// slash, never empty.
func normalisePage(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if !strings.HasPrefix(raw, "/") {
		return "/" + raw
	}
	return raw
}

// truncate bounds a client-supplied string before it reaches a sized column.
//
// A VARCHAR does not protect itself: an over-long value is an error the insert
// returns, and one bad event would fail the whole batch. Cutting it here turns a
// whole-batch failure into one slightly-short label.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// geoFromRequest derives geography and device from the request headers.
//
// Country is filled ONLY from a trusted proxy header. In local development no
// such header exists, so `Country` stays empty - and that is correct. Filling it
// with "Unknown" or defaulting to "IN" would be fabricated data wearing a
// database column.
func geoFromRequest(r *http.Request) geoInfo {
	g := geoInfo{IP: clientIP(r), Device: "desktop", Browser: "unknown", OS: "unknown"}

	if v := firstHeader(r, "CF-IPCountry", "X-Vercel-IP-Country", "X-Geo-Country"); v != "" {
		g.Country = strings.ToUpper(v)
	}
	g.Region = firstHeader(r, "CF-Region", "X-Vercel-IP-Region", "X-Geo-Region")
	g.City = firstHeader(r, "CF-IPCity", "X-Vercel-IP-City", "X-Geo-City")

	ua := r.UserAgent()
	switch {
	case strings.Contains(ua, "Mobile"):
		g.Device = "mobile"
	case strings.Contains(ua, "iPad"), strings.Contains(ua, "Tablet"):
		g.Device = "tablet"
	}
	switch {
	case strings.Contains(ua, "Edg/"):
		g.Browser = "edge"
	case strings.Contains(ua, "Chrome/"):
		g.Browser = "chrome"
	case strings.Contains(ua, "Firefox/"):
		g.Browser = "firefox"
	case strings.Contains(ua, "Safari/") && !strings.Contains(ua, "Chrome/"):
		g.Browser = "safari"
	}
	switch {
	case strings.Contains(ua, "Windows"):
		g.OS = "windows"
	case strings.Contains(ua, "Android"):
		g.OS = "android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		g.OS = "ios"
	case strings.Contains(ua, "Mac OS"):
		g.OS = "macos"
	case strings.Contains(ua, "Linux"):
		g.OS = "linux"
	}
	return g
}

type geoInfo struct {
	IP, Country, Region, City, Device, Browser, OS string
}

func firstHeader(r *http.Request, names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(r.Header.Get(n)); v != "" {
			return v
		}
	}
	return ""
}

// clientIP resolves the caller's address, preferring proxy headers.
func clientIP(r *http.Request) string {
	if v := firstHeader(r, "CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"); v != "" {
		// X-Forwarded-For can be a chain: "client, proxy1, proxy2". The first
		// entry is the original client.
		if i := strings.IndexByte(v, ','); i > 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return strings.Trim(host, "[]")
}

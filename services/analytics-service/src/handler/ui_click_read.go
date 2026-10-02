package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"newproject/services/analytics-service/src/repository"
)

// -----------------------------------------------------------------------------
// READ side of the UI click ledger.
//
// Ingest is `POST /ui-clicks`; this file is everything that reads it back.
//
// The superadmin Awareness grid is the only consumer. Its response shape is kept
// EXACTLY as it was when auth-service owned the table, because the grid's
// TypeScript declares that interface and a rename here would be a silent
// `undefined` in the dashboard rather than a compile error.
// -----------------------------------------------------------------------------

// daysParam reads `?days=` and defaults to 30.
//
// Bounded above deliberately. This table grows without limit between purges, and
// "give me the last 9000 days" is a scan of everything, from a UI.
func daysParam(c *gin.Context, def, max int) int {
	v := c.Query("days")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// ListUIClicks returns ledger rows, newest first.
func (h *Handler) ListUIClicks(c *gin.Context) {
	f := repository.UIClickPageFilter{
		Surface: c.Query("surface"),
		Page:    c.Query("page"),
		Days:    daysParam(c, 30, 365),
		Limit:   100,
	}
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			f.Offset = n
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, total, err := h.uiClicks.List(ctx, f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load clicks"})
		return
	}

	// Keyed `clicks` because that is the field the Awareness grid reads. Changing
	// it would leave the dashboard showing `undefined` rather than failing.
	c.JSON(http.StatusOK, gin.H{"clicks": rows, "total": total})
}

// Stats needs the retention window, and the handler does not otherwise know it.
//
// Passed at construction rather than read from a global, so the value in the
// response and the value the retention job actually uses cannot drift apart - a
// dashboard claiming "90 days" while the job purges at 30 is worse than no
// number at all.
type RetentionWindowDays = int

// UIClickStats is the summary the grid's header shows.
//
// The shape is fixed by the grid's `ClickStats` interface. `retention_days` and
// `estimated_rows_pending_purge` are included on purpose: a dashboard that
// silently under-reports is worse than one that says "90 days of data, 12,000
// rows past the window", because the second one tells you retention is broken.
func (h *Handler) UIClickStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	stats, err := h.uiClicks.Stats(ctx, daysParam(c, 30, 365), h.retentionDays)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute stats"})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// PurgeUIClicks deletes rows past the retention window, on operator request.
//
// POST, never GET: a GET that deletes can be triggered by a crawler, a link
// prefetcher, or a browser history restore. The superadmin app's button is a
// POST for the same reason.
//
// The window is the SERVICE'S configured retention, not a caller-supplied
// cutoff. A caller-chosen cutoff is a foot-gun: "yesterday" would delete
// everything older than a day, and the request would read like the gentlest
// possible option.
//
// Runs synchronously and reports the count. A purge that returns before the
// delete is confirmed is a purge nobody can trust.
func (h *Handler) PurgeUIClicks(c *gin.Context) {
	cutoff := time.Now().UTC().AddDate(0, 0, -h.retentionDays)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	deleted, err := h.uiClicks.PurgeOlderThan(ctx, cutoff)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "purge failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted":        deleted,
		"retention_days": h.retentionDays,
		"message":        "Old UI click events purged",
	})
}

// TopUIClickTargets is "which control gets pressed most".
//
// This is the question Prometheus deliberately cannot answer, and the pair of
// them is the whole design: a `target` is unbounded, so it lives in the
// database and is aggregated here, while Prometheus only ever sees the rate.
func (h *Handler) TopUIClickTargets(c *gin.Context) {
	since := time.Now().UTC().AddDate(0, 0, -daysParam(c, 30, 365))

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := h.uiClicks.TopTargets(ctx, c.Query("surface"), since, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load top targets"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"targets": rows})
}

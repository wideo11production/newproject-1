// Click tracking HTTP handlers
//
// Hinglish comments: har block ka arth
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/service"
)

// ClickHandler click history endpoints handle karta hai
type ClickHandler struct {
	clickSvc *service.ClickService
}

// NewClickHandler naya handler banata hai
func NewClickHandler(clickSvc *service.ClickService) *ClickHandler {
	return &ClickHandler{clickSvc: clickSvc}
}

// RegisterRoutes click routes register karta hai
//
// NOTE: Record PUBLIC hai (koi bhi logged-out user click karta hai),
// lekin authenticated users ka email attach ho jata hai.
// List/Stats/Purge SUPERADMIN only hain.
func (h *ClickHandler) RegisterRoutes(r *gin.RouterGroup, authMW, adminMW gin.HandlerFunc) {
	// ---- Recording (public - clicks tab bhi record hone chahiye jab user login nahi hai) ----
	r.POST("/click-events", h.Record)

	// ---- Admin endpoints (superadmin only) ----
	admin := r.Group("/admin")
	admin.Use(authMW, adminMW)
	{
		admin.GET("/clicks", h.List)
		admin.GET("/clicks/stats", h.Stats)
		admin.POST("/clicks/purge", h.Purge)
	}
}

// ClickPayload - frontend se aane wala batch
type ClickPayload struct {
	Events []ClickEventInput `json:"events"`
}

// ClickEventInput - ek click ka data
type ClickEventInput struct {
	Timestamp string `json:"timestamp"`
	Page      string `json:"page"`
	Target    string `json:"target"`
	Label     string `json:"label"`
	ElementID string `json:"element_id"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Referrer  string `json:"referrer"`
}

// Record clicks store karta hai
func (h *ClickHandler) Record(c *gin.Context) {
	var payload ClickPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	// Max batch size - abuse protection (koi 10000 events nahi bhej sakta)
	if len(payload.Events) > 200 {
		payload.Events = payload.Events[:200]
	}

	// Authenticated user ka email attach karo (agar hai)
	var userID *uuid.UUID
	userEmail := ""
	if raw, ok := c.Get("user_id"); ok {
		if uid, err := uuid.Parse(raw.(string)); err == nil {
			userID = &uid
		}
	}
	if raw, ok := c.Get("email"); ok {
		userEmail, _ = raw.(string)
	}

	userAgent := c.GetHeader("User-Agent")
	ip := clientIP(c.Request)

	saved := 0
	for _, e := range payload.Events {
		// Timestamp parse - frontend ISO string bhejta hai
		ts := time.Now().UTC()
		if e.Timestamp != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, e.Timestamp); err == nil {
				ts = parsed.UTC()
			}
		}

		err := h.clickSvc.RecordClick(
			c.Request.Context(),
			userID, userEmail,
			e.Page, e.Target, e.Label, e.ElementID,
			userAgent, ip, e.Referrer,
			e.X, e.Y,
			ts,
		)
		if err == nil {
			saved++
		}
	}

	c.JSON(http.StatusOK, gin.H{"saved": saved, "received": len(payload.Events)})
}

// List click history list karta hai (filters + pagination)
func (h *ClickHandler) List(c *gin.Context) {
	q := service.ClickQuery{
		Page:      c.Query("page"),
		UserEmail: c.Query("email"),
		Limit:     100,
		Offset:    0,
	}

	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			q.Limit = v
		}
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			q.Offset = v
		}
	}
	if d := c.Query("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 {
			since := time.Now().UTC().AddDate(0, 0, -v)
			q.Since = &since
		}
	}

	result, err := h.clickSvc.ListClicks(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load clicks"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// Stats dashboard summary
func (h *ClickHandler) Stats(c *gin.Context) {
	stats, err := h.clickSvc.GetClickStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// Purge manual trigger (retention worker ke saath extra safety)
func (h *ClickHandler) Purge(c *gin.Context) {
	deleted, err := h.clickSvc.PurgeOldClicks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "purge failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"deleted":         deleted,
		"retention_days":  30,
		"message":         "Old clicks purged",
	})
}

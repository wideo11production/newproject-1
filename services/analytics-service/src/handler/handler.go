package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shopspring/decimal"
	"newproject/services/analytics-service/src/model"
	"newproject/services/analytics-service/src/repository"
	"newproject/services/analytics-service/src/service"
	"newproject/services/analytics-service/src/telemetry"
)

type Handler struct {
	svc *service.AnalyticsService

	// uiClicks is the ledger repository, held directly rather than reached
	// through the service.
	//
	// The ingest path is the one place that does not belong in the service
	// layer: it is a high-volume append that must not be blocked behind the
	// analytics aggregations, and it needs to answer "how many rows did this
	// batch write" for the metrics labels. Routing it through the service would
	// mean either a batched-append flag on every analytics method or a second
	// service instance; neither earns its keep.
	uiClicks *repository.UIClickRepository

	// retentionDays is what the retention job ACTUALLY uses, passed in so the
	// dashboard cannot report a different number than the sweeper enforces.
	retentionDays int

	// publisher is the NATS firehose. May be nil, in which case clicks are
	// recorded and not published - which is a legitimate configuration, not a
	// degraded mode that needs rescuing.
	publisher *telemetry.Publisher
}

func NewHandler(
	svc *service.AnalyticsService,
	uiClicks *repository.UIClickRepository,
	retentionDays int,
	publisher *telemetry.Publisher,
) *Handler {
	return &Handler{
		svc:           svc,
		uiClicks:      uiClicks,
		retentionDays: retentionDays,
		publisher:     publisher,
	}
}

// RegisterPublicRoutes are the routes that must stay reachable without a token.
//
// Exactly two, and both are safe to expose:
//   - `/health`  - a liveness probe. Answering it must not require a credential,
//     or the orchestrator has to hold a secret to know the container is alive.
//   - `/metrics` - Prometheus scrapes it, and Prometheus does not send our header.
//     It exposes counters only (never a label carrying a user id, an email or a
//     URL), so there is nothing in it to protect.
//
// Everything else is guarded. See `RegisterRoutes`.
func (h *Handler) RegisterPublicRoutes(r *gin.Engine) {
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "analytics-service"})
	})
	// `gin.WrapH` adapts Prometheus's net/http handler to Gin. It is the
	// idiomatic bridge: Prometheus writes its own content type and encoding, and
	// a Gin-written wrapper would have to reimplement the exposition format.
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))
}

// RegisterRoutes are the guarded routes.
//
// `guarded` is passed in rather than the bare engine, so the split between
// public and protected is visible at the call site in main.go instead of being
// implied by whatever grouping happens to be in here. A new route added to the
// bare engine would silently be public; adding it to `guarded` makes it
// protected by default.
func (h *Handler) RegisterRoutes(guarded *gin.RouterGroup) {
	// The UI interaction ledger. Distinct from `POST /analytics/clicks`, which is
	// ad engagement - see `src/model/ui_click.go`.
	//
	// GET is the Awareness grid's read; both sit behind the internal token,
	// because the ledger is a full record of every interface interaction in the
	// system and is not public information.
	guarded.POST("/ui-clicks", h.RecordUIClicks)
	guarded.GET("/ui-clicks", h.ListUIClicks)
	guarded.GET("/ui-clicks/stats", h.UIClickStats)
	guarded.GET("/ui-clicks/targets", h.TopUIClickTargets)
	// POST, not GET: a GET that deletes can be triggered by a crawler or a
	// prefetcher. The superadmin app's "purge now" button is a POST for the same
	// reason.
	guarded.POST("/ui-clicks/purge", h.PurgeUIClicks)

	analytics := guarded.Group("/analytics")
	{
		analytics.POST("/views", h.RecordView)
		analytics.POST("/clicks", h.RecordClick)
		analytics.POST("/conversions", h.RecordConversion)
		analytics.POST("/reach", h.RecordReach)
		analytics.POST("/revenue", h.RecordRevenue)
		analytics.GET("/views", h.GetViewLogs)
		analytics.GET("/clicks", h.GetClickLogs)
		analytics.GET("/conversions", h.GetConversionEvents)
		analytics.GET("/reach", h.GetReachStats)
		analytics.GET("/revenue", h.GetRevenueReports)
		analytics.GET("/campaign/:campaign_id/analytics", h.GetCampaignAnalytics)
	}

	ai := guarded.Group("/ai")
	{
		ai.POST("/content/categorize", h.CategorizeContent)
		ai.GET("/creators/:creator_id/recommendations", h.GetCreatorRecommendations)
		ai.POST("/content/:content_id/predict-engagement", h.PredictEngagement)
		ai.GET("/creators/:creator_id/revenue-forecast", h.GetRevenueForecast)
		ai.GET("/trending-content", h.GetTrendingContent)
		ai.GET("/creators/:creator_id/target-status", h.GetTargetStatus)
	}
}

func (h *Handler) RecordView(c *gin.Context) {
	var req struct {
		AdID           uint   `json:"ad_id" binding:"required"`
		CampaignID     uint   `json:"campaign_id" binding:"required"`
		UserID         uint   `json:"user_id"`
		VideoID        uint   `json:"video_id"`
		ContentID      string `json:"content_id" binding:"required"`
		Type           string `json:"type" binding:"required"`
		Duration       int    `json:"duration" binding:"required"`
		PercentWatched string `json:"percent_watched" binding:"required"`
		IPAddress      string `json:"ip_address"`
		UserAgent      string `json:"user_agent"`
		Country        string `json:"country"`
		Region         string `json:"region"`
		City           string `json:"city"`
		Device         string `json:"device"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	percentWatched, err := decimal.NewFromString(req.PercentWatched)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid percent_watched"})
		return
	}

	viewType := model.ViewType(req.Type)

	view, err := h.svc.RecordView(c.Request.Context(), req.AdID, req.CampaignID, req.UserID, req.VideoID, req.ContentID, viewType, req.Duration, percentWatched, req.IPAddress, req.UserAgent, req.Country, req.Region, req.City, req.Device)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"view": view})
}

func (h *Handler) RecordClick(c *gin.Context) {
	var req struct {
		AdID       uint   `json:"ad_id" binding:"required"`
		CampaignID uint   `json:"campaign_id" binding:"required"`
		UserID     uint   `json:"user_id"`
		VideoID    uint   `json:"video_id"`
		ContentID  string `json:"content_id" binding:"required"`
		IPAddress  string `json:"ip_address"`
		UserAgent  string `json:"user_agent"`
		Country    string `json:"country"`
		Region     string `json:"region"`
		City       string `json:"city"`
		Device     string `json:"device"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	click, err := h.svc.RecordClick(c.Request.Context(), req.AdID, req.CampaignID, req.UserID, req.VideoID, req.ContentID, req.IPAddress, req.UserAgent, req.Country, req.Region, req.City, req.Device)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"click": click})
}

func (h *Handler) RecordConversion(c *gin.Context) {
	var req struct {
		AdID              uint   `json:"ad_id" binding:"required"`
		CampaignID        uint   `json:"campaign_id" binding:"required"`
		UserID            uint   `json:"user_id"`
		VideoID           uint   `json:"video_id"`
		ContentID         string `json:"content_id" binding:"required"`
		EventType         string `json:"event_type" binding:"required"`
		EventValue        string `json:"event_value"`
		ConversionRevenue string `json:"conversion_revenue"`
		RevenueSource     string `json:"revenue_source"`
		IPAddress         string `json:"ip_address"`
		UserAgent         string `json:"user_agent"`
		Country           string `json:"country"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conversion, err := h.svc.RecordConversion(c.Request.Context(), req.AdID, req.CampaignID, req.UserID, req.VideoID, req.ContentID, req.EventType, req.EventValue, req.ConversionRevenue, req.RevenueSource, req.IPAddress, req.UserAgent, req.Country)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"conversion": conversion})
}

func (h *Handler) RecordReach(c *gin.Context) {
	var req struct {
		CampaignID   uint   `json:"campaign_id" binding:"required"`
		Date         string `json:"date" binding:"required"`
		UniqueUsers  int    `json:"unique_users" binding:"required"`
		Impressions  int    `json:"impressions" binding:"required"`
		ReachPercent string `json:"reach_percent" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, expected YYYY-MM-DD"})
		return
	}

	reachPercent, err := decimal.NewFromString(req.ReachPercent)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reach_percent"})
		return
	}

	reach, err := h.svc.RecordReach(c.Request.Context(), req.CampaignID, date, req.UniqueUsers, req.Impressions, reachPercent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"reach": reach})
}

func (h *Handler) RecordRevenue(c *gin.Context) {
	var req struct {
		CampaignID  uint   `json:"campaign_id" binding:"required"`
		Date        string `json:"date" binding:"required"`
		Revenue     string `json:"revenue" binding:"required"`
		AdSpend     string `json:"ad_spend" binding:"required"`
		Conversions int    `json:"conversions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, expected YYYY-MM-DD"})
		return
	}

	revenue, err := h.svc.RecordRevenue(c.Request.Context(), req.CampaignID, date, req.Revenue, req.AdSpend, strconv.Itoa(req.Conversions))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"revenue_report": revenue})
}

func (h *Handler) GetViewLogs(c *gin.Context) {
	contentID := c.Query("content_id")
	if contentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	logs, err := h.svc.GetViewLogs(c.Request.Context(), contentID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"view_logs": logs})
}

func (h *Handler) GetClickLogs(c *gin.Context) {
	contentID := c.Query("content_id")
	if contentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	logs, err := h.svc.GetClickLogs(c.Request.Context(), contentID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"click_logs": logs})
}

func (h *Handler) GetConversionEvents(c *gin.Context) {
	contentID := c.Query("content_id")
	if contentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	events, err := h.svc.GetConversionEvents(c.Request.Context(), contentID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversion_events": events})
}

func (h *Handler) GetReachStats(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Query("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campaign_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	reach, err := h.svc.GetReachStats(c.Request.Context(), uint(campaignID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reach_stats": reach})
}

func (h *Handler) GetRevenueReports(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Query("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campaign_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	reports, err := h.svc.GetRevenueReports(c.Request.Context(), uint(campaignID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revenue_reports": reports})
}

func (h *Handler) GetCampaignAnalytics(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	var start, end time.Time
	if startDate != "" {
		start, err = time.Parse("2006-01-02", startDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format, expected YYYY-MM-DD"})
			return
		}
	}
	if endDate != "" {
		end, err = time.Parse("2006-01-02", endDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date format, expected YYYY-MM-DD"})
			return
		}
	}

	analytics, err := h.svc.GetCampaignAnalytics(c.Request.Context(), uint(campaignID), start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"analytics": analytics})
}

func (h *Handler) CategorizeContent(c *gin.Context) {
	var req struct {
		ContentID string `json:"content_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	categorization, err := h.svc.CategorizeContent(c.Request.Context(), req.ContentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categorization": categorization})
}

func (h *Handler) GetCreatorRecommendations(c *gin.Context) {
	creatorID, err := strconv.ParseUint(c.Param("creator_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid creator_id"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	recommendations, err := h.svc.RecommendCreators(c.Request.Context(), uint(creatorID), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"recommendations": recommendations})
}

func (h *Handler) PredictEngagement(c *gin.Context) {
	contentID := c.Param("content_id")
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))

	prediction, err := h.svc.PredictEngagement(c.Request.Context(), contentID, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"prediction": prediction})
}

func (h *Handler) GetRevenueForecast(c *gin.Context) {
	creatorID, err := strconv.ParseUint(c.Param("creator_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid creator_id"})
		return
	}

	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))

	forecasts, err := h.svc.ForecastRevenue(c.Request.Context(), uint(creatorID), days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"forecasts": forecasts})
}

func (h *Handler) GetTrendingContent(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "24"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	trending, err := h.svc.GetTrendingContent(c.Request.Context(), days, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"trending": trending})
}

func (h *Handler) GetTargetStatus(c *gin.Context) {
	creatorID, err := strconv.ParseUint(c.Param("creator_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid creator_id"})
		return
	}

	status, err := h.svc.GetCreatorTargetStatus(c.Request.Context(), uint(creatorID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"target_status": status})
}

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/wideo11/webhook-receiver/internal/model"
)

type WebhookHandler struct {
	db                   *gorm.DB
	logger               *zap.Logger
	dashboardServiceURL  string
	dashboardSecret      string
	httpClient           *http.Client
}

func NewWebhookHandler(db *gorm.DB, logger *zap.Logger, dashboardServiceURL, dashboardSecret string) *WebhookHandler {
	return &WebhookHandler{
		db:                  db,
		logger:              logger,
		dashboardServiceURL: strings.TrimRight(dashboardServiceURL, "/"),
		dashboardSecret:     dashboardSecret,
		httpClient:          &http.Client{Timeout: 3 * time.Second},
	}
}

func (h *WebhookHandler) ReceiveAlertManager(c *gin.Context) {
	var webhook model.AlertManagerWebhook
	if err := c.ShouldBindJSON(&webhook); err != nil {
		h.logger.Error("Failed to bind AlertManager webhook", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	h.logger.Info("Received AlertManager webhook",
		zap.String("status", webhook.Status),
		zap.String("receiver", webhook.Receiver),
		zap.Int("alertCount", len(webhook.Alerts)),
	)

	// Process each alert
	for _, alert := range webhook.Alerts {
		if err := h.processAlert(c.Request.Context(), &alert, webhook.Status, webhook.Receiver); err != nil {
			h.logger.Error("Failed to process alert", zap.Error(err), zap.String("fingerprint", alert.Fingerprint))
			// Continue processing other alerts
		}
	}

	// Store webhook event
	event := model.WebhookEvent{
		Source:   "alertmanager",
		Type:     "alert",
		Payload:  model.ToJSON(webhook),
		Processed: true,
	}
	h.db.Create(&event)

	c.JSON(http.StatusOK, gin.H{"status": "ok", "processed": len(webhook.Alerts)})
}

func (h *WebhookHandler) ReceivePrometheus(c *gin.Context) {
	var webhook model.PrometheusWebhook
	if err := c.ShouldBindJSON(&webhook); err != nil {
		h.logger.Error("Failed to bind Prometheus webhook", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	h.logger.Info("Received Prometheus webhook", zap.Int("alertCount", len(webhook.Alerts)))

	for _, alert := range webhook.Alerts {
		amAlert := model.AlertManagerAlert{
			Status:       "firing",
			Labels:       alert.Labels,
			Annotations:  alert.Annotations,
			StartsAt:     alert.StartsAt,
			EndsAt:       alert.EndsAt,
			GeneratorURL: alert.GeneratorURL,
			Fingerprint:  alert.Fingerprint,
		}
		if err := h.processAlert(c.Request.Context(), &amAlert, "firing", "prometheus"); err != nil {
			h.logger.Error("Failed to process Prometheus alert", zap.Error(err))
		}
	}

	event := model.WebhookEvent{
		Source:    "prometheus",
		Type:      "alert",
		Payload:   model.ToJSON(webhook),
		Processed: true,
	}
	h.db.Create(&event)

	c.JSON(http.StatusOK, gin.H{"status": "ok", "processed": len(webhook.Alerts)})
}

func (h *WebhookHandler) ReceiveCustom(c *gin.Context) {
	var webhook model.CustomWebhook
	if err := c.ShouldBindJSON(&webhook); err != nil {
		h.logger.Error("Failed to bind custom webhook", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	h.logger.Info("Received custom webhook", zap.String("source", webhook.Source), zap.String("severity", webhook.Severity))

	// Convert to alert
	alert := &model.AlertManagerAlert{
		Status: "firing",
		Labels: map[string]string{
			"alertname": webhook.Title,
			"severity":  webhook.Severity,
			"source":    webhook.Source,
		},
		Annotations: map[string]string{
			"summary": webhook.Message,
		},
		StartsAt:     webhook.Timestamp,
		EndsAt:       time.Time{},
		GeneratorURL: "",
		Fingerprint:  uuid.New().String(),
	}

	if err := h.processAlert(c.Request.Context(), alert, "firing", webhook.Source); err != nil {
		h.logger.Error("Failed to process custom alert", zap.Error(err))
	}

	event := model.WebhookEvent{
		Source:    webhook.Source,
		Type:      "custom",
		Payload:   model.ToJSON(webhook),
		Processed: true,
	}
	h.db.Create(&event)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *WebhookHandler) processAlert(ctx context.Context, alert *model.AlertManagerAlert, status, receiver string) error {
	now := time.Now()

	// Check if alert already exists
	var existing model.Alert
	err := h.db.Where("fingerprint = ?", alert.Fingerprint).First(&existing).Error

	alertModel := model.Alert{
		Fingerprint:  alert.Fingerprint,
		Name:         alert.Labels["alertname"],
		Severity:     alert.Labels["severity"],
		State:        status,
		Labels:       model.ToJSON(alert.Labels),
		Annotations:  model.ToJSON(alert.Annotations),
		StartsAt:     alert.StartsAt,
		EndsAt:       nil,
		GeneratorURL: alert.GeneratorURL,
		Status:       status,
	}

	if alert.EndsAt.IsZero() || status == "resolved" {
		alertModel.EndsAt = &alert.EndsAt
	}

	if err == gorm.ErrRecordNotFound {
		// New alert
		alertModel.CreatedAt = now
		alertModel.UpdatedAt = now
		if err := h.db.Create(&alertModel).Error; err != nil {
			return fmt.Errorf("failed to create alert: %w", err)
		}
		h.logger.Info("Created new alert", zap.String("name", alertModel.Name), zap.String("state", status))
	} else if err == nil {
		// Update existing alert
		existing.State = status
		existing.Labels = alertModel.Labels
		existing.Annotations = alertModel.Annotations
		existing.EndsAt = alertModel.EndsAt
		existing.Status = status
		existing.UpdatedAt = now

		if err := h.db.Save(&existing).Error; err != nil {
			return fmt.Errorf("failed to update alert: %w", err)
		}
		h.logger.Info("Updated existing alert", zap.String("name", existing.Name), zap.String("state", status))
	} else {
		return fmt.Errorf("failed to query alert: %w", err)
	}

	// Forward to dashboard-service for real-time updates
	go h.forwardToDashboardService(alertModel)

	return nil
}

func (h *WebhookHandler) forwardToDashboardService(alert model.Alert) {
	// Real-time fan-out: push the persisted alert to dashboard-service so it
	// broadcasts it to every connected browser over the WebSocket bus as an
	// `alert_update` message. Best-effort: a forward failure must NOT fail the
	// webhook that already committed the alert to Postgres - the store is the
	// source of truth; the WS broadcast is a live cache. The alert is still
	// queryable via GET /api/v1/alerts (seeded by the REST proxy in Phase 1).
	//
	// Guards: shared INTERNAL_SERVICE_SECRET; 3s timeout (Prometheus scrape
	// load must not pile up behind a slow dashboard); error logged, never
	// retried (Alertmanager redeliveries handle durability).

	if h.dashboardServiceURL == "" || h.dashboardSecret == "" {
		// Undeployed/legacy config without the secret binding: do not attempt the
		// forward rather than sending an unauthenticated request.
		h.logger.Debug("alert forward skipped: dashboard service or secret not configured",
			zap.String("name", alert.Name))
		return
	}

	body, err := json.Marshal(alert)
	if err != nil {
		h.logger.Error("failed to marshal alert for forward", zap.Error(err), zap.String("fingerprint", alert.Fingerprint))
		return
	}

	url := h.dashboardServiceURL + "/api/v1/internal/alerts/broadcast"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		h.logger.Error("failed to build alert forward request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", h.dashboardSecret)

	resp, err := h.httpClient.Do(req)
	if err != nil {
		h.logger.Warn("alert forward to dashboard-service failed", zap.Error(err), zap.String("name", alert.Name))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		h.logger.Warn("alert forward to dashboard-service non-2xx",
			zap.Int("status", resp.StatusCode), zap.String("name", alert.Name))
		return
	}
	h.logger.Debug("alert forwarded to dashboard-service", zap.String("name", alert.Name))
}

func (h *WebhookHandler) ListAlerts(c *gin.Context) {
	var alerts []model.Alert
	query := h.db.Order("created_at DESC")

	if state := c.Query("state"); state != "" {
		query = query.Where("state = ?", state)
	}
	if severity := c.Query("severity"); severity != "" {
		query = query.Where("severity = ?", severity)
	}
	if limit := c.Query("limit"); limit != "" {
		query = query.Limit(parseInt(limit, 100))
	}
	if offset := c.Query("offset"); offset != "" {
		query = query.Offset(parseInt(offset, 0))
	}

	if err := query.Find(&alerts).Error; err != nil {
		h.logger.Error("Failed to list alerts", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list alerts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

func (h *WebhookHandler) GetAlert(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid alert ID"})
		return
	}

	var alert model.Alert
	if err := h.db.First(&alert, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Alert not found"})
			return
		}
		h.logger.Error("Failed to get alert", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get alert"})
		return
	}

	c.JSON(http.StatusOK, alert)
}

func (h *WebhookHandler) ListWebhookEvents(c *gin.Context) {
	var events []model.WebhookEvent
	query := h.db.Order("created_at DESC")

	if source := c.Query("source"); source != "" {
		query = query.Where("source = ?", source)
	}
	if limit := c.Query("limit"); limit != "" {
		query = query.Limit(parseInt(limit, 100))
	}

	if err := query.Find(&events).Error; err != nil {
		h.logger.Error("Failed to list webhook events", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list webhook events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

func parseInt(s string, defaultVal int) int {
	var val int
	fmt.Sscanf(s, "%d", &val)
	if val == 0 {
		return defaultVal
	}
	return val
}
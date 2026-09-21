package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/api"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/wideo11/dashboard-service/internal/model"
)

type DashboardHandler struct {
	db            *gorm.DB
	logger        *zap.Logger
	prometheusURL string
	promAPI       v1.API
}

func NewDashboardHandler(db *gorm.DB, logger *zap.Logger, prometheusURL string) *DashboardHandler {
	client, err := api.NewClient(api.Config{Address: prometheusURL})
	if err != nil {
		logger.Warn("Failed to create Prometheus client", zap.Error(err))
	}
	
	return &DashboardHandler{
		db:            db,
		logger:        logger,
		prometheusURL: prometheusURL,
		promAPI:       v1.NewAPI(client),
	}
}

func (h *DashboardHandler) ListDashboards(c *gin.Context) {
	var dashboards []model.Dashboard
	query := h.db.Order("updated_at DESC")

	if tag := c.Query("tag"); tag != "" {
		query = query.Where("tags @> ?", fmt.Sprintf(`["%s"]`, tag))
	}

	if limit := c.Query("limit"); limit != "" {
		query = query.Limit(parseInt(limit, 50))
	}

	if offset := c.Query("offset"); offset != "" {
		query = query.Offset(parseInt(offset, 0))
	}

	if err := query.Find(&dashboards).Error; err != nil {
		h.logger.Error("Failed to list dashboards", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list dashboards"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"dashboards": dashboards,
		"total":      len(dashboards),
	})
}

func (h *DashboardHandler) CreateDashboard(c *gin.Context) {
	var req struct {
		Title       string                 `json:"title" binding:"required"`
		UID         string                 `json:"uid"`
		Description string                 `json:"description"`
		Tags        []string               `json:"tags"`
		Timezone    string                 `json:"timezone"`
		Refresh     string                 `json:"refresh"`
		Time        model.TimeRange        `json:"time"`
		TimePicker  model.TimePicker       `json:"timepicker"`
		Panels      []model.Panel          `json:"panels"`
		Variables   []model.Variable       `json:"variables"`
		Links       []model.Link           `json:"links"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dashboard := model.Dashboard{
		UID:         req.UID,
		Title:       req.Title,
		Description: req.Description,
		Tags:        model.ToJSON(req.Tags),
		Timezone:    req.Timezone,
		Refresh:     req.Refresh,
		Time:        model.ToJSON(req.Time),
		TimePicker:  model.ToJSON(req.TimePicker),
		Panels:      model.ToJSON(req.Panels),
		Variables:   model.ToJSON(req.Variables),
		Links:       model.ToJSON(req.Links),
		CreatedBy:   uuid.Nil, // Would get from auth context
		Version:     1,
	}

	if err := h.db.Create(&dashboard).Error; err != nil {
		h.logger.Error("Failed to create dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create dashboard"})
		return
	}

	// Create initial version
	version := model.DashboardVersion{
		DashboardID: dashboard.ID,
		Version:     1,
		Title:       dashboard.Title,
		Panels:      dashboard.Panels,
		Variables:   dashboard.Variables,
		Time:        dashboard.Time,
		CreatedBy:   dashboard.CreatedBy,
	}
	h.db.Create(&version)

	c.JSON(http.StatusCreated, dashboard)
}

func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var dashboard model.Dashboard
	if err := h.db.First(&dashboard, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Dashboard not found"})
			return
		}
		h.logger.Error("Failed to get dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get dashboard"})
		return
	}

	c.JSON(http.StatusOK, dashboard)
}

func (h *DashboardHandler) UpdateDashboard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var req struct {
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		Tags        []string               `json:"tags"`
		Timezone    string                 `json:"timezone"`
		Refresh     string                 `json:"refresh"`
		Time        model.TimeRange        `json:"time"`
		TimePicker  model.TimePicker       `json:"timepicker"`
		Panels      []model.Panel          `json:"panels"`
		Variables   []model.Variable       `json:"variables"`
		Links       []model.Link           `json:"links"`
		Message     string                 `json:"message"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var dashboard model.Dashboard
	if err := h.db.First(&dashboard, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Dashboard not found"})
			return
		}
		h.logger.Error("Failed to get dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update dashboard"})
		return
	}

	// Save current version before update
	version := model.DashboardVersion{
		DashboardID: dashboard.ID,
		Version:     dashboard.Version + 1,
		Title:       dashboard.Title,
		Panels:      dashboard.Panels,
		Variables:   dashboard.Variables,
		Time:        dashboard.Time,
		CreatedBy:   dashboard.CreatedBy,
	}
	h.db.Create(&version)

	// Update dashboard
	dashboard.Title = req.Title
	dashboard.Description = req.Description
	dashboard.Tags = model.ToJSON(req.Tags)
	dashboard.Timezone = req.Timezone
	dashboard.Refresh = req.Refresh
	dashboard.Time = model.ToJSON(req.Time)
	dashboard.TimePicker = model.ToJSON(req.TimePicker)
	dashboard.Panels = model.ToJSON(req.Panels)
	dashboard.Variables = model.ToJSON(req.Variables)
	dashboard.Links = model.ToJSON(req.Links)
	dashboard.Version = version.Version

	if err := h.db.Save(&dashboard).Error; err != nil {
		h.logger.Error("Failed to update dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update dashboard"})
		return
	}

	c.JSON(http.StatusOK, dashboard)
}

func (h *DashboardHandler) DeleteDashboard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	if err := h.db.Delete(&model.Dashboard{}, "id = ?", id).Error; err != nil {
		h.logger.Error("Failed to delete dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete dashboard"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Dashboard deleted"})
}

func (h *DashboardHandler) ListVersions(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var versions []model.DashboardVersion
	if err := h.db.Where("dashboard_id = ?", id).Order("version DESC").Find(&versions).Error; err != nil {
		h.logger.Error("Failed to list versions", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list versions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"versions": versions})
}

func (h *DashboardHandler) ForkDashboard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var dashboard model.Dashboard
	if err := h.db.First(&dashboard, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Dashboard not found"})
			return
		}
		h.logger.Error("Failed to get dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fork dashboard"})
		return
	}

	// Create new dashboard as fork
	newDashboard := dashboard
	newDashboard.ID = uuid.New()
	newDashboard.UID = ""
	newDashboard.Title = dashboard.Title + " (fork)"
	newDashboard.Version = 1
	newDashboard.CreatedAt = time.Now()
	newDashboard.UpdatedAt = time.Now()

	if err := h.db.Create(&newDashboard).Error; err != nil {
		h.logger.Error("Failed to create fork", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create fork"})
		return
	}

	c.JSON(http.StatusCreated, newDashboard)
}

func (h *DashboardHandler) ImportDashboard(c *gin.Context) {
	var req struct {
		Dashboard model.Dashboard `json:"dashboard" binding:"required"`
		Overwrite bool            `json:"overwrite"`
		FolderUID string          `json:"folderUid"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if dashboard with same UID exists
	if req.Dashboard.UID != "" {
		var existing model.Dashboard
		err := h.db.Where("uid = ?", req.Dashboard.UID).First(&existing).Error
		if err == nil && !req.Overwrite {
			c.JSON(http.StatusConflict, gin.H{"error": "Dashboard with this UID already exists"})
			return
		}
		if err == nil && req.Overwrite {
			req.Dashboard.ID = existing.ID
			req.Dashboard.Version = existing.Version + 1
			if err := h.db.Save(&req.Dashboard).Error; err != nil {
				h.logger.Error("Failed to update dashboard", zap.Error(err))
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import dashboard"})
				return
			}
			c.JSON(http.StatusOK, req.Dashboard)
			return
		}
	}

	req.Dashboard.ID = uuid.New()
	req.Dashboard.CreatedAt = time.Now()
	req.Dashboard.UpdatedAt = time.Now()
	req.Dashboard.Version = 1

	if err := h.db.Create(&req.Dashboard).Error; err != nil {
		h.logger.Error("Failed to import dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import dashboard"})
		return
	}

	c.JSON(http.StatusCreated, req.Dashboard)
}

func (h *DashboardHandler) ExportDashboard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var dashboard model.Dashboard
	if err := h.db.First(&dashboard, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Dashboard not found"})
			return
		}
		h.logger.Error("Failed to get dashboard", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export dashboard"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"dashboard": dashboard,
		"meta": gin.H{
			"exportedAt": time.Now(),
			"version":    "1.0",
		},
	})
}

func (h *DashboardHandler) QueryPanelData(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var req model.QueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if h.promAPI == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus not configured"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	results := make(map[string]model.QueryResult)
	for _, q := range req.Queries {
		result, warnings, err := h.promAPI.Query(ctx, q.Expr, time.Now())
		if err != nil {
			results[q.RefID] = model.QueryResult{
				Status: "error",
				Error:  err.Error(),
			}
			continue
		}

		results[q.RefID] = model.QueryResult{
			Status: "success",
			Data: map[string]interface{}{
				"resultType": result.Type(),
				"result":     result.String(),
				"warnings":   warnings,
			},
		}
	}

	c.JSON(http.StatusOK, model.QueryResponse{Results: results})
}

func (h *DashboardHandler) QueryRange(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	var req struct {
		Queries  []model.Query `json:"queries" binding:"required"`
		Start    string        `json:"start" binding:"required"`
		End      string        `json:"end" binding:"required"`
		Step     string        `json:"step" binding:"required"`
	}

	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if h.promAPI == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus not configured"})
		return
	}

	start, err := parseTime(req.Start)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid start time"})
		return
	}
	end, err := parseTime(req.End)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid end time"})
		return
	}
	step, err := time.ParseDuration(req.Step)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid step duration"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	results := make(map[string]model.QueryResult)
	for _, q := range req.Queries {
		r := v1.Range{
			Start: start,
			End:   end,
			Step:  step,
		}
		result, warnings, err := h.promAPI.QueryRange(ctx, q.Expr, r)
		if err != nil {
			results[q.RefID] = model.QueryResult{
				Status: "error",
				Error:  err.Error(),
			}
			continue
		}

		results[q.RefID] = model.QueryResult{
			Status: "success",
			Data: map[string]interface{}{
				"resultType": result.Type(),
				"result":     result.String(),
				"warnings":   warnings,
			},
		}
	}

	c.JSON(http.StatusOK, model.QueryResponse{Results: results})
}

func (h *DashboardHandler) GetPreferences(c *gin.Context) {
	userID := uuid.Nil // Would get from auth context
	
	var prefs []model.DashboardPreference
	if err := h.db.Where("user_id = ?", userID).Find(&prefs).Error; err != nil {
		h.logger.Error("Failed to get preferences", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get preferences"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"preferences": prefs})
}

func (h *DashboardHandler) UpdatePreferences(c *gin.Context) {
	userID := uuid.Nil // Would get from auth context

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for key, value := range req {
		pref := model.DashboardPreference{
			UserID: userID,
			Key:    key,
			Value:  model.ToJSON(value),
		}
		h.db.Where("user_id = ? AND key = ?", userID, key).Assign(pref).FirstOrCreate(&pref)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Preferences updated"})
}

func (h *DashboardHandler) ListFavorites(c *gin.Context) {
	userID := uuid.Nil // Would get from auth context

	var favorites []model.Favorite
	if err := h.db.Preload("Dashboard").Where("user_id = ?", userID).Find(&favorites).Error; err != nil {
		h.logger.Error("Failed to list favorites", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list favorites"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"favorites": favorites})
}

func (h *DashboardHandler) AddFavorite(c *gin.Context) {
	userID := uuid.Nil // Would get from auth context

	dashboardID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	fav := model.Favorite{
		UserID:      userID,
		DashboardID: dashboardID,
	}
	if err := h.db.Create(&fav).Error; err != nil {
		h.logger.Error("Failed to add favorite", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add favorite"})
		return
	}

	c.JSON(http.StatusCreated, fav)
}

func (h *DashboardHandler) RemoveFavorite(c *gin.Context) {
	userID := uuid.Nil // Would get from auth context

	dashboardID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard ID"})
		return
	}

	if err := h.db.Where("user_id = ? AND dashboard_id = ?", userID, dashboardID).Delete(&model.Favorite{}).Error; err != nil {
		h.logger.Error("Failed to remove favorite", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove favorite"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Favorite removed"})
}

func parseInt(s string, defaultVal int) int {
	var val int
	fmt.Sscanf(s, "%d", &val)
	if val == 0 {
		return defaultVal
	}
	return val
}

func parseTime(s string) (time.Time, error) {
	// Try parsing as RFC3339
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	// Try parsing as Unix timestamp
	if ts, err := time.ParseDuration(s + "s"); err == nil {
		return time.Now().Add(-ts), nil
	}
	return time.Time{}, fmt.Errorf("invalid time format")
}
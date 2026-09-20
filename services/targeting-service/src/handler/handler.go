package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/targeting-service/src/model"
	"newproject/services/targeting-service/src/repository"
	"newproject/services/targeting-service/src/service"
)

type Handler struct {
	svc *service.TargetingService
}

func NewHandler(svc *service.TargetingService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	categories := r.Group("/categories")
	{
		categories.POST("", h.CreateCategory)
		categories.GET("", h.ListCategories)
		categories.GET("/:id", h.GetCategory)
		categories.GET("/code/:code", h.GetCategoryByCode)
		categories.PUT("/:id", h.UpdateCategory)
		categories.DELETE("/:id", h.DeleteCategory)
		categories.GET("/tree", h.GetTargetingTree)
	}

	targeting := r.Group("/targeting")
	{
		targeting.GET("/countries", h.GetAllCountries)
		targeting.GET("/languages", h.GetAllLanguages)
		targeting.GET("/channels", h.GetAllChannels)
	}

	rules := r.Group("/campaigns/:campaign_id/targeting")
	{
		rules.POST("", h.CreateTargetingRule)
		rules.GET("", h.GetTargetingRules)
		rules.PUT("/:id", h.UpdateTargetingRule)
		rules.DELETE("/:id", h.DeleteTargetingRule)
		rules.DELETE("", h.ClearTargetingRules)
	}
}

func (h *Handler) CreateCategory(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		Code        string `json:"code" binding:"required"`
		Type        string `json:"type" binding:"required"`
		Description string `json:"description"`
		ParentID    *uint  `json:"parent_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	category, err := h.svc.CreateCategory(c.Request.Context(), req.Name, req.Code, req.Type, req.Description, req.ParentID)
	if err != nil {
		if err == repository.ErrCategoryAlreadyExists {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"category": category})
}

func (h *Handler) GetCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category ID"})
		return
	}
	category, err := h.svc.GetCategory(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrCategoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"category": category})
}

func (h *Handler) GetCategoryByCode(c *gin.Context) {
	category, err := h.svc.GetCategoryByCode(c.Request.Context(), c.Param("code"))
	if err != nil {
		if err == repository.ErrCategoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"category": category})
}

func (h *Handler) ListCategories(c *gin.Context) {
	var parentID *uint
	if pid := c.Query("parent_id"); pid != "" {
		if parsed, err := strconv.ParseUint(pid, 10, 64); err == nil {
			pid := uint(parsed)
			parentID = &pid
		}
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	categories, err := h.svc.ListCategories(c.Request.Context(), parentID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func (h *Handler) UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category ID"})
		return
	}
	var req model.Category
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateCategory(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"category": req})
}

func (h *Handler) DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category ID"})
		return
	}
	if err := h.svc.DeleteCategory(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetTargetingTree(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	tree, err := h.svc.BuildTargetingTree(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tree": tree})
}

func (h *Handler) GetAllCountries(c *gin.Context) {
	countries, err := h.svc.GetAllCountries(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"countries": countries})
}

func (h *Handler) GetAllLanguages(c *gin.Context) {
	languages, err := h.svc.GetAllLanguages(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"languages": languages})
}

func (h *Handler) GetAllChannels(c *gin.Context) {
	channels, err := h.svc.GetAllChannels(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": channels})
}

func (h *Handler) CreateTargetingRule(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	var req struct {
		Field     string `json:"field" binding:"required"`
		Operator  string `json:"operator" binding:"required"`
		Value     string `json:"value" binding:"required"`
		IsInclude bool   `json:"is_include"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule, err := h.svc.CreateTargetingRule(c.Request.Context(), uint(campaignID), req.Field, req.Operator, req.Value, req.IsInclude)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"targeting_rule": rule})
}

func (h *Handler) GetTargetingRules(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	rules, err := h.svc.GetTargetingRules(c.Request.Context(), uint(campaignID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var targetingJson map[string]interface{}
	if len(rules) > 0 {
		jsonData, _ := json.Marshal(rules)
		_ = json.Unmarshal(jsonData, &targetingJson)
	}
	c.JSON(http.StatusOK, gin.H{"targeting_rules": rules, "targeting_json": targetingJson})
}

func (h *Handler) UpdateTargetingRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}
	var req model.TargetRule
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateTargetingRule(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"targeting_rule": req})
}

func (h *Handler) DeleteTargetingRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
		return
	}
	if err := h.svc.DeleteTargetingRule(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ClearTargetingRules(c *gin.Context) {
	campaignID, err := strconv.ParseUint(c.Param("campaign_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid campaign ID"})
		return
	}
	if err := h.svc.ClearTargetingRules(c.Request.Context(), uint(campaignID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "targeting rules cleared"})
}

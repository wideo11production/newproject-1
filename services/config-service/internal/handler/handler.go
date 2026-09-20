package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"services/config-service/internal/model"
	"services/config-service/internal/service"
)

type ConfigHandler struct {
	service *service.ConfigService
}

func NewConfigHandler(service *service.ConfigService) *ConfigHandler {
	return &ConfigHandler{service: service}
}

func (h *ConfigHandler) Create(c *gin.Context) {
	var req model.Config
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	if userID == "" {
		userID = "system"
	}

	if err := h.service.Create(c.Request.Context(), &req, userID); err != nil {
		log.Error().Err(err).Msg("Failed to create config")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create config"})
		return
	}

	c.JSON(http.StatusCreated, req)
}

func (h *ConfigHandler) Get(c *gin.Context) {
	key := c.Param("key")
	environment := c.DefaultQuery("environment", "all")

	config, err := h.service.Get(c.Request.Context(), key, environment)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
		return
	}

	c.JSON(http.StatusOK, config)
}

func (h *ConfigHandler) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	config, err := h.service.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
		return
	}

	c.JSON(http.StatusOK, config)
}

func (h *ConfigHandler) List(c *gin.Context) {
	environment := c.DefaultQuery("environment", "all")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	if limit > 100 {
		limit = 100
	}

	configs, total, err := h.service.List(c.Request.Context(), environment, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list configs")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list configs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  configs,
		"total": total,
		"limit": limit,
		"offset": offset,
	})
}

func (h *ConfigHandler) Update(c *gin.Context) {
	idStr := c.Param("key")
	id, err := uuid.Parse(idStr)
	if err != nil {
		// Try to get by key
		config, err := h.service.Get(c.Request.Context(), idStr, "all")
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
			return
		}
		id = config.ID
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	if userID == "" {
		userID = "system"
	}

	config, err := h.service.Update(c.Request.Context(), id, updates, userID)
	if err != nil {
		log.Error().Err(err).Msg("Failed to update config")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update config"})
		return
	}

	c.JSON(http.StatusOK, config)
}

func (h *ConfigHandler) Delete(c *gin.Context) {
	key := c.Param("key")

	config, err := h.service.Get(c.Request.Context(), key, "all")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
		return
	}

	userID := c.GetString("user_id")
	if userID == "" {
		userID = "system"
	}

	if err := h.service.Delete(c.Request.Context(), config.ID, userID); err != nil {
		log.Error().Err(err).Msg("Failed to delete config")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete config"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *ConfigHandler) History(c *gin.Context) {
	key := c.Param("key")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	config, err := h.service.Get(c.Request.Context(), key, "all")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
		return
	}

	history, err := h.service.History(c.Request.Context(), config.ID, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get config history")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   history,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *ConfigHandler) Watch(c *gin.Context) {
	keys := c.QueryArray("keys")
	if len(keys) == 0 {
		keys = []string{"*"}
	}

	ch, err := h.service.Watch(c.Request.Context(), keys)
	if err != nil {
		log.Error().Err(err).Msg("Failed to start watch")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start watch"})
		return
	}

	c.Stream(func(w io.Writer) bool {
		select {
		case config, ok := <-ch:
			if !ok {
				return false
			}
			data, _ := json.Marshal(config)
			_, _ = w.Write(data)
			_, _ = w.Write([]byte("\n"))
			return true
		case <-c.Request.Context().Done():
			return false
		}
	})
}
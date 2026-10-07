package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/upload-service/src/model"
	"newproject/services/upload-service/src/repository"
	"newproject/services/upload-service/src/service"
)

type Handler struct {
	svc        *service.UploadService
	safetyRepo repository.SafetyRepository
}

func NewHandler(svc *service.UploadService, safetyRepo repository.SafetyRepository) *Handler {
	return &Handler{svc: svc, safetyRepo: safetyRepo}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	uploads := r.Group("/uploads")
	{
		uploads.POST("/init", h.InitSession)
		uploads.POST("/:uuid/chunk", h.UploadChunk)
		uploads.POST("/:uuid/assemble", h.AssembleUpload)
		uploads.GET("/:uuid/status", h.GetUploadStatus)
		uploads.DELETE("/:uuid", h.CancelUpload)
		uploads.POST("/cleanup", h.CleanupExpired)

		// AURA Content Safety Guard routes
		safety := r.Group("/safety")
		{
			safety.GET("/check/:uuid", h.GetSafetyCheck)
			safety.GET("/blacklist/:user_id", h.CheckBlacklist)
		}
	}
}

func (h *Handler) InitSession(c *gin.Context) {
	var req struct {
		UserID     uint   `json:"user_id" binding:"required"`
		Filename   string `json:"filename" binding:"required"`
		ContentType string `json:"content_type" binding:"required"`
		FileSize   int64  `json:"file_size" binding:"required"`
		// Category — content type for educational-violation check.
		// Student ne non-educational upload kiya to AURA revoke trigger.
		// Default "other" agar missing ho.
		Category   string `json:"category"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category := req.Category
	if category == "" {
		category = string(model.CategoryOther)
	}

	session, err := h.svc.InitSession(c.Request.Context(), req.UserID, req.Filename, req.ContentType, req.FileSize, category)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"session": session})
}

func (h *Handler) UploadChunk(c *gin.Context) {
	chunkData, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read chunk data"})
		return
	}

	chunkNum, err := strconv.Atoi(c.Query("chunk_number"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chunk_number required"})
		return
	}

	if err := h.svc.UploadChunk(c.Request.Context(), c.Param("uuid"), chunkNum, chunkData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "chunk uploaded"})
}

func (h *Handler) AssembleUpload(c *gin.Context) {
	minioPath, err := h.svc.AssembleUpload(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"minio_path": minioPath, "status": "completed"})
}

func (h *Handler) GetUploadStatus(c *gin.Context) {
	session, err := h.svc.GetUploadStatus(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrUploadSessionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": session})
}

func (h *Handler) CancelUpload(c *gin.Context) {
	if err := h.svc.CancelUpload(c.Request.Context(), c.Param("uuid")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) CleanupExpired(c *gin.Context) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := h.svc.CleanupExpired(ctx); err != nil {
			_ = err
		}
	}()
	c.JSON(http.StatusOK, gin.H{"message": "cleanup started"})
}

// ---------------------------------------------------------------------------
// AURA Content Safety Guard handlers
// ---------------------------------------------------------------------------

func (h *Handler) GetSafetyCheck(c *gin.Context) {
	check, err := h.safetyRepo.GetSafetyCheckBySessionUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "safety check not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"check": check})
}

func (h *Handler) CheckBlacklist(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	isBlacklisted := h.safetyRepo.IsBlacklisted(c.Request.Context(), uint(userID))
	if isBlacklisted {
		entries, _ := h.safetyRepo.GetBlacklistByUser(c.Request.Context(), uint(userID))
		c.JSON(http.StatusOK, gin.H{
			"blacklisted": true,
			"entries":    entries,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"blacklisted": false})
}

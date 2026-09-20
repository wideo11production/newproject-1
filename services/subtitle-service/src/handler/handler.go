package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/subtitle-service/src/repository"
	"newproject/services/subtitle-service/src/service"
)

type Handler struct {
	svc *service.SubtitleService
}

func NewHandler(svc *service.SubtitleService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	subs := r.Group("/subtitles")
	{
		subs.POST("", h.CreateSubtitle)
		subs.GET("", h.ListSubtitles)
		subs.GET("/:id", h.GetSubtitle)
		subs.GET("/video/:video_id", h.GetByVideo)
		subs.GET("/video/:video_id/lang/:lang", h.GetByLanguage)
		subs.GET("/video/:video_id/default", h.GetDefault)
		subs.PUT("/:id/default", h.SetDefault)
		subs.DELETE("/:id", h.DeleteSubtitle)
		subs.DELETE("/video/:video_id", h.DeleteByVideo)
		subs.PUT("/:id/style", h.UpdateStyle)
		subs.GET("/:id/style", h.GetStyle)
		subs.POST("/auto", h.AutoGenerate)
		subs.POST("/parse/srt", h.ParseSRT)
		subs.POST("/parse/vtt", h.ParseVTT)
		subs.POST("/convert/srt-to-vtt", h.ConvertSRTToVTT)
	}
}

func (h *Handler) CreateSubtitle(c *gin.Context) {
	var req struct {
		VideoID  uint   `json:"video_id" binding:"required"`
		Language string `json:"language" binding:"required"`
		Label    string `json:"label,omitempty"`
		FileType string `json:"file_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.CreateSubtitle(c.Request.Context(), req.VideoID, req.Language, req.Label, req.FileType, nil, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subtitle": sub})
}

func (h *Handler) GetSubtitle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	sub, err := h.svc.GetSubtitle(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) GetByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	subs, err := h.svc.GetSubtitlesByVideo(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitles": subs})
}

func (h *Handler) GetByLanguage(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	lang := c.Param("lang")
	sub, err := h.svc.GetSubtitleByLanguage(c.Request.Context(), uint(videoID), lang)
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) GetDefault(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	sub, err := h.svc.GetSubtitleByLanguage(c.Request.Context(), uint(videoID), "")
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) SetDefault(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	if err := h.svc.SetDefault(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "default subtitle set"})
}

func (h *Handler) DeleteSubtitle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	if err := h.svc.DeleteSubtitle(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) DeleteByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	if err := h.svc.DeleteByVideo(c.Request.Context(), uint(videoID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) UpdateStyle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	var req service.UpdateStyleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	style, err := h.svc.UpdateStyle(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"style": style})
}

func (h *Handler) GetStyle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	style, err := h.svc.GetStyle(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "style not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"style": style})
}

func (h *Handler) AutoGenerate(c *gin.Context) {
	var req struct {
		VideoID   uint   `json:"video_id" binding:"required"`
		Language  string `json:"language" binding:"required"`
		MediaPath string `json:"media_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.AutoGenerate(c.Request.Context(), req.VideoID, req.Language, req.MediaPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subtitle": sub})
}

func (h *Handler) ParseSRT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entries, err := h.svc.ParseSRT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) ParseVTT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entries, err := h.svc.ParseVTT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) ConvertSRTToVTT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	vtt, err := h.svc.GenerateVTTFromSRT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"vtt": vtt})
}

func (h *Handler) ListSubtitles(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Query("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video_id required"})
		return
	}
	subs, err := h.svc.GetSubtitlesByVideo(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitles": subs})
}
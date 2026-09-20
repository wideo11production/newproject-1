package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/thumbnail-service/src/repository"
	"newproject/services/thumbnail-service/src/service"
)

type Handler struct {
	svc *service.ThumbnailService
}

func NewHandler(svc *service.ThumbnailService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	thumbnails := r.Group("/thumbnails")
	{
		thumbnails.POST("/auto", h.GenerateAuto)
		thumbnails.POST("/custom", h.GenerateCustom)
		thumbnails.POST("/sprite", h.GenerateSprite)
		thumbnails.GET("/video/:video_id", h.GetByVideo)
		thumbnails.GET("/auto/:video_id", h.GetAutoByVideo)
		thumbnails.GET("/sprite/:video_id", h.GetSpriteByVideo)
		thumbnails.DELETE("/video/:video_id", h.DeleteByVideo)
		thumbnails.DELETE("/:id", h.DeleteOne)
	}
}

func (h *Handler) GenerateAuto(c *gin.Context) {
	var req struct {
		VideoID   uint   `json:"video_id" binding:"required"`
		MinioPath string `json:"minio_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	thumb, err := h.svc.GenerateAutoThumbnail(c.Request.Context(), req.VideoID, req.MinioPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"thumbnail": thumb})
}

func (h *Handler) GenerateCustom(c *gin.Context) {
	var req struct {
		VideoID   uint    `json:"video_id" binding:"required"`
		MinioPath string  `json:"minio_path" binding:"required"`
		Timecode  float64 `json:"timecode" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	thumb, err := h.svc.GenerateCustomThumbnail(c.Request.Context(), req.VideoID, req.MinioPath, req.Timecode)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"thumbnail": thumb})
}

func (h *Handler) GenerateSprite(c *gin.Context) {
	var req struct {
		VideoID        uint    `json:"video_id" binding:"required"`
		MinioPath      string  `json:"minio_path" binding:"required"`
		VideoDuration  float64 `json:"video_duration" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sprite, err := h.svc.GenerateSpriteSheet(c.Request.Context(), req.VideoID, req.MinioPath, req.VideoDuration)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"sprite_sheet": sprite})
}

func (h *Handler) GetByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	thumbs, err := h.svc.GetThumbnails(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"thumbnails": thumbs})
}

func (h *Handler) GetAutoByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	thumb, err := h.svc.GetAutoThumbnail(c.Request.Context(), uint(videoID))
	if err != nil {
		if err == repository.ErrThumbnailNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "thumbnail not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"thumbnail": thumb})
}

func (h *Handler) GetSpriteByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	sprite, err := h.svc.GetSpriteSheet(c.Request.Context(), uint(videoID))
	if err != nil {
		if err == repository.ErrSpriteNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "sprite sheet not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sprite_sheet": sprite})
}

func (h *Handler) DeleteByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	if err := h.svc.DeleteThumbnails(c.Request.Context(), uint(videoID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "thumbnails deleted"})
}

func (h *Handler) DeleteOne(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid thumbnail ID"})
		return
	}
	if err := h.svc.DeleteThumbnail(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/transcoding-service/src/repository"
	"newproject/services/transcoding-service/src/service"
)

type Handler struct {
	svc *service.TranscodingService
}

func NewHandler(svc *service.TranscodingService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	videos := r.Group("/videos")
	{
		videos.GET("/:id/job/status", h.GetJobStatus)
		videos.GET("/:id/qualities", h.GetQualities)
		videos.POST("/:id/transcode", h.QueueTranscode)
		videos.GET("/:id/master", h.GetMasterPlaylist)
	}

	jobs := r.Group("/jobs")
	{
		jobs.POST("/process", h.ProcessNext)
	}
}

func (h *Handler) QueueTranscode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	job, err := h.svc.QueueTranscoding(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"job": job})
}

func (h *Handler) GetJobStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	jobID, err := strconv.ParseUint(c.Query("job_id"), 10, 64)
	if err != nil {
		jobID = id
	}
	job, err := h.svc.GetJobStatus(c.Request.Context(), uint(jobID))
	if err != nil {
		if err == repository.ErrJobNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

func (h *Handler) GetQualities(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	variants, err := h.svc.GetVideoQualities(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"qualities": variants})
}

func (h *Handler) GetMasterPlaylist(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	masterPath, err := h.svc.GenerateHLSMaster(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"master_path": masterPath})
}

func (h *Handler) ProcessNext(c *gin.Context) {
	go h.svc.ProcessNext(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"message": "processing started"})
}

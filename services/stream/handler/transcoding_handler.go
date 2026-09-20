package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"newproject/services/stream/model"
	"newproject/services/stream/service"
)

// TranscodingHandler handles HTTP requests for transcoding operations
type TranscodingHandler struct {
	transcodingService *service.TranscodingService
}

// NewTranscodingHandler creates a new transcoding handler
func NewTranscodingHandler(transcodingService *service.TranscodingService) *TranscodingHandler {
	return &TranscodingHandler{transcodingService: transcodingService}
}

// SubmitJobHandler handles submitting a new transcoding job
func (h *TranscodingHandler) SubmitJobHandler(c *gin.Context) {
	var req struct {
		UploadID uuid.UUID `json:"upload_id" binding:"required"`
		// In a real implementation, we might also accept:
		// - Target resolutions
		// - Output formats
		// - Encoding presets
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Create a new transcoding job
	job := &model.TranscodeJob{
		JobID:   uuid.New(),
		UploadID: req.UploadID,
		InputPath: fmt.Sprintf("uploads/%s/master.mp4", req.UploadID), // This would come from upload service
		Status:  model.JobStatusPending,
	}

	if err := h.transcodingService.SubmitJob(c.Request.Context(), job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit job"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"job_id": job.JobID,
		"status": "submitted",
	})
}

// GetJobStatusHandler returns the status of a transcoding job
func (h *TranscodingHandler) GetJobStatusHandler(c *gin.Context) {
	jobIDStr := c.Param("job_id")

	jobID, err := uuid.Parse(jobIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job ID"})
		return
	}

	job, err := h.transcodingService.GetJobStatus(c.Request.Context(), jobID)
	if err != nil {
		switch err {
		case service.ErrJobNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get job status"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"job_id":       job.JobID,
		"upload_id":    job.UploadID,
		"status":       job.Status,
		"progress":     job.Progress,
		"current_step": job.CurrentStep,
		"created_at":   job.CreatedAt,
		"updated_at":   job.UpdatedAt,
		"started_at":   job.StartedAt,
		"completed_at": job.CompletedAt,
		"error_message": job.ErrorMessage,
	})
}

// GetJobOutputsHandler returns the outputs for a transcoding job
func (h *TranscodingHandler) GetJobOutputsHandler(c *gin.Context) {
	jobIDStr := c.Param("job_id")

	jobID, err := uuid.Parse(jobIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job ID"})
		return
	}

	outputs, err := h.transcodingService.GetJobOutputs(c.Request.Context(), jobID)
	if err != nil {
		switch err {
		case service.ErrJobNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get job outputs"})
		}
		return
	}

	// Format outputs for response
	var outputInfos []interface{}
	for _, output := range outputs {
		outputInfos = append(outputInfos, gin.H{
			"resolution":   output.Resolution,
			"format":       output.Format,
			"path":         output.Path,
			"bitrate":      output.Bitrate,
			"framerate":    output.Framerate,
			"file_size":    output.FileSize,
			"checksum":     output.Checksum,
			"created_at":   output.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"job_id":   jobID,
		"outputs":  outputInfos,
	})
}

// GetJobManifestsHandler returns the manifests for a transcoding job
func (h *TranscodingHandler) GetJobManifestsHandler(c *gin.Context) {
	jobIDStr := c.Param("job_id")

	jobID, err := uuid.Parse(jobIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job ID"})
		return
	}

	manifests, err := h.transcodingService.GetJobManifests(c.Request.Context(), jobID)
	if err != nil {
		switch err {
		case service.ErrJobNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get job manifests"})
		}
		return
	}

	// Format manifests for response
	var manifestInfos []interface{}
	for _, manifest := range manifests {
		manifestInfos = append(manifestInfos, gin.H{
			"manifest_type": manifest.ManifestType,
			"path":          manifest.Path,
			"created_at":    manifest.CreatedAt,
			"updated_at":    manifest.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"job_id":     jobID,
		"manifests":  manifestInfos,
	})
}

// CancelJobHandler cancels a transcoding job
func (h *TranscodingHandler) CancelJobHandler(c *gin.Context) {
	jobIDStr := c.Param("job_id")

	jobID, err := uuid.Parse(jobIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job ID"})
		return
	}

	// In a real implementation, we would signal the worker to stop processing this job
	// For now, we'll just mark it as cancelled in the database
	job, err := h.transcodingService.GetJobStatus(c.Request.Context(), jobID)
	if err != nil {
		switch err {
		case service.ErrJobNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get job"})
		}
		return
	}

	if job.Status == model.JobStatusCompleted || job.Status == model.JobStatusCancelled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job already completed or cancelled"})
		return
	}

	// Update job status
	job.Status = model.JobStatusCancelled
	job.UpdatedAt = time.Now()
	if err := h.transcodingService.CancelJob(c.Request.Context(), job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel job"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "job cancelled successfully",
	})
}

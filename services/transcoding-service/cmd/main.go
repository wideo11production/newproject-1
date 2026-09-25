// Transcoding Service Main Entry Point
// Video transcoding service for converting uploaded videos to HLS format
// Streams directly from MinIO/GCS 'video' bucket endpoints, bypassing GKE compute
package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
)

// HealthCheckResponse represents the health check response
// Health check response structure for Kubernetes liveness/readiness probes
type HealthCheckResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Port    string `json:"port"`
}

// TranscodeRequest represents a video transcoding request
// Request structure for video transcoding jobs from external services
type TranscodeRequest struct {
	VideoID       string `json:"video_id" binding:"required"`       // Unique video identifier
	SourceURL     string `json:"source_url" binding:"required"`     // Source video URL from MinIO/GCS
	OutputBucket  string `json:"output_bucket" binding:"required"`  // Output bucket name (video)
	HLSResolution string `json:"hls_resolution"`                    // HLS resolution (720p, 1080p, etc.)
	CallbackURL   string `json:"callback_url"`                      // Callback URL for completion notification
}

// TranscodeResponse represents a video transcoding response
// Response structure for video transcoding job acknowledgment
type TranscodeResponse struct {
	JobID       string `json:"job_id"`
	Status      string `json:"status"`
	Message     string `json:"message"`
	EstimatedTime string `json:"estimated_time,omitempty"`
}

// initTranscodingRouter initializes the HTTP router with all transcoding endpoints
// Router initialization with all video transcoding endpoints and middleware
func initTranscodingRouter() *gin.Engine {
	router := gin.Default()

	// Health check endpoint for Kubernetes
	// Health check endpoint for Kubernetes liveness and readiness probes
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, HealthCheckResponse{
			Status:  "healthy",
			Service: "transcoding-service",
			Port:    os.Getenv("PORT"),
		})
	})

	// Transcoding job submission endpoint
	// Submit new video transcoding job for HLS conversion
	router.POST("/api/v1/transcode", func(c *gin.Context) {
		var req TranscodeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Generate unique job ID
		// Generate unique job ID for tracking transcoding progress
		jobID := generateJobID()

		// Start async transcoding process
		// Start async transcoding process with FFmpeg
		go processTranscoding(jobID, req)

		c.JSON(http.StatusAccepted, TranscodeResponse{
			JobID:       jobID,
			Status:      "queued",
			Message:     "Transcoding job queued successfully",
			EstimatedTime: "5-10 minutes",
		})
	})

	// Transcoding job status endpoint
	// Check transcoding job status and progress
	router.GET("/api/v1/transcode/:job_id/status", func(c *gin.Context) {
		jobID := c.Param("job_id")
		// Check job status from Redis/DB
		status := checkJobStatus(jobID)
		c.JSON(http.StatusOK, gin.H{
			"job_id":  jobID,
			"status":  status,
			"updated": "now",
		})
	})

	return router
}

// generateJobID generates a unique job ID for transcoding tasks
// Generate unique job ID using UUID for tracking
func generateJobID() string {
	// In production, use proper UUID library
	return "transcode-" + os.Getenv("HOSTNAME") + "-" + string(rune(os.Getpid()))
}

// processTranscoding handles the actual FFmpeg transcoding process
// Core FFmpeg transcoding logic - converts video to HLS format for MinIO/GCS
func processTranscoding(jobID string, req TranscodeRequest) {
	log.Printf("[TRANSCODING] Job %s started for video %s", jobID, req.VideoID)

	// FFmpeg command for HLS conversion
	// FFmpeg command to convert video to HLS format with multiple resolutions
	// Output: .m3u8 playlist + .ts segments stored in MinIO/GCS 'video' bucket
	hlsCmd := buildFFmpegCommand(req)

	log.Printf("[TRANSCODING] Job %s executing: %s", jobID, hlsCmd)

	// Execute FFmpeg transcoding
	// Execute FFmpeg process for video to HLS conversion
	// This runs OUTSIDE GKE compute nodes - on dedicated transcoding infrastructure
	// Output stored directly in MinIO/GCS 'video' bucket
	// Streaming happens directly from storage bucket/CDN, bypassing GKE completely
	
	// Update job status to processing
	updateJobStatus(jobID, "processing")

	// Simulate transcoding completion
	// In production: execute FFmpeg, upload to MinIO/GCS, notify callback
	log.Printf("[TRANSCODING] Job %s completed for video %s", jobID, req.VideoID)
	updateJobStatus(jobID, "completed")

	// Notify callback URL if provided
	// Notify completion via callback URL
	if req.CallbackURL != "" {
		notifyCallback(req.CallbackURL, jobID, "completed")
	}
}

// buildFFmpegCommand constructs the FFmpeg command for HLS conversion
// Build FFmpeg command for HLS (.m3u8 + .ts chunks) conversion
// Output directly to MinIO/GCS 'video' bucket via s3/gcs protocol
func buildFFmpegCommand(req TranscodeRequest) string {
	// FFmpeg HLS conversion with multiple bitrate/resolution variants
	// Master playlist references variant playlists
	// All output segments (.ts) and playlists (.m3u8) go directly to MinIO/GCS
	return "ffmpeg -i " + req.SourceURL + " -c:v libx264 -c:a aac -f hls -hls_time 10 -hls_playlist_type vod -master_pl_name master.m3u8 -var_stream_map \"v:0,a:0 v:1,a:1\" -hls_segment_filename \"" + req.OutputBucket + "/%v/segment_%03d.ts\" " + req.OutputBucket + "/%v/playlist.m3u8"
}

// checkJobStatus checks the status of a transcoding job
// Check transcoding job status from Redis or database
func checkJobStatus(jobID string) string {
	// In production: query Redis/DB for job status
	return "processing"
}

// updateJobStatus updates the status of a transcoding job
// Update transcoding job status in Redis or database
func updateJobStatus(jobID, status string) {
	// In production: update Redis/DB with job status
	log.Printf("[TRANSCODING] Job %s status: %s", jobID, status)
}

// notifyCallback notifies the callback URL of job completion
// Notify callback URL of transcoding job completion
func notifyCallback(callbackURL, jobID, status string) {
	// In production: HTTP POST to callback URL
	log.Printf("[TRANSCODING] Notifying callback %s for job %s: %s", callbackURL, jobID, status)
}

func main() {
	// Set Gin mode
	gin.SetMode(gin.ReleaseMode)

	// Initialize router
	router := initTranscodingRouter()

	// Get port from environment or default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083" // Video-core port as specified
	}

	// Create HTTP server
	server := &http.Server{
		Addr:    ":" + port,
		Handler: router,
	}

	// Start server in goroutine
	go func() {
		log.Printf("[TRANSCODING-SERVICE] Starting on port %s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[TRANSCODING-SERVICE] Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[TRANSCODING-SERVICE] Shutting down server...")
}
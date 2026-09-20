package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"newproject/services/stream/client"
	"newproject/services/stream/config"
	"newproject/services/stream/handler"
	"newproject/services/stream/ffmpeg"
	"newproject/services/stream/model"
	"newproject/services/stream/repository"
	"newproject/services/stream/service"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Printf("Warning: .env file not found")
	}

	// Load configuration
	cfg, err := config.LoadConfig("config/stream.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize database
	db, err := gorm.Open(postgres.Open(cfg.Database.DSN()), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Auto migrate schema
	if err := db.AutoMigrate(
		&model.TranscodeJob{},
		&model.TranscodeOutput{},
		&model.TranscodeManifest{},
	); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Initialize repositories
	jobRepo := repository.NewTranscodeJobRepository(db)
	outputRepo := repository.NewTranscodeOutputRepository(db)
	manifestRepo := repository.NewTranscodeManifestRepository(db)

	// Initialize MinIO client
	minioClient, err := client.NewMinIOClient(&cfg.MinIO)
	if err != nil {
		log.Fatalf("Failed to initialize MinIO client: %v", err)
	}

	// Initialize FFmpeg transcoder
	var transcoder ffmpeg.Transcoder
	if cfg.Transcode.FFmpegPath != "" && cfg.Transcode.FFprobePath != "" {
		transcoder = ffmpeg.NewFFmpegTranscoder(cfg.Transcode.FFmpegPath, cfg.Transcode.FFprobePath)
	} else {
		// Use mock transcoder for development/testing
		transcoder = &ffmpeg.MockTranscoder{}
		log.Printf("Using mock FFmpeg transcoder")
	}

	// Initialize service
	transcodingService := service.NewTranscodingService(
		cfg,
		jobRepo,
		outputRepo,
		manifestRepo,
		minioClient,
		transcoder,
	)

	// Initialize handler
	transcodingHandler := handler.NewTranscodingHandler(transcodingService)

	// Set up router
	r := gin.New()

	// Global middleware
	r.Use(gin.Recovery())
	// In production, add structured logging middleware

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"service": "video-transcode",
			"timestamp": time.Now().UTC(),
		})
	})

	// Transcoding routes
	transcode := r.Group("/api/v1/transcode")
	{
		transcode.POST("/jobs", transcodingHandler.SubmitJobHandler)
		transcode.GET("/jobs/:job_id", transcodingHandler.GetJobStatusHandler)
		transcode.GET("/jobs/:job_id/outputs", transcodingHandler.GetJobOutputsHandler)
		transcode.GET("/jobs/:job_id/manifests", transcodingHandler.GetJobManifestsHandler)
		transcode.DELETE("/jobs/:job_id", transcodingHandler.CancelJobHandler)
	}

	// Start the job queue processor
	transcodingService.StartJobQueue()

	// Start server
	srv := &http.Server{
		Addr:           ":" + cfg.Server.Port,
		Handler:        r,
		ReadTimeout:    cfg.Server.ReadTimeout,
		WriteTimeout:   cfg.Server.WriteTimeout,
		MaxHeaderBytes: 1 << 20,
	}

	go func() {
		log.Printf("Starting video transcoding service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("Shutting down server...")

	// Shut down transcoding service first
	transcodingService.Shutdown()

	// The context is used to inform the server it has 5 seconds to finish
	// the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exiting")
}

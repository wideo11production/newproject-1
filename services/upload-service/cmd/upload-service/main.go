package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/upload-service/src/config"
	"newproject/services/upload-service/src/database"
	"newproject/services/upload-service/src/handler"
	"newproject/services/upload-service/src/repository"
	"newproject/services/upload-service/src/service"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := database.NewPostgresDB(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}()

	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	uploadRepo := repository.NewUploadRepository(db)
	safetyRepo := repository.NewSafetyRepository(db)

	uploadSvc, err := service.NewUploadService(service.UploadConfig{
		MinioEndpoint:  cfg.Minio.Endpoint,
		MinioAccessKey: cfg.Minio.AccessKey,
		MinioSecretKey: cfg.Minio.SecretKey,
		Bucket:         cfg.Minio.Bucket,
		ChunkSize:      cfg.Minio.GetChunkSize(),
	}, uploadRepo)
	if err != nil {
		log.Fatalf("failed to create upload service: %v", err)
	}

	// AURA Content Safety Guard: FFmpeg + ONNX open-source pipeline.
	// Disabled by default (config.content_safety.enabled) — enable in prod
	// with model file + ffmpeg/python3 on PATH.
	contentSafetyCfg := service.ContentSafetyConfig{
		Enabled:              cfg.ContentSafety.Enabled,
		FFmpegPath:           cfg.ContentSafety.FFmpegPath,
		ONNXModelPath:        cfg.ContentSafety.ONNXModelPath,
		MinConfidence:        cfg.ContentSafety.MinConfidence,
		FrameSampleRate:      cfg.ContentSafety.FrameSampleRate,
		MaxFramesToAnalyze:   cfg.ContentSafety.MaxFramesToAnalyze,
		BlacklistOnDetection: cfg.ContentSafety.BlacklistOnDetection,
	}

	var analyzer service.FrameAnalyzer
	if contentSafetyCfg.Enabled {
		analyzer = service.NewONNXFrameAnalyzer(service.DefaultONNXAnalyzerConfig(cfg.ContentSafety.ONNXModelPath))
	}

	safetySvc := service.NewContentSafetyService(safetyRepo, analyzer, contentSafetyCfg, cfg.Minio.Bucket)
	safetySvc.SetMinioClient(uploadSvc.Client())

	// Wire quota checker into upload service.
	quotaCfg := &service.DefaultQuotaConfig{
		MaxDailyUploads:      cfg.Quota.MaxDailyUploads,
		MaxFileSizeMB:        cfg.Quota.MaxFileSizeMB,
		MaxConcurrentUploads: cfg.Quota.MaxConcurrentUploads,
	}
	uploadSvc.SetQuotaChecker(quotaCfg)
	uploadSvc.SetContentSafety(safetySvc)

	h := handler.NewHandler(uploadSvc, safetyRepo)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	h.RegisterRoutes(r)

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	go func() {
		log.Printf("starting upload service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("server exiting")
}

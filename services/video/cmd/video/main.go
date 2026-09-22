// Package main provides the video service application entry point
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "time"

    "github.com/gin-gonic/gin"
    "newproject/services/video/src/config"
    "newproject/services/video/src/database"
    "newproject/services/video/src/handler"
    "newproject/services/video/src/repository"
    "newproject/services/video/src/service"
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

    // Initialize repositories
    clipRepo := repository.NewClipRepository(db)
    projectRepo := repository.NewProjectRepository(db)
    trackRepo := repository.NewTrackRepository(db)
    thumbnailRepo := repository.NewThumbnailCacheRepository(db)
    fingerprintRepo := repository.NewVideoFingerprintRepository(db)
    audioRepo := repository.NewAudioFingerprintRepository(db)
    targetRepo := repository.NewTargetRepository(db)

    // Initialize services
    videoSvc := service.NewVideoService(
        cfg,
        projectRepo,
        trackRepo,
        clipRepo,
        thumbnailRepo,
    )

    moderationSvc := service.NewModerationService(
        clipRepo,
        fingerprintRepo,
        audioRepo,
        targetRepo,
    )

    // Initialize handlers
    h := handler.NewHandler(videoSvc, moderationSvc)

    // Initialize Gin router
    r := gin.New()
    r.Use(gin.Logger())
    r.Use(gin.Recovery())

    // Register routes
    h.RegisterRoutes(r)

    // Health check endpoint
    r.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status":    "healthy",
            "service":   "video-service",
            "timestamp": time.Now().UTC().Format(time.RFC3339),
            "version":   "1.0.0",
        })
    })

    // Configure HTTP server
    srv := &http.Server{
        Addr:              ":" + cfg.Server.Port,
        Handler:           r,
        ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
    }

    // Start server in goroutine
    go func() {
        log.Printf("starting video service on %s", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("failed to start server: %v", err)
        }
    }()

    // Wait for interrupt signal
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

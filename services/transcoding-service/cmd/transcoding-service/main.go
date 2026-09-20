package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/transcoding-service/src/config"
	"newproject/services/transcoding-service/src/database"
	"newproject/services/transcoding-service/src/handler"
	"newproject/services/transcoding-service/src/repository"
	"newproject/services/transcoding-service/src/service"
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

	videoRepo := repository.NewVideoRepository(db)
	qualRepo := repository.NewQualityRepository(db)
	jobRepo := repository.NewJobRepository(db)

	qualities := make([]service.QualityProfile, len(cfg.FFmpeg.Qualities))
	for i, q := range cfg.FFmpeg.Qualities {
		qualities[i] = service.QualityProfile{
			Height:  q.Height,
			Bitrate: q.Bitrate,
			Codec:   q.Codec,
			Profile: q.Profile,
		}
	}
	if len(qualities) == 0 {
		qualities = service.DefaultQualityProfiles()
	}

	transcodeSvc := service.NewTranscodingService(service.TranscodingConfig{
		FFmpegPath:    cfg.FFmpeg.Path,
		InputDir:      cfg.FFmpeg.InputDir,
		OutputDir:     cfg.FFmpeg.OutputDir,
		Qualities:     qualities,
		MaxConcurrent: cfg.FFmpeg.MaxConcurrent,
	}, videoRepo, qualRepo, jobRepo)

	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			transcodeSvc.ProcessNext(context.Background())
		}
	}()

	h := handler.NewHandler(transcodeSvc)
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
		log.Printf("starting transcoding service on %s", srv.Addr)
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

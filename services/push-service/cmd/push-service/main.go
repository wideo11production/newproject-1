package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/push-service/src/config"
	"newproject/services/push-service/src/database"
	"newproject/services/push-service/src/handler"
	natsconsumer "newproject/services/push-service/src/nats"
	"newproject/services/push-service/src/repository"
	"newproject/services/push-service/src/service"
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

	subRepo := repository.NewSubscriptionRepository(db)
	msgRepo := repository.NewMessageRepository(db)

	pushService, err := service.NewPushService(
		subRepo,
		msgRepo,
		cfg.VAPID.PrivateKey,
		cfg.VAPID.PublicKey,
		cfg.VAPID.Subject,
		cfg.RateLimit.MaxRetries,
		cfg.RateLimit.BatchSize,
		cfg.RateLimit.Interval,
	)
	if err != nil {
		log.Fatalf("failed to create push service: %v", err)
	}

	h := handler.NewHandler(pushService)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	h.RegisterRoutes(r)

	natsConsumer, err := natsconsumer.NewConsumer(cfg.NATS, pushService)
	if err != nil {
		log.Fatalf("failed to create NATS consumer: %v", err)
	}

	ctx, stop := context.WithCancel(context.Background())
	defer stop()

	if err := natsConsumer.Start(ctx); err != nil {
		log.Fatalf("failed to start NATS consumer: %v", err)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	go func() {
		log.Printf("starting push service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("shutting down server...")

	stop()
	natsConsumer.Close()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("server exiting")
}

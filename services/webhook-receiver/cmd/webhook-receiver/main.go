package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"

	"github.com/wideo11/webhook-receiver/internal/config"
	"github.com/wideo11/webhook-receiver/internal/database"
	"github.com/wideo11/webhook-receiver/internal/handler"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Failed to load configuration", zap.Error(err))
	}

	db, err := database.Connect(cfg.Database)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}

	if err := database.Migrate(db); err != nil {
		logger.Fatal("Failed to run migrations", zap.Error(err))
	}

	webhookHandler := handler.NewWebhookHandler(db, logger, cfg.DashboardServiceURL, cfg.InternalServiceSecret)

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(handler.LoggerMiddleware(logger))
	router.Use(handler.CORSMiddleware())

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "webhook-receiver"})
	})

	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	v1 := router.Group("/api/v1")
	{
		v1.POST("/webhooks/alertmanager", webhookHandler.ReceiveAlertManager)
		v1.POST("/webhooks/prometheus", webhookHandler.ReceivePrometheus)
		v1.POST("/webhooks/custom", webhookHandler.ReceiveCustom)

		v1.GET("/alerts", webhookHandler.ListAlerts)
		v1.GET("/alerts/:id", webhookHandler.GetAlert)
		v1.GET("/webhooks/events", webhookHandler.ListWebhookEvents)
	}

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: router,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		logger.Info("Shutting down server...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("Server forced to shutdown", zap.Error(err))
		}
	}()

	logger.Info("Starting webhook-receiver", zap.Int("port", cfg.Port))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("Failed to start server", zap.Error(err))
	}
	logger.Info("Server exited")
}
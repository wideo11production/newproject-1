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

	"github.com/wideo11/dashboard-service/internal/config"
	"github.com/wideo11/dashboard-service/internal/database"
	"github.com/wideo11/dashboard-service/internal/handler"
)

func main() {
	// Initialize logger
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Failed to load configuration", zap.Error(err))
	}

	// Initialize database
	db, err := database.Connect(cfg.Database)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}

	// Run migrations
	if err := database.Migrate(db); err != nil {
		logger.Fatal("Failed to run migrations", zap.Error(err))
	}

	// Initialize handlers
	dashboardHandler := handler.NewDashboardHandler(db, logger, cfg.PrometheusURL)
	websocketHandler := handler.NewWebSocketHandler(db, logger)

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	// ---- Middleware chain ----
	//
	// `handler.RecoveryMiddleware()` REPLACES gin.Recovery():
	// same panic containment, but the response is JSON (the
	// contract every other error path in this service uses)
	// instead of gin's default HTML 500. It sat in
	// `internal/handler` defined-but-never-registered - a
	// safety net that was never wired to the router.
	//
	// `handler.ErrorMiddleware(logger)` turns `c.Error(...)`
	// calls from the handler chain into logged, uniform 500
	// JSON. It was also defined-but-never-registered, so
	// handler errors escaped as bare 500s with no log line.
	//
	// Order matters: Recovery outermost (catches panics from
	// everything below it), then Logger (so it logs the FINAL
	// status code, including the 500 ErrorMiddleware writes),
	// then Error, then CORS (its headers must already be set
	// before any error response is written).
	router.Use(handler.RecoveryMiddleware())
	router.Use(handler.LoggerMiddleware(logger))
	router.Use(handler.ErrorMiddleware(logger))
	router.Use(handler.CORSMiddleware())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "dashboard-service"})
	})

	// Metrics endpoint
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		// Dashboard CRUD
		v1.GET("/dashboards", dashboardHandler.ListDashboards)
		v1.POST("/dashboards", dashboardHandler.CreateDashboard)
		v1.GET("/dashboards/:id", dashboardHandler.GetDashboard)
		v1.PUT("/dashboards/:id", dashboardHandler.UpdateDashboard)
		v1.DELETE("/dashboards/:id", dashboardHandler.DeleteDashboard)
		v1.GET("/dashboards/:id/versions", dashboardHandler.ListVersions)
		v1.POST("/dashboards/:id/fork", dashboardHandler.ForkDashboard)
		v1.POST("/dashboards/import", dashboardHandler.ImportDashboard)
		v1.GET("/dashboards/:id/export", dashboardHandler.ExportDashboard)

		// Panel data proxy
		v1.POST("/dashboards/:id/query", dashboardHandler.QueryPanelData)
		v1.GET("/dashboards/:id/query_range", dashboardHandler.QueryRange)

		// WebSocket for real-time updates
		v1.GET("/ws", websocketHandler.HandleWebSocket)
		// Service-to-service alert forwarder (guarded by INTERNAL_SERVICE_SECRET).
		// `webhook-receiver` POSTs each AlertManager/Prometheus alert here so it
		// fans out to every browser over the WS bus as `alert_update`.
		v1.POST("/internal/alerts/broadcast", func(c *gin.Context) {
			websocketHandler.BroadcastAlert(c, cfg.InternalServiceSecret)
		})

		// Dashboard preferences
		v1.GET("/preferences", dashboardHandler.GetPreferences)
		v1.PUT("/preferences", dashboardHandler.UpdatePreferences)

		// Favorites
		v1.GET("/favorites", dashboardHandler.ListFavorites)
		v1.POST("/favorites", dashboardHandler.AddFavorite)
		v1.DELETE("/favorites/:id", dashboardHandler.RemoveFavorite)
	}

	// Start server
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: router,
	}

	// Graceful shutdown
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

	logger.Info("Starting dashboard-service", zap.Int("port", cfg.Port))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("Failed to start server", zap.Error(err))
	}
	logger.Info("Server exited")
}
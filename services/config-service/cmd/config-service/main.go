package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"services/config-service/internal/config"
	"services/config-service/internal/database"
	"services/config-service/internal/handler"
	"services/config-service/internal/middleware"
	"services/config-service/internal/repository"
	"services/config-service/internal/service"
)

func main() {
	// Initialize logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Load configuration
	cfg := config.Load()

	// Initialize database
	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	// Initialize Redis
	redisClient, err := database.NewRedis(cfg.RedisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to Redis")
	}
	defer redisClient.Close()

	// Initialize NATS
	natsConn, err := database.NewNATS(cfg.NATSURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to NATS")
	}
	defer natsConn.Close()

	// Initialize repositories
	configRepo := repository.NewConfigRepository(db)

	// Initialize services
	configService := service.NewConfigService(configRepo, redisClient, natsConn)

	// Initialize handlers
	configHandler := handler.NewConfigHandler(configService)

	// Setup Gin router
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(middleware.Logger())
	router.Use(middleware.Recovery())
	router.Use(middleware.CORS())
	router.Use(middleware.Metrics())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "healthy",
			"service":   "config-service",
			"version":   cfg.Version,
			"timestamp": time.Now().Unix(),
		})
	})

	// Metrics
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := router.Group("/api/v1")
	{
		// Config routes
		configs := api.Group("/configs")
		{
			configs.GET("", configHandler.List)
			configs.POST("", configHandler.Create)
			configs.GET("/:key", configHandler.Get)
			configs.PUT("/:key", configHandler.Update)
			configs.DELETE("/:key", configHandler.Delete)
			configs.GET("/:key/history", configHandler.History)
		}

		// Watch endpoint for real-time updates
		api.GET("/watch", configHandler.Watch)
	}

	// Start server
	serverAddr := ":" + cfg.Port
	log.Info().Str("addr", serverAddr).Msg("Starting config service")

	go func() {
		if err := router.Run(serverAddr); err != nil {
			log.Fatal().Err(err).Msg("Failed to start server")
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db.Close()

	<-ctx.Done()
	log.Info().Msg("Server exited")
}
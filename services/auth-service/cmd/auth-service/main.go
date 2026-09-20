package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/handler"
	"github.com/wideo11/auth-service/internal/middleware"
	"github.com/wideo11/auth-service/internal/repository"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
	"github.com/wideo11/auth-service/internal/password"
)

func main() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Printf("Warning: .env file not found")
	}

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Set gin mode
	gin.SetMode(cfg.Server.Mode)

	// Initialize database
	db, err := database.NewPostgresDB(&cfg.Database)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Auto migrate database schema
	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Initialize repositories
	userRepo := repository.NewUserRepository(db)
	sessionRepo := repository.NewSessionRepository(db)
	deviceRepo := repository.NewDeviceRepository(db)
	pinRepo := repository.NewPINRepository(db)
	tokenRepo := repository.NewRefreshTokenRepository(db)

	// Initialize services
	passwordService := password.NewPasswordService(cfg.Server.BcryptCost)
	tokenService := token.NewTokenService(&cfg.JWT)
	authService := service.NewAuthService(cfg, userRepo, sessionRepo, deviceRepo, pinRepo, tokenRepo, tokenService, passwordService)

	// Initialize handler
	authHandler := handler.NewAuthHandler(authService)

	// Set up router
	r := gin.New()

	// Global middleware
	r.Use(gin.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"service": "auth-service",
			"timestamp": time.Now().UTC(),
		})
	})

	// Auth routes
	auth := r.Group("/api/v1/auth")
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
		auth.POST("/refresh", authHandler.RefreshToken)
		auth.POST("/logout", authHandler.AuthMiddleware(), authHandler.Logout)
		
		// Protected routes
		protected := auth.Group("")
		protected.Use(authHandler.AuthMiddleware())
		{
			protected.GET("/profile", authHandler.GetProfile)
			protected.POST("/pin/setup", authHandler.SetupPIN)
			protected.POST("/pin/verify", authHandler.VerifyPIN)
		}
	}

	// Start server
	srv := &http := &http.Server{
		Addr:           ":" + cfg.Server.Port,
		Handler:        r,
		ReadTimeout:    time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout:   time.Duration(cfg.Server.WriteTimeout) * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	go func() {
		log.Printf("Starting auth-service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// The context is used to inform the server it has 5 seconds to finish
	// the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exiting")
}
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/newproject/services/settings/src/config"
	"github.com/newproject/services/settings/src/database"
	"github.com/newproject/services/settings/src/handler"
	"github.com/newproject/services/settings/src/repository"
	"github.com/newproject/services/settings/src/service"
)

// main entry point for the settings service
func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Initialize database connection
	db, err := database.NewPostgresDB(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	}()

	// Auto migrate the database schema
	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	// Initialize repositories
	settingRepo := repository.NewSettingRepository(db)

	// Initialize service
	settingService := service.NewSettingService(settingRepo)

	// Initialize handler
	h := handler.NewHandler(settingService)
	r := gin.New()
	// Use Gin's built-in logger and recovery middleware
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	// Register routes
	h.RegisterRoutes(r)

	// Create HTTP server
	srv := &http.Server{
		Addr:    ":" + cfg.Server.Port,
		Handler: r,
		// Good practice: set timeouts to avoid Slowloris attacks.
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	// Run server in a goroutine so that we can gracefully shutdown
	go func() {
		log.Printf("starting settings service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("shutting down server...")

	// The context is used to inform the server it has 5 seconds to finish
	// the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("server exiting")
}
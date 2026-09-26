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
	"github.com/wideo11/auth-service/internal/email"
	"github.com/wideo11/auth-service/internal/handler"
	"github.com/wideo11/auth-service/internal/middleware"
	"github.com/wideo11/auth-service/internal/purge"
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
	// Verification token repository - 30 minute purge lifecycle ke liye
	verifRepo := repository.NewVerificationTokenRepository(db)
	// Purge repository - unverified accounts permanently delete karne ke liye
	purgeRepo := repository.NewPurgeRepository(db)

	// Initialize services
	passwordService := password.NewPasswordService(cfg.Server.BcryptCost)
	tokenService := token.NewTokenService(&cfg.JWT)
	authService := service.NewAuthService(cfg, userRepo, sessionRepo, deviceRepo, pinRepo, tokenRepo, tokenService, passwordService)

	// Verification repositories inject karo (dependency injection - constructor nahi badla)
	authService.SetVerificationRepo(verifRepo)

	// Email dispatcher - SMTP config set ho to real email, warna console log
	// Koi paid provider nahi: local dev me console, production me apna SMTP
	emailDispatcher := email.NewDispatcher(&cfg.Email)
	authService.SetEmailer(emailDispatcher)

	// 30-minute purge worker start karo (background Go worker, koi paid cron nahi)
	// Hinglish: unverified accounts 30 minute baad permanently purge honge
	purgeWorker := purge.NewWorker(cfg, purgeRepo, verifRepo, emailDispatcher)
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	defer cancelWorker()
	purgeWorker.Start(workerCtx)

	// WebAuthn (biometric/passkey) service initialize karo
	// RP ID aur origins .env se aati hain - browser se match karne ke liye zaroori
	webAuthnSvc, err := service.NewWebAuthnService(db, cfg)
	if err != nil {
		// WebAuthn fail ho jaye to service crash nahi hoga - sirf biometrics
		// available nahi hongi. Password login chalta rahega.
		log.Printf("Warning: WebAuthn disabled (%v)", err)
	} else {
		log.Printf("[WEBAUTHN] Enabled | RPID=%s | Origins=%s",
			cfg.WebAuthn.RPID, cfg.WebAuthn.RPOrigins)
	}

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
		// Verification link click handler - GET se call hota hai
		auth.GET("/verify", authHandler.VerifyEmail)
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

	// WebAuthn (biometric/passkey) routes
	// Sirf tab register karte hain jab WebAuthn service successfully init hua ho
	if webAuthnSvc != nil {
		waHandler := handler.NewWebAuthnHandler(webAuthnSvc)

		// Registration flow (device enroll) - authenticated user hi kar sakta hai
		waProtected := auth.Group("/webauthn")
		waProtected.Use(authHandler.AuthMiddleware())
		{
			waProtected.POST("/register/begin", waHandler.BeginRegistration)
			waProtected.POST("/register/finish", waHandler.FinishRegistration)
			waProtected.GET("/credentials", waHandler.ListCredentials)
			waProtected.DELETE("/credentials/:id", waHandler.DeleteCredential)
		}

		// Authentication flow (login with fingerprint/face)
		// Ye UNAUTHENTICATED hota hai - kyunki yahi to prove karta hai ki user kaun hai
		waPublic := auth.Group("/webauthn")
		{
			waPublic.POST("/login/begin", waHandler.BeginAuthentication)
			waPublic.POST("/login/finish", waHandler.FinishAuthentication)
		}
	}

	// Start server
	srv := &http.Server{
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
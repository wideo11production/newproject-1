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
	"github.com/wideo11/auth-service/internal/bootstrap"
	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/database"
	"github.com/wideo11/auth-service/internal/email"
	"github.com/wideo11/auth-service/internal/handler"
	"github.com/wideo11/auth-service/internal/middleware"
	"github.com/wideo11/auth-service/internal/password"
	"github.com/wideo11/auth-service/internal/purge"
	"github.com/wideo11/auth-service/internal/repository"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
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

	// Master root (superadmin) account ensure karo
	// Password bcrypt HASH ke roop me hai (plaintext nahi) + env override
	// supported. Har startup par account ka existence aur hash integrity check
	// hota hai - koi staff manually change kare to SECURITY NOTICE log hota hai.
	// Hinglish: superadmin account hamesha active rehta hai, tampering detect hota hai
	if bootResult, bootErr := bootstrap.EnsureSuperadmin(context.Background(), db); bootErr != nil {
		log.Printf("[SUPERADMIN] bootstrap warning: %v", bootErr)
	} else {
		if bootResult.Created {
			log.Println("[SUPERADMIN] Master root account created successfully")
		}
		if bootResult.Warning != "" {
			log.Printf("[SUPERADMIN] %s", bootResult.Warning)
		}

		// ---- Master root ko superadmin_accounts me register karo ----
		//
		// CRITICAL FIX: ye step pehle MISSING tha. `users` table me row to banti thi,
		// lekin `superadmin_accounts` me nahi - jisse RequireSuperadminMiddleware()
		// main superadmin ko 403 deny kar raha tha (sirf recovery accounts pass hote the).
		// Ab master root bhi role gate se pass hota hai.
		if err := bootstrap.RegisterMasterSuperadminRole(context.Background(), db); err != nil {
			log.Printf("[SUPERADMIN] Failed to register master root role: %v", err)
		} else {
			log.Println("[SUPERADMIN] Master root registered with superadmin role")
		}
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
	// Creator dashboard operations (channels, avatar, sessions) raw GORM handle
	// use karte hain - repositories sirf `users`/`sessions` ka narrow surface
	// cover karti hain, nayi entities (channels) ke liye direct db chahiye.
	authService.SetDB(db)

	// Email dispatcher - SMTP config set ho to real email, warna console log
	// Koi paid provider nahi: local dev me console, production me apna SMTP
	emailDispatcher := email.NewDispatcher(&cfg.Email)
	authService.SetEmailer(emailDispatcher)

	// ---- BACKGROUND EMAIL QUEUE ----
	// Ye verification email ko request se DETACH karta hai, taaki registration
	// ~5 second na ruke. Gmail ka SMTP handshake slow hai; pehle wo request
	// ke andar SYNCHRONOUS chalta tha, jiski wajah se user ka button 5 second
	// disabled rehta tha.
	//
	// NOTE: ye `email.Dispatcher` (console-vs-smtp choose karta hai) ko hi
	// sender ke roop me use karta hai - alag SMTP connection nahi banata.
	emailQueue := email.NewEmailQueue(emailDispatcher, 256)
	emailQueue.Start()
	// Shutdown par queue drain karo, taaki restart par emails drop na hon.
	defer emailQueue.Close()

	// Service ko queue ke saath wire karo. Ye `emailDispatcher` ko REPLACE
	// nahi karta - wo `*email.Dispatcher` hi rehta hai (jo
	// `SendVerificationEmail` implement karta hai). Service type-assertion se
	// `QueueVerificationEmail` method dhoondhta hai; jo mil gaya to queue use
	// karta hai, warna synchronous path.
	authService.SetEmailQueue(emailQueue)

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

	// Security service - lockout engine, PIN, questions, device limits
	securitySvc := service.NewSecurityService(db)
	securityHandler := handler.NewSecurityHandler(securitySvc, authService)

	// Superadmin service - recovery accounts, device lock, session tracking
	superadminSvc := service.NewSuperadminService(db)
	superadminHandler := handler.NewSuperadminHandler(superadminSvc, authService)

	// 2 RECOVERY accounts ensure karo (agar .env me configured hain)
	// Taaki main superadmin fail hone par bhi access mil sake
	if err := superadminSvc.EnsureRecoveryAccounts(context.Background()); err != nil {
		log.Printf("[RECOVERY] bootstrap warning: %v", err)
	} else {
		log.Println("[RECOVERY] Recovery accounts ready")
	}

	// Initialize handler
	authHandler := handler.NewAuthHandler(authService)
	// AuthHandler ko security service inject karo
	// (login me 3-failed-password lockout enforce karne ke liye zaroori hai)
	// NOTE: ye authHandler BANNE KE BAAD hona chahiye - pehle undefined error aata tha
	authHandler.SetSecurityService(securitySvc)

	// Set up router
	r := gin.New()

	// Global middleware
	r.Use(gin.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"service":   "auth-service",
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
		// Resend verification email - naya token + naya email.
		// PRE-auth hai (user abhi login nahi kar sakta, email hi uska proof
		// hai). Handler email enumeration nahi karta - har case me same 200.
		// Purana token automatically delete hota hai (IssueVerificationToken
		// ke andar DeleteByUserID hai), to "resend par purana token hat jaye"
		// requirement bina extra code ke satisfy hoti hai.
		auth.POST("/resend-verification", authHandler.ResendVerification)
		auth.POST("/refresh", authHandler.RefreshToken)
		auth.POST("/logout", authHandler.AuthMiddleware(), authHandler.Logout)
		// ---- Creator dashboard: active devices ----
		// "Aap kis device par logged in hain" - token se user_id lekar
		// scoped query chalata hai (cross-user leak nahi).
		auth.GET("/sessions", authHandler.AuthMiddleware(), authHandler.ListMySessions)

		// Protected routes
		protected := auth.Group("")
		protected.Use(authHandler.AuthMiddleware())
		{
			protected.GET("/profile", authHandler.GetProfile)
			protected.GET("/pin/setup", authHandler.SetupPIN)
			protected.POST("/pin/verify", authHandler.VerifyPIN)

			// ---- Creator dashboard endpoints (migration 005) ----
			// Sab token-derived user_id par scoped hain.
			protected.GET("/channels", authHandler.ListChannels)
			protected.POST("/channels", authHandler.CreateChannel)
			protected.PATCH("/profile", authHandler.UpdateProfile)
			// Profile GET v2 - avatar_url ke saath (purana `GetProfile`
			// fields ka subset return karta hai, isliye naya endpoint).
			protected.GET("/profile/full", authHandler.GetProfileV2)
		}
	}

	// Security routes - PIN, questions, biometric, audit
	// NOTE: security/status authenticated ho sakta hai (login ke baad hi
	// pata chalta hai), baaki endpoints protected hain.
	secGroup := auth.Group("/security")
	{
		// Public: lockout status check (login screen ke liye)
		secGroup.GET("/lockout-status", securityHandler.LockoutStatus)
		// Public: PIN verify (lockout recovery - login ke andar)
		secGroup.POST("/pin/verify", securityHandler.VerifyPIN)
		// Public: available questions catalogue
		secGroup.GET("/questions/available", securityHandler.AvailableQuestions)
	}

	// Protected security endpoints - token chahiye
	secProtected := auth.Group("/security")
	secProtected.Use(authHandler.AuthMiddleware())
	{
		secProtected.GET("/setup-status", securityHandler.SetupStatus)
		secProtected.POST("/pin", securityHandler.SetPIN)
		secProtected.PUT("/pin", securityHandler.ChangePIN)
		secProtected.PUT("/questions", securityHandler.SetSecurityQuestions)
		secProtected.POST("/biometric/complete", securityHandler.MarkBiometric)
		secProtected.GET("/events", securityHandler.SecurityEvents)
	}

	// Superadmin routes - awareness, sessions, device lock, test cleanup
	// NOTE: superadminHandler ke apne requireSuperadmin middleware hai jo
	// har endpoint pe role check karta hai (superadmin ya recovery)
	superadminHandler.RegisterRoutes(auth, authHandler.AuthMiddleware())

	// Click tracking service - persistent history + 30-day retention
	clickSvc := service.NewClickService(db)
	clickHandler := handler.NewClickHandler(clickSvc)
	// Recording public hai, list/stats/purge superadmin-only
	clickHandler.RegisterRoutes(auth, authHandler.AuthMiddleware(), superadminHandler.RequireSuperadminMiddleware())

	// 30-day retention worker - background me chalta hai
	clickSvc.StartClickRetentionWorker(context.Background())

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

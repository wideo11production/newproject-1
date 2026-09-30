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
	"github.com/wideo11/auth-service/internal/natsx"
	"github.com/wideo11/auth-service/internal/password"
	"github.com/wideo11/auth-service/internal/purge"
	"github.com/wideo11/auth-service/internal/redisx"
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

	// ---- VERIFICATION BASE URL VALIDATION (Phase A / gap #5) ----
	//
	// Ye startup par ek baar chalti hai, aur `localhost` wale config ko
	// BOLDLY flag karti hai. Pehle ye problem bilkul silent thi: koi error
	// nahi, koi log nahi, bas ek link jo phone par DEAD tha. Ab operator ko
	// `docker compose logs auth-service` se turant dikh jayega, users ko
	// 2-3 signup chhodne se pehle.
	//
	// NOTE: ye FATAL nahi hai - local dev me `localhost` bilkul sahi hai.
	// Sirf tab hard-fail karte hain jab ye config `release` mode me ho, yaani
	// production me. Local dev me warning kaafi hai.
	if reach := authService.CheckVerificationReachability(); reach.Fatal {
		if cfg.Server.Mode == "release" {
			// Production me ye band karne layak nahi hai - par service ko
			// crash karne se bhi behtar hai ki wo chalu rahe aur log me
			// clearly bataye. `log.Fatalf` se container crash-loop hoga aur
			// operator ko sirf "exit 1" dikhega, iske bajaye exact fix
			// instruction log me print hoti hai.
			log.Printf("[VERIFY][BLOCKER] %s", reach.Message)
			log.Printf("[VERIFY][BLOCKER] Server is running in RELEASE mode with an " +
				"unreachable verification base URL. Signup from any device other than " +
				"this one will be broken until VERIFICATION_BASE_URL is fixed.")
		} else {
			log.Printf("[VERIFY][WARN] %s", reach.Message)
		}
	} else if reach.Message != "" {
		log.Printf("[VERIFY][OK] %s", reach.Message)
	}

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

	// =========================================================================
	// REDIS - rate limiting + JWT revocation denylist
	// =========================================================================
	//
	// Ye DEGRADE karte hue start hote hain, crash nahi karte. Rationale:
	// Redis ek cache hai, ek source of truth nahi. Agar Redis down hone par
	// auth crash karta, to ek cache outage poore auth ko le jata - jo
	// brute-force se bada nuksaan hai.
	//
	// Redis down hone par jo kya hota hai:
	//   - rate limiter ALLOW karta hai (fail open) - attack possible, logged
	//   - denylist check DB wale session check par gir jata hai - correct
	// dono degraded paths documented hain respective files me.
	var redisClient *redisx.Client
	if rc, rErr := redisx.New(cfg.Redis); rErr != nil {
		log.Printf("[RATELIMIT] Redis unavailable (%v) - rate limiting DEGRADED, "+
			"brute-force protection is not enforced until Redis recovers", rErr)
	} else {
		redisClient = rc
		log.Println("[RATELIMIT] Redis connected - rate limiting active")
	}
	if redisClient != nil {
		defer redisClient.Close()
	}

	// =========================================================================
	// NATS JetStream - security event audit stream
	// =========================================================================
	//
	// Same degrade policy: NATS down hone par sirf audit trail chali jaati
	// hai, security enforcement nahi. Isiliye ye bhi non-fatal hai.
	var natsPub *natsx.Publisher
	if np, nErr := natsx.Connect(cfg.NATS.URL); nErr != nil {
		log.Printf("[AUDIT] NATS unavailable (%v) - security events will not be "+
			"streamed (rate limiting itself is unaffected)", nErr)
	} else {
		natsPub = np
		log.Println("[AUDIT] NATS JetStream connected - rate limit events will stream")
	}
	if natsPub != nil {
		defer natsPub.Close()
	}

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

	// ---- Global middleware (ORDER MATTERS) ----
	//
	// 1. SecurityHeaders PEHLE - taaki baaki handlers in headers ko
	//    overwrite na kar sakein, aur har response (including errors) pe
	//    protection mile.
	// 2. NoStore - auth API ke responses cache nahi hone chahiye (PII).
	// 3. Recovery - panic catch (headers already set ho chuke hain, to
	//    500 response pe bhi security headers rahenge).
	// 4. Logger - request log.
	// 5. CORS - origin check (config allowlist se).
	securityCfg := middleware.DefaultSecurityHeadersConfig()
	securityCfg.HSTSMaxAge = cfg.Security.HSTSMaxAge
	securityCfg.HSTSIncludeSubdomains = cfg.Security.HSTSIncludeSubdomains
	if cfg.Security.CSP != "" {
		securityCfg.CSP = cfg.Security.CSP
	}
	if cfg.Security.ReferrerPolicy != "" {
		securityCfg.ReferrerPolicy = cfg.Security.ReferrerPolicy
	}
	if cfg.Security.FrameOptions != "" {
		securityCfg.FrameOptions = cfg.Security.FrameOptions
	}
	if cfg.Security.PermissionsPolicy != "" {
		securityCfg.PermissionsPolicy = cfg.Security.PermissionsPolicy
	}

	r.Use(middleware.SecurityHeaders(securityCfg))
	r.Use(middleware.NoStore())
	r.Use(gin.Recovery())
	r.Use(middleware.Logger())
	// ---- Phase C7: revocation store ----
	// RevocationStore ek hi Redis client use karta hai jo rate limiter
	// use karta hai (edisx.Client ka doc comment hi yeh kehta hai).
	// Alag pool isliye NAHI banaya: rate limiting aur revocation ke
	// failure requirements ULAT hain - limiter ke bursts ki starvation
	// revocation checks ko slow karti hai, jo theek nahi lagta kuch alag
	// fault hai.
	// Nil ho sakta hai (Redis down par boot). Chain us case me
	// CheckRevoked se guzar jata hai - degrade, crash nahi.
	revocationStore := middleware.NewRevocationStore(redisClient)
	if revocationStore != nil {
		// Service layer ko bhi chahiye: logout ke andar Redis entry likhni hoti
		// hai. Ye interface ke through jaata hai, concrete Redis client ke
		// through nahi - test me stub daal kar logout Redis ke bina test ho
		// sakta hai.
		authService.SetRevocationStore(revocationStore)
	}

	r.Use(middleware.NewCORS(middleware.CorsConfig{
		AllowedOrigins:   cfg.Security.GetAllowedOrigins(),
		AllowCredentials: cfg.Security.AllowCredentials,
	}))

	// ---- Rate limit body capture ----
	//
	// ORDER MATTERS: ye `BodyEmailCapture` hai, `RateLimit` se PEHLE. Ye login
	// body se email nikaal ke gin context me rakh deta hai taki rate limiter
	// account-par key kar sake, aur body ko original bytes ke saath wapas
	// de deta hai. Agar order ulta hua to handler ko empty body milti aur
	// EVERY login fail ho jati.
	//
	// Ye sab routes par lagta hai, par sirf /login, /register, /refresh ke liye
	// body padhta hai - baaki har request ke liye buffer karna waste hoga.
	r.Use(middleware.BodyEmailCapture())

	// ---- Audit sink ----
	//
	// Rate limiter ko ye chahiye taki blocked attempts NATS JetStream par
	// stream ho sakein. Nil sink bhi safe hai (events drop ho jaate hain),
	// isliye ye tab bhi lagta hai jab NATS connect nahi hua.
	if natsPub != nil {
		r.Use(middleware.WithRateLimitAudit(middleware.NewRateLimitAuditSink(natsPub)))
	}

	// Startup par ek baar log karo ki CORS allowlist kya hai - galat config
	// hone par "login hi nahi ho raha" wali aadat ki bug aasan hoti hai, aur
	// logs me clear reason hona chahiye.
	log.Printf("[SECURITY] CORS origins=%v credentials=%v | HSTS max-age=%ds | X-Frame-Options=%s",
		cfg.Security.GetAllowedOrigins(),
		cfg.Security.AllowCredentials,
		securityCfg.HSTSMaxAge,
		securityCfg.FrameOptions,
	)

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
		// =====================================================================
		// RATE LIMITED ROUTES
		// =====================================================================
		//
		// ---- YE PEHLE BINARY KISI NE NAHI LIMIT KIYA THA ----
		//
		// Pehle auth-service par KOI rate limiting nahi thi. Sirf ek limiter
		// thi - `apps/web/src/lib/rate-limiter.ts` - jo Next.js ki process
		// memory me chalti thi. Do wajah se wo ASLI protection nahi thi:
		//
		//   1. BYPASSABLE. `auth-service` ka port 8085 host pe published hai.
		//      Verify kiya gaya: seedhe 6 login attempts -> 6x HTTP 400, zero
		//      429. Matlab unlimited password guessing.
		//   2. RESTART-RESET. Next.js restart saare counters wipe kar deta tha.
		//   3. PER-REPLICA. Do Next.js instances = double the documented limit.
		//
		// ---- 4 POLICIES, 3 KEYS ----
		//
		// Sirf IP-based limiting credential stuffing me KAMZOR hai: attacker
		// 500 IPs rotate karke ek hi account par guess karta hai, har IP apni
		// limit ke andar rehta hai. Isliye teen alag keys chalti hain:
		//
		//   login           8/min    per IP+email pair   (narrow, jaldi)
		//   login_sustained 30/15min per IP+email pair   (total cap)
		//   login_account   10/15min per EMAIL only     <- ASLI protection
		//   login_ip        20/5min   per IP only        <- password spray
		//
		// `login_account` me IP hai hi nahi - IP rotate karne se koi nahi
		// bach sakta. Ye wo rule hai jo brute force rokta hai.
		//
		// ---- WHY 4 POLICIES ON ONE ROUTE ----
		//
		// Kyunki ek limit ek dimension cover karti hai. 8/min per pair se
		// distributed attack nahi rukta (har pair alag), aur 10/15min per
		// account se legitimate user jisne 3 baar galat password type kiya
		// wo nahi rukta. Saare lagane se dono attack shapes cover hote hain
		// bina legit use ko hurt kiye.
		auth.POST("/login",
			middleware.RateLimit(redisClient,
				middleware.LimitLogin,
				middleware.LimitLoginSustained,
				middleware.LimitLoginPerAccount,
				middleware.LimitLoginPerIP,
			),
			authHandler.Login)

		// Registration: 3 per 5 min per IP. Bulk signup rokta hai.
		auth.POST("/register",
			middleware.RateLimit(redisClient, middleware.LimitRegister),
			authHandler.Register)

		// Verification resend: 10 per 5 min. Email-bombing aur sender
		// reputation damage rokta hai.
		auth.POST("/resend-verification",
			middleware.RateLimit(redisClient, middleware.LimitVerify),
			authHandler.ResendVerification)

		// Refresh: token exchange. Generous - legitimate clients refresh
		// routinely, aur is route par tight limit refresh loop me user ko
		// logout kar sakta hai.
		auth.POST("/refresh",
			middleware.RateLimit(redisClient, middleware.LimitLoginSustained),
			authHandler.RefreshToken)

		// PIN verify PUBLIC hai (login ke andar, lockout recovery) - isiliye
		// ye PIN brute-force ka ek aur darwaza hai. Isko rate limit karna
		// zaroori hai, warna 4-digit PIN guess karna possible ho jayega.
		// NOTE: ye route neeche `secGroup` me bhi hai; wahi registration
		// authoritative hai. Yahan duplicate register karna Next me panic
		// deta hai, isliye yahan nahi kiya - neeche limit ke saath
		// register hota hai.

		// Verification link click handler - GET se call hota hai
		auth.GET("/verify", authHandler.VerifyEmail)
		// Settings META public hai - login page bhi theme/language read karta
		// hai, aur user logged-out ho tab bhi options dikhne chahiye.
		auth.GET("/settings/meta", authHandler.GetSettingsMeta)
		// NOTE: `/resend-verification` upar rate-limit ke saath register hota
		// hai. Yahan dobara register karne se gin panic karta tha:
		//   panic: handlers are already registered for path
		//   '/api/v1/auth/resend-verification'
		// Logout + AuthMiddleware + CheckRevoked.
		//
		// TEENO lagane ka order matter karta hai:
		//   AuthMiddleware   - signature verify + `sessions` me token hash
		//                      dhoondta hai aur `session_id` context me
		//                      daalta hai
		//   CheckRevoked     - usi `session_id` ko Redis se check karta hai
		//
		// Order ulta hua to CheckRevoked ko `session_id` hi nahi milta
		// (context verify hone se pehle khali hota hai) aur wo HAR request
		// par chupchap pass ho jata - matlab mounted hone ke bawajood kuch
		// nahi hota. Ye wahi class of bug hai jisli wajah se ye file pehle
		// DEAD CODE thi: likhi hui thi, chain me nahi lagi thi.
		auth.POST("/logout", authHandler.AuthMiddleware(), middleware.CheckRevoked(revocationStore), authHandler.Logout)
		// ---- Creator dashboard: active devices ----
		// "Aap kis device par logged in hain" - token se user_id lekar
		// scoped query chalata hai (cross-user leak nahi).
		auth.GET("/sessions", authHandler.AuthMiddleware(), authHandler.ListMySessions)

		// Protected routes
		protected := auth.Group("")
		protected.Use(authHandler.AuthMiddleware())
		// Sab PROTECTED routes par bhi. Ye ek Redis EXISTS call hai -
		// logout ke turant baad aaye request ko 401 milta hai bina Postgres
		// round-trip ke. Redis down ho to ye `false` return karta hai aur
		// AuthMiddleware ka DB check Authoritatively reject karta hai.
		protected.Use(middleware.CheckRevoked(revocationStore))
		{
			protected.GET("/profile", authHandler.GetProfile)
			protected.GET("/pin/setup", authHandler.SetupPIN)
			protected.POST("/pin/verify", authHandler.VerifyPIN)

			// ---- SETTINGS (Block 2 - SSOT) ----
			// User preferences ka single source of truth. Ek hi GET me
			// identity + preferences dono milte hain (SSOT principle).
			protected.GET("/settings", authHandler.GetSettings)
			protected.PATCH("/settings", authHandler.UpdateSettings)

			// ---- IDENTITY / ROLE ----
			// `/me` se client ko apna role pata chalta hai (superadmin-only
			// UI hide karne ke liye). NOTE: ye sirf UI hint hai - real
			// authorization middleware + guards par hai.
			protected.GET("/me", authHandler.GetMe)

			// ---- SECURITY ROLLOVER (Block 2.5 / 2.6) ----
			// Old credential verify karke naya set karta hai, aur saare
			// DUSRE sessions + refresh tokens + expired verification tokens
			// hard-delete kar deta hai (garbage accumulation nahi).
			//
			// SECURITY: current session ID token se aati hai, body se nahi -
			// warna client "is session ko chhod do" bol ke apni hijacked
			// session bacha sakta tha.
			protected.PUT("/security/pin/rollover", authHandler.RolloverPIN)
			protected.PUT("/password", authHandler.ChangePassword)

			// ---- UNLOCK CHECKS (two-step confirm UI) ----
			// Sirf VERIFY karte hain, koi state change nahi. Ye un endpoints
			// ka backend hai jinse UI me "old credential sahi daalo -> form khule".
			// NOTE: ye `/security/*` bucket me hain, wahi rate limit.
			protected.POST("/security/pin/check", authHandler.CheckPIN)
			protected.POST("/password/check", authHandler.CheckPassword)

			// ---- AVATAR UPLOAD (direct to MinIO via presigned URLs) ----
			// 2-step: pehle URL, phir finalize. File bytes app server par
			// kabhi nahi aate - browser seedha MinIO me PUT karta hai.
			protected.POST("/avatar/upload-url", authHandler.AvatarUploadURL)
			protected.POST("/avatar/finalize", authHandler.AvatarFinalize)

			// ---- Creator dashboard endpoints (migration 005) ----
			// Sab token-derived user_id par scoped hain.
			protected.GET("/channels", authHandler.ListChannels)
			protected.POST("/channels", authHandler.CreateChannel)
			// ---- Phase B1: channel management beyond create ----
			//
			// SECURITY: `/:id` wale routes me `user_id` filter service layer par
			// LAGA HUA HAI aur user_id TOKEN se aata hai. Bina token ke koi
			// doosre user ka channel read/edit/delete nahi kar sakta (IDOR nahi).
			protected.GET("/channels/:id", authHandler.GetChannel)
			protected.PATCH("/channels/:id", authHandler.UpdateChannel)
			protected.DELETE("/channels/:id", authHandler.DeleteChannel)
			// ---- Channel cover upload (Phase B1) ----
			// Same 3-step presigned flow as avatars. Both handlers run an
			// ownership check on `:id` (channel must belong to the caller)
			// BEFORE minting a URL or saving anything.
			protected.POST("/channels/:id/cover/upload-url", authHandler.CoverUploadURL)
			protected.POST("/channels/:id/cover/finalize", authHandler.CoverFinalize)
			protected.PATCH("/profile", authHandler.UpdateProfile)
			// Profile GET v2 - avatar_url ke saath (purana `GetProfile`
			// fields ka subset return karta hai, isliye naya endpoint).
			protected.GET("/profile/full", authHandler.GetProfileV2)
		}

		// ---- PUBLIC channel discovery (Phase B1) ----
		//
		// ---- WHY A SEPARATE `/public` PREFIX ----
		// Ye routes `/api/v1/channels/:id` ke saath SAME prefix me nahi rakh sakte
		// the. Gin ke router me ek static segment aur ek param segment bhai nahi
		// ho sakte - `/channels/public` aur `/channels/:id` ek saath register
		// karne pe gin PANIC karta hai ("conflicts with existing wildcard").
		// Alag prefix isse structurally rok deta hai aur saath me semantics bhi
		// saaf karta hai: `/public/*` = "auth nahi chahiye".
		//
		// SECURITY: in par AuthMiddleware LAGA HUA NAHI HAI - ye jaan-boojh kar
		// hai, kyunki public channel page login ke bina dikhna chahiye. Privacy
		// service layer par depend karti hai: sirf `is_public AND is_active` rows
		// hi return hoti hain, aur private/missing dono ke liye SAME 404 aata hai
		// ( warna attacker handle enumerate kar sakta tha).
		publicGroup := r.Group("/api/v1/public/channels")
		{
			publicGroup.GET("", authHandler.ListPublicChannels)
			publicGroup.GET("/:handle", authHandler.GetPublicChannel)
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
		//
		// RATE LIMITED - ye zaroori hai. Ye route bina token ke khuli hai
		// (lockout recovery ke liye) aur 4-digit PIN check karta hai. Bina
		// limit ke koi 10,000 possible PINs chhoti script se enumerate kar
		// sakta tha. 8/min per IP+pair se ye brute force impractical ho
		// jata hai jabki legit user ko apna PIN type karne ka time milta hai.
		secGroup.POST("/pin/verify",
			middleware.RateLimit(redisClient, middleware.LimitLogin),
			securityHandler.VerifyPIN)
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
		// Skip: user ne EXPLICITLY biometric decline kiya (migration 010).
		// Ye "mark as registered" NAHI hai - wo loop create karta tha.
		secProtected.POST("/biometric/skip", securityHandler.SkipBiometric)
		secProtected.GET("/events", securityHandler.SecurityEvents)
	}

	// Superadmin routes - awareness, sessions, device lock, test cleanup
	// NOTE: superadminHandler ke apne requireSuperadmin middleware hai jo
	// har endpoint pe role check karta hai (superadmin ya recovery)
	superadminHandler.RegisterRoutes(auth, authHandler.AuthMiddleware())

	// Awareness (Block 3) - REAL user data grid.
	// NOTE: ye apna route group banata hai aur DONO layers lagata hai
	// (auth + superadmin role), isliye backend-level protection bhi hai -
	// sirf Next.js middleware par depend nahi karte.
	authHandler.RegisterAwarenessRoutes(auth)

	// ---- STORAGE (MinIO) init ----
	//
	// Avatar uploads apne self-hosted MinIO me jate hain (koi paid provider
	// nahi). Ye presigned URL deta hai taki browser seedha upload kare.
	//
	// NOTE: config missing hone par WARN karke aage badhte hain - app crash
	// nahi hota, sirf avatar upload unavailable rehta hai. Ye deliberate hai:
	// ek misconfigured optional feature pure app ko down nahi karega.
	//
	// SECURITY: credentials missing hua to ERROR (fail fast) - chhota
	// fallback use karne se upload chupke se fail hota aur user ko pata
	// nahi chalta.
	if storageSvc, sErr := service.NewStorageService(&cfg.Storage); sErr != nil {
		log.Printf("[WARN] Storage disabled: %v", sErr)
		log.Printf("[WARN] Avatar upload unavailable. Set STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY in .env")
	} else {
		authHandler.SetStorageService(storageSvc)
		log.Printf("[OK] Storage ready: MinIO %s (bucket %s)",
			cfg.Storage.GetEndpoint(), cfg.Storage.GetAvatarBucket())
	}
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

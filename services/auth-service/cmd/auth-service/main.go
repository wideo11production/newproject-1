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
	authredis "github.com/wideo11/auth-service/src/redis"
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

	// =========================================================================
	// SCHEMA
	// =========================================================================
	//
	// `database.Migrate` and not `database.AutoMigrate`, and the difference is the
	// whole point: AutoMigrate only creates the tables GORM knows about, so on an
	// empty database EVERYTHING the SQL chain owns is missing - `channels`,
	// `user_services`, `appointments`, `privilege_registry`, and every view.
	//
	// That was not theoretical. With the chain unrun, the service could not start
	// AT ALL on a fresh database:
	//
	//	create view privilege_registry: ERROR: relation "appointments" does not exist
	//
	// because the view is created after AutoMigrate and reads a table migration
	// 017 creates. Not degraded, not partially - not started.
	//
	// `Migrate` orders the four phases and records a ledger, so a fresh deploy and
	// a redeploy converge on the same schema without a human running psql.
	if err := database.Migrate(db); err != nil {
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

	// ---------------------------------------------------------------------------
	// PII RETENTION SWEEPER
	// ---------------------------------------------------------------------------
	//
	// Ye pehle BILKUL nahi tha, jabki `SYSTEM-PLAN.md` §3.3 30-day retention
	// specify karta hai. Jo bhi delete nahi karta tha. Jo gap tha wo sirf
	// telemetry ka nahi tha - ye tables bhi har row me PII rakhti hain:
	//
	//	sessions          ip_address, user_agent
	//	refresh_tokens    user_id, expires_at
	//	user_sessions     ip_address, user_agent, duration_seconds
	//	security_events   email, ip_address, user_agent, detail
	//
	// Aur ye kabhi delete nahi hote the. Do consequences, dono serious:
	//
	//  1. Koi DB backup chura le to uske paas SAARE users ka historical IP aur
	//     exact user-agent hai - "kaun kab kis machine se login tha" ka poora
	//     record.
	//  2. Account delete karne par ye rows ZALTI REH JAATI THI. Migration 012 ne
	//     FK rules theek kiye taaki `DELETE FROM users` chale, par ye worker nahi
	//     tha - to ek erasure request "user row gaya, uski IP history nahi" ka
	//     result de sakti thi.
	//
	// Ye `purgeWorker` se ALAG rakha gaya hai. Wo ek product rule hai (user ko
	// email jaata hai), ye ek data-lifecycle rule hai (koi user-visible effect
	// nahi). Ek flag do rules control kare, to ek ki galti doosre ko chupke se
	// band kar deti hai - aur compliance window chupke se infinite ho jaati hai.
	retentionWindows := purge.RetentionWindowsFromEnv(os.LookupEnv)
	retentionWorker := purge.NewRetentionWorker(db, &retentionWindows)
	retentionWorker.Start(workerCtx)
	defer retentionWorker.Stop()

	// First sweep SYNCHRONOUSLY, before serving traffic.
	//
	// A ticker that only starts sweeping an hour from boot means a fresh
	// deployment carries a full backlog of expired rows for its first hour of
	// life. Running it once at startup means the invariant "no expired session
	// row survives a deploy" holds the moment the service is up, and it also
	// proves the DELETE works against the real schema - if a table name is wrong
	// or a column is missing, this is where it surfaces, in a log line, rather
	// than in a support ticket about disk usage.
	if retentionWindows.Enabled {
		if res := retentionWorker.RunOnce(workerCtx); res.Total() > 0 {
			log.Printf("[RETENTION] startup sweep removed %d expired row(s)", res.Total())
		}
	}

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
	//
	// `cfg` pass kiya ja raha hai taki device-per-account limit .env se on/off
	// ho sake (DEVICE_LIMIT_ENABLED). `cfg == nil` par service SECURE default
	// maanta hai - limit chalu, cap 3.
	securitySvc := service.NewSecurityService(db, cfg)
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

	// Wire Redis to the superadmin handler for the rate-limit reset endpoint.
	//
	// Nil-safe: a deployment without Redis has no counters to reset, and the
	// endpoint answers 503 rather than pretending the operation succeeded.
	// Kept separate from the constructor for the same reason
	// `SetEntitlementAdmin` is a setter: Redis may not be initialised yet at
	// construction time, and reordering construction for one optional
	// dependency is worse than one extra setter call.
	superadminHandler.SetRedisClient(redisClient)

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

	// ---- Channel subscriptions (migration 015) ----
	//
	// The subscriber COUNT is DERIVED from `channel_subscriptions` through the
	// `channel_subscriber_counts` view. Nothing increments a counter anywhere -
	// that is the whole point, and it is why a stored `subscriber_count` column
	// is deliberately absent from the `channels` table.
	//
	// Redis caches the derived count for 60s and is invalidated on every write.
	// `Keys()` hands over the raw client so this can take the narrow `CountCache`
	// interface rather than the whole wrapper - which also means the count can be
	// tested without a live Redis.
	subSvc := service.NewChannelSubscriptionService(db, redisClient.Keys())
	authHandler.SetSubscriptionService(subSvc)

	// ---- Media pipeline (Phase 3 + 4) ----
	//
	// `MediaService` owns the `media_assets` rows and the state machine;
	// `StorageService` only signs URLs and never touches the database. Keeping
	// them apart means "can this URL be signed" and "is this user over quota"
	// stay two questions with two failure modes, instead of one component that
	// is bad at both.
	// ---- Entitlements (Phase 5) ----
	//
	// Seeded from .env on every boot, so a plan or price change is a restart
	// rather than a migration. The seed is an UPSERT by (plan_code, capability)
	// AND it DELETES grants for plans that are no longer configured - otherwise a
	// retired plan quietly keeps granting capabilities to whoever still holds it.
	entitlementSvc := service.NewEntitlementService(db, cfg.Plans)
	if err := entitlementSvc.Seed(context.Background()); err != nil {
		// Fatal, not a warning. Running with an EMPTY catalogue means every quota
		// check resolves to zero and nobody can do anything - which looks like a
		// total outage rather than a misconfiguration, and would be diagnosed in
		// entirely the wrong place.
		log.Fatalf("entitlement seed failed: %v", err)
	}
	log.Printf("[ENTITLEMENTS] seeded %d plan(s): %v", len(cfg.Plans.Plans), cfg.Plans.Codes())

	// ---- AuthService gets the SAME entitlement instance ----
	//
	// `CreateChannel` needs the user's `max_channels` limit, and the only place
	// that is authoritatively resolved is here. Passing the same instance (not a
	// second `NewEntitlementService`) keeps `cfg.Plans` a single snapshot: a plan
	// added to `.env` between two constructions would be visible to one and not
	// the other, which makes the channel limit answer differently depending on
	// which code path asked.
	authService.SetEntitlementService(entitlementSvc)

	// =========================================================================
	// SERVICE ACCESS + RBAC (migration 017)
	// =========================================================================
	//
	// ---- WHY THIS IS HERE NOW AND NOT ALREADY ----
	//
	// `internal/service/service_access.go` and `internal/service/rbac.go` were
	// fully written, fully commented and covered by 40 tests. Neither was ever
	// CONSTRUCTED in this file. Verified on the live database before this change:
	//
	//     SELECT count(*) FROM permissions;  -> 0
	//     SELECT count(*) FROM roles;        -> 0
	//     SELECT count(*) FROM user_services -> 0
	//
	// So migration 017's four tables existed and were empty, the registry view
	// existed, and the code that reads them was unreachable. A superadmin's
	// "who may do what" screen would have rendered an empty list forever, and
	// nothing anywhere would have said why.
	//
	// The lesson is the same one this repo keeps meeting: a feature can be
	// complete, tested, documented and never run. `TestEveryTableNameIsProvisioned`
	// now checks the tables are created; nothing checked they were POPULATED.
	//
	// ---- WHY THE SEED IS FATAL ON FAILURE ----
	//
	// An empty permission catalogue means `Can()` answers `false` for everything.
	// Every privileged action silently refuses, and the symptom - "nobody can do
	// anything" - looks like a permissions bug rather than a boot that skipped a
	// step. Failing loudly at startup is the honest version of the same state.
	serviceAccess := service.NewServiceAccess(db)
	rbac := service.NewRBAC(db, serviceAccess)

	if err := rbac.Seed(context.Background()); err != nil {
		// Same reasoning as the entitlement seed above, and the same severity.
		log.Fatalf("RBAC seed failed: %v", err)
	}
	log.Printf("[RBAC] permission catalogue seeded")

	authHandler.SetRBAC(rbac, serviceAccess)

	authHandler.SetMediaService(service.NewMediaService(db, entitlementSvc))
	// The object store is attached AFTER it is built, in the storage block below.
	// It is only needed for the playback path, and the media service works without
	// it for every other route.

	// The comment thread under an asset. Its own service because a comment is a
	// viewer's interaction, not part of the asset's pipeline - and the link ban it
	// enforces needs to live in exactly one place.
	authHandler.SetCommentService(service.NewCommentService(db))
	// ---- Transcoding handoff ----
	//
	// Optional. A missing client does NOT fail an upload - FinalizeMedia
	// records the asset and simply does not queue the transcode, because telling
	// a user their 8 GB upload failed means they re-upload it.
	if tc, err := service.NewTranscodeClient(); err != nil {
		log.Printf("[MEDIA] transcode handoff OFF: %v - uploads will be stored but not transcoded", err)
	} else {
		authHandler.SetTranscodeClient(tc)
		// Lifetime device slots. Read-only surface for the account screen; the
		// ENFORCEMENT happens inside the register path, so it cannot be bypassed by
		// calling a different endpoint.
		authHandler.SetDeviceSlotService(service.NewDeviceSlotService(db, entitlementSvc))
	}
	authHandler.SetEntitlementService(entitlementSvc)

	// The one-trial-per-BROWSER cap. Without this the table is empty and every
	// browser gets unlimited trials, which is the failure mode the cap exists to
	// prevent. See internal/service/trial_device.go.
	authHandler.SetTrialDeviceService(service.NewTrialDeviceService(db))

	// MFA challenge store for PIN-as-2FA at login
	if redisClient != nil {
		mfaStore := authredis.NewMFAChallengeStore(redisClient.Keys(), 5*time.Minute)
		authHandler.SetMFAChallengeStore(mfaStore)
	}

	// ---- Give the SUPERADMIN handler the same entitlement service ----
	//
	// Without this, `POST /admin/entitlements` has nothing to grant with: `Grant`
	// had zero production callers, so `entitlements` stayed empty, so every
	// `Limit()` returned `ErrEntitlementMissing`, so **every quota in the product
	// resolved to 0** and the upload path failed closed for everybody on every
	// plan including the paid ones.
	//
	// THE SAME INSTANCE as above, not a second `NewEntitlementService`. Two
	// services over one database would each hold their own `cfg.Plans` snapshot,
	// and a plan added to `.env` between the two constructions would be accepted
	// by one handler and refused by another — so a grant could fail on the
	// endpoint and succeed through the upload path, which is the worst version of
	// that bug: intermittent, and only for new plans.
	//
	// `cfg.Plans` is passed too, because the handler needs the catalogue to render
	// it and to reject an unknown `plan_code` BEFORE writing anything.
	superadminHandler.SetEntitlementAdmin(db, entitlementSvc, cfg.Plans)

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

	// MFA verify - PIN-as-2FA at login. Rate limited like PIN verify.
	auth.POST("/mfa/verify",
		middleware.RateLimit(redisClient, middleware.LimitLoginSustained),
		authHandler.VerifyMFA)

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

	// -----------------------------------------------------------------------
	// PRESENCE - "who is online right now"
	// -----------------------------------------------------------------------
	//
	// `StartSession` / `EndSession` / `HeartbeatSession` had been written on the
	// superadmin service, were correct, and had ZERO callers. `user_sessions`
	// stayed permanently empty, so the dashboard reported, for every user, forever:
	//
	//     Online Now 0 · Total Sessions 0 · Seconds Online 0 · Devices 0
	//
	// ...while people were demonstrably signed in. `ListAllActivity` listed every
	// user correctly and `GetUserActivity` counted rows in a table nobody wrote to.
	//
	// THIS IS THE FOURTH TIME THIS SHAPE HAS APPEARED, and naming them is the
	// point: correct code, correct comments, correct tests, and no path by which
	// anything reaches it. Five copies of `/api/audit`. Three of
	// `/api/health-check`. `/ui-clicks/targets` with zero callers. And this.
	//
	// Attached to `auth` with an explicit `AuthMiddleware()` per route rather than
	// to `protected`, so each route states its own guard instead of inheriting one.
	// A presence endpoint reachable anonymously would let anyone mark anyone online,
	// and "who is on my platform right now" is not a public figure.
	presenceHandler := handler.NewHandler(db)
	presenceHandler.RegisterRoutes(auth, authHandler.AuthMiddleware())

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

	// ---- The caller's OWN plan, allowance and expiry ----
	//
	// NOT the admin route. A user who is not a superadmin must be able to render
	// "your trial ends in 2 days", and a route that took the target from the path
	// would be one refactor away from showing somebody else's allowance.
	//
	// No path parameter, no body, no query. The identity is the verified token,
	// so there is no field to get wrong. See `internal/handler/my_entitlements.go`.
	protected.GET("/me/entitlements", authHandler.GetMyEntitlements)

	// ---- PERMISSIONS SELF-HEALING ----
	//
	// Users who registered before the auto-appointment fix may lack the creator
	// role. This endpoint lets them self-heal without support intervention.
	// Idempotent: returns fixed=false if already has role, fixed=true if granted.
	protected.POST("/me/fix-permissions", authHandler.FixPermissions)

	// ---- THE FREE CREATOR PLAN ----
	//
	// Grants the `trial` plan to a caller who holds NO live entitlement, which is
	// the state of every account created before registration granted one
	// automatically. Separate from `/me/plan` because that route refuses any plan
	// whose cycle is not `monthly`, and the trial's whole point is that the SERVER
	// picks its end date. See internal/handler/free_plan.go.
	//
	// Idempotent and read-only when a plan is already live: a caller holding a
	// subscription or a lifetime purchase is told so and left alone.
	protected.POST("/me/free-plan", authHandler.ActivateFreePlan)

	// ---- SELF-SERVICE PLANS ----
	//
	// The user-facing counterpart to the superadmin grant route. A user who
	// wants to earn money picks their own plan here instead of waiting for a
	// human with access to `/admin/entitlements`.
	//
	// Both take nothing from the URL: the GET is a catalogue read, and the POST
	// identifies the buyer from the token. See plan_self_service.go for why
	// lifetime plans are absent and why the source recorded is `subscription`.
	protected.GET("/me/plans", authHandler.SelectablePlans)
	protected.POST("/me/plan", authHandler.SubscribePlan)

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
		//
		// NOTE: `/dashboard/stats` is registered ONCE, further down, with
		// `RequireService("web")` on it. It used to also be registered here, and
		// having it twice makes `gin` PANIC on start - the whole service refuses to
		// boot.
		//
		// Caught by `TestMainHasNoDuplicateRouteLiterals`, which existed before this
		// change and would have caught it. Worth stating because the failure mode of
		// a duplicate route is a total outage with an error that names neither of the
		// two places you would look.

		// ---- Creator CAPABILITIES. These are the only routes below that ask
		// "may this ROLE do this", rather than "is this a valid session". ----
		//
		// `RequirePermission` par pehle bhi lagaya hua tha - jaisa is block ka
		// comment BAAD me likhta tha. Wo comment GALAT tha: method UNEXPORTED tha
		// (`requirePermission`), isliye package `main` use call hi nahi kar sakta
		// tha. Matlab 15 capabilities, 4 ranked roles aur Appoint() ka anti-escalation
		// check - sab likhe hue the, aur KABHI CHALE HI NAHI.
		//
		// Do alag baatein ab enforce hoti hain, jo easily confuse ho jaati hain:
		//
		//   PERMISSION  "kya is ROLE ko channel banana hai"      -> RequirePermission
		//   OWNERSHIP   "kya is USER ko YEH channel edit karna hai" -> service layer
		//
		// Pehle sirf DOOSRA tha (aur wo sahi tha - `DeleteChannel` me
		// `id = ? AND user_id = ?` hai, to koi doosre ka channel touch nahi kar
		// sakta). Pehla layer hi missing tha: koi bhi signed-in account channel
		// bana sakta tha.
		//
		// Sirf pehla lagana doosre ko tod deta - koi bhi permitted user kisi ka bhi
		// channel edit kar lega. Sirf doosra lagana pehle ko nahi rokta - bina
		// creator capability wala user channel bana hi sakta hai. Dono chahiye the,
		// aur ek hi tha.
		//
		// GET `/channels` list karta hai, channel nahi banata, isliye uspar permission
		// nahi hai - padhna create karna nahi hai.
		// `RequireService` answers the OTHER question:
		//
		//	RequireService   "kya is person ko ye app KHOLNE ka hai"   -> grant table
		//	RequirePermission "kya is person ko ye KARNE ka hai"        -> capability
		//
	// Dono chahiye, aur dono alag hain. Grant milne se aadmi app ke ANDAR jaata
	// hai; permission batata hai andar jaakar kya kar sakta hai. Inhe ek kar dene
	// ka matlab hoga ya to "jo billing kholta hai woh invoice padh sakta hai",
	// ya "jise billing kholne ka grant nahi hai woh billing khol hi nahi sakta -
	// superadmin ko bhi nahi".
		//
	// `web` par laga hai kyunki creator routes usi app ke andar hain. Ek grant
	// nahi rakhne wala user `web` open hi nahi kar paata - aur ye `video_editor`
	// wale user par bhi lagta hai, kyunki wahi `web` par authenticated hota hai.
		// Grant TABLE rows hain, app nahi - isliye ek hi grant dono ko cover karta
		// hai, aur ek extra row likhne se dono apps me se ek khul jayegi.
		protected.GET("/dashboard/stats",
			authHandler.RequireService("web"),
			authHandler.GetDashboardStats)

		protected.GET("/channels",
			authHandler.RequireService("web"),
			authHandler.ListChannels)
		protected.POST("/channels",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermChannelCreate),
			authHandler.CreateChannel)

		protected.GET("/channels/:id",
			authHandler.RequireService("web"),
			authHandler.GetChannel)
		protected.PATCH("/channels/:id",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermChannelEdit),
			authHandler.UpdateChannel)
		protected.DELETE("/channels/:id",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermChannelDelete),
			authHandler.DeleteChannel)

		// Cover / logo media. `media.upload` use kiya, `channel.cover_upload` jaisa
		// naya member invent nahi kiya - `rbac.go` ki vocabulary ek CLOSED set hai,
		// aur ek route ke liye member banana hi wo vocabulary ko open karta hai.
		protected.POST("/channels/:id/cover/upload-url",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermMediaUpload),
			authHandler.CoverUploadURL)
		protected.POST("/channels/:id/cover/finalize",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermMediaUpload),
			authHandler.CoverFinalize)

		// Channel creation ke dauraan cover (channel ID abhi bani nahi).
		protected.POST("/channels/cover/upload-url",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermChannelCreate),
			authHandler.CoverUploadURLForCreate)
		protected.POST("/channels/cover/finalize",
			authHandler.RequireService("web"),
			authHandler.RequirePermission(service.PermChannelCreate),
			authHandler.CoverFinalizeForCreate)

			// ---- CHANNEL SETUP STEP 2 (migration 022) ----
			//
			// The compulsory second step. Creating a channel and having a channel
			// are different things, and a creator who stops after creating one
			// leaves an empty banner, no logo and no upload defaults behind -
			// which is the state every abandoned account looks like.
			//
			// `/channels/setup/pending` puts a STATIC segment where `:id` puts a
			// wildcard, so the two share a path position. Gin resolves the static
			// segment in preference to the wildcard, which is what makes the
			// pending route work; registration order was checked and does not
			// matter either way.
			//
			// What DOES matter is that the static route exists at all. A request to
			// `/channels/setup/pending` served by the `:id` handler would parse
			// "pending" as a channel id, fail, and answer 400 - so the dashboard
			// gate would report "setup status unavailable" on every load with no
			// other symptom. `TestChannelSetupRoutesAreReachable` holds this.
			protected.GET("/channels/setup/pending", authHandler.PendingChannelSetup)
			protected.GET("/channels/:id/setup", authHandler.GetChannelSetup)
			protected.PATCH("/channels/:id/setup", authHandler.UpdateChannelSetup)
			// The logo's three steps. A separate bucket budget from the cover, so
			// separate endpoints rather than a `?kind=` parameter - a kind
			// parameter would be one handler with two security profiles, and the
			// wrong branch is the one nobody reads.
			protected.POST("/channels/:id/logo/upload-url", authHandler.LogoUploadURL)
			protected.POST("/channels/:id/logo/finalize", authHandler.LogoFinalize)
			// ---- Channel subscriptions (migration 015) ----
			//
			// The COUNT is served from the `channel_subscriber_counts` VIEW, not a
			// column. Nothing increments a subscriber number anywhere in this
			// codebase, which is the entire point - see
			// `internal/service/channel_subscription.go`.
			//
			// `subscribe` / `unsubscribe` / `mine` take the viewer from the TOKEN,
			// never from a parameter, so nobody can subscribe anyone else.
			protected.POST("/channels/:id/subscribe", authHandler.SubscribeChannel)
			protected.POST("/channels/:id/unsubscribe", authHandler.UnsubscribeChannel)
			protected.GET("/channels/:id/subscription", authHandler.AmIChannelSubscriber)
			// The LIST of who subscribed is audience data and is authenticated for
			// that reason. The COUNT is public - see the handler's comment.
			protected.GET("/channels/:id/subscribers", authHandler.ListChannelSubscribers)
			protected.PATCH("/profile", authHandler.UpdateProfile)
			// ---- Reel platform readiness (Phase 4) ----
			//
			// GET /media/:id/reel-readiness is PUBLIC, and that is deliberate: the grid
			// describes a FILE - its dimensions, length, size, whether it has audio - and
			// contains nothing about who owns it. It is fixed-length and keyed by
			// platform, so there is nothing to enumerate either.
			//
			// It reads through MediaService.ReelFactsFor, which returns a struct that
			// CANNOT carry the owner. The guarantee is in the type rather than in trusting
			// the handler not to read a field it was not given - which is the difference
			// between a boundary and a habit.
			publicMedia := r.Group("/api/v1/media")
			{
				publicMedia.GET("/reel-platforms", authHandler.ListReelPlatforms)
				publicMedia.GET("/:id/reel-readiness", authHandler.ReelReadiness)
			}

			// Owner-scoped media routes.
			// From `protected`, NOT from `auth`.
			//
			// `protected` is the group that carries `AuthMiddleware()`. Attaching to
			// `auth` would put a token-gated handler behind no token check at all.
			//
			// The handler reads the user id from the TOKEN (`creatorUserID`), so this
			// mistake produced a 401 rather than a breach - which is exactly the reason
			// that is the only place it reads it from. Had it taken the id from the
			// request body, the same wiring mistake would have been an open endpoint.
			protectedMedia := protected.Group("/media")
			{
				protectedMedia.GET("/:id/export-pack", authHandler.ReelExportPack)
			// Media mutations. The quota lives at initiate, so a user who is over
			// allowance never receives a URL and never pays the upload time.
			protectedMedia.POST("/initiate", authHandler.InitMedia)
		// What the caller may still upload, per kind. Read up front so the
		// upload page can show "12 of 25 left" and a trial can be routed to
		// plans BEFORE a file is picked instead of after.
		protectedMedia.GET("/quota", authHandler.MediaQuota)
			protectedMedia.POST("/:id/finalize", authHandler.FinalizeMedia)
			// ---- RETRY and DELETE: the recovery path for a failed upload ----
			//
			// A `failed` asset used to be a one-way door. The transcoder wrote the
			// row, `MarkTranscodeResult` refused any asset not mid-pipeline, and
			// nothing in the product could move it back - so a 4K file that outran
			// the transcoder's memory was permanently dead, and the creator's only
			// route was re-uploading every byte.
			//
			// These two routes close that. `POST /:id/retry` re-queues the
			// transcode against the SAME stored object; `DELETE /:id` drops the row
			// and its bytes. Both are owner-scoped and both are locked to `failed`
			// in the service, so neither can be aimed at an in-flight upload.
			protectedMedia.POST("/:id/retry", authHandler.RetryMedia)
			protectedMedia.DELETE("/:id", authHandler.DeleteMedia)
				protectedMedia.GET("", authHandler.ListMedia)
				protectedMedia.GET("/:id", authHandler.GetMedia)
				// Poll for "is it ready yet" without downloading the whole asset.
				// Owner-scoped, because `failure_reason` and `object_key` are not
				// things to hand a stranger.
				protectedMedia.GET("/:id/status", authHandler.MediaStatus)
			// Signed playback URL for one object inside the asset. The `video`
			// bucket is private, so a plain URL is denied for EVERYONE including
			// the uploader - this is what makes a finished upload viewable.
			protectedMedia.GET("/:id/signed-url", authHandler.SignedStreamURL)

			// Byte streaming for the OWNER. Same assets, a different authority:
			// `/public/media/:id/stream` asks "may a stranger see this", this asks
			// "is this yours" - and an owner may watch their own draft that the
			// public route refuses.
			protectedMedia.GET("/:id/stream", authHandler.OwnerStream)

			// The owner releasing an asset to the video page. A separate step from
			// the moderation verdict on purpose: the scan answers "is it safe", this
			// answers "did the owner confirm and choose to publish" - and the record
			// of that confirmation is the only proof the responsibility was accepted.
			// See `PublishMedia` for why it cannot override a screening verdict.
			protectedMedia.POST("/:id/publish", authHandler.PublishMedia)

			// ---- Comments on a clip ----
			//
			// Under `/media/:id/...` because a comment is about a CLIP and not a
			// free-floating entity: the asset id in the path is what scopes the query,
			// and it is what the link ban is enforced against.
			protectedMedia.GET("/:id/comments", authHandler.MediaComments)
			protectedMedia.POST("/:id/comments", authHandler.CommentCreate)

			// The like and the edit/delete are on the COMMENT id rather than the
			// asset, because they act on a comment and not on a clip.
			protectedMedia.POST("/comments/:cid/like", authHandler.CommentLike)
			protectedMedia.PATCH("/comments/:cid", authHandler.CommentEdit)
			protectedMedia.DELETE("/comments/:cid", authHandler.CommentDelete)

				// ---- The transcode callback ----
				//
				// NOT under `/media/:id`, deliberately: this is a REPORT about an asset,
				// not a request for one, and the id arrives in the body.
				//
				// It authenticates with the shared `TRANSCODE_INTERNAL_TOKEN` inside the
				// handler, using a constant-time compare. It is not behind
				// `AuthMiddleware` because the transcoder is a SERVICE, not a signed-in
				// user - and it WRITES to media rows, so an open endpoint here would let
				// anyone mark anyone's video `ready` with a url of their choosing.
				r.POST("/api/v1/internal/media/transcode-callback", authHandler.TranscodeCallback)

				// ---- Device management (lifetime plan allowance) ----
				//
				// Read-only surface for the account screen. The ENFORCEMENT lives in the
				// register path (DeviceSlotService.CheckSlot), so it cannot be sidestepped by
				// calling a different endpoint.
				//
				// `revoke` takes the fingerprint in a BODY, never in a URL: a fingerprint
				// identifies a device, and a URL would put it in every access log, proxy log
				// and browser history between here and the user.
				protected.GET("/devices", authHandler.ListDevices)
				protected.POST("/devices/revoke", authHandler.RevokeDevice)
			}
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
			// The channel's published videos and reels. Separate from the channel itself
			// so a page can show the Videos and Shorts tabs without fetching everything
			// and splitting it in the client.
			publicGroup.GET("/:handle/media", authHandler.GetPublicChannelMedia)
		}

		// Public media discovery (related videos, browse) - no auth required.
		publicMediaGroup := r.Group("/api/v1/public/media")
		{
			publicMediaGroup.GET("", authHandler.GetPublicMedia)
			// Signs a short-lived playback URL for one object inside a publicly
			// visible asset. The gate (ready + approved + public channel) lives in
			// the service; every refusal answers one 404.
			publicMediaGroup.GET("/:id/stream", authHandler.GetPublicMediaStream)

		// The comment thread under a clip. PUBLIC, for the same reason the clip is:
		// a stranger can watch it, and the comments are part of the page they are
		// looking at. An anonymous viewer gets `viewer_has_liked: false` everywhere
		// rather than an error, which is the honest answer to "which of these did I
		// like" when there is no "I".
		//
		// The LIST is here and the WRITE paths are under `/auth/media/...`, because
		// posting needs a session while reading does not. Two routes for the same
		// resource is not duplication: they carry different authority, and merging
		// them would mean one of the two got the wrong check.
		publicMediaGroup.GET("/:id/comments", authHandler.MediaComments)
		}

		// =====================================================================
		// SERVICE ACCESS + RBAC (migration 017)
		// =====================================================================
		//
		// Registered on `protected`, so a token is already required. Everything
		// below then answers a NARROWER question: is this token a superadmin, or
		// does it hold a named permission?
		//
		// The superadmin check lives INSIDE the handlers rather than as a
		// middleware on this group, and that is deliberate. It is read from the
		// DATABASE (`superadmin_accounts.is_active`), not from a role claim on the
		// token, so a slot revoked mid-session stops working on the next request
		// rather than at token expiry. As a group middleware it would also run
		// identically for every route in `protected` - and these are the routes
		// that DEFINE the privilege model, so they must be able to answer for
		// themselves.
		//
		// `RequirePermission` IS a middleware and IS applied per-route below, so a
		// handler cannot forget to call it.
		//
		// That sentence was here before, and it was FALSE for as long as it stood.
		// The method was unexported (`requirePermission`), so `main` could not call
		// it, and it was applied to zero routes. A comment asserting that a security
		// control is wired is not the control, and it is the same failure as the
		// unwired presence writers in this file's history: correct code, correct
		// comment, no path by which anything reaches it.
		//
		// It is now `RequirePermission`, it is on the channel routes, and
		// `cmd/auth-service/rbac-wiring_test.go` fails if the wiring is removed.
		//
		// These live INSIDE this block because `protected` is block-scoped: a
		// declaration in one `{ ... }` is not visible in the next one.
		protected.GET("/services", authHandler.MyServices)

		adminRBAC := protected.Group("/admin")
		adminRBAC.GET("/registry", authHandler.GetPrivilegeRegistry)
		adminRBAC.POST("/services/grant", authHandler.GrantService)
		adminRBAC.POST("/services/revoke", authHandler.RevokeService)

		// =================================================================
		// CONTENT MODERATION REVIEW (migration 030)
		// =================================================================
		//
		// The screener is a heuristic engine with a declared borderline band, so
		// some uploads need a human. Before this existed, `ModerationWorklist` and
		// `ResolveModeration` had no route on top of them: every flagged video sat
		// at `flagged` forever, invisible to everyone including its creator, with
		// nothing saying why - which is a worse state than refusing it, because a
		// refusal at least tells the creator something.
		//
		// Reading is gated on `audit.view`; DECIDING is gated on
		// `moderation.review`. Two permissions, not one, because "who looked" and
		// "who approved" must be different sets of people for an audit of this
		// queue to mean anything.
		//
		// `RequirePermission` fails closed when RBAC is unwired, which is the
		// right direction for a route that can publish refused content.
		protected.GET("/moderation/queue",
			authHandler.RequirePermission(service.PermAuditView), authHandler.ModerationQueue)
		protected.GET("/moderation/:id/audits",
			authHandler.RequirePermission(service.PermAuditView), authHandler.ModerationAudits)
		protected.POST("/moderation/:id/resolve",
			authHandler.RequirePermission(service.PermModerationReview), authHandler.ResolveModeration)
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
	// `CheckRevoked` WAS MISSING HERE, and it is the most consequential of the
	// three gaps it closed.
	//
	// `/pin`, `/PUT /pin`, `/questions` and `/biometric/complete` are the endpoints
	// that CONFIGURE the account's second factor. `AuthMiddleware` checks the
	// JWT's signature and its expiry - and a token that was revoked at logout
	// still passes both, because revocation lives in a Redis denylist that
	// `AuthMiddleware` never reads.
	//
	// So: log out on a shared or lost device, and the previous session's token
	// keeps working until it expires on its own. In that window the holder of that
	// token can set a new PIN and change the security questions - i.e. take over
	// the very credentials recovery depends on. The `protected` group 200 lines
	// above already had this check; this group was simply missed.
	//
	// It is one Redis EXISTS. Not having it here is not a saving.
	if revocationStore != nil {
		secProtected.Use(middleware.CheckRevoked(revocationStore))
	}
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
	//
	// `CheckRevoked` passed as an extra guard. It was missing from this group,
	// which is the worst possible place for it to be missing: `/admin/*` exposes
	// every user's security events, every user's session history, the device lock
	// and account purging. Revoking a superadmin session is the documented
	// incident-response action, and on this group it did not work - the revoked
	// token still passed the signature and expiry checks and kept full access.
	//
	// Passed unconditionally rather than behind a `revocationStore != nil` check:
	// `CheckRevoked(nil)` passes requests straight through (`revocation.go:145`),
	// so the nil case is already handled at the point where it matters. The
	// conditional version needed a `saGuards` slice and a variadic call, which
	// reads as "the guard is optional" - and that is precisely the belief this
	// change is removing.
	superadminHandler.RegisterRoutes(auth, authHandler.AuthMiddleware(),
		middleware.CheckRevoked(revocationStore))

	// ---- SERVICE-TO-SERVICE: billing's payment-success grant (P0.3) ----
	//
	// When billing records a payment for a subscription, the subscriber
	// must be granted the plan they paid for, and `entitlements` live
	// here. So the write has to be a call from billing to auth.
	//
	// Mounted on the ROOT engine, NOT on `auth`/`protected`: those
	// groups carry `AuthMiddleware()`, which authenticates a user
	// session, and billing is not a user. The caller authenticates AS A
	// SERVICE - a short-lived token signed by the same JWT_SECRET_KEY
	// carrying `service: "billing"` (see
	// `internal/middleware/service_token.go` for why the claim, not the
	// secret, is the boundary).
	//
	// WHO CALLS IT, AND WHY NOT YET (Phase 0 dependency):
	// billing's subscription tables key users by `uint` while auth
	// keys them by UUID, and billing's `Subscribe` fails loudly
	// (`user_id_not_resolvable`) for every real user until that id
	// space is reconciled (billing's `identity.go`). So the billing-side
	// auto-fire is deliberately NOT wired: firing it today would grant a
	// plan to a user billing cannot name. This endpoint is the
	// correctly-attributed target - `source: "subscription"`, the one
	// source the superadmin endpoint refuses because a manual grant is
	// not a sale - and it is tested here. An operator can grant the
	// same plan by hand via `POST /admin/entitlements` meanwhile.
	r.POST(
		"/api/v1/internal/entitlements/subscription",
		middleware.RequireServiceToken([]byte(cfg.JWT.SecretKey), "billing"),
		superadminHandler.GrantSubscriptionEntitlement,
	)

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
		// Playback needs the object store on the MEDIA service, not just the
		// handler: a presigned URL cannot be fetched by a server (its Host is in
		// the signature), so the bytes are opened directly instead of being
		// handed out as a URL. See `StorageService.OpenPublicVideoObject`.
		//
		// Attached here, after storage exists, because the media service is built
		// earlier and every non-playback route works without it.
		if mediaSvc := authHandler.MediaService(); mediaSvc != nil {
			mediaSvc.WithStorage(storageSvc)
			log.Printf("[OK] Media playback streaming enabled (bucket %s)",
				cfg.Storage.GetVideoBucket())
		}
		log.Printf("[OK] Storage ready: MinIO %s (bucket %s)",
			cfg.Storage.GetEndpoint(), cfg.Storage.GetAvatarBucket())
	}
	// ---- Click tracking REMOVED from auth-service ----
	//
	// This used to be a full click-tracking stack here: `ClickService`, the
	// `/click-events` routes, the `click_events` table and a 30-day retention
	// worker. All of it has moved to `analytics-service` as `ui_click_events`.
	//
	// WHY IT MOVED, since "it worked, why move it": "which button did this user
	// press" is not an auth concern. It lived here only because this service had
	// a database already wired up, and the cost was that the ledger was
	// unfindable, analytics queries had to cross service boundaries, and the
	// table had exactly one owner who did not want it.
	//
	// The analytics service is where it belongs: it already models clicks,
	// views, conversions and reach, and it now owns the 90-day retention for
	// the UI ledger. The superadmin Awareness grid reads it from there via
	// `forwardTelemetry`, which checks the caller's role before attaching the
	// internal token.
	//
	// Removed rather than left behind: dead endpoints on a live service are how
	// the next person ends up writing to a table nobody is reading.

	// WebAuthn (biometric/passkey) routes
	// Sirf tab register karte hain jab WebAuthn service successfully init hua ho
	if webAuthnSvc != nil {
		// `authSvc` is passed so a verified assertion can ISSUE A SESSION.
		//
		// Without it `FinishAuthentication` verified a real WebAuthn signature -
		// the strongest authentication this product supports - and returned
		// `{"verified": true}` with no token and no session. There was no possible
		// next step. The passkey flow was a dead end and a password was the only
		// way in, which made the "more secure than a password" comment true of the
		// signature and false of the product.
		//
		// `securitySvc` is passed so the passkey login reports the SAME mandatory
		// gate state the password login reports. A passkey proves WHO you are; it
		// is not a waiver of what the account must have configured.
		waHandler := handler.NewWebAuthnHandler(webAuthnSvc, authService, securitySvc)

		// Registration flow (device enroll) - authenticated user hi kar sakta hai
		//
		// `CheckRevoked` was missing here, and on the whole group. A session
		// revoked at logout is in the Redis denylist, but `AuthMiddleware` only
		// checks the JWT signature and its expiry - both of which a still-
		// unexpired token passes. So a logged-out device could re-enrol a
		// credential, and `/credentials` still answered. Every other protected
		// group already had this check; this one was the omission.
		waProtected := auth.Group("/webauthn")
		waProtected.Use(authHandler.AuthMiddleware())
		// Unconditional for the same reason as `secProtected` - `CheckRevoked(nil)`
		// passes through, so there is no nil case to guard here.
		waProtected.Use(middleware.CheckRevoked(revocationStore))
		{
			waProtected.POST("/register/begin", waHandler.BeginRegistration)
			waProtected.POST("/register/finish", waHandler.FinishRegistration)
			waProtected.GET("/credentials", waHandler.ListCredentials)
			waProtected.DELETE("/credentials/:id", waHandler.DeleteCredential)
		}

		// Authentication flow (login with fingerprint/face)
		// Ye UNAUTHENTICATED hota hai - kyunki yahi to prove karta hai ki user kaun hai
		//
		// ---- RATE LIMITED, AND THIS IS THE POINT OF THE WHOLE BLOCK ----
		//
		// These two routes were completely unthrottled while the password login
		// next to them carries four policies (8/min, 30/15min, 10/15min per
		// account, 20/5min per IP).
		//
		// `/login/begin` takes an email address and returns a distinct error per
		// case: `no biometric credential registered` versus a real challenge. That
		// is an EMAIL ENUMERATION ORACLE - it answers "does this address have a
		// passkey?" for any address on the internet, unlimited times, with no
		// credential. Before this it was unlimited; that is not a strong factor
		// with a weak front door, it is a strong factor with an open one.
		//
		// `/login/finish` mints the session, so an unthrottled version is an
		// unthrottled challenge-guessing oracle.
		//
		// Same four policies as the password login, because they are the ones
		// designed for this job - the per-account policy is the one that matters,
		// since its key is the email and no IP rotation can escape it.
		waPublic := auth.Group("/webauthn")
		{
			waPublic.POST("/login/begin",
				middleware.BodyEmailCapture(),
				middleware.RateLimit(redisClient, middleware.LimitLogin),
				middleware.RateLimit(redisClient, middleware.LimitLoginSustained),
				middleware.RateLimit(redisClient, middleware.LimitLoginPerAccount),
				middleware.RateLimit(redisClient, middleware.LimitLoginPerIP),
				waHandler.BeginAuthentication,
			)
			waPublic.POST("/login/finish",
				// The client cannot send an email here reliably - the WebAuthn
				// assertion payload has no user field the server should trust.
				// Per-IP is therefore the only key available, which is why the
				// limit is the tighter per-IP policy.
				middleware.RateLimit(redisClient, middleware.LimitLoginPerIP),
				middleware.RateLimit(redisClient, middleware.LimitLoginSustained),
				waHandler.FinishAuthentication,
			)
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

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/analytics-service/src/config"
	"newproject/services/analytics-service/src/database"
	"newproject/services/analytics-service/src/handler"
	"newproject/services/analytics-service/src/middleware"
	"newproject/services/analytics-service/src/repository"
	"newproject/services/analytics-service/src/service"
	"newproject/services/analytics-service/src/telemetry"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// ---- REFUSE TO START UNPROTECTED ----
	//
	// This check is here, at the top, before a database connection or a listener.
	//
	// The alternative - a middleware that logs a warning when no token is set -
	// is the shape of the bug this service already had: routes registered with
	// nothing in front of them. A check that warns is ignored in the one
	// environment where it matters. A check that stops the process is not.
	//
	// There is deliberately no dev bypass. A bypass is a hole with an extra step,
	// and the value that turns it on lives in the same file as everything else.
	if err := cfg.ValidateForServe(); err != nil {
		log.Fatalf("refusing to start: %v", err)
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

	viewRepo := repository.NewViewLogRepository(db)
	clickRepo := repository.NewClickLogRepository(db)
	convRepo := repository.NewConversionRepository(db)
	reachRepo := repository.NewReachRepository(db)
	revenueRepo := repository.NewRevenueReportRepository(db)

	// The UI ledger lives in this service but is a DIFFERENT table from
	// `clickRepo`'s ad-engagement ClickLog. Two tables, two domains - see
	// `src/model/ui_click.go`.
	uiClickRepo := repository.NewUIClickRepository(db)

	analyticsSvc := service.NewAnalyticsService(viewRepo, clickRepo, convRepo, reachRepo, revenueRepo)

	// ---- Retention ----
	//
	// Started before the listener so the first sweep runs against a fresh
	// schema. It sweeps immediately and then every 6h.
	retentionWindow := time.Duration(cfg.Telemetry.RetentionDays) * 24 * time.Hour
	if retentionWindow <= 0 {
		retentionWindow = service.DefaultRetentionDays * 24 * time.Hour
	}
	retention := service.NewRetentionJob(uiClickRepo, retentionWindow)
	retentionCtx, retentionCancel := context.WithCancel(context.Background())
	defer retentionCancel()
	go retention.Run(retentionCtx)

	// ---- Realtime firehose (NATS JetStream) ----
	//
	// Started BEFORE the listener, so the first request already has a publisher
	// waiting. It cannot block startup: connecting happens in a goroutine and a
	// failure just means "clicks recorded, not published" - the database write is
	// the one that matters.
	publisherCtx, publisherCancel := context.WithCancel(context.Background())
	defer publisherCancel()

	var publisher *telemetry.Publisher
	if natsURL := cfg.Telemetry.NATSURL; natsURL != "" {
		publisher = telemetry.New(natsURL, cfg.Telemetry.PublishQueueSize)
		publisher.Start(publisherCtx)
		defer publisher.Stop()
	} else {
		log.Println("[TELEMETRY] NATS URL not configured - click events will be recorded but not published")
	}

	h := handler.NewHandler(analyticsSvc, uiClickRepo, int(retentionWindow.Hours()/24), publisher)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// Public first, so nothing can shadow them with a group that demands a token
	// the healthcheck does not have.
	h.RegisterPublicRoutes(r)

	// Everything else sits behind one group carrying the token check. Passing
	// the GROUP rather than the engine is what makes "protected by default" the
	// shape of the code: a route added to `guarded` needs no thought, and one
	// added to `r` is visibly the exception.
	guarded := r.Group("/", middleware.RequireInternalToken(cfg.Security.InternalToken))
	h.RegisterRoutes(guarded)

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	go func() {
		log.Printf("starting analytics service on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	log.Println("server exiting")
}

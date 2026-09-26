package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/billing-service/src/config"
	"newproject/services/billing-service/src/database"
	"newproject/services/billing-service/src/handler"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
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

	planRepo := repository.NewSubscriptionPlanRepository(db)
	subRepo := repository.NewSubscriptionRepository(db)
	taxRepo := repository.NewTaxRateRepository(db)
	invoiceRepo := repository.NewInvoiceRepository(db)
	itemRepo := repository.NewInvoiceItemRepository(db)
	paymentRepo := repository.NewPaymentRepository(db)
	expenseRepo := repository.NewManualExpenseRepository(db)

	billingSvc := service.NewBillingService(planRepo, subRepo, taxRepo, invoiceRepo, itemRepo, paymentRepo, expenseRepo)

	h := handler.NewHandler(billingSvc)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	h.RegisterRoutes(r)

	// Health check route: Kubernetes/Docker healthcheck is endpoint par depend karta hai.
	// Pehle ye route register nahi thi, isliye /health par 404 aata tha aur container
	// unhealthy mark ho jata tha. Ab service ready hone par 200 return karta hai.
	// Hinglish: health route add kiya taaki container healthcheck pass ho sake
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "billing-service",
			"port":    cfg.Server.Port,
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Server.Port,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadTimeout) * time.Second,
	}

	go func() {
		log.Printf("starting billing service on %s", srv.Addr)
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

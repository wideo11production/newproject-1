package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"newproject/services/bot-service/src/config"
	"newproject/services/bot-service/src/handler"
	"newproject/services/bot-service/src/nats"
	"newproject/services/bot-service/src/repository"
	"newproject/services/bot-service/src/service"
	"newproject/services/bot-service/src/vector"

	"github.com/sashabaranov/go-openai"
)

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Set Gin mode
	gin.SetMode(cfg.GinMode)

	// Initialize Postgres DB
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.PostgresHost, cfg.PostgresPort, cfg.PostgresUser, cfg.PostgresPassword, cfg.PostgresDBName, cfg.PostgresSSLMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	// Auto-migrate the models
	err = db.AutoMigrate(&model.Chat{}, &model.Message{}, &model.Knowledge{})
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Initialize Qdrant client
	vectorClient, err := vector.NewQdrantClient(cfg.QdrantHost, cfg.QdrantPort, cfg.QdrantAPIKey, nil) // OpenAI client will be set later
	if err != nil {
		log.Fatalf("Failed to create Qdrant client: %v", err)
	}
	// Ensure the collection exists (vector size for OpenAI Ada-002 is 1536)
	err = vectorClient.EnsureCollection(1536)
	if err != nil {
		log.Fatalf("Failed to ensure Qdrant collection: %v", err)
	}

	// Initialize OpenAI client
	openAIClient := openai.NewClient(cfg.OpenAIAPIKey)

	// Update vector client with OpenAI client (since we need it for embeddings)
	vectorClient.OpenAIClient = openAIClient

	// Initialize repository
	repo := repository.NewPostgresRepository(db)

	// Initialize service
	knowledgeService := service.NewKnowledgeService(repo, vectorClient, openAIClient)

	// Initialize handler
	chatHandler := handler.NewChatHandler(knowledgeService)

	// Set up Gin router
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// Routes
	r.POST("/chats", chatHandler.CreateChat)
	r.POST("/chats/:chatID/messages", chatHandler.SendMessage)
	r.GET("/chats/:chatID/messages", chatHandler.GetMessages)

	// Start HTTP server in a goroutine
	srvAddr := ":" + cfg.GinPort
	go func() {
		log.Printf("Starting HTTP server on %s", srvAddr)
		if err := r.Run(srvAddr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Set up NATS JetStream consumer for knowledge ingestion
	natsConsumer, err := nats.NewConsumer(
		cfg.NATSURL,
		cfg.NATSClusterID,
		cfg.NATSClientID,
		"bot.knowledge", // subject
		"KNOWLEDGE_STREAM", // stream
		"bot-service-consumer", // durable
		repo,
		vectorClient,
	)
	if err != nil {
		log.Fatalf("Failed to create NATS consumer: %v", err)
	}
	go func() {
		if err := natsConsumer.Start(); err != nil {
			log.Fatalf("Failed to start NATS consumer: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
}
}
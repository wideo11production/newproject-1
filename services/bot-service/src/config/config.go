package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

// Config holds all configuration for the bot service.
type Config struct {
	// Gin configuration
	GinMode string
	GinPort string

	// Postgres configuration
	PostgresHost     string
	PostgresPort     string
	PostgresUser     string
	PostgresPassword string
	PostgresDBName   string
	PostgresSSLMode  string

	// Qdrant configuration
	QdrantHost string
	QdrantPort string
	QdrantAPIKey string

	// OpenAI configuration
	OpenAIAPIKey string

	// NATS configuration
	NATSURL      string
	NATSClusterID string
	NATSClientID string

	// Other configurations
	Environment string
}

// LoadConfig loads configuration from .env file and environment variables.
func LoadConfig() (*Config, error) {
	// Load .env file if exists
	err := godotenv.Load()
	if err != nil {
		log.Println("No .env file found, relying on environment variables")
	}

	config := &Config{
		GinMode:          getEnv("GIN_MODE", "debug"),
		GinPort:          getEnv("GIN_PORT", "8080"),

		PostgresHost:     getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:     getEnv("POSTGRES_PORT", "5432"),
		PostgresUser:     getEnv("POSTGRES_USER", "postgres"),
		PostgresPassword: getEnv("POSTGRES_PASSWORD", "postgres"),
		PostgresDBName:   getEnv("POSTGRES_DB", "bot_service"),
		PostgresSSLMode:  getEnv("POSTGRES_SSLMODE", "disable"),

		QdrantHost:     getEnv("QDRANT_HOST", "localhost"),
		QdrantPort:     getEnv("QDRANT_PORT", "6333"),
		QdrantAPIKey:   getEnv("QDRANT_API_KEY", ""),

		OpenAIAPIKey:   getEnv("OPENAI_API_KEY", ""),

		NATSURL:        getEnv("NATS_URL", "nats://localhost:4222"),
		NATSClusterID:  getEnv("NATS_CLUSTER_ID", "test-cluster"),
		NATSClientID:   getEnv("NATS_CLIENT_ID", "bot-service"),

		Environment:    getEnv("ENVIRONMENT", "development"),
	}

	return config, nil
}

// getEnv gets an environment variable or returns a fallback value.
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
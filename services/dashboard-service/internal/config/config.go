package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

type Config struct {
	Port               int
	Database           DatabaseConfig
	Redis              RedisConfig
	PrometheusURL      string
	NATSURL            string
	LogLevel           string
	Environment        string
	// InternalServiceSecret gates the service-to-service alert-forwarding
	// endpoint. Read only server-side from env; validated at boot.
	InternalServiceSecret string
}

type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	SSLMode         string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		Port:          getEnvAsInt("PORT", 8080),
		PrometheusURL: getEnv("PROMETHEUS_URL", "http://prometheus:9090"),
		NATSURL:       getEnv("NATS_URL", "nats://nats:4222"),
		LogLevel:      getEnv("LOG_LEVEL", "info"),
		Environment:   getEnv("ENVIRONMENT", "development"),
		Database: DatabaseConfig{
			Host:            getEnv("DB_HOST", "localhost"),
			Port:            getEnvAsInt("DB_PORT", 5432),
			User:            getEnv("DB_USER", "postgres"),
			Password:        getEnv("DB_PASSWORD", "postgres"),
			Database:        getEnv("DB_NAME", "dashboard"),
			SSLMode:         getEnv("DB_SSL_MODE", "disable"),
			MaxOpenConns:    getEnvAsInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:    getEnvAsInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: time.Duration(getEnvAsInt("DB_CONN_MAX_LIFETIME", 300)) * time.Second,
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnvAsInt("REDIS_PORT", 6379),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvAsInt("REDIS_DB", 0),
		},
		InternalServiceSecret: getEnv("INTERNAL_SERVICE_SECRET", ""),
	}

	// Fail closed: the internal alert-forwarding endpoint is the only way the
	// alert pipeline becomes real-time. A missing secret means the endpoint would
	// either (a) reject every legitimate forward, killing the pipeline, or (b)
	// have to run unguarded to stay "working" - which lets anyone on the network
	// inject fake alerts into every dashboard. Refuse to boot in production
	// without it; warn otherwise.
	if cfg.Environment == "production" && cfg.InternalServiceSecret == "" {
		return nil, fmt.Errorf("INTERNAL_SERVICE_SECRET must be set when ENVIRONMENT=production")
	}
	if cfg.InternalServiceSecret == "" {
		cfg.InternalServiceSecret = getEnv("INTERNAL_SERVICE_SECRET", "dev-insecure-change-me")
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func (c *Config) ZapConfig() zap.Config {
	var zapCfg zap.Config
	if c.Environment == "production" {
		zapCfg = zap.NewProductionConfig()
	} else {
		zapCfg = zap.NewDevelopmentConfig()
	}
	zapCfg.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	return zapCfg
}
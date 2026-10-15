package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                 int
	Database             DatabaseConfig
	DashboardServiceURL  string
	// JWTSecretKey is the auth-service signing secret
	// (SSOT: the host's .env). Bound from
	// JWT_SECRET_KEY so this service can validate the
	// SAME tokens auth-service issues, instead of
	// keeping a second, drift-prone secret.
	JWTSecretKey         string
	LogLevel             string
	Environment          string
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

func Load() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		Port:                getEnvAsInt("PORT", 8081),
		DashboardServiceURL: getEnv("DASHBOARD_SERVICE_URL", "http://dashboard-service:8080"),
		JWTSecretKey:        getEnv("JWT_SECRET_KEY", ""),
		LogLevel:            getEnv("LOG_LEVEL", "info"),
		Environment:         getEnv("ENVIRONMENT", "development"),
		InternalServiceSecret: getEnv("INTERNAL_SERVICE_SECRET", ""),
		Database: DatabaseConfig{
			Host:            getEnv("DB_HOST", "localhost"),
			Port:            getEnvAsInt("DB_PORT", 5432),
			User:            getEnv("DB_USER", "postgres"),
			Password:        getEnv("DB_PASSWORD", "postgres"),
			Database:        getEnv("DB_NAME", "webhook_receiver"),
			SSLMode:         getEnv("DB_SSL_MODE", "disable"),
			MaxOpenConns:    getEnvAsInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:    getEnvAsInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: time.Duration(getEnvAsInt("DB_CONN_MAX_LIFETIME", 300)) * time.Second,
		},
	}

	// ---- Fail fast on a missing signing secret in production ----
	//
	// Ye secret auth-service ke tokens validate karne
	// ke liye hai. Production me ek empty secret ka
	// matlab hai service kisi bhi token ko validate
	// nahi kar sakti - silently request handle karna
	// nahi, fail fast karna chahiye, taaki galat
	// config chupke se live na jaye.
	if cfg.Environment == "production" && cfg.JWTSecretKey == "" {
		return nil, fmt.Errorf("JWT_SECRET_KEY must be set when ENVIRONMENT=production")
	}
	// The internal alert-forward path is only live when BOTH the dashboard URL
	// and the shared secret are present. In production a missing pair silently
	// disables real-time alerts (fail-open into "silently broken") - refuse to
	// boot rather than ship a dead pipeline.
	if cfg.Environment == "production" && (cfg.DashboardServiceURL == "" || cfg.InternalServiceSecret == "") {
		missing := []string{}
		if cfg.DashboardServiceURL == "" {
			missing = append(missing, "DASHBOARD_SERVICE_URL")
		}
		if cfg.InternalServiceSecret == "" {
			missing = append(missing, "INTERNAL_SERVICE_SECRET")
		}
		return nil, fmt.Errorf("production alert-forward is unconfigured (%s) - refusin to start", strings.Join(missing, ", "))
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
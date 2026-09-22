package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	CDN      CDNConfig
	NATS     NATSConfig
	Redis    RedisConfig
}

type ServerConfig struct {
	Port         string
	ReadTimeout  int
	WriteTimeout int
	IdleTimeout  int
}

type DatabaseConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Name     string
	SSLMode  string
	MaxOpen  int
	MaxIdle  int
}

type CDNConfig struct {
	DefaultProvider string
	// CloudFront
	CloudFrontAccessKeyID     string
	CloudFrontSecretAccessKey string
	CloudFrontDefaultRegion   string
	// Cloudflare
	CloudflareAPIToken string
	CloudflareEmail    string
	// Default cache settings
	DefaultTTL int
	MaxTTL     int
	MinTTL     int
}

type NATSConfig struct {
	URL           string
	ClusterID     string
	ClientID      string
	MaxReconnects int
	ReconnectWait time.Duration
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
	PoolSize int
}

func LoadConfig() (*Config, error) {
	return &Config{
		Server: ServerConfig{
			Port:         getEnv("CDN_SERVER_PORT", "8089"),
			ReadTimeout:  getEnvAsInt("CDN_SERVER_READ_TIMEOUT", 30),
			WriteTimeout: getEnvAsInt("CDN_SERVER_WRITE_TIMEOUT", 30),
			IdleTimeout:  getEnvAsInt("CDN_SERVER_IDLE_TIMEOUT", 120),
		},
		Database: DatabaseConfig{
			Host:     getEnv("CDN_DB_HOST", "localhost"),
			Port:     getEnvAsInt("CDN_DB_PORT", 5432),
			User:     getEnv("CDN_DB_USER", "postgres"),
			Password: getEnv("CDN_DB_PASSWORD", "postgres"),
			Name:     getEnv("CDN_DB_NAME", "cdn_service"),
			SSLMode:  getEnv("CDN_DB_SSL_MODE", "disable"),
			MaxOpen:  getEnvAsInt("CDN_DB_MAX_OPEN", 25),
			MaxIdle:  getEnvAsInt("CDN_DB_MAX_IDLE", 5),
		},
		CDN: CDNConfig{
			DefaultProvider:           getEnv("CDN_DEFAULT_PROVIDER", "cloudfront"),
			CloudFrontAccessKeyID:     getEnv("CDN_CLOUDFRONT_ACCESS_KEY_ID", ""),
			CloudFrontSecretAccessKey: getEnv("CDN_CLOUDFRONT_SECRET_ACCESS_KEY", ""),
			CloudFrontDefaultRegion:   getEnv("CDN_CLOUDFRONT_DEFAULT_REGION", "us-east-1"),
			CloudflareAPIToken:        getEnv("CDN_CLOUDFLARE_API_TOKEN", ""),
			CloudflareEmail:           getEnv("CDN_CLOUDFLARE_EMAIL", ""),
			DefaultTTL:                getEnvAsInt("CDN_DEFAULT_TTL", 86400),
			MaxTTL:                    getEnvAsInt("CDN_MAX_TTL", 31536000),
			MinTTL:                    getEnvAsInt("CDN_MIN_TTL", 0),
		},
		NATS: NATSConfig{
			URL:           getEnv("CDN_NATS_URL", "nats://localhost:4222"),
			ClusterID:     getEnv("CDN_NATS_CLUSTER_ID", "wideo11"),
			ClientID:      getEnv("CDN_NATS_CLIENT_ID", "cdn-service"),
			MaxReconnects: getEnvAsInt("CDN_NATS_MAX_RECONNECTS", -1),
			ReconnectWait: time.Duration(getEnvAsInt("CDN_NATS_RECONNECT_WAIT", 2)) * time.Second,
		},
		Redis: RedisConfig{
			Host:     getEnv("CDN_REDIS_HOST", "localhost"),
			Port:     getEnvAsInt("CDN_REDIS_PORT", 6379),
			Password: getEnv("CDN_REDIS_PASSWORD", ""),
			DB:       getEnvAsInt("CDN_REDIS_DB", 0),
			PoolSize: getEnvAsInt("CDN_REDIS_POOL_SIZE", 10),
		},
	}, nil
}

func (c *DatabaseConfig) DSN() string {
	return "host=" + c.Host + " port=" + strconv.Itoa(c.Port) + " user=" + c.User + " password=" + c.Password + " dbname=" + c.Name + " sslmode=" + c.SSLMode
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
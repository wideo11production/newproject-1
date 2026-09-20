package config

import (
	"github.com/spf13/viper"
)

type Config struct {
	Environment   string
	Port          string
	Version       string
	DatabaseURL   string
	RedisURL      string
	NATSURL       string
	JWTSecret     string
	LogLevel      string
}

func Load() *Config {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath("/etc/config-service")

	// Set defaults
	viper.SetDefault("environment", "development")
	viper.SetDefault("port", "8080")
	viper.SetDefault("version", "0.0.1")
	viper.SetDefault("database_url", "postgresql://postgres:postgres@localhost:5432/wideo11?sslmode=disable")
	viper.SetDefault("redis_url", "redis://localhost:6379")
	viper.SetDefault("nats_url", "nats://localhost:4222")
	viper.SetDefault("jwt_secret", "change-me-in-production")
	viper.SetDefault("log_level", "info")

	// Environment variable overrides
	viper.AutomaticEnv()
	viper.BindEnv("environment", "ENVIRONMENT")
	viper.BindEnv("port", "PORT")
	viper.BindEnv("version", "VERSION")
	viper.BindEnv("database_url", "DATABASE_URL")
	viper.BindEnv("redis_url", "REDIS_URL")
	viper.BindEnv("nats_url", "NATS_URL")
	viper.BindEnv("jwt_secret", "JWT_SECRET")
	viper.BindEnv("log_level", "LOG_LEVEL")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			panic(err)
		}
	}

	return &Config{
		Environment: viper.GetString("environment"),
		Port:        viper.GetString("port"),
		Version:     viper.GetString("version"),
		DatabaseURL: viper.GetString("database_url"),
		RedisURL:    viper.GetString("redis_url"),
		NATSURL:     viper.GetString("nats_url"),
		JWTSecret:   viper.GetString("jwt_secret"),
		LogLevel:    viper.GetString("log_level"),
	}
}
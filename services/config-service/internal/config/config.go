package config

import (
	"github.com/spf13/viper"
	"strings"
)

type Config struct {
	Environment string
	Port        string
	Version     string
	DatabaseURL string
	RedisURL    string
	NATSURL     string
	JWTSecret   string
	LogLevel    string
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
	// ---- ENVIRONMENT VARIABLES NEED THIS LINE TO WORK AT ALL ----
	//
	// Viper looks up an env var by upper-casing the key and replacing the
	// SEPARATOR - but only when `SetEnvKeyReplacer` says what the separator is.
	// Without it, `security.internal_token` is looked up as
	// `SECURITY.INTERNAL_TOKEN`, with a literal dot, which nothing sets.
	//
	// The result is silent: no error, no warning, the process starts, and every
	// value arrives as its zero value. A security setting that was configured
	// reads as DISABLED.
	//
	// This is not theoretical. `analytics-service` was about to start with no
	// authentication because of it, and the only reason that was caught was a
	// fail-closed startup check refusing to run. 25 of the 28 viper services in
	// this tree had the same defect - see SERVICE-TRIAGE.md.
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

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

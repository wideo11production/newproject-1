package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	VAPID    VAPIDConfig
	RateLimit RateLimitConfig
	NATS     NATSConfig
}

type NATSConfig struct {
	URLs              []string
	Stream            string
	PushSubject       string
	DurableConsumer   string
}

type ServerConfig struct {
	Port         string
	Mode         string
	ReadTimeout  int
	WriteTimeout int
}

type DatabaseConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
	SSLMode  string
	TimeZone string
}

type VAPIDConfig struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

type RateLimitConfig struct {
	BatchSize    int
	Interval     time.Duration
	MaxRetries   int
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/push-service")

	viper.AutomaticEnv()

	setDefaults()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func setDefaults() {
	viper.SetDefault("server.port", "8084")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "push_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("vapid.subject", "mailto:admin@wideo11.com")

	viper.SetDefault("ratelimit.batch_size", 100)
	viper.SetDefault("ratelimit.interval", "5s")
	viper.SetDefault("ratelimit.max_retries", 5)

	viper.SetDefault("nats.urls", []string{"nats://localhost:4222"})
	viper.SetDefault("nats.stream", "NOTIFICATION")
	viper.SetDefault("nats.push_subject", "NOTIFICATION.push")
	viper.SetDefault("nats.durable_consumer", "push-service")
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Routes   []RouteConfig
}

type ServerConfig struct {
	Port         string
	Mode         string
	ReadTimeout  int
	WriteTimeout int
}

type RouteConfig struct {
	Path       string
	Service    string
	ServiceURL string
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/gateway-service")

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
	viper.SetDefault("server.port", "8088")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	// Define default routes
	viper.Set("routes", []interface{}{
		map[string]interface{}{
			"path":       "/auth",
			"service":    "auth-service",
			"serviceURL": "http://localhost:8081",
		},
		map[string]interface{}{
			"path":       "/user",
			"service":    "user-service",
			"serviceURL": "http://localhost:8084",
		},
		map[string]interface{}{
			"path":       "/email",
			"service":    "email-service",
			"serviceURL": "http://localhost:8085",
		},
		map[string]interface{}{
			"path":       "/profile",
			"service":    "profile-service",
			"serviceURL": "http://localhost:8086",
		},
		map[string]interface{}{
			"path":       "/settings",
			"service":    "settings-service",
			"serviceURL": "http://localhost:8087",
		},
	})
}

func (c *Config) GetRoutes() []RouteConfig {
	var routes []RouteConfig
	err := viper.UnmarshalKey("routes", &routes)
	if err != nil {
		return []RouteConfig{}
	}
	return routes
}
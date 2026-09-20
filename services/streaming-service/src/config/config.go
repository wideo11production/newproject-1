package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig
	Streaming StreamingConfig
}

type ServerConfig struct {
	Port         string
	Mode         string
	ReadTimeout  int
	WriteTimeout int
}

type StreamingConfig struct {
	MinioEndpoint string
	MinioBucket  string
	MinioSecure  bool
	MinioAccessKey string
	MinioSecretKey string
	URLSignExpiry string
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/streaming-service")

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
	viper.SetDefault("server.port", "8089")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("streaming.minio.endpoint", "localhost:9000")
	viper.SetDefault("streaming.minio.bucket", "video-uploads")
	viper.SetDefault("streaming.minio.secure", false)
	viper.SetDefault("streaming.minio.access_key", "minioadmin")
	viper.SetDefault("streaming.minio.secret_key", "minioadmin")
	viper.SetDefault("streaming.url_sign_expiry", "24h")
}

func (c *StreamingConfig) GetURLSignExpiry() string {
	return c.URLSignExpiry
}

func (c *ServerConfig) Addr() string {
	return ":" + c.Port
}

var _ = fmt.Sprintf

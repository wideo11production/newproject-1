package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server        ServerConfig
	Database      DatabaseConfig
	Minio         MinioConfig
	Quota         QuotaConfig
	ContentSafety ContentSafetyConfig
}

type ContentSafetyConfig struct {
	Enabled              bool   `mapstructure:"enabled"`
	FFmpegPath           string `mapstructure:"ffmpeg_path"`
	ONNXModelPath        string `mapstructure:"onnx_model_path"`
	MinConfidence        float32 `mapstructure:"min_confidence"`
	FrameSampleRate      int    `mapstructure:"frame_sample_rate"`      // 1 = every frame, 5 = every 5th frame
	MaxFramesToAnalyze   int    `mapstructure:"max_frames_to_analyze"`  // 0 = all frames
	BlacklistOnDetection bool   `mapstructure:"blacklist_on_detection"`
}

type QuotaConfig struct {
	// Per-user upload limits (from .env)
	MaxDailyUploads      int64 `mapstructure:"max_daily_uploads"`       // 0 = unlimited
	MaxFileSizeMB        int64 `mapstructure:"max_file_size_mb"`        // 0 = unlimited
	MaxConcurrentUploads int   `mapstructure:"max_concurrent_uploads"`  // 0 = unlimited
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

type MinioConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	Secure    bool
	ChunkSize int64
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/upload-service")

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
	viper.SetDefault("server.port", "8085")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "upload_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("minio.endpoint", "localhost:9000")
	viper.SetDefault("minio.access_key", "minioadmin")
	viper.SetDefault("minio.secret_key", "minioadmin")
	viper.SetDefault("minio.bucket", "video-uploads")
	viper.SetDefault("minio.secure", false)
	viper.SetDefault("minio.chunk_size", 5242880)

	// Quota defaults (0 = unlimited per user directive "unlimited")
	viper.SetDefault("quota.max_daily_uploads", 0)
	viper.SetDefault("quota.max_file_size_mb", 0)
	viper.SetDefault("quota.max_concurrent_uploads", 0)

	// Content Safety defaults
	viper.SetDefault("content_safety.enabled", false)
	viper.SetDefault("content_safety.ffmpeg_path", "ffmpeg")
	viper.SetDefault("content_safety.onnx_model_path", "/models/content_safety.onnx")
	viper.SetDefault("content_safety.min_confidence", 0.85)
	viper.SetDefault("content_safety.frame_sample_rate", 10)
	viper.SetDefault("content_safety.max_frames_to_analyze", 50)
	viper.SetDefault("content_safety.blacklist_on_detection", true)
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

func (c *MinioConfig) GetChunkSize() int64 {
	if c.ChunkSize <= 0 {
		return 5 * 1024 * 1024
	}
	return c.ChunkSize
}

func (c *MinioConfig) GetEndpoint() string {
	if c.Secure {
		return "https://" + c.Endpoint
	}
	return "http://" + c.Endpoint
}

var _ = time.Second

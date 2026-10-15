package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	FFmpeg   FFmpegConfig
	Whisper  WhisperConfig
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

type FFmpegConfig struct {
	Path string
}

type WhisperConfig struct {
	// BaseURL of a faster-whisper-server. Empty = not configured, and the
	// service reports transcription as unavailable rather than pretending.
	URL string
	// TimeoutSeconds for ONE transcription request. 0 = 10 minutes.
	TimeoutSeconds int
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/subtitle-service")

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
	viper.SetDefault("server.port", "8090")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "subtitle_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("ffmpeg.path", "ffmpeg")

	// Hinglish: pehle default `http://localhost:9000` tha. Port 9000 is project
	// me MINIO ka hai — yaani ye service bina soch-samjhe MinIO ko "whisper
	// server" maan ke hit karti thi. Ab default khaali hai: `Configured()`
	// false hoga aur `TranscribeAudio` saaf "not configured" error dega, bajaye
	// MinIO ke S3 XML response ko JSON parse karne ki koshish ke.
	//
	// Docker compose me aaye `whisper:8000` (faster-whisper-server) set hota hai.
	viper.SetDefault("whisper.url", "")
	// Ek transcription request ka timeout. 10 minute — 1 min audio CPU pe 10-60s
	// leta hai, aur lamba video usse zyada. Bina iske ek stuck request handler
	// ko hang kar deta hai.
	viper.SetDefault("whisper.timeout_seconds", 600)
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

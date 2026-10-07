package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server      ServerConfig
	Framerate   FramerateConfig
	Database    DatabaseConfig
	MinIO       MinIOConfig
	FFmpeg      FFmpegConfig
}

type ServerConfig struct {
	Port         string
	Mode         string
	ReadTimeout  int
	WriteTimeout int
}

type FramerateConfig struct {
	// AURA_HIGH_FRAMERATE_ENABLED master toggle.
	// Global on/off switch for ALL premium framerate features.
	// Default false — AURA Premium is dormant until license check passes.
	Enabled bool
	// MaxStandardFPS — standard tier ceiling (default 30, supports 25/30 drop).
	// All users capped here when global toggle is OFF or license is non-premium.
	MaxStandardFPS int
	// MaxHighFPS — high tier ceiling (default 60) for monthly/group plan subscribers.
	// Monthly/group plan waalon ka MAXIMUM ceiling — premium NOT unlocked.
	MaxHighFPS int
	// AuraHighFPS — 120 FPS, ONLY for active lifetime single-user AURA license.
	AuraHighFPS int
	// AuraPremiumFPS — 240 FPS, 240Hz display optimization (top tier).
	// Lifetime license + 240Hz display waalon ke liye.
	AuraPremiumFPS int
	// Display240HzOptimized — enables 240Hz display optimization path.
	Display240HzOptimized bool
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

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    bool
	Bucket    string
}

type FFmpegConfig struct {
	Path string
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/video-service")

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
	viper.SetDefault("server.port", "8083")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "video_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("minio.endpoint", "localhost:9000")
	viper.SetDefault("minio.access_key", "minioadmin")
	viper.SetDefault("minio.secret_key", "minioadmin")
	viper.SetDefault("minio.use_ssl", false)
	viper.SetDefault("minio.bucket", "video")

	viper.SetDefault("ffmpeg.path", "ffmpeg")

	viper.SetDefault("framerate.enabled", false)
	viper.SetDefault("framerate.max_standard_fps", 30)
	viper.SetDefault("framerate.max_high_fps", 60)
	viper.SetDefault("framerate.aura_high_fps", 120)
	viper.SetDefault("framerate.aura_premium_fps", 240)
	viper.SetDefault("framerate.display_240hz_optimized", true)
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

package config

import (
	"fmt"
	"time"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

type Config struct {
	Server   ServerConfig
	MinIO    MinIOConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Transcode TranscodeConfig
	Worker    WorkerConfig
}

type ServerConfig struct {
	Port         string        `koanf:"port"`
	Mode         string        `koanf:"mode"`
	ReadTimeout  time.Duration `koanf:"read_timeout"`
	WriteTimeout time.Duration `koanf:"write_timeout"`
}

type MinIOConfig struct {
	Endpoint     string        `koanf:"endpoint"`
	AccessKey    string        `koanf:"access_key"`
	SecretKey    string        `koanf:"secret_key"`
	UseSSL       bool          `koanf:"use_ssl"`
	BucketName   string        `koanf:"bucket_name"`
}

type DatabaseConfig struct {
	Host     string `koanf:"host"`
	Port     int    `koanf:"port"`
	User     string `koanf:"user"`
	Password string `koanf:"password"`
	DBName   string `koanf:"dbname"`
	SSLMode  string `koanf:"sslmode"`
	TimeZone string `koanf:"timezone"`
}

type RedisConfig struct {
	Host     string `koanf:"host"`
	Port     int    `koanf:"port"`
	Password string `koanf:"password"`
	DB       int    `koanf:"db"`
}

type TranscodeConfig struct {
	OutputBucket     string        `koanf:"output_bucket"`
	TempStoragePath  string        `koanf:"temp_storage_path"`
	FFmpegPath       string        `koanf:"ffmpeg_path"`
	FFprobePath      string        `koanf:"ffprobe_path"`
	Preset           string        `koanf:"preset"` // e.g., "medium", "fast", "slow"
	CRF              int           `koanf:"crf"`    // Constant Rate Factor (18-28, lower is better quality)
	MaxWidth         int           `koanf:"max_width"`
	MaxHeight        int           `koanf:"max_height"`
	KeyframeInterval int           `koanf:"keyframe_interval"` // GOP size
	Profile          string        `koanf:"profile"` // H.264 profile (baseline, main, high)
}

type WorkerConfig struct {
	PoolSize         int           `koanf:"pool_size"` // Number of concurrent workers
	QueueSize        int           `koanf:"queue_size"` // Maximum queued jobs
	PollInterval     time.Duration `koanf:"poll_interval"` // How often to check for new jobs
	JobTimeout       time.Duration `koanf:"job_timeout"` // Maximum time per job
	MaxRetries       int           `koanf:"max_retries"` // Maximum retry attempts
}

func LoadConfig(path string) (*Config, error) {
	k := koanf.New(".")
	if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
		return nil, err
	}

	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

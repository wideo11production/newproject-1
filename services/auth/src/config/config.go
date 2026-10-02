package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Biometric BiometricConfig
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

type BiometricConfig struct {
	// WebAuthn specific settings
	RPID                   string        // Relying Party ID (domain)
	RPName                 string        // Relying Party Name
	Origin                 string        // The origin (scheme://host:port) of the web app
	IconURL                string        // Optional icon URL
	Timeout                time.Duration // Timeout for WebAuthn operations
	Attestation            string        // Preference for attestation conveyance (none, indirect, direct)
	AuthenticatorSelection struct {
		AuthenticatorAttachment string // "platform" or "cross-platform"
		RequireResidentKey      bool
		UserVerification        string // "required", "preferred", "discouraged"
	}
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/biometric-service")

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
	viper.SetDefault("server.port", "8081")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "biometric_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("biometric.rpid", "localhost")
	viper.SetDefault("biometric.rpname", "Wideo11")
	viper.SetDefault("biometric.origin", "http://localhost:3000")
	viper.SetDefault("biometric.timeout", 5) // minutes
	viper.SetDefault("biometric.attestation", "none")
	viper.SetDefault("biometric.authenticator_selection.authenticator_attachment", "cross-platform")
	viper.SetDefault("biometric.authenticator_selection.require_resident_key", false)
	viper.SetDefault("biometric.authenticator_selection.user_verification", "preferred")
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

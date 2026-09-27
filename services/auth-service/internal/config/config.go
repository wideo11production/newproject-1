package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server       ServerConfig
	Database     DatabaseConfig
	Redis        RedisConfig
	JWT          JWTConfig
	Log          LogConfig
	Verification VerificationConfig
	Email        EmailConfig
	Purge        PurgeConfig
	WebAuthn     WebAuthnConfig
}

// WebAuthnConfig WebAuthn (biometric/passkey) ke relying-party settings hold karta hai.
//
// RPID aur Origin browser ke saath match hone CHAHIYE, warna browser
// "SecurityError: The operation is insecure" dekar registration refuse kar dega.
// Ye values SSOT .env se aati hain - code me hardcoded kuch nahi.
// Hinglish: RP ID aur origin browser se match karne zaroori hain
type WebAuthnConfig struct {
	// RPID: relying party id - usually your domain (e.g. "localhost" for local dev)
	RPID string `mapstructure:"rpid"`
	// RPDisplayName: browser prompt me dikhne wala naam
	RPDisplayName string `mapstructure:"rp_display_name"`
	// RPOrigins: allowed origins (comma separated). Browser isko verify karta hai.
	RPOrigins string `mapstructure:"rp_origins"`
	// SessionTimeoutMinutes: challenge validity (minutes)
	SessionTimeoutMinutes int `mapstructure:"session_timeout_minutes"`
}

// VerificationConfig controls the email-verification lifecycle.
//
// TTLMinutes default 30 hai - yaani agar user 30 minute me verification link
// par click nahi karta, to uska account permanently purge ho jata hai.
// Ye value SSOT .env se aati hai (VERIFICATION_TTL_MINUTES), hardcoded nahi.
// Hinglish: 30 minute ka verification window
type VerificationConfig struct {
	// TTLMinutes: kitne minute me link expire hoga. Default 30.
	TTLMinutes int `mapstructure:"ttl_minutes"`
	// BaseURL: verification link ka base, jaise https://app.wideo11.com
	// Isse email me clickable link banta hai
	BaseURL string `mapstructure:"base_url"`
	// PurgeEnabled: agar false ho to purge worker chalega hi nahi
	PurgeEnabled bool `mapstructure:"purge_enabled"`
}

// EmailConfig configures outbound email.
//
// DESIGN DECISION (cost + SSOT): Ye service koi paid provider (SendGrid/Mailgun/
// SES paid tier) use nahi karta. SMTP_HOST khali hone par Dispatcher console/log
// transport use karta hai - yaani local dev me email log me dikhta hai aur koi
// paisa nahi lagta. Production me SMTP_HOST set karne par real SMTP bhejta hai.
// Hinglish: paid service nahi, khud ka SMTP ya console log
type EmailConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	From     string `mapstructure:"from"`
	// FromName: email me dikhne wala naam, jaise "Wideo11 Security"
	FromName string `mapstructure:"from_name"`
	// UseTLS: STARTTLS on karna hai ya nahi
	UseTLS bool `mapstructure:"use_tls"`
	// InsecureSkipVerify: sirf local testing ke liye - production me false rehna chahiye
	InsecureSkipVerify bool `mapstructure:"insecure_skip_verify"`
}

// PurgeConfig controls the background purge worker.
type PurgeConfig struct {
	// IntervalSeconds: worker kitni der baar chalega. Default 60s.
	IntervalSeconds int `mapstructure:"interval_seconds"`
	// BatchSize: ek run me kitne rows purge karne hain
	BatchSize int `mapstructure:"batch_size"`
	// Enabled: purge worker on/off
	Enabled bool `mapstructure:"enabled"`
}

type ServerConfig struct {
	Port         string
	Mode         string
	ReadTimeout  int
	WriteTimeout int
	// BcryptCost: mapstructure tag zaroori hai. Bina iske viper ka key
	// "server.bcrypt_cost" is field se match nahi hota (underscore vs camelCase),
	// aur value 0 reh jati thi - jisse cost galti se MinCost(10) par gir jata tha.
	// Hinglish: mapstructure tag ke bina SSOT ka bcrypt cost apply nahi hota tha
	BcryptCost int `mapstructure:"bcrypt_cost"`
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

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
}

type JWTConfig struct {
	// SecretKey: JWT signing key
	//
	// CRITICAL SECURITY BUG FIX: mapstructure tag ZAROORI tha. Bina iske viper ka
	// key "jwt.secret_key" is field se match nahi hota (snake_case vs camelCase),
	// jisse value EMPTY reh jati thi - aur service EMPTY SECRET se tokens sign
	// kar rahi thi. Empty-key HMAC tokens ATTACKER forge kar sakta hai.
	// Ye bug TTL wale bug ka bhai hai (dono snake_case mapping theek nahi hui thi).
	// Ab tag laga hai to .env ka JWT_SECRET_KEY properly bind hota hai.
	SecretKey string `mapstructure:"secret_key"`
	// AccessTokenTTL: minutes me token validity
	//
	// CRITICAL BUG FIX: mapstructure tag ZAROORI hai. Bina iske viper ka key
	// "jwt.access_token_ttl" is field se match nahi hota (snake_case vs camelCase),
	// value 0 reh jati thi. Phir token ka exp == iat ho jata tha - yaani token
	// TURANT expire ho jata tha aur har protected API call "token expired"
	// fail ho jati thi login ke turant baad.
	// Hinglish: mapstructure tag ke bina token 0-minute ka tha - turant expire
	AccessTokenTTL  int `mapstructure:"access_token_ttl"` // minutes
	RefreshTokenTTL int `mapstructure:"refresh_token_ttl"` // days
	Issuer          string
	Audience        string
}

type LogConfig struct {
	Level  string
	Format string
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/auth-service")

	viper.AutomaticEnv()

	// Env key replacer: viper AutomaticEnv me dots ko underscores me convert nahi karta.
	// Bina iske viper "DATABASE.HOST" jaisa env name dhundhta hai jo exist nahi karta,
	// aur container ke .env variables silently ignore ho jaate hain - service default
	// (localhost) par chali jaati hai. Ye replacer DATABASE_HOST / JWT_SECRET_KEY
	// jaise standard env names ko bind karta hai. (billing-service me yahi bug tha)
	// Hinglish: bina iske SSOT .env kaam hi nahi karega
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
	viper.SetDefault("server.port", "8080")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)
	viper.SetDefault("server.bcrypt_cost", 12)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "auth_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("redis.host", "localhost")
	viper.SetDefault("redis.port", 6379)
	viper.SetDefault("redis.password", "")
	viper.SetDefault("redis.db", 0)

	viper.SetDefault("jwt.secret_key", "your-secret-key-change-in-production")
	viper.SetDefault("jwt.access_token_ttl", 15)
	viper.SetDefault("jwt.refresh_token_ttl", 7)
	viper.SetDefault("jwt.issuer", "wideo11-auth")
	viper.SetDefault("jwt.audience", "wideo11-api")

	viper.SetDefault("log.level", "info")
	viper.SetDefault("log.format", "json")

	// Verification defaults - 30 minute window jaisa product spec me hai
	viper.SetDefault("verification.ttl_minutes", 30)
	viper.SetDefault("verification.base_url", "http://localhost:3000")
	viper.SetDefault("verification.purge_enabled", true)

	// Email defaults - SMTP_HOST khaali rakhne par console transport use hoga
	viper.SetDefault("email.host", "")
	viper.SetDefault("email.port", 587)
	viper.SetDefault("email.user", "")
	viper.SetDefault("email.password", "")
	viper.SetDefault("email.from", "no-reply@wideo11.com")
	viper.SetDefault("email.from_name", "Wideo11 Security")
	viper.SetDefault("email.use_tls", true)
	viper.SetDefault("email.insecure_skip_verify", false)

	// Purge worker defaults - har 60 second me chalega
	viper.SetDefault("purge.interval_seconds", 60)
	viper.SetDefault("purge.batch_size", 100)
	viper.SetDefault("purge.enabled", true)

	// WebAuthn defaults - local dev ke liye "localhost"
	// NOTE: RPID aur Origin ko browser ke saath EXACTLY match hona chahiye,
	// warna browser "insecure context" error dekar registration refuse kar deta hai.
	// Production me ye apne real domain pe set karenge.
	viper.SetDefault("webauthn.rpid", "localhost")
	viper.SetDefault("webauthn.rp_display_name", "Wideo11")
	viper.SetDefault("webauthn.rp_origins", "http://localhost:3000")
	viper.SetDefault("webauthn.session_timeout_minutes", 5)
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}
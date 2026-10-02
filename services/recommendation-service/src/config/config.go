package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all configuration for the recommendation service
// सारा कॉन्फिगरेशन .env से लोड होता है (SSOT - Single Source of Truth)
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	NATS     NATSConfig
	AI       AIConfig
	Search   SearchConfig
	Feed     FeedConfig
	I18n     I18nConfig
	Currency CurrencyConfig
	// Universal Multi-Country Logic Matrices
	MinimumBalanceBuffer  int     // ₹2000 Minimum Balance (INR) - held from earnings after profits
	SisterSharePercentage float64 // 5% share for Sister's dashboard
	HpaAutoScalingLimit   int     // 76% auto-scaling limit for Kubernetes HPA
	CountrySpecific       map[string]CountrySpecificConfig
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
	Port         string
	Host         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// DatabaseConfig holds PostgreSQL database configuration
type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Name            string
	SSLMode         string
	TimeZone        string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// DSN returns the PostgreSQL connection string
func (d *DatabaseConfig) DSN() string {
	return "host=" + d.Host + " port=" + strconv.Itoa(d.Port) + " user=" + d.User + " password=" + d.Password + " dbname=" + d.Name + " sslmode=" + d.SSLMode + " TimeZone=" + d.TimeZone
}

// NATSConfig holds NATS JetStream configuration
// NATS JetStream इवेंट बस के लिए कॉन्फिगरेशन - 7 इवेंट स्ट्रीम टोपोलॉजी
type NATSConfig struct {
	URL            string
	StreamPrefix   string
	Subjects       NATSSubjects
	ConsumerConfig NATSConsumerConfig
}

// NATSSubjects defines the 7 event stream topologies
// 7 इवेंट स्ट्रीम टोपोलॉजी: VIDEO, WALLET, USER, CONTENT, ANALYTICS, NOTIFICATION, SYSTEM
type NATSSubjects struct {
	Video        string
	Wallet       string
	User         string
	Content      string
	Analytics    string
	Notification string
	System       string
}

// NATSConsumerConfig holds consumer configuration
type NATSConsumerConfig struct {
	DurableName    string
	AckPolicy      string
	MaxDeliver     int
	AckWait        time.Duration
	MaxAckPending  int
	FilterSubjects []string
}

// AIConfig holds local AI (Ollama) configuration
// फ्री लोकल AI (Ollama) इंटीग्रेशन के लिए कॉन्फिगरेशन
type AIConfig struct {
	BaseURL     string
	Model       string
	Timeout     time.Duration
	MaxTokens   int
	Temperature float64
	EnableCache bool
	CacheTTL    time.Duration
}

// SearchConfig holds PostgreSQL full-text search configuration
// PostgreSQL नेटिव tsvector/tsquery फुल-टेक्स्ट सर्च कॉन्फिगरेशन
type SearchConfig struct {
	Language        string
	Dictionary      string
	FuzzyThreshold  float64
	AutoCompleteMax int
	IndexBatchSize  int
	ReindexInterval time.Duration
}

// FeedConfig holds feed generation configuration
type FeedConfig struct {
	FollowingFeedLimit    int
	TrendingFeedLimit     int
	DiscoveryFeedLimit    int
	MaxFeedItems          int
	ScoreWeights          FeedScoreWeights
	CacheTTL              time.Duration
	RefreshInterval       time.Duration
	DiversityFactor       float64
	FreshnessWeight       float64
	EngagementWeight      float64
	PersonalizationWeight float64
}

// FeedScoreWeights holds weights for feed scoring algorithm
type FeedScoreWeights struct {
	FollowScore        float64
	EngagementScore    float64
	RecencyScore       float64
	DiversityScore     float64
	LanguageMatchScore float64
	CurrencyMatchScore float64
	AIInferenceScore   float64
}

// I18nConfig holds internationalization configuration
// मल्टी-लैंग्वेज सपोर्ट - 7 लोकल i18n पैकेज फॉर्मेट
type I18nConfig struct {
	DefaultLanguage string
	SupportedLangs  []string
	FallbackLang    string
	DateFormats     map[string]string
	NumberFormats   map[string]string
}

// CurrencyConfig holds multi-currency configuration
// मल्टी-करेंसी सपोर्ट - डायनामिक करेंसी वैल्यू स्ट्रक्चर
type CurrencyConfig struct {
	DefaultCurrency     string
	SupportedCurrencies []string
	ExchangeRateAPI     string
	CacheTTL            time.Duration
}

// CountrySpecificConfig holds country-specific logic matrices
// देश-विशिष्ट तर्क मैट्रिक्स - क्षेत्र-विशिष्ट नियम, non-refundable सीमाएँ, डिवाइस प्रोफ़ाइल लॉक
type CountrySpecificConfig struct {
	MinimumBalanceBuffer  int    // local currency units (e.g., USD for US, CAD for Canada)
	NonRefundableBoundary bool   // if true, transactions are non-refundable after this boundary (e.g., time-based or amount-based)
	DeviceProfileLock     string // e.g., "strict", "moderate", "lenient" - locks device profile to prevent refund liabilities
}

// LoadConfig loads configuration from .env file (SSOT)
// कॉन्फिगरेशन .env से लोड होता है - Single Source of Truth
func LoadConfig() (*Config, error) {
	viper.SetConfigFile(".env")
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

	// Default values - डिफॉल्ट मान
	setDefaults()

	if err := viper.ReadInConfig(); err != nil {
		// .env फाइल नहीं मिली तो एनवायरनमेंट वेरिएबल्स का उपयोग करें
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	cfg := &Config{}
	if err := viper.Unmarshal(cfg); err != nil {
		return nil, err
	}

	// Build CountrySpecific map from viper settings
	if cfg.CountrySpecific == nil {
		cfg.CountrySpecific = make(map[string]CountrySpecificConfig)
	}
	countries := []string{"US", "CA", "GLOBAL"}
	for _, country := range countries {
		prefix := "COUNTRY_" + country
		minBuffer := viper.GetInt(prefix + "_MINIMUM_BALANCE_BUFFER")
		nonRefundable := viper.GetBool(prefix + "_NON_REFUNDABLE_BOUNDARY")
		deviceLock := viper.GetString(prefix + "_DEVICE_PROFILE_LOCK")
		// If the value is zero (for int) or empty string (for string) and we didn't set a default via viper, we might have an issue.
		// But we set defaults in setDefaults, so they should be set.
		// However, to be safe, we'll check if the value was actually provided by viper or is the zero value from not being set.
		// Since we set defaults in setDefaults, we can assume they are set, but we'll use the values we got.
		cfg.CountrySpecific[country] = CountrySpecificConfig{
			MinimumBalanceBuffer:  minBuffer,
			NonRefundableBoundary: nonRefundable,
			DeviceProfileLock:     deviceLock,
		}
	}

	// Validate critical platform variables and country-specific configs
	if err := validateConfig(cfg); err != nil {
		panic("Configuration validation failed: " + err.Error())
	}

	return cfg, nil
}

// setDefaults sets default configuration values
func setDefaults() {
	// Server defaults
	viper.SetDefault("SERVER_PORT", "8086")
	viper.SetDefault("SERVER_HOST", "localhost")
	viper.SetDefault("SERVER_READ_TIMEOUT", "30s")
	viper.SetDefault("SERVER_WRITE_TIMEOUT", "30s")
	viper.SetDefault("SERVER_IDLE_TIMEOUT", "120s")

	// Database defaults
	viper.SetDefault("DB_HOST", "localhost")
	viper.SetDefault("DB_PORT", 5432)
	viper.SetDefault("DB_USER", "postgres")
	viper.SetDefault("DB_PASSWORD", "postgres")
	viper.SetDefault("DB_NAME", "recommendation_db")
	viper.SetDefault("DB_SSL_MODE", "disable")
	viper.SetDefault("DB_TIMEZONE", "UTC")
	viper.SetDefault("DB_MAX_OPEN_CONNS", 25)
	viper.SetDefault("DB_MAX_IDLE_CONNS", 25)
	viper.SetDefault("DB_CONN_MAX_LIFETIME", "5m")

	// NATS defaults
	viper.SetDefault("NATS_URL", "nats://localhost:4222")
	viper.SetDefault("NATS_STREAM_PREFIX", "RECOMMENDATION")
	viper.SetDefault("NATS_SUBJECT_VIDEO", "recommendation.video")
	viper.SetDefault("NATS_SUBJECT_WALLET", "recommendation.wallet")
	viper.SetDefault("NATS_SUBJECT_USER", "recommendation.user")
	viper.SetDefault("NATS_SUBJECT_CONTENT", "recommendation.content")
	viper.SetDefault("NATS_SUBJECT_ANALYTICS", "recommendation.analytics")
	viper.SetDefault("NATS_SUBJECT_NOTIFICATION", "recommendation.notification")
	viper.SetDefault("NATS_SUBJECT_SYSTEM", "recommendation.system")
	viper.SetDefault("NATS_CONSUMER_DURABLE", "recommendation-consumer")
	viper.SetDefault("NATS_ACK_POLICY", "explicit")
	viper.SetDefault("NATS_MAX_DELIVER", 3)
	viper.SetDefault("NATS_ACK_WAIT", "30s")
	viper.SetDefault("NATS_MAX_ACK_PENDING", 1000)

	// AI defaults (Ollama)
	viper.SetDefault("AI_BASE_URL", "http://localhost:11434")
	viper.SetDefault("AI_MODEL", "llama3.2")
	viper.SetDefault("AI_TIMEOUT", "30s")
	viper.SetDefault("AI_MAX_TOKENS", 2048)
	viper.SetDefault("AI_TEMPERATURE", 0.7)
	viper.SetDefault("AI_ENABLE_CACHE", true)
	viper.SetDefault("AI_CACHE_TTL", "1h")

	// Search defaults (PostgreSQL full-text)
	viper.SetDefault("SEARCH_LANGUAGE", "english")
	viper.SetDefault("SEARCH_DICTIONARY", "simple")
	viper.SetDefault("SEARCH_FUZZY_THRESHOLD", 0.6)
	viper.SetDefault("SEARCH_AUTOCOMPLETE_MAX", 10)
	viper.SetDefault("SEARCH_INDEX_BATCH_SIZE", 1000)
	viper.SetDefault("SEARCH_REINDEX_INTERVAL", "1h")

	// Feed defaults
	viper.SetDefault("FEED_FOLLOWING_LIMIT", 20)
	viper.SetDefault("FEED_TRENDING_LIMIT", 20)
	viper.SetDefault("FEED_DISCOVERY_LIMIT", 20)
	viper.SetDefault("FEED_MAX_ITEMS", 100)
	viper.SetDefault("FEED_CACHE_TTL", "5m")
	viper.SetDefault("FEED_REFRESH_INTERVAL", "10m")
	viper.SetDefault("FEED_DIVERSITY_FACTOR", 0.3)
	viper.SetDefault("FEED_FRESHNESS_WEIGHT", 0.25)
	viper.SetDefault("FEED_ENGAGEMENT_WEIGHT", 0.35)
	viper.SetDefault("FEED_PERSONALIZATION_WEIGHT", 0.4)

	// Score weights defaults
	viper.SetDefault("FEED_WEIGHT_FOLLOW", 0.3)
	viper.SetDefault("FEED_WEIGHT_ENGAGEMENT", 0.25)
	viper.SetDefault("FEED_WEIGHT_RECENCY", 0.2)
	viper.SetDefault("FEED_WEIGHT_DIVERSITY", 0.1)
	viper.SetDefault("FEED_WEIGHT_LANGUAGE_MATCH", 0.075)
	viper.SetDefault("FEED_WEIGHT_CURRENCY_MATCH", 0.075)
	viper.SetDefault("FEED_WEIGHT_AI_INFERENCE", 0.1)

	// I18n defaults
	viper.SetDefault("I18N_DEFAULT_LANG", "en")
	viper.SetDefault("I18N_SUPPORTED_LANGS", "en,hi,es,fr,de,zh,ja")
	viper.SetDefault("I18N_FALLBACK_LANG", "en")

	// Currency defaults
	viper.SetDefault("CURRENCY_DEFAULT", "USD")
	viper.SetDefault("CURRENCY_SUPPORTED", "USD,INR,EUR,GBP,JPY,CNY,AUD")
	viper.SetDefault("CURRENCY_EXCHANGE_API", "https://api.exchangerate-api.com/v4/latest")
	viper.SetDefault("CURRENCY_CACHE_TTL", "1h")

	// Parse comma-separated values
	viper.SetDefault("NATS_FILTER_SUBJECTS", "recommendation.video,recommendation.wallet,recommendation.user,recommendation.content,recommendation.analytics,recommendation.notification,recommendation.system")

	// Universal Multi-Country Logic Matrices defaults
	viper.SetDefault("MINIMUM_BALANCE_BUFFER", 2000) // ₹2000 INR
	viper.SetDefault("SISTER_SHARE_PERCENTAGE", 5.0) // 5%
	viper.SetDefault("HPA_AUTO_SCALING_LIMIT", 76)   // 76%

	// Country-specific defaults for US, Canada, and Global
	viper.SetDefault("COUNTRY_US_MINIMUM_BALANCE_BUFFER", 25) // $25 USD
	viper.SetDefault("COUNTRY_US_NON_REFUNDABLE_BOUNDARY", true)
	viper.SetDefault("COUNTRY_US_DEVICE_PROFILE_LOCK", "strict")

	viper.SetDefault("COUNTRY_CA_MINIMUM_BALANCE_BUFFER", 30) // $30 CAD
	viper.SetDefault("COUNTRY_CA_NON_REFUNDABLE_BOUNDARY", true)
	viper.SetDefault("COUNTRY_CA_DEVICE_PROFILE_LOCK", "strict")

	viper.SetDefault("COUNTRY_GLOBAL_MINIMUM_BALANCE_BUFFER", 2000) // Default to INR equivalent
	viper.SetDefault("COUNTRY_GLOBAL_NON_REFUNDABLE_BOUNDARY", true)
	viper.SetDefault("COUNTRY_GLOBAL_DEVICE_PROFILE_LOCK", "strict")
}

// validateConfig validates the loaded configuration
func validateConfig(cfg *Config) error {
	// Validate MinimumBalanceBuffer (should be positive)
	if cfg.MinimumBalanceBuffer <= 0 {
		return fmt.Errorf("MINIMUM_BALANCE_BUFFER must be positive, got %d", cfg.MinimumBalanceBuffer)
	}

	// Validate SisterSharePercentage (between 0 and 100)
	if cfg.SisterSharePercentage < 0 || cfg.SisterSharePercentage > 100 {
		return fmt.Errorf("SISTER_SHARE_PERCENTAGE must be between 0 and 100, got %.2f", cfg.SisterSharePercentage)
	}

	// Validate HpaAutoScalingLimit (between 1 and 100)
	if cfg.HpaAutoScalingLimit < 1 || cfg.HpaAutoScalingLimit > 100 {
		return fmt.Errorf("HPA_AUTO_SCALING_LIMIT must be between 1 and 100, got %d", cfg.HpaAutoScalingLimit)
	}

	// Validate CountrySpecific map is initialized
	if cfg.CountrySpecific == nil {
		return fmt.Errorf("CountrySpecific map is nil")
	}

	// Define required countries
	requiredCountries := []string{"US", "CA", "GLOBAL"}

	for _, country := range requiredCountries {
		config, exists := cfg.CountrySpecific[country]
		if !exists {
			return fmt.Errorf("missing country configuration for %s", country)
		}

		// Validate country-specific fields
		if config.MinimumBalanceBuffer <= 0 {
			return fmt.Errorf("country %s: MinimumBalanceBuffer must be positive, got %d", country, config.MinimumBalanceBuffer)
		}

		// NonRefundableBoundary is bool, no range validation needed

		// Validate DeviceProfileLock (allowed values)
		allowedLocks := map[string]bool{"strict": true, "moderate": true, "lenient": true}
		if !allowedLocks[config.DeviceProfileLock] {
			return fmt.Errorf("country %s: DeviceProfileLock must be one of strict, moderate, lenient, got %s", country, config.DeviceProfileLock)
		}
	}

	return nil
}

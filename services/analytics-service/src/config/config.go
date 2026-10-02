package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Security  SecurityConfig
	Telemetry TelemetryConfig
}

// TelemetryConfig - retention for the UI click ledger, plus the realtime
// firehose.
type TelemetryConfig struct {
	// RetentionDays is how long a UI click event is kept in the ledger.
	//
	// 90 days is the plan's number (`RETENTION_CLICK_EVENTS`). Long enough to
	// investigate a funnel, short enough to answer a deletion request without
	// arguing about it.
	//
	// Read from config rather than hardcoded because it is the number most
	// likely to be argued about, and the wrong value has a legal dimension as
	// well as a disk one.
	RetentionDays int `mapstructure:"retention_days"`

	// NATSURL is the JetStream endpoint for the realtime firehose.
	//
	// Empty DISABLES publishing, and that is a legitimate setting: a deployment
	// that only wants the ledger can leave it blank, and the click path behaves
	// exactly the same either way - the database write is what matters, and
	// publishing is best-effort by design.
	NATSURL string `mapstructure:"nats_url"`

	// PublishQueueSize bounds the in-memory queue.
	//
	// Bounded on purpose: full means DROP, never block. An unbounded queue would
	// convert a NATS outage into unbounded memory growth in the service, and then
	// into a latency spike on every user's click when it finally flushed.
	PublishQueueSize int `mapstructure:"publish_queue_size"`
}

// SecurityConfig - internal service-to-service authentication.
//
// WHY THIS EXISTS AT ALL
// ---------------------
// This service shipped with `gin.Logger()` + `gin.Recovery()` and nothing else,
// which means every route on it was open: anyone who could reach the container
// could write views, clicks, conversions and revenue, and read all of it back.
// On a compose network that is "anything else in the project", and this service
// records money-shaped events.
//
// It was never deployed, so nothing was ever exposed. That is luck, not a
// design decision, and adopting the service must not ship that state again.
//
// WHY ONE TOKEN AND NOT JWT
// -------------------------
// Only two callers exist: the apps' shared audit handler (writes) and the
// superadmin app (reads). Both are server-side and both already live in this
// trust boundary. Verifying JWTs here would mean copying the auth-service
// signing secret into a second service and widening its blast radius, in order
// to solve a problem these two callers do not have. The superadmin app
// authenticates its own users and proxies; this service only needs to know
// "is this one of ours".
//
// READS AND WRITES SHARE THE TOKEN on purpose: a second mechanism would be a
// second thing to get wrong, and the only reader is the superadmin app, which
// has already checked the human before it calls.
type SecurityConfig struct {
	// InternalToken is the shared secret in `X-Internal-Token`.
	InternalToken string `mapstructure:"internal_token"`
}

func (c SecurityConfig) Enabled() bool { return c.InternalToken != "" }

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

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("/etc/analytics-service")

	viper.AutomaticEnv()

	// ---- WITHOUT THIS LINE, NO ENV VAR EVER REACHES A NESTED KEY ----
	//
	// Viper maps a config key to an env var name by upper-casing it and
	// replacing the SEPARATOR with underscores - but only if you tell it what
	// the separator is. With no replacer configured it looks for
	// `SECURITY.INTERNAL_TOKEN`, dots and all, which nobody sets. Compose
	// passes `SECURITY_INTERNAL_TOKEN`, and viper silently ignores it.
	//
	// The failure is genuinely nasty, and it is why this service had never been
	// started before: nothing errors, nothing warns, the process boots, and
	// every value simply arrives as its zero value. Here that meant the internal
	// token read as empty and `ValidateForServe` refused to start - which is the
	// best possible outcome, because the alternative was a service running
	// with auth silently disabled.
	//
	// It is the same bug that `device_limit.enabled` had in auth-service, and
	// the same one 26 of the 28 services in `services/` still have. One line per
	// service; see `tools/fix-env-replacer.mjs`.
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
	viper.SetDefault("server.port", "8091")
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("server.read_timeout", 10)
	viper.SetDefault("server.write_timeout", 10)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "analytics_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	// No default for the token, deliberately.
	//
	// An empty default would make `Enabled()` false, and a service that starts
	// with auth silently disabled is the exact failure mode this middleware
	// exists to prevent. Instead main() REFUSES to start without one - see
	// `ValidateForServe`. Local development sets it in `.env` like everything
	// else; there is no dev-only bypass, because a bypass is a hole with an
	// extra step.
	viper.SetDefault("security.internal_token", "")

	// 90 days, matching SYSTEM-PLAN.md's `RETENTION_CLICK_EVENTS`. The zero-check
	// in main() falls back to the same constant, so the two can never drift
	// apart silently.
	viper.SetDefault("telemetry.retention_days", 90)

	// The compose-network address. Empty by default so a developer running the
	// service outside compose does not silently start publishing to something
	// unexpected.
	viper.SetDefault("telemetry.nats_url", "nats://nats:4222")
	viper.SetDefault("telemetry.publish_queue_size", 4096)
}

// ValidateForServe refuses a configuration that would run unprotected.
//
// This is the difference between "auth is on by default" and "auth is
// configured". A check that logs a warning is ignored in the one environment
// where it matters; a check that refuses to start is not.
func (c *Config) ValidateForServe() error {
	if !c.Security.Enabled() {
		return fmt.Errorf(
			"security.internal_token is empty: analytics-service would accept writes and reads " +
				"from anything that can reach it. Set ANALYTICS_INTERNAL_TOKEN (or security.internal_token) " +
				"rather than starting unprotected")
	}
	return nil
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

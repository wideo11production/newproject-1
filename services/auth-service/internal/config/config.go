package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	// NATS - security event audit stream (see NATSConfig for the failure
	// policy: audit only, never an auth decision)
	NATS         NATSConfig
	JWT          JWTConfig
	Log          LogConfig
	Verification VerificationConfig
	Email        EmailConfig
	Purge        PurgeConfig
	WebAuthn     WebAuthnConfig
	// Storage StorageConfig
	Storage StorageConfig
	// Security - response headers + CORS allowlist (Phase A / gap #2)
	Security SecurityConfig

	// Plans is the CAPABILITY catalogue - what each plan GRANTS, seeded into
	// entitlement_grants at boot.
	//
	// Deliberately separate from billing-service's subscription_plans, which is the
	// PRICE catalogue. Pricing moves when marketing does; capabilities move when
	// the product does. One table for both would make every price change a
	// migration on the entitlements table.
	Plans PlansConfig

	// DeviceLimit - "max N accounts per device" ka on/off switch
	//
	// NOTE: `mapstructure` tag ZAROORI hai. mapstructure field-name se key
	// dhoondta hai, aur wo underscore ko nahi maanta. Bina tag ke ye field
	// `devicelimit` key ke neeche dhoondhega, jabki viper ke paas key hai
	// `device_limit.*` - aur phir na env se value aati, na SetDefault, aur
	// field chup-chaap apni zero value (false) par reh jata hai.
	//
	// Ye waise hi `Server`/`JWT` fields par nahi dikhta kyunki unke naam
	// (`server`, `jwt`) already case-insensitive match karte hain. Isiliye
	// `DEVICE_LIMIT_ENABLED=true` set karne par bhi cap OFF hi rehta tha -
	// bina kisi error ke. Isi wajah se is toggle par test bhi hai
	// (`device_limit_env_test.go`).
	DeviceLimit DeviceLimitConfig `mapstructure:"device_limit"`
}

// DeviceLimitConfig device-per-account cap control karta hai.
//
// ----------------------------------------------------------------------------
// KYUN YE ENV SE DRIVABLE HAI
// ----------------------------------------------------------------------------
//
// SPEC me tha: ek device pe max 3 accounts, 4th pe reject. Ye rule production
// ke liye sahi hai - ek shared/compromised machine se ankhon accounts banana
// abuse ka signal hai.
//
// PAR local development me ye rule TODTA hai. Developer ke paas sirf EK laptop
// hota hai, aur wo baar-baar naye test accounts banata hai. 3 ke baad har
// register 403 `device_limit_exceeded` deta tha, aur developer ko lagta tha
// registration bug hai (wo asli reason nahi hai).
//
// Isliye ye ab .env se on/off hai:
//
//	DEVICE_LIMIT_ENABLED=false   -> limit OFF (unlimited accounts/device)
//	DEVICE_LIMIT_ENABLED=true    -> limit ON  (MAX_ACCOUNTS accounts/device)
//
// SECURITY NOTE: default `true` hai - yaani koi ye env var bhool jaye, to
// production behaviour SPEC ke mutabiq SEEDHA (limit chalu) rehta hai. Fail-open
// nahi, fail-secure. Local dev me jaan-boojh kar `false` karna padta hai.
type DeviceLimitConfig struct {
	// Enabled - false par device-per-account cap apply NAHI hota.
	Enabled bool `mapstructure:"enabled"`
	// MaxAccounts - limit ON hone par per-device account cap. Default 3 (SPEC).
	MaxAccounts int `mapstructure:"max_accounts"`
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

// NATSConfig configures the security-event audit stream.
//
// NOTE: ye sirf AUDIT ke liye hai - NATS par koi authentication decision nahi
// leta. Isliye NATS down hone par login chalta rehta hai, sirf event recording
// ruk jaati hai. Is failure policy ka rationale `internal/natsx` ke package
// comment me hai.
type NATSConfig struct {
	// URL e.g. "nats://nats:4222"
	URL string
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
	AccessTokenTTL  int `mapstructure:"access_token_ttl"`  // minutes
	RefreshTokenTTL int `mapstructure:"refresh_token_ttl"` // days
	Issuer          string
	Audience        string
}

type LogConfig struct {
	Level  string
	Format string
}

// SecurityConfig - security response headers + CORS allowlist.
//
// Phase A / gap #2: pehle koi security header set nahi hota tha, aur CORS
// `*` + credentials use karta tha (jo browsers reject karte hain aur jo
// CSRF ka darwaza kholta hai).
type SecurityConfig struct {
	// ---- CORS ----
	// AllowedOrigins: comma-separated origin allowlist, jaise
	// "http://localhost:3000,https://app.wideo11.com".
	//
	// SECURITY: `*` sirf tab safe hai jab credentials OFF hon. `*` +
	// credentials = "koi bhi site authenticated request bhej sakti hai".
	// Isliye production me explicit list do.
	AllowedOrigins string `mapstructure:"allowed_origins"`
	// AllowCredentials: cookies / Authorization header allow.
	AllowCredentials bool `mapstructure:"allow_credentials"`

	// ---- Headers ----
	// HSTSMaxAge: `Strict-Transport-Security` max-age (seconds).
	// 0 = off (default). Production me 31536000 (1 saal) rakho.
	HSTSMaxAge int `mapstructure:"hsts_max_age"`
	// HSTSIncludeSubdomains: `includeSubDomains` directive.
	HSTSIncludeSubdomains bool `mapstructure:"hsts_include_subdomains"`
	// CSP: Content-Security-Policy. Khaali = strict API default.
	CSP string `mapstructure:"csp"`
	// ReferrerPolicy, FrameOptions, PermissionsPolicy: khaali = secure default.
	ReferrerPolicy    string `mapstructure:"referrer_policy"`
	FrameOptions      string `mapstructure:"frame_options"`
	PermissionsPolicy string `mapstructure:"permissions_policy"`
}

// GetAllowedOrigins - comma-separated string ko cleaned slice me deta hai.
func (s *SecurityConfig) GetAllowedOrigins() []string {
	if s == nil || s.AllowedOrigins == "" {
		return []string{"http://localhost:3000"}
	}
	parts := strings.Split(s.AllowedOrigins, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return []string{"http://localhost:3000"}
	}
	return out
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
	// Plan catalogue read explicitly rather than through Unmarshal.
	//
	// These are flat scalar keys and reading them here means every price and
	// limit appears in ONE file where a reader can check them all at once.
	// A struct here would spread them across seven nested types.
	cfg.Plans = LoadPlans()

	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// -----------------------------------------------------------------------------
// Validate - refuse to start with a configuration that cannot be secure
// -----------------------------------------------------------------------------
//
// `LoadConfig` returns an error on failure, so this is a hard stop: `main`
// fatals before it binds a port. That ordering is the point - a service that
// listens before checking its signing key is briefly serving authenticated
// endpoints to nobody, and a health check that passes during that window is a
// health check that reported the wrong thing.
//
// The alternative - logging a warning - was tried. A warning in a log file is
// not a control: it is read once, by whoever happens to be looking, and the
// service then runs for months signing tokens with a public key.
//
// Only genuinely-fatal misconfigurations are here. Every optional field keeps a
// working default, because a validation list that cries wolf gets deleted.
func (c *Config) Validate() error {
	// ---- JWT signing key ----
	//
	// Required, and additionally checked against the two published values that
	// have been defaults in this codebase's history. Checking for "empty" alone
	// would not catch someone who copies an old `.env.example` - which is the
	// realistic failure, because that file is exactly where somebody looks.
	if c.JWT.SecretKey == "" {
		return errors.New(
			"JWT_SECRET_KEY is not set.\n" +
				"  This value signs every session in the product and every app's gate verifies\n" +
				"  against it. Without it there is no authentication, only the appearance of it.\n" +
				"  Generate one with:  openssl rand -base64 48")
	}
	for _, published := range KnownWeakJWTSecrets {
		if c.JWT.SecretKey == published {
			return fmt.Errorf(
				"JWT_SECRET_KEY is set to %q, which is published in this repository.\n"+
					"  Anyone who has read the source can forge a token with role:\"superadmin\".\n"+
					"  Generate a real one with:  openssl rand -base64 48", published)
		}
	}

	// Too-short keys are rejected rather than warned about: HMAC-SHA256 truncates
	// silently below its block size, so a 12-character key is accepted by every
	// library and provides far less than 48 bytes of strength.
	if len(c.JWT.SecretKey) < 32 {
		return fmt.Errorf(
			"JWT_SECRET_KEY is only %d characters. Use at least 32 (openssl rand -base64 48).",
			len(c.JWT.SecretKey))
	}

	return nil
}

// KnownWeakJWTSecrets lists every signing key that has ever been committed here.
//
// Checked explicitly rather than pattern-matched on "looks weak", because these
// are the exact strings that are already in the repository and in everybody's
// `.env.example`. A substring check would also reject a legitimate key that
// happened to contain one of them, and a check that produces false positives gets
// removed.
//
// This list is append-only. Removing an entry does not un-publish the key.
var KnownWeakJWTSecrets = []string{
	"your-secret-key-change-in-production",
	"dev-only-insecure-secret-change-me",
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

	// ---- STORAGE (MinIO) ----
	//
	// KYUN YE ZAROORI HAI (viper ka subtle behaviour):
	// `viper.AutomaticEnv()` ALONE se nested keys `Unmarshal` me nahi aate.
	// Viper ko har key pehle se JAANNA chahiye - yaani wo kisi config file
	// me listed ho, ya `SetDefault` se registered ho. Bina iske:
	//     container me STORAGE_ACCESS_KEY set tha
	//     par cfg.Storage.AccessKey KHAALI aa raha tha
	// Isliye ye saare keys yahan register karte hain.
	//
	// NOTE: default values khaali/development-friendly rakhe hain. Ye sirf
	// "key known hai" ensure karne ke liye hain - actual values env se aayenge.
	viper.SetDefault("storage.enabled", true)
	viper.SetDefault("storage.endpoint", "minio:9000")
	viper.SetDefault("storage.access_key", "")
	viper.SetDefault("storage.secret_key", "")
	viper.SetDefault("storage.avatar_bucket", "avatars")
	viper.SetDefault("storage.cover_bucket", "covers")
	viper.SetDefault("storage.presign_ttl_minutes", 15)
	viper.SetDefault("storage.public_host", "localhost:9000")
	viper.SetDefault("storage.use_ssl", false)
	// Bucket provisioning ka kaam `minio-init` karta hai. Default false, taaki
	// scoped (non-root) service account ke saath bhi startup na fail ho.
	// Purane setups jo sirf root creds use karte hain, unke liye `.env` ya
	// compose me ise true kar sakte hain.
	viper.SetDefault("storage.manage_bucket", false)

	// ---- SECURITY (Phase A / gap #2) ----
	//
	// CORS: default sirf local dev origin. `*` NAHI - wo credentials ke
	// saath invalid hai aur kisi bhi site ko authenticated request bhejne
	// deta hai.
	viper.SetDefault("security.allowed_origins", "http://localhost:3000")
	viper.SetDefault("security.allow_credentials", true)
	// HSTS default OFF: local dev plain HTTP par chalta hai aur HSTS cache
	// browser me 6 mahine tak atak jaata hai. Production me .env se on karo.
	viper.SetDefault("security.hsts_max_age", 0)
	viper.SetDefault("security.hsts_include_subdomains", false)
	// CSP / referrer / frame / permissions: khaali = code me secure defaults.
	viper.SetDefault("security.csp", "")
	viper.SetDefault("security.referrer_policy", "")
	viper.SetDefault("security.frame_options", "")
	viper.SetDefault("security.permissions_policy", "")
	viper.SetDefault("database.dbname", "auth_service")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "UTC")

	viper.SetDefault("redis.host", "localhost")
	viper.SetDefault("redis.port", 6379)
	viper.SetDefault("redis.password", "")

	// NATS - audit stream only. Default is the compose service name, matching
	// how Redis defaults to "localhost" for host-machine dev runs.
	viper.SetDefault("nats.url", "nats://nats:4222")
	viper.SetDefault("redis.db", 0)

	// ---- `jwt.secret_key` IS REGISTERED, BUT WITH NO USABLE DEFAULT ----
	//
	// It used to default to "your-secret-key-change-in-production". Every other
	// default in this function is a convenience; that one was a vulnerability with
	// a friendly name.
	//
	// The mechanism is worth being precise about, because it is not obvious from
	// the code. If `JWT_SECRET_KEY` is unset, viper yields the default string, and
	// the service starts and signs tokens with it. It logs no warning, all health
	// checks pass, every test passes, and the app works. And then, because that
	// string is committed in this file, anyone who has read the repository can
	// forge a token:
	//
	//   payload = {"user_id": "...", "role": "superadmin", "aud": "wideo11-api", "exp": <future>}
	//   token   = base64url(header) + "." + base64url(payload) + "." + HMAC_SHA256(payload, "your-secret-key-change-in-production")
	//
	// The signature verifies. `aud` matches. `exp` has not passed. Every gate in
	// every app - all of which read the SAME default - accepts it. That is not a
	// login bypass to work around; it is "there is no login".
	//
	// So the default is the EMPTY STRING, and `Validate` rejects it.
	//
	// ----------------------------------------------------------------------------
	// WHY THE SetDefault CALL IS STILL HERE, WITH AN EMPTY VALUE
	// ----------------------------------------------------------------------------
	//
	// This is the same trap documented a few lines below for `storage.access_key`,
	// and it is worth repeating because the obvious "fix" - deleting the
	// SetDefault entirely - is a serious outage.
	//
	// Viper's `AutomaticEnv` does not discover keys. It only substitutes a value
	// for a key viper already knows about, and `Unmarshal` walks that known set.
	// With no `SetDefault("jwt.secret_key", ...)`, viper has no `jwt.secret_key`,
	// so `JWT_SECRET_KEY=...` in the environment is invisible: `cfg.JWT.SecretKey`
	// stays empty, `Validate` refuses, and the service will not start EVEN WHEN THE
	// OPERATOR HAS SET A PERFECTLY GOOD KEY.
	//
	// That is a fail-closed failure and therefore a safe one, but it is still an
	// outage caused by a change that looked like a security improvement. The
	// registration is what makes the env var work; the value is what makes it safe.
	// Both halves are needed, and `TestLoadConfigSucceedsWithAGoodSecret` is what
	// stops somebody deleting this line in a later "cleanup".
	viper.SetDefault("jwt.secret_key", "")

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

	// ---- DEVICE ACCOUNT LIMIT (on/off switch) ----
	//
	// Default `true` + `3` = SPEC behaviour. Local dev me `.env` me
	// `DEVICE_LIMIT_ENABLED=false` karke unlimited accounts/device kar sakte ho.
	viper.SetDefault("device_limit.enabled", true)
	viper.SetDefault("device_limit.max_accounts", 3)
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode, c.TimeZone)
}

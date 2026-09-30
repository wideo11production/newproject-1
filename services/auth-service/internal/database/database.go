package database

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// Pool sizing. The defaults matter more than they look:
//
//   - MaxIdleConns below MaxOpenConns is deliberate. Postgres is a single
//     shared bottleneck; holding idle connections open for every service in
//     the compose network is how a mid-size deployment starts timing out on
//     connection setup long before it runs out of CPU.
//   - ConnMaxLifetime is well under any upstream proxy idle timeout. A
//     connection reused across a proxy's own timeout fails on its next use
//     with a confusing "server closed the connection unexpectedly".
const (
	defaultMaxOpenConns = 25
	defaultMaxIdleConns = 10
	defaultConnMaxLife  = 30 * time.Minute
	defaultConnMaxIdle  = 5 * time.Minute
	pingTimeout         = 5 * time.Second
)

func NewPostgresDB(cfg *config.DatabaseConfig) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode, cfg.TimeZone)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(defaultMaxOpenConns)
	sqlDB.SetMaxIdleConns(defaultMaxIdleConns)
	sqlDB.SetConnMaxLifetime(defaultConnMaxLife)
	sqlDB.SetConnMaxIdleTime(defaultConnMaxIdle)

	// gorm.Open is lazy - it does not actually touch the network. Without
	// this the service logs "connection established" and then fails on its
	// first query, which reads like a query bug rather than a config or
	// outage problem. Ping first so startup fails loudly and immediately.
	ctx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("database ping failed (host=%s port=%d db=%s): %w",
			cfg.Host, cfg.Port, cfg.DBName, err)
	}

	log.Info().
		Str("host", cfg.Host).
		Int("port", cfg.Port).
		Str("db", cfg.DBName).
		Msg("Database connection established")

	return db, nil
}

// MigratedModels returns every persisted model AutoMigrate owns, in one
// place.
//
// It is exported, and used by AutoMigrate itself, so that the list cannot
// drift between the code that applies it and the tests that assert on it.
// Adding a model here is the only step needed to make its table exist.
func MigratedModels() []interface{} {
	return []interface{}{
		&model.User{},
		&model.Session{},
		&model.Device{},
		&model.PIN{},
		&model.RefreshToken{},
		&model.VerificationToken{},
		&model.WebAuthnCredential{},
		&model.WebAuthnSession{},
		&model.SecurityProfile{},
		&model.SecurityPIN{},
		&model.SecurityQuestion{},
		&model.DeviceAccount{},
		&model.SecurityEvent{},
		&model.SuperadminAccount{},
		&model.UserSession{},
		&model.TestAccountMarker{},
		&model.ClickEvent{},
	}
}

// SQLOnlyTables lists the tables that GORM deliberately does NOT create,
// and the migration that owns each one.
//
// The reason is capability, not preference. These tables carry things
// GORM cannot express:
//   - CHECK constraints  (handle format, length guards, role enum)
//   - partial indexes    (public channels only)
//   - triggers           (updated_at maintenance)
//   - Postgres column defaults that must match a NOT NULL contract
//
// A GORM-created version of any of these would compile, start, and pass
// unit tests while being missing its constraints in production.
//
// If a table here is ever promoted into MigratedModels, remove it from this
// list in the same commit - TestAutoMigrateCoversEveryPersistedModel fails
// otherwise.
var SQLOnlyTables = map[string]string{
	"channels":           "005_creator_dashboard.sql",
	"user_settings":      "007_user_settings_and_telemetry_geo.sql",
	"user_registrations": "008_user_registrations.sql",
}

func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(MigratedModels()...); err != nil {
		return fmt.Errorf("automigrate: %w", err)
	}
	log.Info().Int("models", len(MigratedModels())).Msg("AutoMigrate complete")
	return nil
}

package database

import (
	"fmt"
	"log"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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

	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)

	log.Println("Database connection established")
	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
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
	)
}
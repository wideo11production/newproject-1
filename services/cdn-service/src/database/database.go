package database

import (
	"fmt"

	"newproject/services/cdn-service/src/model"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func NewPostgresDB(dsn string) (*gorm.DB, error) {
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

	// Connection pool settings from config would be applied here
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&model.CDNConfig{},
		&model.CDNCacheRule{},
		&model.CDNInvalidation{},
		&model.CDNSignedURL{},
		&model.CDNAnalytics{},
		&model.VideoCDNMapping{},
	)
}

func NewTestDB() (*gorm.DB, error) {
	// For testing purposes - uses SQLite in memory
	db, err := gorm.Open(postgres.Open(""), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	return db, nil
}
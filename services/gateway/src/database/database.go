package database

import (
	"fmt"
	"log"

	// The gateway service doesn't require a database for its core functionality
	// This is a placeholder for consistency with other services
	// In a real implementation, this might connect to a database for storing
	// route configurations, API keys, rate limit data, etc.
)

// NewPostgresDB is a placeholder function
func NewPostgresDB(dsn string) (*interface{}, error) {
	return nil, fmt.Errorf("gateway service does not require a database connection")
}

// AutoMigrate is a placeholder function
func AutoMigrate(db interface{}) error {
	return nil
}
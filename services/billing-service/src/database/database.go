package database

import (
	"fmt"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"newproject/services/billing-service/src/model"
)

func NewPostgresDB(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(25)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&model.SubscriptionPlan{},
		&model.Subscription{},
		// UserIdentity: the uint<->UUID adapter between billing's
		// `subscriptions.user_id` and auth-service's canonical user
		// UUID. Without the table, `Resolve` fails and every
		// subscriber is unresolvable.
		&model.UserIdentity{},
		// RoyaltyMilestone: one-time royalty claim tracker (Tier A/B/C/D
		// withdrawal law). `has_withdrawn_first_royalty` flag yahan
		// lock hota hai — ek user, ek claim, dobara nahi.
		&model.RoyaltyMilestone{},
		// PushAllocation: 12-month commitment ka free text-only
		// push quota (default 1000, 3-month absolute limit,
		// .env-configurable). Expiry ke baad PurgeExpired se
		// auto-forfeit.
		&model.PushAllocation{},
		// StudentIdentity: AURA student gate verification record.
		// Degree/ID review → 'verified' + 365-day identity token;
		// educational-violation → 'revoked' + 25% penalty.
		&model.StudentIdentity{},
		&model.TaxRate{},
		&model.Invoice{},
		&model.InvoiceItem{},
		&model.Payment{},
		// --- Revenue / payout protection models (added for multi-account fraud) ---
		//
		// DeviceAdRevenue: device-level ad revenue cap (multi-account fraud protection)
		&model.DeviceAdRevenue{},
		// PayoutIdentity: UPI/bank/wire identities with UNIQUE index (dedup protection)
		&model.PayoutIdentity{},
		// DeviceRevenueLink: device se linked accounts ka analytics
		&model.DeviceRevenueLink{},
	)
}

func DSN(host string, port int, user, password, dbname, sslmode, tz string) string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		host, port, user, password, dbname, sslmode, tz)
}

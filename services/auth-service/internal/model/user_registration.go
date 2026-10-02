package model

import (
	"time"

	"github.com/google/uuid"
)

// NOTE ON THIS FILE'S HISTORY, since the filename no longer explains it:
// `UserRegistration` used to share `model/click.go` with the `ClickEvent`
// struct. `ClickEvent` moved to analytics-service, and deleting that file
// wholesale broke `internal/service/awareness.go`, which needs this struct.
//
// The lesson worth keeping: "this file is about clicks" is not the same as
// "these structs belong to click tracking". This one does not.
//
// UserRegistration - ek REAL registration ka record.
//
// REQUIREMENT: "superadmin ko pata chale KIS NE, KAB, KIS DESH SE, KIS
// DEVICE se, KIS BROWSER se register kiya".
//
// CLICK_TRACKING se alag table kyun:
//   - registration ek ONE-TIME event hai, clicks nahi (bulk ho sakte hain)
//   - ye PERMANENT audit record hai - click events purge ho sakte hain,
//     par "kaun account banata hai" kabhi nahi mita
//   - analytics queries (country-wise signups, device split) seedha is table
//     par cheap hain
//
// HONESTY: sirf REAL data. Geo header na mile to country/continent NULL.
type UserRegistration struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Email      string    `gorm:"size:255;not null;index" json:"email"`
	Username   string    `gorm:"size:100" json:"username"`
	IPAddress  string    `gorm:"size:64" json:"ip_address"`
	UserAgent  string    `gorm:"size:512" json:"user_agent"`
	Country    string    `gorm:"size:2" json:"country,omitempty"`
	Continent  string    `gorm:"size:8" json:"continent,omitempty"`
	DeviceType string    `gorm:"size:16" json:"device_type,omitempty"`
	Browser    string    `gorm:"size:64" json:"browser,omitempty"`
	OS         string    `gorm:"size:64" json:"os,omitempty"`
	// Referrer - user kahan se aaya (landing page, referral link, etc.)
	Referrer  string    `gorm:"size:512" json:"referrer"`
	CreatedAt time.Time `gorm:"not null;index" json:"created_at"`
}

func (UserRegistration) TableName() string { return "user_registrations" }

// NOTE: `func (ClickEvent) TableName()` and the `ClickRetentionDays` /
// `ClickPurgeIntervalHours` constants used to live here too. Both went with the
// click ledger to analytics-service, where retention is now driven by that
// service's own `RetentionJob` and configurable via `TELEMETRY_RETENTION_DAYS`.
//
// The constants are worth noting rather than just deleting: they said 30 days,
// while the telemetry service's window is 90. Two retention windows for two
// tables was the correct design - a registration audit record and a click log
// have different lifetimes - but it means "retention" has no single answer in
// this codebase, and anyone assuming one will be wrong about one of them.

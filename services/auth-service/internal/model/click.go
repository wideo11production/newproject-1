// Click history - persistent, with 30-day automatic retention
//
// KYUN PERSISTENT CHAHIE:
// Pehle clicks memory buffer + localStorage me jaa rahe the, jo RESTART par
// gayab ho jaate the. Superadmin ko chahiye ki history SURVIVE kare - isliye
// ye Postgres me store hoti hai (survives restarts, auditable).
//
// 30-DAY RETENTION (garbage se bacha):
// Click history kabhi useful nahi hoti 30 din se zyada purani. Agar delete
// nahi ki to table UNBOUNDED grow karegi aur DB garbage se bharega.
// Isliye ek retention worker hai jo periodically (aur startup par) 30 din se
// purani rows HARD DELETE kar deta hai. Isse DB size bounded rehta hai.
//
// NOTE: Ye deletion AUDIT ke liye bhi theek hai - security_events (jo critical
// hain) alag table me hain aur unka apna retention nahi hai. Click history
// sirf analytics hai, isliye isko prune karna safe hai.
//
// Hinglish comments: har block ka arth
package model

import (
	"time"

	"github.com/google/uuid"
)

// ClickEvent - ek user click ka record
type ClickEvent struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`

	// ---- Who clicked ----
	UserID    *uuid.UUID `gorm:"type:uuid;index" json:"user_id,omitempty"`
	UserEmail string     `gorm:"size:255;index" json:"user_email,omitempty"`

	// ---- What was clicked ----
	Page      string `gorm:"size:255;not null;index" json:"page"`
	Target    string `gorm:"size:255" json:"target"`
	Label     string `gorm:"size:255" json:"label"`
	ElementID string `gorm:"size:128" json:"element_id"`

	// ---- Where ----
	X int `gorm:"not null;default:0" json:"x"`
	Y int `gorm:"not null;default:0" json:"y"`

	// ---- Context ----
	UserAgent string `gorm:"size:200" json:"user_agent"`
	IPAddress string `gorm:"size:64" json:"ip_address"`
	Referrer  string `gorm:"size:255" json:"referrer"`

	// ---- When (microsecond precision - SPEC) ----
	Timestamp time.Time `gorm:"not null;index" json:"timestamp"`

	// ---- GEO (migration 007) ----
	// REAL values jo request headers/UA se derive hue. Header na mile to
	// ZERO-VALUE (empty string) rahegi - hum kabhi fabricated data nahi
	// bharte. Dashboard par khaali dikhna sahi hai.
	Country   string `gorm:"size:2" json:"country,omitempty"`
	Continent string `gorm:"size:8" json:"continent,omitempty"`

	// ---- DEVICE PROFILE (migration 007) ----
	// mobile | tablet | desktop | bot | unknown
	DeviceType string `gorm:"size:16" json:"device_type,omitempty"`
	// "Chrome 131", "Edge 131" etc.
	Browser string `gorm:"size:64" json:"browser,omitempty"`
	// "Windows 10/11", "Android 14" etc.
	OS string `gorm:"size:64" json:"os,omitempty"`

	// ---- SESSION LINK (migration 007) ----
	// Click ko login session se jodne ke liye. Bina iske "kaun sa user,
	// kaun sa device" correlate nahi hoga.
	SessionID *uuid.UUID `gorm:"type:uuid;index" json:"session_id,omitempty"`
}

// UserRegistration - ek REAL registration ka record.
//
// REQUIREMENT: "superadmin ko pata chale KIS NE, KAB, KIS DESH SE, KIS
// DEVICE se, KIS BROWSER se register kiya".
//
// CLICK_EVENTS se alag table kyun:
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

func (ClickEvent) TableName() string { return "click_events" }

// Click retention constants
const (
	// ClickRetentionDays: 30 din se purani click history delete
	ClickRetentionDays = 30
	// ClickPurgeIntervalHours: kitne ghante me purge chalega
	ClickPurgeIntervalHours = 6
)

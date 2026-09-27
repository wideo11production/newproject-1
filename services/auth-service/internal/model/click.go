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
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`

	// ---- Who clicked ----
	UserID    *uuid.UUID `gorm:"type:uuid;index" json:"user_id,omitempty"`
	UserEmail string     `gorm:"size:255;index" json:"user_email,omitempty"`

	// ---- What was clicked ----
	Page     string `gorm:"size:255;not null;index" json:"page"`
	Target   string `gorm:"size:255" json:"target"`
	Label    string `gorm:"size:255" json:"label"`
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
}

func (ClickEvent) TableName() string { return "click_events" }

// Click retention constants
const (
	// ClickRetentionDays: 30 din se purani click history delete
	ClickRetentionDays = 30
	// ClickPurgeIntervalHours: kitne ghante me purge chalega
	ClickPurgeIntervalHours = 6
)

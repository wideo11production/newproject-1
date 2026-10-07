package model

import "time"

// PushAllocation - ek user ka TEXT-ONLY push notification quota.
//
// Hinglish: 12-month commitment (monthly-billed) lene par user
// ko 1000 free push notifications milte hain (dono numbers
// .env se configurable hain — user directive: ".env file se
// kaam jyada karske build karna"). Quota 3 months ke absolute
// time-barred limit ke andar use karna hai; expiry ke baad
// unexpended quota auto-forfeit hota hai (PurgeExpired).
type PushAllocation struct {
	// ID is the row's own id.
	ID uint `gorm:"primarykey" json:"id"`
	// UserID is the billing-side uint (identity adapter se aaya).
	UserID uint `gorm:"not null;index" json:"user_id"`
	// QuotaTotal is the granted total notifications (default 1000).
	QuotaTotal int `gorm:"not null;default:0" json:"quota_total"`
	// QuotaRemaining is the leftover notifications.
	QuotaRemaining int `gorm:"not null;default:0" json:"quota_remaining"`
	// ExpiresAt is the 3-month absolute time-barred limit.
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	// Source records which purchase granted this (e.g.
	// "twelve-month-commitment") — audit trail ke liye.
	Source string `gorm:"size:50;not null" json:"source"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PushAllocation) TableName() string {
	return "push_allocations"
}

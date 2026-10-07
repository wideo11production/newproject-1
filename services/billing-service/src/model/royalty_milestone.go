package model

import "time"

// RoyaltyMilestone — ek user ka ONE-TIME royalty claim tracker.
//
// Hinglish: ye table user ke "pehla royalty withdrawal" ko lock
// karti hai. Balance ek threshold cross karne par user ek-dime
// royalty (country-specific price) claim kar sakta hai — sirf ek
// dafa. Flag true hone ke baad dobara claim blocked.
//
// Money rule (SYSTEM-PLAN.md R2): har amount integer MINOR units
// mein hai (INR ke liye paise). ₹100 = 10000. Float kabhi nahi.
type RoyaltyMilestone struct {
	// ID is the row's own id.
	ID uint `gorm:"primarykey" json:"id"`
	// UserID is the billing-side uint (identity adapter se aaya).
	// Unique: ek user ke liye sirf ek milestone row.
	UserID uint `gorm:"not null;uniqueIndex" json:"user_id"`
	// Currency is the ISO-4217 code (INR, USD, ...).
	Currency string `gorm:"size:3;not null" json:"currency"`
	// HasWithdrawnFirstRoyalty true hone par dobara claim blocked.
	// Ye flag LOCK hota hai claim ke baath — race-safe conditional
	// update repository mein hai (WHERE has_withdrawn = false).
	HasWithdrawnFirstRoyalty bool `gorm:"not null;default:false" json:"has_withdrawn_first_royalty"`
	// FirstRoyaltyWithdrawnAt kab claim hua (nil = abhi tak nahi).
	FirstRoyaltyWithdrawnAt *time.Time `json:"first_royalty_withdrawn_at"`
	// RoyaltyPriceMinor is the one-time claim amount (minor units).
	RoyaltyPriceMinor int64 `gorm:"not null;default:0" json:"royalty_price_minor"`
	// MilestoneThresholdMinor is the balance level jo claim
	// eligibility deta hai (minor units).
	MilestoneThresholdMinor int64 `gorm:"not null;default:0" json:"milestone_threshold_minor"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (RoyaltyMilestone) TableName() string {
	return "royalty_milestones"
}

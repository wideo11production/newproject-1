// Device-level ad revenue model
//
// YE TABLE wo hai jo multi-account ad fraud ko DEVICE level par rokta hai.
// Ek hi device se linked saare accounts ka COMBINED ad revenue yahan track
// hota hai - taaki 3 accounts bana kar 3x earnings na nikal sake.
//
// Hinglish comments: har block ka arth
package model

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DeviceAdRevenue - ek device ka mahina-wise combined ad revenue
type DeviceAdRevenue struct {
	ID     uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	DeviceID string `gorm:"size:128;not null;uniqueIndex:idx_device_period" json:"device_id"`

	// Period: "YYYY-MM" - har mahine ka alag record (reset hota hai)
	Period string `gorm:"size:7;not null;uniqueIndex:idx_device_period" json:"period"`

	// TotalRevenue: is device ke SAARE linked accounts ka combined ad revenue
	// (INR). Ye value cap check hoti hai.
	TotalRevenue float64 `gorm:"type:numeric(20,2);not null;default:0" json:"total_revenue"`

	// AdImpressions: kitne counted impressions is device se aaye
	AdImpressions int64 `gorm:"not null;default:0" json:"ad_impressions"`

	// LinkedAccounts: is device pe kitne accounts hain
	LinkedAccounts int `gorm:"not null;default:1" json:"linked_accounts"`

	// ---- Review / enforcement flags ----

	// RequiresReview: manual review chahiye (suspicious activity)
	RequiresReview bool `gorm:"not null;default:false" json:"requires_review"`

	// CapExceeded: monthly cap cross ho gaya
	CapExceeded bool `gorm:"not null;default:false" json:"cap_exceeded"`

	// RevenueHeld: revenue HOLD ki gayi hai (payout nahi hoga jab tak review na ho)
	RevenueHeld bool `gorm:"not null;default:false" json:"revenue_held"`

	// FlaggedReason: admin ke liye detail
	FlaggedReason string `gorm:"size:500" json:"flagged_reason"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (DeviceAdRevenue) TableName() string { return "device_ad_revenue" }

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// DeviceAdRevenueRepository device ad revenue ke DB operations
type DeviceAdRevenueRepository interface {
	Get(ctx context.Context, deviceID, period string) (*DeviceAdRevenue, error)
	GetOrCreate(ctx context.Context, deviceID, period string) (*DeviceAdRevenue, error)
	Save(ctx context.Context, record *DeviceAdRevenue) error
}

type deviceAdRevenueRepository struct {
	db *gorm.DB
}

// NewDeviceAdRevenueRepository naya repository banata hai
func NewDeviceAdRevenueRepository(db *gorm.DB) DeviceAdRevenueRepository {
	return &deviceAdRevenueRepository{db: db}
}

// Get record nikalta hai (nil agar nahi hai)
func (r *deviceAdRevenueRepository) Get(
	ctx context.Context, deviceID, period string,
) (*DeviceAdRevenue, error) {
	var record DeviceAdRevenue
	err := r.db.WithContext(ctx).
		Where("device_id = ? AND period = ?", deviceID, period).
		First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// GetOrCreate record nikalta hai ya naya banata hai
func (r *deviceAdRevenueRepository) GetOrCreate(
	ctx context.Context, deviceID, period string,
) (*DeviceAdRevenue, error) {
	record := DeviceAdRevenue{
		DeviceID:       deviceID,
		Period:         period,
		LinkedAccounts: 1,
	}

	// Upsert - conflict ho to existing record mile
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "device_id"}, {Name: "period"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"updated_at": time.Now(),
		}),
		DoNothing: false,
	}).Create(&record).Error

	if err != nil {
		return nil, err
	}

	// Ab actual record padho (upsert ke baad ID set nahi hota)
	var saved DeviceAdRevenue
	if err := r.db.WithContext(ctx).
		Where("device_id = ? AND period = ?", deviceID, period).
		First(&saved).Error; err != nil {
		return nil, err
	}
	return &saved, nil
}

// Save record update karta hai
func (r *deviceAdRevenueRepository) Save(ctx context.Context, record *DeviceAdRevenue) error {
	record.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(record).Error
}

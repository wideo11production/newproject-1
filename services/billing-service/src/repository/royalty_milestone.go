package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
)

// ErrMilestoneNotFound — milestone row nahi mili.
var ErrMilestoneNotFound = errors.New("royalty_milestone_not_found")

// ErrMilestoneAlreadyLocked — one-time claim pehle se lock hai.
// Concurrent double-claim mein conditional update 0 rows affect
// karta hai — ye error return hota hai.
var ErrMilestoneAlreadyLocked = errors.New("royalty_milestone_already_locked")

// RoyaltyMilestoneRepository — royalty milestone ke liye storage
// boundary. Service sirf is interface ko janti hai (test fake
// banane ke liye bhi ye chahiye).
type RoyaltyMilestoneRepository interface {
	// GetOrCreate returns the user's milestone row, allocating one
	// on first sight. Race-safe: do concurrent first-sight requests
	// mein ek hi INSERT jeeta hai, haar karne wala winner ka row
	// return karta hai (error nahi) — dono ek hi user ke hain.
	GetOrCreate(ctx context.Context, userID uint, currency string, royaltyPriceMinor, milestoneThresholdMinor int64) (*model.RoyaltyMilestone, error)
	// MarkFirstRoyaltyWithdrawn locks the one-time claim. Conditional
	// update (WHERE has_withdrawn = false) — do concurrent claims
	// mein sirf ek ka RowsAffected 1 hoga; doosra
	// ErrMilestoneAlreadyLocked lega.
	MarkFirstRoyaltyWithdrawn(ctx context.Context, userID uint, at time.Time) error
}

type royaltyMilestoneRepository struct {
	db *gorm.DB
}

func NewRoyaltyMilestoneRepository(db *gorm.DB) RoyaltyMilestoneRepository {
	return &royaltyMilestoneRepository{db: db}
}

func (r *royaltyMilestoneRepository) GetOrCreate(
	ctx context.Context, userID uint, currency string,
	royaltyPriceMinor, milestoneThresholdMinor int64,
) (*model.RoyaltyMilestone, error) {
	var m model.RoyaltyMilestone
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&m).Error
	if err == nil {
		return &m, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// ---- First sight: allocate ----
	// Insert IS the allocation. Concurrent same-user insert: the
	// unique index (user_id) rejects ours — the winner's row is the
	// correct answer, not an error.
	m = model.RoyaltyMilestone{
		UserID:                   userID,
		Currency:                 currency,
		RoyaltyPriceMinor:        royaltyPriceMinor,
		MilestoneThresholdMinor: milestoneThresholdMinor,
	}
	if err := r.db.WithContext(ctx).Create(&m).Error; err != nil {
		var winner model.RoyaltyMilestone
		if err2 := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&winner).Error; err2 == nil {
			return &winner, nil
		}
		// Na hamari insert chali, na winner mili — ORIGINAL failure
		// report karo (wohi batati hai kya attempt hua tha).
		return nil, err
	}
	return &m, nil
}

func (r *royaltyMilestoneRepository) MarkFirstRoyaltyWithdrawn(ctx context.Context, userID uint, at time.Time) error {
	// Conditional update = the one-time lock. Sirf un rows ko update
	// karta hai jahan flag abhi false hai: kisi ne beech mein claim
	// kar liya to RowsAffected 0 — caller ko error milta hai.
	res := r.db.WithContext(ctx).
		Model(&model.RoyaltyMilestone{}).
		Where("user_id = ? AND has_withdrawn_first_royalty = ?", userID, false).
		Updates(map[string]any{
			"has_withdrawn_first_royalty": true,
			"first_royalty_withdrawn_at":  at,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrMilestoneAlreadyLocked
	}
	return nil
}

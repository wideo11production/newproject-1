package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
)

// ErrPushAllocationNotFound - user ka koi active allocation nahi.
var ErrPushAllocationNotFound = errors.New("push_allocation_not_found")

// PushAllocationRepository - push quota ke liye storage boundary.
type PushAllocationRepository interface {
	// GetActiveByUser returns the user's latest non-expired
	// allocation (newest first).
	GetActiveByUser(ctx context.Context, userID uint) (*model.PushAllocation, error)
	// Create stores a newly granted allocation.
	Create(ctx context.Context, alloc *model.PushAllocation) error
	// Consume atomically decrements one notification. Conditional
	// update (WHERE quota_remaining > 0 AND expires_at > now) —
	// concurrent consumers mein sirf ek hi decrement hoga.
	// RowsAffected 0 = exhausted / expired / missing.
	Consume(ctx context.Context, userID uint) error
	// PurgeExpired deletes all allocations past their 3-month
	// limit (auto-forfeit) and returns the purged count.
	PurgeExpired(ctx context.Context) (int64, error)
}

type pushAllocationRepository struct {
	db *gorm.DB
}

func NewPushAllocationRepository(db *gorm.DB) PushAllocationRepository {
	return &pushAllocationRepository{db: db}
}

func (r *pushAllocationRepository) GetActiveByUser(ctx context.Context, userID uint) (*model.PushAllocation, error) {
	var alloc model.PushAllocation
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND expires_at > ?", userID, time.Now()).
		Order("created_at DESC").
		First(&alloc).Error
	if err != nil {
		return nil, err
	}
	return &alloc, nil
}

func (r *pushAllocationRepository) Create(ctx context.Context, alloc *model.PushAllocation) error {
	return r.db.WithContext(ctx).Create(alloc).Error
}

func (r *pushAllocationRepository) Consume(ctx context.Context, userID uint) error {
	// Conditional update = the quota lock. Sirf un rows par
	// decrement jahan quota bacha ho AUR limit expire nahi hui
	// ho — do concurrent consumers mein sirf ek jeeta.
	res := r.db.WithContext(ctx).
		Model(&model.PushAllocation{}).
		Where("user_id = ? AND quota_remaining > 0 AND expires_at > ?", userID, time.Now()).
		Updates(map[string]any{"quota_remaining": gorm.Expr("quota_remaining - 1")})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// Koi active quota nahi: ya exhaust, ya expire, ya row
		// hi nahi — caller ke liye sab ek hi answer.
		return ErrPushAllocationNotFound
	}
	return nil
}

func (r *pushAllocationRepository) PurgeExpired(ctx context.Context) (int64, error) {
	// 3-month limit ke baad unexpended quota auto-forfeit.
	res := r.db.WithContext(ctx).
		Where("expires_at < ?", time.Now()).
		Delete(&model.PushAllocation{})
	return res.RowsAffected, res.Error
}

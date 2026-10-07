package service

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ---------------------------------------------------------------------------
// Push allocation engine — 1000 text-only notifications, 3-month limit.
//
// Hinglish: 12-month commitment purchase par user ko free push
// quota milta hai. Dono numbers .env se configurable hain
// (user directive). Expiry ke baad unexpended quota
// auto-forfeit hota hai — PurgeExpired ek daemon (main.go
// ticker) se call hoga; wiring agla slice hai.
// ---------------------------------------------------------------------------

// Push quota config keys (SSOT: .env).
const (
	PushQuotaDefaultEnv    = "PUSH_QUOTA_DEFAULT"
	PushQuotaExpiryDaysEnv = "PUSH_QUOTA_EXPIRY_DAYS"
)

// Push quota defaults — user directive numbers.
var (
	// pushQuotaDefault: granted notifications per allocation (1000).
	pushQuotaDefault = intEnv(PushQuotaDefaultEnv, 1000)
	// pushQuotaExpiryDays: absolute time-barred limit (3 months).
	pushQuotaExpiryDays = intEnv(PushQuotaExpiryDaysEnv, 90)
)

// ErrPushQuotaExhausted - koi usable quota nahi (exhaust ya expired).
var ErrPushQuotaExhausted = errors.New("push_quota_exhausted")

// intEnv - int variant env loader (royalty.go ke int64Env
// ke saath — same package mein dono chahiye kyunki quota
// numbers int hain, royalty amounts int64 minor units).
func intEnv(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// PushAllocationService - push quota business laws.
type PushAllocationService struct {
	repo repository.PushAllocationRepository
}

// NewPushAllocationService builds the push quota engine.
func NewPushAllocationService(repo repository.PushAllocationRepository) *PushAllocationService {
	return &PushAllocationService{repo: repo}
}

// PushQuotaDefaults - current .env-resolved quota configuration
// (dashboard display ke liye).
func PushQuotaDefaults() (total int, expiryDays int) {
	return pushQuotaDefault, pushQuotaExpiryDays
}

// Grant - ek purchase ke baad user ko quota deta hai.
//
// `source` the purchase ka audit trail hai (e.g.
// "twelve-month-commitment"). Har grant ek nayi allocation row
// banata hai — renewal ke liye bhi same path.
func (s *PushAllocationService) Grant(ctx context.Context, userID uint, source string) (*model.PushAllocation, error) {
	alloc := &model.PushAllocation{
		UserID:         userID,
		QuotaTotal:     pushQuotaDefault,
		QuotaRemaining: pushQuotaDefault,
		// 3-month absolute limit — grant ke waqt se shuru.
		ExpiresAt: time.Now().AddDate(0, 0, pushQuotaExpiryDays),
		Source:     source,
	}
	if err := s.repo.Create(ctx, alloc); err != nil {
		return nil, err
	}
	return alloc, nil
}

// Consume - ek text-only push notification use karta hai.
//
// Race-safe conditional decrement (repository mein hai). Exhaust
// ya expired ho to ErrPushQuotaExhausted.
func (s *PushAllocationService) Consume(ctx context.Context, userID uint) error {
	if err := s.repo.Consume(ctx, userID); err != nil {
		if errors.Is(err, repository.ErrPushAllocationNotFound) {
			return ErrPushQuotaExhausted
		}
		return err
	}
	return nil
}

// Remaining - user ki current active quota (dashboard ke liye).
func (s *PushAllocationService) Remaining(ctx context.Context, userID uint) (*model.PushAllocation, error) {
	alloc, err := s.repo.GetActiveByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return alloc, nil
}

// PurgeExpired - 3-month limit ke baad unexpended quota
// auto-forfeit karta hai. Purged count return karta hai.
//
// Hinglish: ye ek background daemon (main.go ticker) se call
// hoga — "Wire a background daemon task that auto-forfeits and
// purges any unexpended quota after a 3-month absolute
// time-barred limit". Wiring agla slice hai.
func (s *PushAllocationService) PurgeExpired(ctx context.Context) (int64, error) {
	return s.repo.PurgeExpired(ctx)
}

// Push allocation tests — 1000 notif / 3-month quota laws.
//
// Ye tests user ke directives ko lock karte hain:
//   - Grant: default quota + 3-month expiry (env-configurable)
//   - Consume: race-safe decrement, exhausted/expired rejected
//   - PurgeExpired: sirf expired rows delete hoti hain
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ---------------------------------------------------------------------------
// Fake repository (poora interface implement karta hai)
// ---------------------------------------------------------------------------

type fakePushAllocRepo struct {
	rows map[uint][]*model.PushAllocation
	next uint
}

func newFakePushAllocRepo() *fakePushAllocRepo {
	return &fakePushAllocRepo{rows: map[uint][]*model.PushAllocation{}}
}

func (f *fakePushAllocRepo) GetActiveByUser(ctx context.Context, userID uint) (*model.PushAllocation, error) {
	rows := f.rows[userID]
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].ExpiresAt.After(time.Now()) {
			return rows[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (f *fakePushAllocRepo) Create(ctx context.Context, alloc *model.PushAllocation) error {
	f.next++
	alloc.ID = f.next
	f.rows[alloc.UserID] = append(f.rows[alloc.UserID], alloc)
	return nil
}

func (f *fakePushAllocRepo) Consume(ctx context.Context, userID uint) error {
	rows := f.rows[userID]
	for i := len(rows) - 1; i >= 0; i-- {
		a := rows[i]
		if a.ExpiresAt.After(time.Now()) && a.QuotaRemaining > 0 {
			a.QuotaRemaining--
			return nil
		}
	}
	return repository.ErrPushAllocationNotFound
}

func (f *fakePushAllocRepo) PurgeExpired(ctx context.Context) (int64, error) {
	var purged int64
	for userID, rows := range f.rows {
		kept := rows[:0]
		for _, a := range rows {
			if a.ExpiresAt.Before(time.Now()) {
				purged++
				continue
			}
			kept = append(kept, a)
		}
		f.rows[userID] = kept
	}
	return purged, nil
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

// TestPushGrant_UsesConfig - Grant config ke hisaab se quota deta hai.
func TestPushGrant_UsesConfig(t *testing.T) {
	svc := NewPushAllocationService(newFakePushAllocRepo())
	ctx := context.Background()

	alloc, err := svc.Grant(ctx, 31, "twelve-month-commitment")
	if err != nil {
		t.Fatal(err)
	}
	if alloc.QuotaTotal != pushQuotaDefault || alloc.QuotaRemaining != pushQuotaDefault {
		t.Errorf("grant: expected %d/%d, got %d/%d",
			pushQuotaDefault, pushQuotaDefault, alloc.QuotaTotal, alloc.QuotaRemaining)
	}
	// 3-month (90-day) limit — grant ke waqt se.
	want := time.Now().AddDate(0, 0, pushQuotaExpiryDays)
	if diff := alloc.ExpiresAt.Sub(want); diff < -time.Minute || diff > time.Minute {
		t.Errorf("grant expiry: expected ~%v, got %v", want, alloc.ExpiresAt)
	}
	if alloc.Source != "twelve-month-commitment" {
		t.Errorf("source: expected audit trail, got %s", alloc.Source)
	}
}

// TestPushQuotaDefaults_Positive - env-resolved values sane hain.
func TestPushQuotaDefaults_Positive(t *testing.T) {
	total, days := PushQuotaDefaults()
	if total <= 0 {
		t.Errorf("push quota default must be positive, got %d", total)
	}
	if days <= 0 {
		t.Errorf("push quota expiry days must be positive, got %d", days)
	}
}

// ---------------------------------------------------------------------------
// Consume
// ---------------------------------------------------------------------------

// TestPushConsume_Decrements - consume ek notification ghatata hai.
func TestPushConsume_Decrements(t *testing.T) {
	repo := newFakePushAllocRepo()
	svc := NewPushAllocationService(repo)
	ctx := context.Background()

	alloc, err := svc.Grant(ctx, 32, "twelve-month-commitment")
	if err != nil {
		t.Fatal(err)
	}
	before := alloc.QuotaRemaining
	for i := 0; i < 3; i++ {
		if err := svc.Consume(ctx, 32); err != nil {
			t.Fatal(err)
		}
	}
	if alloc.QuotaRemaining != before-3 {
		t.Errorf("after 3 consumes: expected %d, got %d", before-3, alloc.QuotaRemaining)
	}
}

// TestPushConsume_Exhausted - quota 0 ho to consume rejected.
func TestPushConsume_Exhausted(t *testing.T) {
	repo := newFakePushAllocRepo()
	svc := NewPushAllocationService(repo)
	ctx := context.Background()

	alloc, err := svc.Grant(ctx, 33, "twelve-month-commitment")
	if err != nil {
		t.Fatal(err)
	}
	// Quota khud set karke exhaust simulate karo.
	alloc.QuotaRemaining = 0
	if err := svc.Consume(ctx, 33); err != ErrPushQuotaExhausted {
		t.Errorf("exhausted consume: expected ErrPushQuotaExhausted, got %v", err)
	}
}

// TestPushConsume_Expired - expiry ke baad consume rejected.
func TestPushConsume_Expired(t *testing.T) {
	repo := newFakePushAllocRepo()
	svc := NewPushAllocationService(repo)
	ctx := context.Background()

	alloc, err := svc.Grant(ctx, 34, "twelve-month-commitment")
	if err != nil {
		t.Fatal(err)
	}
	// 3-month limit PURI ho gayi — quota bacha ho par expired.
	alloc.ExpiresAt = time.Now().Add(-time.Hour)
	alloc.QuotaRemaining = 500
	if err := svc.Consume(ctx, 34); err != ErrPushQuotaExhausted {
		t.Errorf("expired consume: expected ErrPushQuotaExhausted, got %v", err)
	}
}

// TestPushConsume_NoAllocation - koi grant nahi hua to rejected.
func TestPushConsume_NoAllocation(t *testing.T) {
	svc := NewPushAllocationService(newFakePushAllocRepo())
	if err := svc.Consume(context.Background(), 35); err != ErrPushQuotaExhausted {
		t.Errorf("no-allocation consume: expected ErrPushQuotaExhausted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// PurgeExpired (3-month auto-forfeit)
// ---------------------------------------------------------------------------

// TestPushPurgeExpired_OnlyExpired - sirf expired rows delete.
func TestPushPurgeExpired_OnlyExpired(t *testing.T) {
	repo := newFakePushAllocRepo()
	svc := NewPushAllocationService(repo)
	ctx := context.Background()

	// Active allocation (user 36).
	if _, err := svc.Grant(ctx, 36, "twelve-month-commitment"); err != nil {
		t.Fatal(err)
	}
	// Expired allocation (user 37) — manually expire karke.
	expired, err := svc.Grant(ctx, 37, "twelve-month-commitment")
	if err != nil {
		t.Fatal(err)
	}
	expired.ExpiresAt = time.Now().Add(-time.Hour)

	purged, err := svc.PurgeExpired(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 1 {
		t.Errorf("purge: expected 1, got %d", purged)
	}
	// Active user ki allocation bachi hai.
	if _, err := svc.Remaining(ctx, 36); err != nil {
		t.Errorf("active allocation must survive purge: %v", err)
	}
	// Expired user ki allocation gayi.
	if _, err := svc.Remaining(ctx, 37); err == nil {
		t.Error("expired allocation must be purged")
	}
}

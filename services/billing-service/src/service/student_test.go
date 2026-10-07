// AURA Student Gate tests — verification, token, penalty law.
//
// Ye tests lock karte hain:
//   - 365-day identity token mint + validate (+ tamper reject)
//   - IsVerifiedStudent: flag && status && expiry teeno chahiye
//   - 25% revocation penalty = plan price ka 25% (INR + USD)
//   - RevokeForEducationalViolation: flag + token clear
//   - Discount law integration: verified → student matrix passes,
//     revoked → student matrix rejected (GetPlanForUser error)
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
)

// ---------------------------------------------------------------------------
// Test double: in-memory student identity repo
// ---------------------------------------------------------------------------

type fakeStudentIdentityRepo struct {
	rows map[uint]*model.StudentIdentity
}

func newFakeStudentRepo() *fakeStudentIdentityRepo {
	return &fakeStudentIdentityRepo{rows: map[uint]*model.StudentIdentity{}}
}

func (f *fakeStudentIdentityRepo) GetByUserID(ctx context.Context, userID uint) (*model.StudentIdentity, error) {
	m, ok := f.rows[userID]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return m, nil
}

func (f *fakeStudentIdentityRepo) Upsert(ctx context.Context, identity *model.StudentIdentity) error {
	// OnConflictUpdateAll ke saamne: existing mein se ID preserve +
	// fields overwrite. Test mein simple assign.
		if existing, ok := f.rows[identity.UserID]; ok {
			identity.ID = existing.ID
		} else {
			identity.ID = f.nextID()
		}
	f.rows[identity.UserID] = identity
	return nil
}

var _ = gorm.ErrRecordNotFound // keep import for the GetByUserID path

// small id sequencer for the fake
var fakeStudentSeq uint

func (f *fakeStudentIdentityRepo) nextID() uint {
	fakeStudentSeq++
	return fakeStudentSeq
}

func (f *fakeStudentIdentityRepo) RevokeByUserID(ctx context.Context, userID uint) error {
	m, ok := f.rows[userID]
	if !ok {
		return nil // idempotent: nothing to revoke
	}
	if !m.IsVerifiedStudent || m.Status != StudentStatusVerified ||
		m.IdentityTokenExpiresAt == nil || m.IdentityTokenExpiresAt.Before(time.Now()) {
		return nil
	}
	m.IsVerifiedStudent = false
	m.Status = StudentStatusRevoked
	m.IdentityToken = ""
	m.IdentityTokenExpiresAt = nil
	return nil
}

func (f *fakeStudentIdentityRepo) IsVerified(ctx context.Context, userID uint) bool {
	m, ok := f.rows[userID]
	if !ok {
		return false
	}
	if !m.IsVerifiedStudent || m.Status != StudentStatusVerified {
		return false
	}
	if m.IdentityTokenExpiresAt == nil || m.IdentityTokenExpiresAt.Before(time.Now()) {
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// 365-day identity token
// ---------------------------------------------------------------------------

// TestStudentToken365DayExpiry - minted token ~365 days valid,
// tampered token reject.
func TestStudentToken365DayExpiry(t *testing.T) {
	repo := newFakeStudentRepo()
	svc := NewStudentService(repo, nil, nil)
	ctx := context.Background()
	secret := []byte("test-secret-123")

	si, err := svc.GrantVerification(ctx, 41, 1, secret)
	if err != nil {
		t.Fatal(err)
	}
	if si.IdentityTokenExpiresAt == nil {
		t.Fatal("expiry must be set")
	}
	// ~365 days (allow 1 min tolerance).
	want := time.Now().Add(StudentIdentityTokenTTL)
	if diff := si.IdentityTokenExpiresAt.Sub(want); diff < -time.Minute || diff > time.Minute {
		t.Errorf("expiry: expected ~%v, got %v", want, *si.IdentityTokenExpiresAt)
	}

	// Valid token → parses, returns userID.
	uid, err := ValidateStudentIdentityToken(si.IdentityToken, secret)
	if err != nil {
		t.Fatalf("validate valid token: %v", err)
	}
	if uid != 41 {
		t.Errorf("token userID: expected 41, got %d", uid)
	}

	// Tampered token → reject.
	tampered := si.IdentityToken[:len(si.IdentityToken)-4] + "AAAA"
	if _, err := ValidateStudentIdentityToken(tampered, secret); err == nil {
		t.Error("tampered token must be rejected")
	}

	// Wrong secret → reject.
	if _, err := ValidateStudentIdentityToken(si.IdentityToken, []byte("wrong")); err == nil {
		t.Error("wrong secret must be rejected")
	}
}

// ---------------------------------------------------------------------------
// IsVerifiedStudent lifecycle
// ---------------------------------------------------------------------------

// TestIsVerifiedStudent_LifecycleStates - pending/revoked/expired
// sab false, only active-verified true.
func TestIsVerifiedStudent_LifecycleStates(t *testing.T) {
	repo := newFakeStudentRepo()
	svc := NewStudentService(repo, nil, nil)
	ctx := context.Background()
	secret := []byte("s")

	future := time.Now().Add(360 * 24 * time.Hour)
	past := time.Now().Add(-1 * time.Hour)

	// pending — verify nahi hua.
	repo.Upsert(ctx, &model.StudentIdentity{UserID: 51, Status: StudentStatusPending, IsVerifiedStudent: false})
	if svc.IsVerifiedStudent(ctx, 51) {
		t.Error("pending must be false")
	}

	// verified but token expiry in past → false.
	repo.Upsert(ctx, &model.StudentIdentity{
		UserID:                 52, Status: StudentStatusVerified, IsVerifiedStudent: true,
		IdentityTokenExpiresAt: &past,
	})
	if svc.IsVerifiedStudent(ctx, 52) {
		t.Error("expired token must be false")
	}

	// verified, active token → true.
	repo.Upsert(ctx, &model.StudentIdentity{
		UserID:                 53, Status: StudentStatusVerified, IsVerifiedStudent: true,
		IdentityTokenExpiresAt: &future,
	})
	if !svc.IsVerifiedStudent(ctx, 53) {
		t.Error("active verified must be true")
	}

	// revoked — GrantVerification se ban gaya phir revoke.
	_, err := svc.GrantVerification(ctx, 54, 1, secret)
	if err != nil {
		t.Fatal(err)
	}
	if !svc.IsVerifiedStudent(ctx, 54) {
		t.Fatal("just-verified must be true")
	}
	if err := svc.RevokeForEducationalViolation(ctx, 54); err != nil {
		t.Fatal(err)
	}
	if svc.IsVerifiedStudent(ctx, 54) {
		t.Error("revoked must be false")
	}
}

// ---------------------------------------------------------------------------
// 25% revocation penalty
// ---------------------------------------------------------------------------

// TestStudentRevocationPenalty - 25% of plan price, INR + USD.
func TestStudentRevocationPenalty(t *testing.T) {
	plans := []struct {
		plan     *model.SubscriptionPlan
		expected string // decimal string
	}{
		{plan: &model.SubscriptionPlan{Price: decimal.NewFromInt(300)}, expected: "75"},     // ₹300 → ₹75
		{plan: &model.SubscriptionPlan{Price: decimal.NewFromInt(1000)}, expected: "250"},   // ₹1000 → ₹250
		{plan: &model.SubscriptionPlan{Price: decimal.NewFromInt(500)}, expected: "125"},     // $500 → $125
	}
	for _, tc := range plans {
		got := CalculateStudentRevocationPenalty(tc.plan)
		if !got.Equal(decimal.RequireFromString(tc.expected)) {
			t.Errorf("plan price %s: expected penalty %s, got %s",
				tc.plan.Price.String(), tc.expected, got.String())
		}
	}
}

// TestRevocationPenaltyForUser - user ke current plan se penalty.
func TestRevocationPenaltyForUser(t *testing.T) {
	plan := &model.SubscriptionPlan{Price: decimal.NewFromInt(1000)} // ₹1000
	sub := &model.Subscription{UserID: 61, PlanID: 99, Status: model.SubscriptionStatusActive}
	svc := NewStudentService(newFakeStudentRepo(),
		&stubSubRepo{sub: sub},
		&stubPlanRepo{plan: plan})
	ctx := context.Background()

	penalty, err := svc.RevocationPenaltyForUser(ctx, 61)
	if err != nil {
		t.Fatal(err)
	}
	if !penalty.Equal(decimal.NewFromInt(250)) {
		t.Errorf("penalty for ₹1000 plan: expected 250, got %s", penalty.String())
	}
}

// TestRevocationPenaltyForUser_NoSubscription - koi active plan
// nahi to ErrNoActiveSubscription.
func TestRevocationPenaltyForUser_NoSubscription(t *testing.T) {
	svc := NewStudentService(newFakeStudentRepo(),
		&stubSubRepo{sub: nil}, &stubPlanRepo{})
	if _, err := svc.RevocationPenaltyForUser(context.Background(), 62); err != ErrNoActiveSubscription {
		t.Errorf("expected ErrNoActiveSubscription, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Educational-violation revocation (billing side)
// ---------------------------------------------------------------------------

// TestRevokeForEducationalViolation_ClearsState - flag false +
// token cleared (so re-use impossible).
func TestRevokeForEducationalViolation_ClearsState(t *testing.T) {
	repo := newFakeStudentRepo()
	svc := NewStudentService(repo, nil, nil)
	ctx := context.Background()

	_, err := svc.GrantVerification(ctx, 71, 1, []byte("s"))
	if err != nil {
		t.Fatal(err)
	}
	si, _ := repo.GetByUserID(ctx, 71)
	if si.IdentityToken == "" {
		t.Fatal("token should be set after grant")
	}

	if err := svc.RevokeForEducationalViolation(ctx, 71); err != nil {
		t.Fatal(err)
	}
	si, _ = repo.GetByUserID(ctx, 71)
	if si.IsVerifiedStudent {
		t.Error("flag must be false after revoke")
	}
	if si.Status != StudentStatusRevoked {
		t.Errorf("status: expected revoked, got %s", si.Status)
	}
	if si.IdentityToken != "" {
		t.Error("token must be cleared after revoke")
	}
	if si.IdentityTokenExpiresAt != nil {
		t.Error("expiry must be cleared after revoke")
	}
}

// ---------------------------------------------------------------------------
// Discount law integration (gate feeds GetPlanForUser)
// ---------------------------------------------------------------------------

// TestStudentDiscountLawIntegration - verify → student matrix
// passes; revoke → student matrix rejected (ineligible).
func TestStudentDiscountLawIntegration(t *testing.T) {
	repo := newFakeStudentRepo()
	svc := NewStudentService(repo, nil, nil)
	ctx := context.Background()

	_, err := svc.GrantVerification(ctx, 81, 1, []byte("s"))
	if err != nil {
		t.Fatal(err)
	}

	// Verified → checkout can pass IsVerifiedStudent=true.
	if !svc.IsVerifiedStudent(ctx, 81) {
		t.Fatal("must be verified right after grant")
	}
	// Student matrix eligible → GetPlanForUser accepts.
	_, err = GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{IsVerifiedStudent: true}, DiscountStudent)
	if err != nil {
		t.Errorf("verified student: student matrix should be accepted, got %v", err)
	}

	// Revoke — verification gone.
	if err := svc.RevokeForEducationalViolation(ctx, 81); err != nil {
		t.Fatal(err)
	}
	if svc.IsVerifiedStudent(ctx, 81) {
		t.Fatal("must be revoked")
	}
	// Student matrix now INELIGIBLE → GetPlanForUser rejects.
	_, err = GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{IsVerifiedStudent: false}, DiscountStudent)
	if err == nil {
		t.Error("revoked student: student matrix must be rejected")
	}
	if !strings.Contains(err.Error(), "requires AURA-verified") {
		t.Errorf("expected eligibility error, got %v", err)
	}
}

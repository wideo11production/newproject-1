// Royalty milestone engine tests — Tier A/B/C/D laws.
//
// Ye tests user ke directives ko lock karte hain:
//   - one-time royalty claim (flag immediately lock)
//   - threshold (₹510) se neeche claim rejected
//   - KYC-verified = instant payout, unverified = superadmin hold
//   - WideoCut Pro / Push allocation exemption (min-balance bypass)
//   - deficit calculation (Tier C green panel numbers)
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
// Test doubles
// ---------------------------------------------------------------------------

// fakeMilestoneRepo — in-memory milestone store (GetOrCreate + lock).
type fakeMilestoneRepo struct {
	rows map[uint]*model.RoyaltyMilestone
	next uint
}

func newFakeMilestoneRepo() *fakeMilestoneRepo {
	return &fakeMilestoneRepo{rows: map[uint]*model.RoyaltyMilestone{}}
}

func (f *fakeMilestoneRepo) GetOrCreate(ctx context.Context, userID uint, currency string, priceMinor, thresholdMinor int64) (*model.RoyaltyMilestone, error) {
	if m, ok := f.rows[userID]; ok {
		return m, nil
	}
	f.next++
	m := &model.RoyaltyMilestone{
		ID:                      f.next,
		UserID:                  userID,
		Currency:                currency,
		RoyaltyPriceMinor:       priceMinor,
		MilestoneThresholdMinor: thresholdMinor,
	}
	f.rows[userID] = m
	return m, nil
}

func (f *fakeMilestoneRepo) MarkFirstRoyaltyWithdrawn(ctx context.Context, userID uint, at time.Time) error {
	m, ok := f.rows[userID]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	if m.HasWithdrawnFirstRoyalty {
		return repository.ErrMilestoneAlreadyLocked
	}
	m.HasWithdrawnFirstRoyalty = true
	m.FirstRoyaltyWithdrawnAt = &at
	return nil
}

// stubSubRepo — sirf GetByUserID override; baaki methods embedded
// interface se panic karengi (in tests mein call nahi honge).
type stubSubRepo struct {
	repository.SubscriptionRepository
	sub *model.Subscription
	err error
}

func (f *stubSubRepo) GetByUserID(ctx context.Context, userID uint) (*model.Subscription, error) {
	return f.sub, f.err
}

// stubPlanRepo — sirf GetByID override.
type stubPlanRepo struct {
	repository.SubscriptionPlanRepository
	plan *model.SubscriptionPlan
	err  error
}

func (f *stubPlanRepo) GetByID(ctx context.Context, id uint) (*model.SubscriptionPlan, error) {
	return f.plan, f.err
}

// withRoyaltyConfig — test ke liye config swap (defer restore).
func withRoyaltyConfig(t *testing.T, cfg RoyaltyConfig) {
	t.Helper()
	old := royaltyConfig
	royaltyConfig = cfg
	t.Cleanup(func() { royaltyConfig = old })
}

// testConfig — user ke India examples (₹100 / ₹510 / ₹2000).
func testConfig() RoyaltyConfig {
	return RoyaltyConfig{
		Currency:                "INR",
		RoyaltyPriceMinor:       10000,  // ₹100
		MilestoneThresholdMinor: 51000,  // ₹510
		MinimumBalanceMinor:     200000, // ₹2000
	}
}

func newTestRoyaltyService(sub *model.Subscription, plan *model.SubscriptionPlan) (*RoyaltyService, *fakeMilestoneRepo) {
	ms := newFakeMilestoneRepo()
	return NewRoyaltyService(ms, &stubSubRepo{sub: sub}, &stubPlanRepo{plan: plan}), ms
}

// ---------------------------------------------------------------------------
// Tier transitions (India example numbers)
// ---------------------------------------------------------------------------

// TestTierTransitions_IndiaExample — A → B → (claim) → C → D.
func TestTierTransitions_IndiaExample(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	svc, _ := newTestRoyaltyService(nil, nil)
	ctx := context.Background()

	// Tier A: balance ₹400 < threshold ₹510 — restricted.
	st, err := svc.Evaluate(ctx, 1, 40000)
	if err != nil {
		t.Fatal(err)
	}
	if st.Tier != WithdrawalTierBelowThreshold {
		t.Errorf("balance ₹400: expected tier A, got %s", st.Tier)
	}
	if st.WithdrawalUnrestricted {
		t.Error("tier A must be restricted")
	}
	if st.DeficitToThresholdMinor != 11000 { // ₹110
		t.Errorf("deficit to threshold: expected 11000, got %d", st.DeficitToThresholdMinor)
	}

	// Tier B: balance ₹510 — threshold cross, claim eligible.
	st, err = svc.Evaluate(ctx, 1, 51000)
	if err != nil {
		t.Fatal(err)
	}
	if st.Tier != WithdrawalTierRoyaltyMilestone {
		t.Errorf("balance ₹510: expected tier B, got %s", st.Tier)
	}
	if !st.RoyaltyClaimEligible {
		t.Error("tier B must be claim-eligible")
	}

	// ONE-TIME claim (KYC-verified).
	claim, err := svc.ClaimFirstRoyalty(ctx, 1, 51000, true)
	if err != nil {
		t.Fatal(err)
	}
	if claim.AmountMinor != 10000 || claim.Currency != "INR" {
		t.Errorf("claim amount: expected ₹100 INR, got %d %s", claim.AmountMinor, claim.Currency)
	}
	if claim.Status != ClaimStatusInstant {
		t.Errorf("KYC-verified claim should route instant, got %s", claim.Status)
	}

	// Tier C: claim ke baad balance ₹410 (510-100) < ₹2000 — green panel.
	st, err = svc.Evaluate(ctx, 1, 41000)
	if err != nil {
		t.Fatal(err)
	}
	if st.Tier != WithdrawalTierTransition {
		t.Errorf("balance ₹410 post-claim: expected tier C, got %s", st.Tier)
	}
	if !st.HasWithdrawnFirstRoyalty {
		t.Error("flag must be true after claim")
	}
	if st.DeficitToMinimumMinor != 159000 { // ₹2000 - ₹410 = ₹1590
		t.Errorf("deficit to minimum: expected 159000, got %d", st.DeficitToMinimumMinor)
	}
	if st.WithdrawalUnrestricted {
		t.Error("tier C must still be restricted")
	}

	// Tier D: balance ₹2500 ≥ ₹2000 — unrestricted.
	st, err = svc.Evaluate(ctx, 1, 250000)
	if err != nil {
		t.Fatal(err)
	}
	if st.Tier != WithdrawalTierAboveBuffer {
		t.Errorf("balance ₹2500: expected tier D, got %s", st.Tier)
	}
	if !st.WithdrawalUnrestricted {
		t.Error("tier D must be unrestricted")
	}
}

// TestFirstRoyaltyOneTimeLock — doosra claim rejected, flag locked.
func TestFirstRoyaltyOneTimeLock(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	svc, _ := newTestRoyaltyService(nil, nil)
	ctx := context.Background()

	if _, err := svc.ClaimFirstRoyalty(ctx, 7, 60000, true); err != nil {
		t.Fatal(err)
	}
	// Doosra claim — same user, abhi bhi balance above threshold.
	_, err := svc.ClaimFirstRoyalty(ctx, 7, 60000, true)
	if err == nil {
		t.Fatal("second claim must be rejected")
	}
	if err != ErrRoyaltyAlreadyWithdrawn {
		t.Errorf("expected ErrRoyaltyAlreadyWithdrawn, got %v", err)
	}
	// Snapshot bhi lock dikhata hai.
	st, err := svc.Evaluate(ctx, 7, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if !st.HasWithdrawnFirstRoyalty {
		t.Error("Evaluate must report flag locked")
	}
	if st.RoyaltyClaimEligible {
		t.Error("locked flag must not be claim-eligible")
	}
}

// TestClaimBelowThresholdRejected — threshold se neeche claim nahi.
func TestClaimBelowThresholdRejected(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	svc, _ := newTestRoyaltyService(nil, nil)
	ctx := context.Background()

	// ₹509.99 — ek paisa kam, threshold cross nahi hua.
	_, err := svc.ClaimFirstRoyalty(ctx, 9, 50999, true)
	if err == nil {
		t.Fatal("claim below threshold must be rejected")
	}
	if err != ErrBelowRoyaltyThreshold {
		t.Errorf("expected ErrBelowRoyaltyThreshold, got %v", err)
	}
	// Flag LOCK nahi hona chahiye — rejected claim koi effect nahi.
	st, err := svc.Evaluate(ctx, 9, 50999)
	if err != nil {
		t.Fatal(err)
	}
	if st.HasWithdrawnFirstRoyalty {
		t.Error("rejected claim must not lock the flag")
	}
}

// TestClaimRouting_KYC — verified = instant, unverified = hold.
func TestClaimRouting_KYC(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	ctx := context.Background()

	// KYC-verified user — automated instant payout.
	svcVerified, _ := newTestRoyaltyService(nil, nil)
	claim, err := svcVerified.ClaimFirstRoyalty(ctx, 11, 51000, true)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Status != ClaimStatusInstant {
		t.Errorf("verified claim: expected %s, got %s", ClaimStatusInstant, claim.Status)
	}

	// Unverified user — superadmin telemetry hold log.
	svcUnverified, _ := newTestRoyaltyService(nil, nil)
	claim, err = svcUnverified.ClaimFirstRoyalty(ctx, 12, 51000, false)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Status != ClaimStatusHold {
		t.Errorf("unverified claim: expected %s, got %s", ClaimStatusHold, claim.Status)
	}
}

// ---------------------------------------------------------------------------
// Exemptions (WideoCut Pro / Push allocation)
// ---------------------------------------------------------------------------

// activeSub — ek active subscription with the given plan id.
func activeSub(planID uint) *model.Subscription {
	return &model.Subscription{
		UserID:  21,
		PlanID:  planID,
		Status:  model.SubscriptionStatusActive,
	}
}

// TestExemption_WideoCutPro — Pro license min-balance bypass karti hai.
func TestExemption_WideoCutPro(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	// Balance ₹600: threshold cross (claim eligible) par min balance
	// (₹2000) se BELOW — Pro exemption ke bina restricted.
	svcNoSub, _ := newTestRoyaltyService(nil, nil)
	st, err := svcNoSub.Evaluate(context.Background(), 21, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if st.WithdrawalUnrestricted {
		t.Error("no subscription: below-min balance must be restricted")
	}

	// Active WideoCut Pro plan — bypass ON.
	svcPro, _ := newTestRoyaltyService(activeSub(101), &model.SubscriptionPlan{ID: 101, Code: WideoCutProPlanCode})
	st, err = svcPro.Evaluate(context.Background(), 21, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if !st.MinBalanceBypassed {
		t.Error("WideoCut Pro must set min-balance bypass")
	}
	if !st.WithdrawalUnrestricted {
		t.Error("WideoCut Pro must unlock withdrawal below min balance")
	}
	// Royalty logic independent hai — abhi bhi Tier B (claim pending).
	if st.Tier != WithdrawalTierRoyaltyMilestone {
		t.Errorf("Pro user at ₹600: expected tier B, got %s", st.Tier)
	}
}

// TestExemption_PushAllocation — standalone push allocation bhi bypass.
func TestExemption_PushAllocation(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	svc, _ := newTestRoyaltyService(
		activeSub(202),
		&model.SubscriptionPlan{ID: 202, Code: PushAllocationPlanCode},
	)
	st, err := svc.Evaluate(context.Background(), 21, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if !st.MinBalanceBypassed || !st.WithdrawalUnrestricted {
		t.Error("push allocation must bypass min-balance constraint")
	}
}

// TestExemption_NormalPlanNoBypass — regular plan bypass NAHI karta.
func TestExemption_NormalPlanNoBypass(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	svc, _ := newTestRoyaltyService(
		activeSub(303),
		&model.SubscriptionPlan{ID: 303, Code: "starter"},
	)
	st, err := svc.Evaluate(context.Background(), 21, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if st.MinBalanceBypassed {
		t.Error("regular plan must not bypass min-balance")
	}
	if st.WithdrawalUnrestricted {
		t.Error("regular plan below min balance must stay restricted")
	}
}

// TestExemption_InactivePlanNoBypass — expired/cancelled plan bypass NAHI.
func TestExemption_InactivePlanNoBypass(t *testing.T) {
	withRoyaltyConfig(t, testConfig())
	expired := activeSub(404)
	expired.Status = model.SubscriptionStatusExpired
	svc, _ := newTestRoyaltyService(expired, &model.SubscriptionPlan{ID: 404, Code: WideoCutProPlanCode})
	st, err := svc.Evaluate(context.Background(), 21, 60000)
	if err != nil {
		t.Fatal(err)
	}
	if st.MinBalanceBypassed {
		t.Error("expired plan must not bypass min-balance")
	}
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

// TestRoyaltyConfigDefaults — env khali hai to user ke example defaults.
func TestRoyaltyConfigDefaults(t *testing.T) {
	cfg := LoadRoyaltyConfig()
	if cfg.Currency != "INR" {
		t.Errorf("default currency: expected INR, got %s", cfg.Currency)
	}
	if cfg.RoyaltyPriceMinor != 10000 {
		t.Errorf("default royalty price: expected 10000 (₹100), got %d", cfg.RoyaltyPriceMinor)
	}
	if cfg.MilestoneThresholdMinor != 51000 {
		t.Errorf("default threshold: expected 51000 (₹510), got %d", cfg.MilestoneThresholdMinor)
	}
	if cfg.MinimumBalanceMinor != 200000 {
		t.Errorf("default min balance: expected 200000 (₹2000), got %d", cfg.MinimumBalanceMinor)
	}
}

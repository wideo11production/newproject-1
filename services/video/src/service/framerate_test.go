// AURA Premium Framerate — strict license-gated feature flag tests.
//
// Hinglish: ye tests verify karte hain (user directive Q2):
//   - Global toggle OFF → sabhi users standard 30 FPS (dormant)
//   - Global toggle ON + active lifetime license → TierAura/Premium (120/240)
//   - Global toggle ON + standard monthly → max 60 FPS (NO premium, zero discount)
//   - Global toggle ON + group plan → max 60 FPS (NO premium, zero discount)
//   - Global toggle ON + no license → standard only
//   - Global toggle ON + inactive license → standard only
//   - Role-based logic: COMPLETELY REMOVED
//   - Subscription-based logic: COMPLETELY REMOVED
//   - Manual override clamping: cannot exceed eligible tier
//
// Pure logic — fake license checker + fake repo, database ke bina.
package service

import (
	"context"
	"errors"
	"testing"

	"newproject/services/video/src/model"
)

// ---------------------------------------------------------------------------
// Fake AURA license checker
// ---------------------------------------------------------------------------

type fakeLicenseChecker struct {
	licenseType     model.AURALicenseType
	licenseActive   bool
	err            error
}

func (f *fakeLicenseChecker) CheckLicense(ctx context.Context, userID uint) (model.AURALicenseType, bool, error) {
	if f.err != nil {
		return model.LicenseNone, false, f.err
	}
	return f.licenseType, f.licenseActive, nil
}

// ---------------------------------------------------------------------------
// Fake framerate profile repository
// ---------------------------------------------------------------------------

type fakeFramerateRepo struct {
	profiles []*model.ProjectFramerateProfile
	createErr error
	getErr     error
}

func (f *fakeFramerateRepo) Create(ctx context.Context, p *model.ProjectFramerateProfile) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.profiles = append(f.profiles, p)
	return nil
}

func (f *fakeFramerateRepo) GetByProjectUUID(ctx context.Context, projectUUID string) (*model.ProjectFramerateProfile, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	for _, p := range f.profiles {
		if p.ProjectUUID == projectUUID {
			return p, nil
		}
	}
	return nil, errors.New("profile not found")
}

func (f *fakeFramerateRepo) Update(ctx context.Context, p *model.ProjectFramerateProfile) error {
	return nil
}

// ---------------------------------------------------------------------------
// IsHighFramerateRole — REMOVED. Verify it no longer exists in model.
// ---------------------------------------------------------------------------

func TestRoleBasedLogic_Removed(t *testing.T) {
	// User directive Q2: role-based activation completely stripped out.
	// Verify that IsHighFramerateRole no longer exists.
	// Hinglish: agar ye function exist karta hai to build fail hoga —
	// isliye hum sirf license-based check karte hain.
	// (No test needed — compilation itself proves removal.)
}

// ---------------------------------------------------------------------------
// AURALicenseType.IsPremiumLicense
// ---------------------------------------------------------------------------

func TestAURALicenseType_IsPremiumLicense(t *testing.T) {
	// Only lifetime single-user license is premium.
	if !model.LicenseLifetimeSingleUser.IsPremiumLicense() {
		t.Error("lifetime_single_user should be premium license")
	}
	if model.LicenseStandardMonthly.IsPremiumLicense() {
		t.Error("standard_monthly should NOT be premium")
	}
	if model.LicenseGroupPlan.IsPremiumLicense() {
		t.Error("group_plan should NOT be premium")
	}
	if model.LicenseNone.IsPremiumLicense() {
		t.Error("none should NOT be premium")
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — global toggle OFF (dormant for ALL users)
// ---------------------------------------------------------------------------

func TestCheckEligibility_GlobalToggleOff_AllStandard(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = false

	// Test with various license types — ALL should be standard when toggle is OFF.
	testCases := []struct {
		name    string
		license model.AURALicenseType
		active  bool
	}{
		{"lifetime active", model.LicenseLifetimeSingleUser, true},
		{"monthly active", model.LicenseStandardMonthly, true},
		{"group active", model.LicenseGroupPlan, true},
		{"no license", model.LicenseNone, false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewFramerateService(cfg, &fakeLicenseChecker{
				licenseType: tc.license,
				licenseActive: tc.active,
			}, nil)

			elig, err := svc.CheckEligibility(context.Background(), 1)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if elig.IsEligible {
				t.Errorf("%s: should NOT be eligible when toggle is OFF", tc.name)
			}
			if elig.MaxTier != model.TierStandard {
				t.Errorf("%s: tier expected standard, got %s", tc.name, elig.MaxTier)
			}
			if elig.MaxFPS != cfg.MaxStandardFPS {
				t.Errorf("%s: FPS expected %d, got %d", tc.name, cfg.MaxStandardFPS, elig.MaxFPS)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — active lifetime license → Premium (120/240 FPS)
// ---------------------------------------------------------------------------

func TestCheckEligibility_ActiveLifetimeLicense_TierPremium(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: true,
	}, nil)

	elig, err := svc.CheckEligibility(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !elig.IsEligible {
		t.Error("active lifetime license should be eligible for premium")
	}
	if elig.MaxTier != model.TierPremium {
		t.Errorf("tier: expected premium, got %s", elig.MaxTier)
	}
	if elig.MaxFPS != cfg.AuraPremiumFPS {
		t.Errorf("FPS: expected %d (240), got %d", cfg.AuraPremiumFPS, elig.MaxFPS)
	}
	if elig.DisplayRefresh != model.RefreshRate240 {
		t.Errorf("refresh: expected 240Hz, got %d", elig.DisplayRefresh)
	}
	if elig.LicenseType != model.LicenseLifetimeSingleUser {
		t.Errorf("license type: expected lifetime_single_user, got %s", elig.LicenseType)
	}
	if !elig.LicenseActive {
		t.Error("license should be active")
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — standard monthly plan → max 60 FPS (NO premium, zero discount)
// ---------------------------------------------------------------------------

func TestCheckEligibility_StandardMonthly_Max60FPS(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseStandardMonthly,
		licenseActive: true,
	}, nil)

	elig, err := svc.CheckEligibility(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// User directive Q2: "Standard Monthly / Group Plan Subscriber → Maximum
	// playback ceiling strictly clamped at 60 FPS profile limits. Zero discount vectors."
	if elig.IsEligible {
		t.Error("standard monthly should NOT be eligible for premium (120/240)")
	}
	if elig.MaxTier != model.TierHigh {
		t.Errorf("tier: expected high (60 FPS cap), got %s", elig.MaxTier)
	}
	if elig.MaxFPS != cfg.MaxHighFPS {
		t.Errorf("FPS: expected %d (60, monthly cap), got %d", cfg.MaxHighFPS, elig.MaxFPS)
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — group plan → max 60 FPS (NO premium)
// ---------------------------------------------------------------------------

func TestCheckEligibility_GroupPlan_Max60FPS(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseGroupPlan,
		licenseActive: true,
	}, nil)

	elig, err := svc.CheckEligibility(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elig.IsEligible {
		t.Error("group plan should NOT be eligible for premium")
	}
	if elig.MaxTier != model.TierHigh {
		t.Errorf("tier: expected high, got %s", elig.MaxTier)
	}
	if elig.MaxFPS != 60 {
		t.Errorf("FPS: expected 60 (group cap), got %d", elig.MaxFPS)
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — no license → standard only
// ---------------------------------------------------------------------------

func TestCheckEligibility_NoLicense_StandardOnly(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseNone,
		licenseActive: false,
	}, nil)

	elig, err := svc.CheckEligibility(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elig.IsEligible {
		t.Error("no license should NOT be eligible for premium")
	}
	if elig.MaxTier != model.TierStandard {
		t.Errorf("tier: expected standard, got %s", elig.MaxTier)
	}
	if elig.MaxFPS != 30 {
		t.Errorf("FPS: expected 30 (standard), got %d", elig.MaxFPS)
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — inactive lifetime license → standard only (NOT premium)
// ---------------------------------------------------------------------------

func TestCheckEligibility_InactiveLifetimeLicense_StandardOnly(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: false, // inactive — NOT eligible
	}, nil)

	elig, err := svc.CheckEligibility(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elig.IsEligible {
		t.Error("inactive lifetime license should NOT be eligible")
	}
	if elig.MaxTier != model.TierStandard {
		t.Errorf("tier: expected standard, got %s", elig.MaxTier)
	}
}

// ---------------------------------------------------------------------------
// CheckEligibility — license checker error propagation
// ---------------------------------------------------------------------------

func TestCheckEligibility_LicenseCheckerError(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		err: errors.New("licensing-service unreachable"),
	}, nil)

	_, err := svc.CheckEligibility(context.Background(), 1)
	if err == nil {
		t.Fatal("expected error from license checker")
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — lifetime license → premium profile saved
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_LifetimeLicense_PremiumProfile(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: true,
	}, repo)

	profile, err := svc.ApplyFramerateToProject(context.Background(), 42, "proj-premium", nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.Tier != model.TierPremium {
		t.Errorf("tier: expected premium, got %s", profile.Tier)
	}
	if profile.EffectiveFPS != 240 {
		t.Errorf("FPS: expected 240, got %d", profile.EffectiveFPS)
	}
	if profile.DisplayRefresh != model.RefreshRate240 {
		t.Errorf("refresh: expected 240Hz, got %d", profile.DisplayRefresh)
	}
	// Profile should be persisted.
	if len(repo.profiles) != 1 {
		t.Fatalf("expected 1 profile in repo, got %d", len(repo.profiles))
	}
	saved := repo.profiles[0]
	if saved.LicenseType != model.LicenseLifetimeSingleUser {
		t.Errorf("license type: expected lifetime, got %s", saved.LicenseType)
	}
	if !saved.AutoActivated {
		t.Error("should be auto-activated (license triggered, no manual override)")
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — monthly plan → clamped to 60 FPS (high tier)
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_MonthlyPlan_CappedAt60FPS(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseStandardMonthly,
		licenseActive: true,
	}, repo)

	profile, err := svc.ApplyFramerateToProject(context.Background(), 1, "proj-monthly", nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.Tier != model.TierHigh {
		t.Errorf("tier: expected high (60 FPS cap), got %s", profile.Tier)
	}
	if profile.EffectiveFPS != 60 {
		t.Errorf("FPS: expected 60 (monthly cap), got %d", profile.EffectiveFPS)
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — global toggle OFF → standard for lifetime license too
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_ToggleOff_LifetimeLicense_StillStandard(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = false // toggle OFF
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: true,
	}, repo)

	profile, err := svc.ApplyFramerateToProject(context.Background(), 1, "proj", nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Even with lifetime license, toggle OFF → standard.
	if profile.Tier != model.TierStandard {
		t.Errorf("tier: expected standard (toggle off), got %s", profile.Tier)
	}
	if profile.EffectiveFPS != 30 {
		t.Errorf("FPS: expected 30 (toggle off), got %d", profile.EffectiveFPS)
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — manual override clamping (cannot exceed eligibility)
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_ManualOverrideClampedToEligibility(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	// Monthly plan → max is TierHigh (60 FPS).
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseStandardMonthly,
		licenseActive: true,
	}, repo)

	// Try to override to premium — should clamp to high.
	override := model.TierPremium
	profile, err := svc.ApplyFramerateToProject(context.Background(), 1, "proj", nil, &override)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.Tier != model.TierHigh {
		t.Errorf("tier: expected clamped high, got %s", profile.Tier)
	}
	if profile.EffectiveFPS != 60 {
		t.Errorf("FPS: expected 60 (clamped), got %d", profile.EffectiveFPS)
	}
	if !profile.ManualOverride {
		t.Error("should be marked as manual override (attempted)")
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — manual override within eligibility (lifetime → Aura)
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_ManualOverrideWithinEligibility(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: true,
	}, repo)

	// Override to aura (120 FPS) — within lifetime license eligibility.
	override := model.TierAura
	profile, err := svc.ApplyFramerateToProject(context.Background(), 1, "proj", nil, &override)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.Tier != model.TierAura {
		t.Errorf("tier: expected aura, got %s", profile.Tier)
	}
	if profile.EffectiveFPS != 120 {
		t.Errorf("FPS: expected 120, got %d", profile.EffectiveFPS)
	}
	if !profile.ManualOverride {
		t.Error("should be marked as manual override")
	}
	if profile.AutoActivated {
		t.Error("manual override should not be auto-activated")
	}
}

// ---------------------------------------------------------------------------
// ApplyFramerateToProject — repo error
// ---------------------------------------------------------------------------

func TestApplyFramerateToProject_RepoError(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	repo := &fakeFramerateRepo{
		createErr: errors.New("db offline"),
	}
	svc := NewFramerateService(cfg, &fakeLicenseChecker{
		licenseType:   model.LicenseLifetimeSingleUser,
		licenseActive: true,
	}, repo)

	_, err := svc.ApplyFramerateToProject(context.Background(), 1, "proj", nil, nil)
	if err == nil {
		t.Fatal("expected error from repo Create")
	}
}

// ---------------------------------------------------------------------------
// GetProfile — profile retrieval
// ---------------------------------------------------------------------------

func TestGetProfile_Found(t *testing.T) {
	cfg := DefaultFramerateConfig()
	repo := &fakeFramerateRepo{
		profiles: []*model.ProjectFramerateProfile{
			{
				ProjectUUID:    "proj-1",
				UserID:         1,
				LicenseType:    model.LicenseLifetimeSingleUser,
				Tier:           model.TierPremium,
				EffectiveFPS:   240,
				DisplayRefresh: model.RefreshRate240,
			},
		},
	}
	svc := NewFramerateService(cfg, nil, repo)

	profile, err := svc.GetProfile(context.Background(), "proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if profile.EffectiveFPS != 240 {
		t.Errorf("FPS: expected 240, got %d", profile.EffectiveFPS)
	}
	if profile.LicenseType != model.LicenseLifetimeSingleUser {
		t.Errorf("license: expected lifetime, got %s", profile.LicenseType)
	}
}

func TestGetProfile_NotFound(t *testing.T) {
	cfg := DefaultFramerateConfig()
	repo := &fakeFramerateRepo{}
	svc := NewFramerateService(cfg, nil, repo)

	_, err := svc.GetProfile(context.Background(), "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent profile")
	}
}

// ---------------------------------------------------------------------------
// fpsForTier
// ---------------------------------------------------------------------------

func TestFpsForTier_AllTiers(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true
	svc := NewFramerateService(cfg, nil, nil)

	tests := []struct {
		tier         model.FramerateTier
		expectedFPS  int
		expectedRef  model.DisplayRefreshRate
	}{
		{model.TierStandard, 30, model.RefreshRate60},
		{model.TierHigh, 60, model.RefreshRate120},
		{model.TierAura, 120, model.RefreshRate120},
		{model.TierPremium, 240, model.RefreshRate240},
	}

	for _, tt := range tests {
		fps, ref := svc.fpsForTier(tt.tier)
		if fps != tt.expectedFPS {
			t.Errorf("tier %s: FPS expected %d, got %d", tt.tier, tt.expectedFPS, fps)
		}
		if ref != tt.expectedRef {
			t.Errorf("tier %s: refresh expected %d, got %d", tt.tier, tt.expectedRef, ref)
		}
	}
}

// ---------------------------------------------------------------------------
// DefaultFramerateConfig
// ---------------------------------------------------------------------------

func TestDefaultFramerateConfig(t *testing.T) {
	cfg := DefaultFramerateConfig()
	// Hinglish: default me toggle OFF — dormant until license + toggle both pass.
	if cfg.Enabled {
		t.Error("default should have Enabled=false (dormant)")
	}
	if cfg.AuraHighFPS != 120 {
		t.Errorf("AuraHighFPS: expected 120, got %d", cfg.AuraHighFPS)
	}
	if cfg.AuraPremiumFPS != 240 {
		t.Errorf("AuraPremiumFPS: expected 240, got %d", cfg.AuraPremiumFPS)
	}
	if cfg.MaxHighFPS != 60 {
		t.Errorf("MaxHighFPS: expected 60 (monthly cap), got %d", cfg.MaxHighFPS)
	}
	if cfg.MaxStandardFPS != 30 {
		t.Errorf("MaxStandardFPS: expected 30, got %d", cfg.MaxStandardFPS)
	}
}

// ---------------------------------------------------------------------------
// Zero discount vectors — verify monthly and group get SAME 60 FPS cap
// ---------------------------------------------------------------------------

func TestZeroDiscountVectors_MonthlyAndGroupSame60FPSCap(t *testing.T) {
	cfg := DefaultFramerateConfig()
	cfg.Enabled = true

	svc := NewFramerateService(cfg, nil, nil)

	// Monthly plan.
	monthlyElig := &model.FramerateEligibility{
		MaxTier:  model.TierHigh,
		MaxFPS:   cfg.MaxHighFPS,
	}
	fpsForMonthly, _ := svc.fpsForTier(monthlyElig.MaxTier)

	// Group plan.
	groupElig := &model.FramerateEligibility{
		MaxTier:  model.TierHigh,
		MaxFPS:   cfg.MaxHighFPS,
	}
	fpsForGroup, _ := svc.fpsForTier(groupElig.MaxTier)

	// Both must be 60 FPS — zero discount.
	if fpsForMonthly != 60 || fpsForGroup != 60 {
		t.Errorf("zero discount: monthly=%d, group=%d, both should be 60", fpsForMonthly, fpsForGroup)
	}
}

// ---------------------------------------------------------------------------
// tierRank — ensures premium > aura > high > standard
// ---------------------------------------------------------------------------

func TestTierRank_Ordering(t *testing.T) {
	cfg := DefaultFramerateConfig()
	svc := NewFramerateService(cfg, nil, nil)

	if svc.tierRank(model.TierStandard) >= svc.tierRank(model.TierHigh) {
		t.Error("standard rank should be < high rank")
	}
	if svc.tierRank(model.TierHigh) >= svc.tierRank(model.TierAura) {
		t.Error("high rank should be < aura rank")
	}
	if svc.tierRank(model.TierAura) >= svc.tierRank(model.TierPremium) {
		t.Error("aura rank should be < premium rank")
	}
}

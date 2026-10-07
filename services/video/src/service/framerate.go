// AURA Premium Framerate — strict license-gated feature flag engine.
//
// Hinglish: ye service AURA Premium Framerate feature ka core LOGIC implement karta hai.
// **CRITICAL BUSINESS LOGIC (user directive Q2):**
//
// 1. 120 FPS / 240Hz ENGINE CAPABILITY COMPLETELY DECOUPLED from role-based triggers.
//    Sabhi role-based activations, group sharing, discount tiers — HATAA DIYE.
//    Sirf license-based decision hai.
//
// 2. SINGLE-USER LIFETIME GATE:
//    - Global toggle OFF → sabhi users standard (25/30/60 FPS) par limited.
//    - Global toggle ON → check AURA license:
//      - Active Lifetime Single-User License → unlock 120/240 FPS.
//      - Standard Monthly / Group Plan → max 60 FPS. Zero discounts.
//    - Koi free trial, monthly plan, ya group se premium nahi milega.
//
// Architecture:
//   - AURALicenseChecker interface (cross-module safe: video-service ne
//     user-service ya licensing-service ko direct import nahi karta).
//   - FramerateProfileRepository for persistence.
//   - Decision engine: global toggle → license check → tier mapping.
//
package service

import (
	"context"
	"errors"
	"fmt"

	"newproject/services/video/src/config"
	"newproject/services/video/src/model"
)

// AURALicenseChecker — cross-module interface to query AURA license status.
//
// Hinglish: video-service user-service/licensing-service ko directly import
// nahi karta (separate Go modules, circular dependency risk). Is interface ko
// main.go implement karega (HTTP client to licensing-service). Tests mein fake lagta hai.
//
// **IMPORTANT (user directive Q2):** ye interface sirf license type + status
// return karta hai — koi role, koi subscription, koi voucher. License-based
// check pure and simple.
type AURALicenseChecker interface {
	// CheckLicense returns the user's AURA license type and active status.
	// Returns: (licenseType, licenseActive, error)
	// licenseType = lifetime_single_user / standard_monthly / group_plan / none
	// licenseActive = true only if license status is "active"
	CheckLicense(ctx context.Context, userID uint) (model.AURALicenseType, bool, error)
}

// FramerateProfileRepository — project framerate profile storage.
// Hinglish: ye interface profile persistence ke liye hai. AutoMigrate
// ProjectFramerateProfile model ko handle karta hai.
type FramerateProfileRepository interface {
	Create(ctx context.Context, p *model.ProjectFramerateProfile) error
	GetByProjectUUID(ctx context.Context, projectUUID string) (*model.ProjectFramerateProfile, error)
	Update(ctx context.Context, p *model.ProjectFramerateProfile) error
}

// FramerateService — AURA Premium Framerate feature flag engine.
//
// Hinglish: ye service ye determine karta hai ki user ko kaunse FPS mil sakta
// hai, based on:
//  1. Global toggle (AURA_HIGH_FRAMERATE_ENABLED)
//  2. AURA license type (lifetime single-user vs monthly vs group)
//  3. License active status
//
// Role-based activation COMPLETELY REMOVED (user directive Q2).
type FramerateService struct {
	cfg   config.FramerateConfig
	users AURALicenseChecker
	repo  FramerateProfileRepository
}

// NewFramerateService creates a new FramerateService.
func NewFramerateService(
	cfg config.FramerateConfig,
	users AURALicenseChecker,
	repo FramerateProfileRepository,
) *FramerateService {
	return &FramerateService{
		cfg:   cfg,
		users: users,
		repo:  repo,
	}
}

// CheckEligibility evaluates whether a user can use AURA Premium framerate.
//
// OPERATIONAL FLOW (user directive Q2):
//  1. Global toggle OFF → TierStandard, not eligible (all users).
//  2. Global toggle ON → check AURA license:
//     a. Active + LifetimeSingleUser → TierAura/Premium eligible.
//     b. Active + StandardMonthly/GroupPlan → TierHigh max (60 FPS). NOT eligible for premium.
//     c. Inactive/Expired → TierStandard. NOT eligible.
//  3. NO role-based logic. NO subscription-based. NO voucher/discount.
//
// Hinglish: yehi core decision engine hai. License check karta hai,
// tier assign karta hai, FPS calculate karta hai.
func (s *FramerateService) CheckEligibility(ctx context.Context, userID uint) (*model.FramerateEligibility, error) {

	// 1. Global toggle check — sabse pehle.
	if !s.cfg.Enabled {
		return &model.FramerateEligibility{
			IsEligible:      false,
			MaxTier:         model.TierStandard,
			MaxFPS:          s.cfg.MaxStandardFPS,
			DisplayRefresh:  model.RefreshRate60,
			LicenseType:     model.LicenseNone,
			LicenseActive:   false,
			Reason:          "AURA_HIGH_FRAMERATE_ENABLED is false (global toggle off) — all users capped at standard profiles",
		}, nil
	}

	// 2. AURA license check — NOT role check. License-only decision.
	licenseType, licenseActive, err := s.users.CheckLicense(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to check AURA license: %w", err)
	}

	// 3. If license not active → standard tier, not eligible for premium.
	if !licenseActive {
		return &model.FramerateEligibility{
			IsEligible:      false,
			MaxTier:         model.TierStandard,
			MaxFPS:          s.cfg.MaxStandardFPS,
			DisplayRefresh:  model.RefreshRate60,
			LicenseType:     licenseType,
			LicenseActive:   false,
			Reason:          fmt.Sprintf("license=%s is not active — premium framerate not unlocked", licenseType),
		}, nil
	}

	// 4. If license is active:
	//    - Lifetime single-user → PREMIUM eligible (120/240 FPS).
	//    - Monthly/group → max 60 FPS (high tier), NOT premium.
	if licenseType.IsPremiumLicense() {
		// Active lifetime single-user license → unlock premium matrix.
		return &model.FramerateEligibility{
			IsEligible:      true,
			MaxTier:         model.TierPremium,
			MaxFPS:          s.cfg.AuraPremiumFPS,
			DisplayRefresh:  model.RefreshRate240,
			LicenseType:     licenseType,
			LicenseActive:   true,
			Reason:          "active lifetime single-user AURA license — premium framerate unlocked (120/240 FPS)",
		}, nil
	}

	// Standard monthly or group plan → max 60 FPS (high tier).
	// User directive Q2: "Standard Monthly / Group Plan Subscriber → Maximum
	// playback ceiling strictly clamped at 60 FPS profile limits. Zero discount vectors permitted."
	return &model.FramerateEligibility{
		IsEligible:      false,
		MaxTier:         model.TierHigh,
		MaxFPS:          s.cfg.MaxHighFPS,
		DisplayRefresh:  model.RefreshRate120,
		LicenseType:     licenseType,
		LicenseActive:   true,
		Reason:          fmt.Sprintf("active %s license — max 60 FPS (premium NOT unlocked, zero discounts)", licenseType),
	}, nil
}

// ApplyFramerateToProject evaluates eligibility and saves the profile.
//
// Hinglish: jab project create/update hota hai, ye method call hota hai
// to determine kare ki uss project ko kaunse FPS milega. License check karta
// hai, profile database me save karta hai, aur Project.FPS field sync karta hai.
//
// Parameters:
//   - userID: license check ke liye
//   - projectUUID: profile associate karne ke liye
//   - project: FPS field sync ke liye (nil ho sakta hai)
//   - manualOverrideTier: user ne explicitly tier set kiya (clamp check ke saath)
func (s *FramerateService) ApplyFramerateToProject(
	ctx context.Context,
	userID uint,
	projectUUID string,
	project *model.Project,
	manualOverrideTier *model.FramerateTier,
) (*model.ProjectFramerateProfile, error) {

	eligibility, err := s.CheckEligibility(ctx, userID)
	if err != nil {
		return nil, err
	}

	tier := eligibility.MaxTier
	autoActivated := true

	// Manual override — user ne explicitly tier set kiya.
	if manualOverrideTier != nil {
		// Clamp: manual tier cannot exceed max eligible tier.
		if s.tierRank(*manualOverrideTier) > s.tierRank(eligibility.MaxTier) {
			tier = eligibility.MaxTier
		} else {
			tier = *manualOverrideTier
		}
		autoActivated = false
	}

	fps, refresh := s.fpsForTier(tier)

	profile := &model.ProjectFramerateProfile{
		ProjectUUID:      projectUUID,
		UserID:           userID,
		LicenseType:      eligibility.LicenseType,
		Tier:             tier,
		EffectiveFPS:     fps,
		DisplayRefresh:   refresh,
		AutoActivated:    autoActivated,
		ManualOverride:   manualOverrideTier != nil,
	}

	if s.repo != nil {
		if err := s.repo.Create(ctx, profile); err != nil {
			return nil, fmt.Errorf("failed to save framerate profile: %w", err)
		}
	}

	// Sync Project.FPS field (backward compatible).
	if project != nil {
		project.FPS = fps
	}

	return profile, nil
}

// CheckLicense delegates to the AURALicenseChecker.
// Hinglish: ye method externally accessible hai license check ke liye
// bina full eligibility ke.
func (s *FramerateService) CheckLicense(ctx context.Context, userID uint) (model.AURALicenseType, bool, error) {
	if s.users == nil {
		return model.LicenseNone, false, errors.New("license checker not configured")
	}
	return s.users.CheckLicense(ctx, userID)
}

// GetProfile retrieves the framerate profile for a project.
func (s *FramerateService) GetProfile(ctx context.Context, projectUUID string) (*model.ProjectFramerateProfile, error) {
	if s.repo == nil {
		return nil, errors.New("repository not configured")
	}
	return s.repo.GetByProjectUUID(ctx, projectUUID)
}

// BuildFramerateDecision creates a decision record for logging/audit.
func (s *FramerateService) BuildFramerateDecision(
	eligibility *model.FramerateEligibility,
	profile *model.ProjectFramerateProfile,
) model.FramerateDecision {
	return model.FramerateDecision{
		UserID:             profile.UserID,
		ProjectUUID:        profile.ProjectUUID,
		Tier:               profile.Tier,
		EffectiveFPS:       profile.EffectiveFPS,
		DisplayRefresh:     profile.DisplayRefresh,
		Reason:             eligibility.Reason,
		GlobalToggleON:     s.cfg.Enabled,
		LicenseType:        eligibility.LicenseType,
		LicenseActive:      eligibility.LicenseActive,
		AutoActivated:      profile.AutoActivated,
		ManualOverride:     profile.ManualOverride,
	}
}

// fpsForTier returns the FPS and display refresh rate for a given tier.
// Hinglish: tier se FPS calculate karta hai. Config values use karta hai.
func (s *FramerateService) fpsForTier(tier model.FramerateTier) (int, model.DisplayRefreshRate) {
	switch tier {
	case model.TierPremium:
		return s.cfg.AuraPremiumFPS, model.RefreshRate240
	case model.TierAura:
		return s.cfg.AuraHighFPS, model.RefreshRate120
	case model.TierHigh:
		return s.cfg.MaxHighFPS, model.RefreshRate120
	default:
		return s.cfg.MaxStandardFPS, model.RefreshRate60
	}
}

// tierRank returns ordinal rank for comparison (higher = better tier).
// Hinglish: manual override clamping ke liye — user tier ko max eligible se
// upar jaa sakta nahi hai.
func (s *FramerateService) tierRank(tier model.FramerateTier) int {
	switch tier {
	case model.TierPremium:
		return 3
	case model.TierAura:
		return 2
	case model.TierHigh:
		return 1
	default:
		return 0
	}
}

// DefaultFramerateConfig returns safe defaults for AURA Premium framerate.
//
// User directive Q2: default config reflects strict license gating.
// - AURA_HIGH_FRAMERATE_ENABLED = false (dormant until toggle + license pass)
// - Standard = 30 FPS, High = 60 FPS, Aura = 120 FPS, Premium = 240 FPS
func DefaultFramerateConfig() config.FramerateConfig {
	return config.FramerateConfig{
		Enabled:               false, // dormant by default
		MaxStandardFPS:        30,    // all users capped here
		MaxHighFPS:            60,    // monthly/group plan max
		AuraHighFPS:           120,   // lifetime license only
		AuraPremiumFPS:        240,   // lifetime + 240Hz display
		Display240HzOptimized: true,
	}
}

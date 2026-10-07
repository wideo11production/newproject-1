// AURA Premium Framerate — strict license-gated encoding model.
//
// Hinglish: ye model AURA Premium Framerate feature ka state store karta hai.
// **CRITICAL BUSINESS LOGIC (user directive Q2):**
//
// 1. 120 FPS / 240Hz ENGINE CAPABILITY COMPLETELY DECOUPLED FROM:
//    - Standard monthly models
//    - Student vouchers
//    - Role-based triggers (advocate/lawyer/student/etc — SAB KE LIYE HATAA DIYA)
//    - Group sharing frameworks
//    - Discount tiers (ZERO DISCOUNT VECTORS PERMITTED)
//
// 2. SINGLE-USER LIFETIME GATE: Premium framerate (120/240 FPS) is ONLY
//    accessible to accounts with an active standalone, full-price,
//    single-user AURA Specific lifetime license tier purchase.
//    Koi bhi free trial, monthly plan, ya group plan se premium nahi milega.
//
// Operational Flow:
//   Global Flag (AURA_HIGH_FRAMERATE_ENABLED)
//   ├── OFF → All users capped at standard profiles (25/30/60 FPS).
//   └── ON  → Check specific single-user AURA Tier License status.
//       ├── Active Lifetime Single-User License Holder → Unlock 120 FPS / 240Hz.
//       └── Standard Monthly / Group Plan Subscriber → Max 60 FPS. Zero discounts.
//
// YEH MODEL PURE DECISION-MAKING KA STATE HAI — actual FPS calculation
// service layer mein hoti hai. Yahan sirf types + constants hain.
//
package model

import (
	"time"

	"gorm.io/gorm"
)

// FramerateTier — encoding tier ke liye.
// Hinglish: ye tiers encode karte hain ki user ko kitna FPS mil sakta hai.
// standard = 25/30/60 (all users), aura = 120, premium = 240.
type FramerateTier string

const (
	// TierStandard — 25/30/60 FPS, sabhi users ke liye default.
	// Global toggle OFF ho ya license inactive ho, yehi tier milta hai.
	TierStandard FramerateTier = "standard"
	// TierHigh — 60 FPS, monthly/group plan subscribers ka maximum ceiling.
	// Lifetime license waalon ko bhi yeh dikhaiye aata hai as a stepping stone.
	TierHigh FramerateTier = "high"
	// TierAura — 120 FPS, AURA Specific lifetime license holders ke liye.
	// Yeh sirf full-price standalone lifetime license waalon tak pahunchega.
	TierAura FramerateTier = "aura"
	// TierPremium — 240 FPS, 240Hz display optimization.
	// Lifetime license + 240Hz display waalon ke liye top tier.
	TierPremium FramerateTier = "premium"
)

// AllFramerateTiers — iteration ke liye.
var AllFramerateTiers = []FramerateTier{
	TierStandard,
	TierHigh,
	TierAura,
	TierPremium,
}

// DisplayRefreshRate — supported display refresh rates.
type DisplayRefreshRate int

const (
	RefreshRate60  DisplayRefreshRate = 60
	RefreshRate120 DisplayRefreshRate = 120
	RefreshRate144 DisplayRefreshRate = 144
	RefreshRate240 DisplayRefreshRate = 240
)

// AURALicenseType — user ke AURA license ka type.
//
// User directive (Q2): "ONLY accessible to accounts possessing an active
// standalone, full-price, single-user AURA Specific lifetime license tier
// purchase."
//
// Hinglish: ye types determine karte hain ki user ka license kis category
// mein fallata hai. Standard monthly aur group plan wale 60 FPS tak hi
// limited hain — premium (120/240) lifetime license se hi unlock hota hai.
// Koi free trial, koi discount, koi role-based activation nahi.
type AURALicenseType string

const (
	// LicenseLifetimeSingleUser — AURA Specific lifetime license.
	// Full-price, standalone, single-user. PREMIUM framerate (120/240 FPS) unlock karta hai.
	// Yehi license type hai jo AURA Premium Framerate Feature ko UNLOCK karega.
	LicenseLifetimeSingleUser AURALicenseType = "lifetime_single_user"

	// LicenseStandardMonthly — monthly subscription plan.
	// Maximum 60 FPS tak limited. ZERO discount vectors permitted.
	LicenseStandardMonthly AURALicenseType = "standard_monthly"

	// LicenseGroupPlan — group/team plan.
	// Maximum 60 FPS tak limited. Group sharing framework — premium nahi milega.
	LicenseGroupPlan AURALicenseType = "group_plan"

	// LicenseNone — koi bhi AURA license nahi hai (free trial ya kuch nahi).
	// Standard 30 FPS tak limited.
	LicenseNone AURALicenseType = "none"
)

// AURALicenseStatus — license ka active/inactive status.
type AURALicenseStatus string

const (
	LicenseStatusActive   AURALicenseStatus = "active"
	LicenseStatusInactive AURALicenseStatus = "inactive"
	LicenseStatusExpired  AURALicenseStatus = "expired"
)

// IsPremiumLicense returns true ONLY for active lifetime single-user licenses.
// Hinglish: ye function check karta hai ki kya user ka license premium
// framerate unlock karta hai. Koi bhi monthly ya group plan nahi dega true —
// sirf full-price standalone lifetime license hi dega.
func (l AURALicenseType) IsPremiumLicense() bool {
	return l == LicenseLifetimeSingleUser
}

// IsActive returns true if the license status is active.
func (s AURALicenseStatus) IsActive() bool {
	return s == LicenseStatusActive
}

// ProjectFramerateProfile — ek project ke liye framerate configuration.
//
// Hinglish: jab project create/update hota hai, FramerateService isi profile
// ko set karta hai based on AURA license status. Project.FPS field se sync hota hai.
// License check hota hai, role check nahi (user directive Q2: role-based
// activation removed).
type ProjectFramerateProfile struct {
	gorm.Model
	ProjectID      uint                 `gorm:"not null;index" json:"project_id"`
	ProjectUUID    string               `gorm:"type:text;not null;index" json:"project_uuid"`
	UserID         uint                 `gorm:"not null;index" json:"user_id"`
	// LicenseType — user ka AURA license type jisse ye profile decide hua.
	LicenseType    AURALicenseType      `gorm:"size:30;not null;default:'none'" json:"license_type"`
	Tier           FramerateTier        `gorm:"size:20;not null;default:'standard'" json:"tier"`
	EffectiveFPS   int                  `gorm:"not null;default:30" json:"effective_fps"`
	DisplayRefresh DisplayRefreshRate   `gorm:"not null;default:60" json:"display_refresh"`
	// AutoActivated — true agar license automatically ne trigger kiya (no manual override).
	AutoActivated bool `gorm:"not null;default:false" json:"auto_activated"`
	// ManualOverride — user ne manually tier change kiya (clamp check ke saath).
	ManualOverride bool `gorm:"not null;default:false" json:"manual_override"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt      time.Time            `json:"updated_at"`
}

func (ProjectFramerateProfile) TableName() string {
	return "project_framerate_profiles"
}

// FramerateEligibility — user ke liye framerate tier evaluate hone ka result.
//
// Hinglish: ye structure determine karta hai ki user ko kaunse tier mil sakta
// hai. FramerateService.CheckEligibility se calculate hota hai.
// License-based decision — NOT role-based.
type FramerateEligibility struct {
	// IsEligible — kya user premium framerate (120/240 FPS) use kar sakta hai.
	// TRUE sirf active lifetime single-user license holder ke liye.
	IsEligible bool
	// MaxTier — user tak pahunch sakta hai sabse high tier.
	MaxTier FramerateTier
	// MaxFPS — us tier ke corresponding FPS.
	MaxFPS int
	// DisplayRefresh — recommended display refresh rate.
	DisplayRefresh DisplayRefreshRate
	// LicenseType — user ka actual license type.
	LicenseType AURALicenseType
	// LicenseActive — license active hai ya nahi.
	LicenseActive bool
	// Reason — human-readable kyun eligible/nahin hua (debugging ke liye).
	Reason string
}

// FramerateDecision — feature flag evaluation ke baad ka decision.
// Hinglish: ye structure log karta hai ki framerate kyun set hua,
// kaise decide hua (global toggle, license type, manual override).
type FramerateDecision struct {
	UserID             uint
	ProjectUUID        string
	Tier               FramerateTier
	EffectiveFPS       int
	DisplayRefresh     DisplayRefreshRate
	Reason             string
	GlobalToggleON     bool
	LicenseType        AURALicenseType
	LicenseActive      bool
	AutoActivated      bool
	ManualOverride     bool
}

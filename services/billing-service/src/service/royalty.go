package service

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ---------------------------------------------------------------------------
// Royalty milestone engine — Tier A/B/C/D withdrawal law.
//
// Hinglish: ye engine user ke balance ko chaar tiers me rakhta hai
// aur ek-dime first-royalty claim ko lock karta hai. Balance is
// engine ka INPUT hai — wallet/balance table abhi scaffold hai,
// isliye balance caller (ledger) se aayega. Engine khud koi paisa
// nahi banata, nahi store karta — sirf rules compute karta hai.
// ---------------------------------------------------------------------------

// Plan codes jo minimum-balance constraint se EXEMPT hain (user
// directive: standalone 'WideoCut Pro' license ya standalone 'Push
// Notification' allocation kharidne par min-balance rule bypass).
// Note: ye codes plan catalog ke seed codes se match hone chahiye.
const (
	WideoCutProPlanCode    = "wvideocut-pro"
	PushAllocationPlanCode = "push-notification-allocation"
)

// Claim routing statuses (KYC ke hisaab se — user directive).
const (
	// ClaimStatusInstant — KYC-verified account: automated instant payout.
	ClaimStatusInstant = "instant_payout"
	// ClaimStatusHold — unverified request: superadmin telemetry hold log.
	ClaimStatusHold = "superadmin_hold"
)

var (
	// ErrRoyaltyAlreadyWithdrawn — one-time royalty pehle se claimed.
	ErrRoyaltyAlreadyWithdrawn = errors.New("royalty_already_withdrawn")
	// ErrBelowRoyaltyThreshold — balance ne milestone threshold cross nahi kiya.
	ErrBelowRoyaltyThreshold = errors.New("below_royalty_threshold")
)

// RoyaltyConfig — country-specific royalty parameters (SSOT: env se).
//
// Hinglish: sab amounts MINOR units mein (INR = paise). Defaults
// user ke examples ke hisaab se: royalty price ₹100 = 10000,
// threshold ₹510 = 51000, minimum balance ₹2000 = 200000. Foreign
// equivalents ek alag currency ke config row se aayenge (recommendation-
// service ke per-country pattern jaisa).
type RoyaltyConfig struct {
	Currency                string
	RoyaltyPriceMinor       int64
	MilestoneThresholdMinor int64
	MinimumBalanceMinor     int64
}

// LoadRoyaltyConfig env se config padhta hai (safe defaults).
func LoadRoyaltyConfig() RoyaltyConfig {
	return RoyaltyConfig{
		Currency:                strEnv("ROYALTY_CURRENCY", "INR"),
		RoyaltyPriceMinor:       int64Env("ROYALTY_PRICE_MINOR", 10000),
		MilestoneThresholdMinor: int64Env("ROYALTY_THRESHOLD_MINOR", 51000),
		MinimumBalanceMinor:     int64Env("MINIMUM_BALANCE_MINOR", 200000),
	}
}

func strEnv(key, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v
}

func int64Env(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

// royaltyConfig is the process-wide SSOT. Tests (same package) isse
// override kar sakte hain — runtime mein env kabhi change nahi hota.
var royaltyConfig = LoadRoyaltyConfig()

// WithdrawalTier — display classification (Tier A/B/C/D).
type WithdrawalTier string

const (
	// WithdrawalTierBelowThreshold (Tier A): balance < royalty threshold.
	// Withdrawal button restricted — balance screen par dikhta hai.
	WithdrawalTierBelowThreshold WithdrawalTier = "below_threshold"
	// WithdrawalTierRoyaltyMilestone (Tier B): threshold cross ho gaya,
	// one-time royalty claim abhi pending — abhi claim kar sakta hai.
	WithdrawalTierRoyaltyMilestone WithdrawalTier = "royalty_milestone"
	// WithdrawalTierTransition (Tier C): royalty claim ho gaya par
	// minimum balance abhi pura nahi — soft green deficit panel.
	WithdrawalTierTransition WithdrawalTier = "transition"
	// WithdrawalTierAboveBuffer (Tier D): minimum balance cross ho gaya.
	// Withdrawal unrestricted — user kabhi bhi withdraw kar sakta hai.
	WithdrawalTierAboveBuffer WithdrawalTier = "above_buffer"
)

// WithdrawalState — ek user ka complete tier snapshot.
//
// Hinglish: frontend sirf ye struct render karega — paisa ka math
// yahan (Go) hota hai, client mein kabhi nahi (PROGRESS.md iron
// rule: "React must never calculate payout").
type WithdrawalState struct {
	Tier WithdrawalTier `json:"tier"`
	// BalanceMinor is the caller-supplied balance (minor units).
	BalanceMinor int64  `json:"balance_minor"`
	Currency     string `json:"currency"`
	// RoyaltyPriceMinor — one-time claim amount.
	RoyaltyPriceMinor int64 `json:"royalty_price_minor"`
	// MilestoneThresholdMinor — claim eligibility level.
	MilestoneThresholdMinor int64 `json:"milestone_threshold_minor"`
	// MinimumBalanceMinor — lifetime-income buffer level.
	MinimumBalanceMinor int64 `json:"minimum_balance_minor"`
	// DeficitToThresholdMinor — Tier A: claim ke liye kitna aur chahiye.
	DeficitToThresholdMinor int64 `json:"deficit_to_threshold_minor"`
	// DeficitToMinimumMinor — Tier C: lifetime unlock ke liye kitna aur
	// chahiye ("Just ₹X more to unlock lifetime income bounds!").
	DeficitToMinimumMinor int64 `json:"deficit_to_minimum_minor"`
	// HasWithdrawnFirstRoyalty — one-time flag (locked post-claim).
	HasWithdrawnFirstRoyalty bool `json:"has_withdrawn_first_royalty"`
	// RoyaltyClaimEligible — abhi claim kar sakta hai.
	RoyaltyClaimEligible bool `json:"royalty_claim_eligible"`
	// MinBalanceBypassed — Pro/Push exemption se min-balance rule bypass.
	MinBalanceBypassed bool `json:"min_balance_bypassed"`
	// WithdrawalUnrestricted — withdrawal button open (Tier D ya exemption).
	WithdrawalUnrestricted bool `json:"withdrawal_unrestricted"`
}

// RoyaltyClaim — ek successful one-time claim ka result.
type RoyaltyClaim struct {
	AmountMinor int64     `json:"amount_minor"`
	Currency    string    `json:"currency"`
	// Status: ClaimStatusInstant (KYC-verified) ya ClaimStatusHold.
	Status      string    `json:"status"`
	WithdrawnAt time.Time `json:"withdrawn_at"`
}

// RoyaltyService — royalty milestone business laws.
//
// Hinglish: BillingService se alag struct hai taaki NewBillingService
// ke pinned signature (tests pin karti hai) mein koi drift na aaye.
// Deps: milestone repo (nayi table), subscription + plan repos
// (exemption check ke liye).
type RoyaltyService struct {
	milestoneRepo repository.RoyaltyMilestoneRepository
	subRepo       repository.SubscriptionRepository
	planRepo      repository.SubscriptionPlanRepository
}

// NewRoyaltyService builds the royalty engine.
func NewRoyaltyService(
	milestoneRepo repository.RoyaltyMilestoneRepository,
	subRepo repository.SubscriptionRepository,
	planRepo repository.SubscriptionPlanRepository,
) *RoyaltyService {
	return &RoyaltyService{
		milestoneRepo: milestoneRepo,
		subRepo:       subRepo,
		planRepo:      planRepo,
	}
}

// Evaluate — user ka tier snapshot compute karta hai.
//
// `balanceMinor` the caller (ledger/wallet) se aata hai — engine
// khud balance store nahi karta (wallet table abhi scaffold hai).
func (s *RoyaltyService) Evaluate(ctx context.Context, userID uint, balanceMinor int64) (*WithdrawalState, error) {
	cfg := royaltyConfig
	m, err := s.milestoneRepo.GetOrCreate(ctx, userID, cfg.Currency, cfg.RoyaltyPriceMinor, cfg.MilestoneThresholdMinor)
	if err != nil {
		return nil, err
	}
	exempt, err := s.minBalanceExempt(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Do independent dimensions:
	//   royalty claim — threshold cross + flag false
	//   withdrawal freedom — min balance met YA exemption
	withdrawn := m.HasWithdrawnFirstRoyalty
	royaltyEligible := !withdrawn && balanceMinor >= cfg.MilestoneThresholdMinor
	minBalanceMet := balanceMinor >= cfg.MinimumBalanceMinor
	unrestricted := minBalanceMet || exempt

	state := &WithdrawalState{
		BalanceMinor:             balanceMinor,
		Currency:                 cfg.Currency,
		RoyaltyPriceMinor:        cfg.RoyaltyPriceMinor,
		MilestoneThresholdMinor:  cfg.MilestoneThresholdMinor,
		MinimumBalanceMinor:      cfg.MinimumBalanceMinor,
		HasWithdrawnFirstRoyalty: withdrawn,
		RoyaltyClaimEligible:     royaltyEligible,
		MinBalanceBypassed:       exempt,
		WithdrawalUnrestricted:   unrestricted,
	}
	// Deficits sirf positive hain — 0 ka matlab "target mil gaya".
	if deficit := cfg.MilestoneThresholdMinor - balanceMinor; deficit > 0 {
		state.DeficitToThresholdMinor = deficit
	}
	if deficit := cfg.MinimumBalanceMinor - balanceMinor; deficit > 0 {
		state.DeficitToMinimumMinor = deficit
	}

	switch {
	case withdrawn && !unrestricted:
		// Claim ho gaya, buffer abhi nahi — Tier C (green panel).
		state.Tier = WithdrawalTierTransition
	case withdrawn && unrestricted:
		// Claim ho gaya, buffer bhi mil gaya — Tier D.
		state.Tier = WithdrawalTierAboveBuffer
	case royaltyEligible:
		// Threshold cross, claim pending — Tier B.
		state.Tier = WithdrawalTierRoyaltyMilestone
	default:
		// Threshold abhi nahi — Tier A (restricted).
		state.Tier = WithdrawalTierBelowThreshold
	}
	return state, nil
}

// ClaimFirstRoyalty — the ONE-TIME royalty extraction.
//
// `balanceMinor` caller se aata hai. Threshold cross nahi hua to
// ErrBelowRoyaltyThreshold. Pehle se claimed to
// ErrRoyaltyAlreadyWithdrawn. Flag LOCK hota hai isi call mein
// (conditional UPDATE — concurrent double-claim mein sirf ek jeeta).
//
// KYC-verified accounts get instant payout routing; unverified
// requests route to superadmin hold (user directive: bank-driven
// KYC webhooks — unverified = telemetry hold log).
func (s *RoyaltyService) ClaimFirstRoyalty(ctx context.Context, userID uint, balanceMinor int64, kycVerified bool) (*RoyaltyClaim, error) {
	cfg := royaltyConfig
	m, err := s.milestoneRepo.GetOrCreate(ctx, userID, cfg.Currency, cfg.RoyaltyPriceMinor, cfg.MilestoneThresholdMinor)
	if err != nil {
		return nil, err
	}
	if m.HasWithdrawnFirstRoyalty {
		return nil, ErrRoyaltyAlreadyWithdrawn
	}
	if balanceMinor < cfg.MilestoneThresholdMinor {
		return nil, ErrBelowRoyaltyThreshold
	}

	now := time.Now().UTC()
	if err := s.milestoneRepo.MarkFirstRoyaltyWithdrawn(ctx, userID, now); err != nil {
		if errors.Is(err, repository.ErrMilestoneAlreadyLocked) {
			// Concurrent claim ne beech mein flag lock kar diya.
			return nil, ErrRoyaltyAlreadyWithdrawn
		}
		return nil, err
	}

	status := ClaimStatusHold
	if kycVerified {
		status = ClaimStatusInstant
	}
	return &RoyaltyClaim{
		AmountMinor: cfg.RoyaltyPriceMinor,
		Currency:    cfg.Currency,
		Status:      status,
		WithdrawnAt: now,
	}, nil
}

// minBalanceExempt — user ke paas active WideoCut Pro license ya
// Push Notification allocation hai? (User directive: inko
// min-balance constraint se bypass.)
func (s *RoyaltyService) minBalanceExempt(ctx context.Context, userID uint) (bool, error) {
	sub, err := s.subRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if sub == nil || sub.Status != model.SubscriptionStatusActive {
		return false, nil
	}
	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return plan.Code == WideoCutProPlanCode || plan.Code == PushAllocationPlanCode, nil
}

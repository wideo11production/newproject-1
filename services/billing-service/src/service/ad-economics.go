// Ad Plan Economics - revenue split engine
//
// YE MODULE AD REVENUE KA POORA MATH IMPLEMENT KARTA HAI (Q3.2 ke mutabiq).
// Pure logic hai - DB/network nahi - isliye unit testable hai.
//
// ---------------------------------------------------------------------------
// REVENUE SPLIT RULES (jo aapne diye):
//
// Ek ad ka example: ₹1000, 100 din me 10 baar show
//   → Viewer (ad dekhne wale)   : 60%
//   → Platform                   : 20%
//   → Content uploader (SUBSCRIBED)    : 20%
//   → Content uploader (FREE uploader)   : 0%
//   → Platform (full remainder)       : 40%
// Iska matlab: platform ko hamesha 20% minimum milta hai, baaki 80% viewer+creator
// me baant'te hain. SUBSCRIBED creator = 20%, FREE creator = 0% (user directive).
//
// ---------------------------------------------------------------------------
// PLANS (country/currency ke hisaab se alag):
//   India (INR)   : 300/3mo, 500/6mo, 1000/12mo, min balance ₹1000
//   High (USD)    : $150/3mo, $250/6mo, $500/12mo, min balance $1000
//   Low (local)   : 450/3mo, 750/6mo, 1500/12mo, min balance 3000
//
// CONTENT UPLOADER DISCOUNT:
//   - Monthly video-editor plans par 50% discount (sirf subscription wale)
//   - Lifetime purchase par KOI discount NAHI (group usage me discount nahi)
//
// Hinglish comments: har block ka arth
package service

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// Revenue split
// ---------------------------------------------------------------------------

// RevenueSplit - ek ad impression ka revenue kaise banta hai
type RevenueSplit struct {
	// Total ad revenue (gross)
	Gross decimal.Decimal
	// Viewer ka share (60%)
	Viewer decimal.Decimal
	// Content uploader ka share (subscribed=20%, free=0%)
	Creator decimal.Decimal
	// Platform ka share (20% ya free case me 20%)
	Platform decimal.Decimal
	// Creator subscribed tha ya nahi
	CreatorSubscribed bool
}

// SplitPercentages - industry-standard ad revenue distribution
//
// NOTE: Ye constants hain, config se nahi. Reason: ye RATE contract hai -
// inhe change karna ek product decision hai, config se karna silently
// payout math badal dega. Isliye code me explicit rakhe hain.
const (
	// ViewerSharePct: ad dekhne wale ko (60%)
	ViewerSharePct = "0.60"
	// CreatorSubscribedSharePct: subscription wale creator ko (20%)
	CreatorSubscribedSharePct = "0.20"
	// CreatorFreeSharePct: free uploader ko (0%) — subscription ke bina
	// creator ko kuch nahi milta (user directive: strictly subscribed
	// creators get 20%, free creators get NOTHING)
	CreatorFreeSharePct = "0.00"
	// PlatformSharePct: platform ko (20%)
	PlatformSharePct = "0.20"
)

// CalculateRevenueSplit ek ad impression ka revenue split karta hai
//
// EXAMPLE: ₹1000 ka ad, creator SUBSCRIBED hai:
//   Viewer   = 1000 × 0.60 = ₹600
//   Creator  = 1000 × 0.20 = ₹200
//   Platform = 1000 × 0.20 = ₹200
//   Total    = ₹1000 ✅
//
// EXAMPLE: ₹1000 ka ad, creator FREE hai (subscription nahi):
//   Viewer   = 1000 × 0.60 = ₹600
//   Creator  = 1000 × 0.00 = ₹0    (free creators get NOTHING)
//   Platform = 1000 × 0.40 = ₹400  (baki - 0.20 base + 0.20 free creator ki jagah)
//
// NOTE: Rounding - paise 2 decimal tak round hote hain aur LAST share ko
// adjust kiya jaata hai taaki total EXACTLY gross ke barabar rahe (paisa
// create ya destroy nahi hona chahiye).
func CalculateRevenueSplit(
	gross decimal.Decimal,
	creatorSubscribed bool,
) *RevenueSplit {

	viewerPct := decimal.RequireFromString(ViewerSharePct)

	creatorPct := decimal.RequireFromString(CreatorFreeSharePct)
	if creatorSubscribed {
		creatorPct = decimal.RequireFromString(CreatorSubscribedSharePct)
	}

	// Viewer aur creator ke baad jo bacha wahi platform ka hai
	// (subscribed: 1.00 - 0.60 - 0.20 = 0.20 ✅)
	// (free:      1.00 - 0.60 - 0.00 = 0.40, platform poori baki paata hai)
	platformEffectivePct := decimal.NewFromInt(1).
		Sub(viewerPct).
		Sub(creatorPct)

	viewer := money(gross.Mul(viewerPct))
	creator := money(gross.Mul(creatorPct))
	platform := money(gross.Mul(platformEffectivePct))

	// Rounding safety: total exactly gross ke barabar hona chahiye
	// Agar 1-2 paisa difference bache to platform me add kar dete hain
	delta := money(gross.Sub(viewer.Add(creator).Add(platform)))
	if !delta.IsZero() {
		platform = money(platform.Add(delta))
	}

	return &RevenueSplit{
		Gross:             money(gross),
		Viewer:            viewer,
		Creator:           creator,
		Platform:          platform,
		CreatorSubscribed: creatorSubscribed,
	}
}

// money - 2 decimal places tak round (paise ka standard)
func money(d decimal.Decimal) decimal.Decimal {
	return d.Round(2)
}

// ---------------------------------------------------------------------------
// Ad campaign economics
// ---------------------------------------------------------------------------

// AdCampaign ek ad campaign ka economics describe karta hai
type AdCampaign struct {
	// Campaign ID
	CampaignID string
	// Total budget (jo advertiser ne diya)
	TotalBudget decimal.Decimal
	// Kitne din me chalani hai
	DurationDays int
	// Din me kitni impressions
	DailyImpressions int
	// Content uploader subscribed hai ya nahi
	CreatorSubscribed bool
}

// CampaignEconomics - poore campaign ka paisa kahan gaya
type CampaignEconomics struct {
	Gross          decimal.Decimal
	TotalImpressions int
	ViewerTotal     decimal.Decimal
	CreatorTotal    decimal.Decimal
	PlatformTotal   decimal.Decimal
	PerImpression   decimal.Decimal
	EffectiveDays   int
}

// CalculateCampaignEconomics poore campaign ka split calculate karta hai
//
// EXAMPLE: ₹1000 budget, 100 din, 10 impressions/day
//   Total impressions = 100 × 10 = 1000
//   Per impression   = ₹1000 / 1000 = ₹1.00
//   Split per 1.00   = viewer 0.60, creator 0.20 (subscribed), platform 0.20
func CalculateCampaignEconomics(c *AdCampaign) *CampaignEconomics {

	// Total impressions
	totalImpressions := c.DurationDays * c.DailyImpressions

	if totalImpressions <= 0 {
		return &CampaignEconomics{Gross: money(c.TotalBudget)}
	}

	// Per impression value
	perImpression := c.TotalBudget.Div(decimal.NewFromInt(int64(totalImpressions)))

	// Poore campaign ka split
	split := CalculateRevenueSplit(c.TotalBudget, c.CreatorSubscribed)

	effectiveDays := c.DurationDays
	if effectiveDays <= 0 {
		effectiveDays = 1
	}

	return &CampaignEconomics{
		Gross:           money(c.TotalBudget),
		TotalImpressions: totalImpressions,
		ViewerTotal:      split.Viewer,
		CreatorTotal:     split.Creator,
		PlatformTotal:    split.Platform,
		PerImpression:    money(perImpression),
		EffectiveDays:    effectiveDays,
	}
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

// PlanTier - subscription ka duration
type PlanTier string

const (
	TierQuarterly      PlanTier = "quarterly"       // 3 months
	TierBiannual       PlanTier = "biannual"        // 6 months
	TierAnnual         PlanTier = "annual"          // 12 months
	TierLifetime       PlanTier = "lifetime"        // one-time single user
	TierLifetimeGroup5 PlanTier = "lifetime_group5" // one-time group of 5
	TierLifetimeGroup10 PlanTier = "lifetime_group10" // one-time group of 10
	TierLifetimeAURA   PlanTier = "lifetime_aura"   // one-time single + AURA
)

// Region - kaun sa plan group (currency ke hisaab se)
type Region string

const (
	// RegionIndia: Indian pricing (INR)
	RegionIndia Region = "india"
	// RegionHigh: jahan currency INR se ZYADA hai (USD plan)
	RegionHigh Region = "high"
	// RegionLow: jahan currency INR se KAM hai
	RegionLow Region = "low"
)

// Plan - ek subscription plan
type Plan struct {
	Tier      PlanTier
	Region    Region
	Currency  string
	Price     decimal.Decimal
	Days      int
	// MinBalance: is plan ka minimum balance (wallet me hold)
	MinBalance decimal.Decimal
	// DiscountPercent: content uploader ko discount (0 = no discount)
	DiscountPercent int
}

// PlanPriceTable - region aur tier ke hisaab se pricing
//
// VIDEO EDITOR PLANS (7 tiers):
//   Monthly: 3mo, 6mo, 12mo
//   Lifetime: single, group5, group10, single_aura
//
// India (INR) pricing:
//   Quarterly:     999  (3 months)
//   Biannual:      1799 (6 months) 
//   Annual:        2999 (12 months)
//   Lifetime:      7999 (single)
//   Lifetime G5:   19999 (group of 5)
//   Lifetime G10:  34999 (group of 10)
//   Lifetime AURA: 12999 (single + AURA)
//
// High (USD) pricing:
//   Quarterly:     $29  (3 months)
//   Biannual:      $49  (6 months)
//   Annual:        $79  (12 months)
//   Lifetime:      $199 (single)
//   Lifetime G5:   $499 (group of 5)
//   Lifetime G10:  $899 (group of 10)
//   Lifetime AURA: $299 (single + AURA)
//
// Low (LOCAL) pricing:
//   Quarterly:     1499 (3 months)
//   Biannual:      2699 (6 months)
//   Annual:        4499 (12 months)
//   Lifetime:      11999 (single)
//   Lifetime G5:   29999 (group of 5)
//   Lifetime G10:  52999 (group of 10)
//   Lifetime AURA: 18999 (single + AURA)
//
// Min balance: India=1000, High=1000, Low=3000 (same as before)
var PlanPriceTable = map[Region]map[PlanTier]*Plan{
	RegionIndia: {
		TierQuarterly:       {Tier: TierQuarterly, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(999), Days: 90, MinBalance: decimal.NewFromInt(1000)},
		TierBiannual:        {Tier: TierBiannual, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(1799), Days: 180, MinBalance: decimal.NewFromInt(1000)},
		TierAnnual:          {Tier: TierAnnual, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(2999), Days: 365, MinBalance: decimal.NewFromInt(1000)},
		TierLifetime:        {Tier: TierLifetime, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(7999), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeGroup5:  {Tier: TierLifetimeGroup5, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(19999), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeGroup10: {Tier: TierLifetimeGroup10, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(34999), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeAURA:    {Tier: TierLifetimeAURA, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(12999), Days: 0, MinBalance: decimal.NewFromInt(1000)},
	},
	RegionHigh: {
		TierQuarterly:       {Tier: TierQuarterly, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(29), Days: 90, MinBalance: decimal.NewFromInt(1000)},
		TierBiannual:        {Tier: TierBiannual, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(49), Days: 180, MinBalance: decimal.NewFromInt(1000)},
		TierAnnual:          {Tier: TierAnnual, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(79), Days: 365, MinBalance: decimal.NewFromInt(1000)},
		TierLifetime:        {Tier: TierLifetime, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(199), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeGroup5:  {Tier: TierLifetimeGroup5, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(499), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeGroup10: {Tier: TierLifetimeGroup10, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(899), Days: 0, MinBalance: decimal.NewFromInt(1000)},
		TierLifetimeAURA:    {Tier: TierLifetimeAURA, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(299), Days: 0, MinBalance: decimal.NewFromInt(1000)},
	},
	RegionLow: {
		TierQuarterly:       {Tier: TierQuarterly, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(1499), Days: 90, MinBalance: decimal.NewFromInt(3000)},
		TierBiannual:        {Tier: TierBiannual, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(2699), Days: 180, MinBalance: decimal.NewFromInt(3000)},
		TierAnnual:          {Tier: TierAnnual, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(4499), Days: 365, MinBalance: decimal.NewFromInt(3000)},
		TierLifetime:        {Tier: TierLifetime, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(11999), Days: 0, MinBalance: decimal.NewFromInt(3000)},
		TierLifetimeGroup5:  {Tier: TierLifetimeGroup5, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(29999), Days: 0, MinBalance: decimal.NewFromInt(3000)},
		TierLifetimeGroup10: {Tier: TierLifetimeGroup10, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(52999), Days: 0, MinBalance: decimal.NewFromInt(3000)},
		TierLifetimeAURA:    {Tier: TierLifetimeAURA, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(18999), Days: 0, MinBalance: decimal.NewFromInt(3000)},
	},
}

// ---------------------------------------------------------------------------
// Discount matrices (user directive — Conflict 2 answer)
// ---------------------------------------------------------------------------

// DiscountMatrix - ek user par EXACTLY ONE discount matrix.
//
// Hinglish: user ke liye discount ek hi hota hai — dual-
// compounding (25% + 25% = 50%) BLOCKED hai. Student verified
// ho ya 12-month commitment lo, dono mein se EK choose karta
// hai (user directive: "ik hi discount available hai double
// nahi milega").
type DiscountMatrix string

const (
	// DiscountNone - koi discount nahi (default).
	DiscountNone DiscountMatrix = "none"
	// DiscountStudent - AURA engine se verified student / tutor /
	// tuition center ke liye 25%.
	DiscountStudent DiscountMatrix = "student"
	// DiscountTwelveMonth - 12-month commitment (monthly-billed)
	// ke liye 25%.
	DiscountTwelveMonth DiscountMatrix = "twelve_month"
)

// DiscountPercent - dono matrices ka value: 25%.
const DiscountPercent = 25

// DiscountEligibility - user ki discount eligibility.
//
// Hinglish: IsVerifiedStudent flag AURA student gate
// (student_verifications — user-service) se aayega, abhi woh
// scaffold hai, isliye checkout verified status pass karta hai.
// IsTwelveMonthCommitment checkout ka shape hai (12-month
// commitment, monthly-billed).
type DiscountEligibility struct {
	IsVerifiedStudent      bool
	IsTwelveMonthCommitment bool
}

// GetPlan - region + tier se plan lookup karta hai
func GetPlan(region Region, tier PlanTier) (*Plan, error) {
	tiers, ok := PlanPriceTable[region]
	if !ok {
		return nil, fmt.Errorf("unknown region: %s", region)
	}
	plan, ok := tiers[tier]
	if !ok {
		return nil, fmt.Errorf("unknown tier %s for region %s", tier, region)
	}
	return plan, nil
}

// GetPlanForUser - user ka plan with EXACTLY ONE discount matrix.
//
// LAWS (user directive — Conflict 2 answer):
//   - Creator plans = viewer plans EXACTLY. Purani creator 50%
//     monthly discount law DELETED hai (user ne order diya:
//     "creator ka old wala delete karna ha") — creator ab viewer
//     plan hi leta hai, storage free hai, koi creator-specific
//     discount matrix nahi.
//   - Verified student / tutor / tuition center -> student
//     matrix (25%).
//   - 12-month commitment (monthly-billed) -> twelve_month
//     matrix (25%).
//   - ONE matrix per user: dono eligible ho to bhi user EK
//     choose karta hai — dual-compounding BLOCKED.
//
// `matrix` the USER'S choice (checkout se aata hai). Ineligible
// choice (student matrix jab AURA verification nahi hui) ->
// error, taake frontend ko explicit feedback mile.
func GetPlanForUser(
	region Region,
	tier PlanTier,
	eligibility DiscountEligibility,
	matrix DiscountMatrix,
) (*Plan, error) {
	plan, err := GetPlan(region, tier)
	if err != nil {
		return nil, err
	}

	// Choice validation — ineligible matrix reject karo.
	switch matrix {
	case DiscountNone:
		return plan, nil
	case DiscountStudent:
		if !eligibility.IsVerifiedStudent {
			return nil, fmt.Errorf(
				"student discount matrix requires AURA-verified student/tutor/tuition-center status")
		}
	case DiscountTwelveMonth:
		if !eligibility.IsTwelveMonthCommitment {
			return nil, fmt.Errorf(
				"twelve-month discount matrix requires a 12-month monthly-billed commitment")
		}
	default:
		return nil, fmt.Errorf("unknown discount matrix: %s", matrix)
	}

	// EXACTLY ONE matrix apply karo. Yahan tak ineligible
	// choices reject ho chuke hain; dono eligible ho to bhi
	// user ne EK choose kiya hai — isliye 25% hi, 50% nahi.
	discounted := *plan
	discounted.DiscountPercent = DiscountPercent
	discounted.Price = money(plan.Price.Mul(
		decimal.NewFromInt(1).Sub(
			decimal.NewFromInt(DiscountPercent).Div(decimal.NewFromInt(100)),
		),
	))
	return &discounted, nil
}

// CalculateMinBalanceCheck - user ka balance plan ke minimum se compare
//
// Business rule (Q1.1): minimum balance HAR USER ke apne wallet me hota hai.
// User ko dashboard pe dikhta hai. Minimum cross karne par withdrawal
// UNRESTRICTED ho jata hai.
func CalculateMinBalanceCheck(
	currentBalance decimal.Decimal,
	plan *Plan,
) (meetsMinimum bool, shortfall decimal.Decimal) {

	if plan == nil {
		// Koi plan nahi - default India quarterly minimum
		defaultMin := decimal.NewFromInt(1000)
		if currentBalance.GreaterThanOrEqual(defaultMin) {
			return true, decimal.Zero
		}
		return false, money(defaultMin.Sub(currentBalance))
	}

	if currentBalance.GreaterThanOrEqual(plan.MinBalance) {
		return true, decimal.Zero
	}

	return false, money(plan.MinBalance.Sub(currentBalance))
}

// FormatMoneyPlan - plan ka human readable summary
func FormatMoneyPlan(p *Plan) string {
	if p == nil {
		return "No plan"
	}
	discount := ""
	if p.DiscountPercent > 0 {
		discount = fmt.Sprintf(" (%d%% off)", p.DiscountPercent)
	}
	return fmt.Sprintf("%s %s / %d days%s | min balance %s %s",
		p.Currency, p.Price.String(), p.Days, discount, p.Currency, p.MinBalance.String())
}

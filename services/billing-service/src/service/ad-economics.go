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
//   → Content uploader (SUBSCRIBED)  : 20%
//   → Content uploader (FREE uploader) : 10%
//   → Platform                   : +10%  (baki)
// Iska matlab: platform ko hamesha 20% milta hai, baaki 80% viewer+creator
// me baant'te hain. Creator ka hissa depend karta hai uske subscription
// status par.
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
	// Content uploader ka share (subscribed=20%, free=10%)
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
	// CreatorFreeSharePct: free uploader ko (10%)
	CreatorFreeSharePct = "0.10"
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
// EXAMPLE: ₹1000 ka ad, creator FREE hai:
//   Viewer   = 1000 × 0.60 = ₹600
//   Creator  = 1000 × 0.10 = ₹100
//   Platform = 1000 × 0.20 = ₹200
//   (baki ₹100 platform me - kyunki creator ko sirf 10% mila)
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
	// (free:      1.00 - 0.60 - 0.10 = 0.30, jisme 0.20 platform +
	//            0.10 "baki" platform me jaata hai - jaisa aapne kaha)
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
	TierQuarterly PlanTier = "quarterly" // 3 months
	TierBiannual  PlanTier = "biannual"  // 6 months
	TierAnnual    PlanTier = "annual"    // 12 months
	TierLifetime  PlanTier = "lifetime"  // one-time
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
// Aapke diye gaye numbers:
//   India: 300/3mo, 500/6mo, 1000/12mo, min balance 1000
//   High:  $150/3mo,  $250/6mo,  $500/12mo,  min balance 1000
//   Low:   450/3mo,   750/6mo,   1500/12mo, min balance 3000
var PlanPriceTable = map[Region]map[PlanTier]*Plan{
	RegionIndia: {
		TierQuarterly: {Tier: TierQuarterly, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(300), Days: 90, MinBalance: decimal.NewFromInt(1000)},
		TierBiannual:  {Tier: TierBiannual, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(500), Days: 180, MinBalance: decimal.NewFromInt(1000)},
		TierAnnual:    {Tier: TierAnnual, Region: RegionIndia, Currency: "INR", Price: decimal.NewFromInt(1000), Days: 365, MinBalance: decimal.NewFromInt(1000)},
	},
	RegionHigh: {
		TierQuarterly: {Tier: TierQuarterly, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(150), Days: 90, MinBalance: decimal.NewFromInt(1000)},
		TierBiannual:  {Tier: TierBiannual, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(250), Days: 180, MinBalance: decimal.NewFromInt(1000)},
		TierAnnual:    {Tier: TierAnnual, Region: RegionHigh, Currency: "USD", Price: decimal.NewFromInt(500), Days: 365, MinBalance: decimal.NewFromInt(1000)},
	},
	RegionLow: {
		TierQuarterly: {Tier: TierQuarterly, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(450), Days: 90, MinBalance: decimal.NewFromInt(3000)},
		TierBiannual:  {Tier: TierBiannual, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(750), Days: 180, MinBalance: decimal.NewFromInt(3000)},
		TierAnnual:    {Tier: TierAnnual, Region: RegionLow, Currency: "LOCAL", Price: decimal.NewFromInt(1500), Days: 365, MinBalance: decimal.NewFromInt(3000)},
	},
}

// ContentUploaderDiscountPercent - content uploader ko monthly plans par discount
//
// Aapke rule: "content uploaders plans lenege unko video-editor ke monthly
// wale plans me se 50% discount milyega"
//
// IMPORTANT: Lifetime par KOI discount NAHI (aapke rule: "lifetime purchase
// me group usage me nahi koi discount")
const ContentUploaderDiscountPercent = 50

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

// GetPlanForCreator - content uploader ka discount apply karke plan deta hai
//
// RULES:
//   - Monthly/biannual/annual plans par 50% discount
//   - Lifetime par 0% discount
func GetPlanForCreator(
	region Region,
	tier PlanTier,
	isContentUploader bool,
) (*Plan, error) {

	plan, err := GetPlan(region, tier)
	if err != nil {
		return nil, err
	}

	// Lifetime par discount NAHI - ye hard rule hai
	if tier == TierLifetime {
		discounted := *plan
		discounted.DiscountPercent = 0
		discounted.Price = plan.Price // no discount
		return &discounted, nil
	}

	// Content uploader nahi hai ya lifetime hai -> full price
	if !isContentUploader {
		discounted := *plan
		discounted.DiscountPercent = 0
		return &discounted, nil
	}

	// Content uploader: 50% discount on monthly plans
	discountPercent := decimal.NewFromInt(ContentUploaderDiscountPercent)
	discountedPrice := plan.Price.
		Mul(decimal.NewFromInt(1).Sub(discountPercent.Div(decimal.NewFromInt(100))))

	discounted := *plan
	discounted.DiscountPercent = ContentUploaderDiscountPercent
	discounted.Price = money(discountedPrice)

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

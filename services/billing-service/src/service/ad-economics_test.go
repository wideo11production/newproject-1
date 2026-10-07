// Ad economics tests - revenue split aur plan pricing
//
// YE TESTS wo RULES protect karte hain jo aapne diye:
//   - 60/20/20 split (subscribed creator)
//   - 60/0/40 split (free creator - gets nothing)
//   - Region-wise plan pricing
//   - ONE discount matrix per user (student 25% XOR 12-month 25%)
//   - Minimum balance check
//
// Hinglish comments: har block ka arth
package service

import (
	"testing"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// Revenue split
// ---------------------------------------------------------------------------

// TestRevenueSplitSubscribedCreator - 60/20/20 split
func TestRevenueSplitSubscribedCreator(t *testing.T) {
	gross := decimal.NewFromInt(1000)

	split := CalculateRevenueSplit(gross, true)

	tests := []struct {
		name     string
		got      decimal.Decimal
		expected string
	}{
		{"viewer 60%", split.Viewer, "600"},
		{"creator 20%", split.Creator, "200"},
		{"platform 20%", split.Platform, "200"},
	}

	for _, tc := range tests {
		if !tc.got.Equal(decimal.RequireFromString(tc.expected)) {
			t.Errorf("%s: expected %s, got %s", tc.name, tc.expected, tc.got.String())
		}
	}

	// Total EXACTLY gross hona chahiye - paisa create/destroy nahi hona chahiye
	total := split.Viewer.Add(split.Creator).Add(split.Platform)
	if !total.Equal(gross) {
		t.Errorf("total must equal gross: %s vs %s", total.String(), gross.String())
	}
}

// TestRevenueSplitFreeCreator - 60/0/40 split (free creator gets 0%)
func TestRevenueSplitFreeCreator(t *testing.T) {
	gross := decimal.NewFromInt(1000)

	split := CalculateRevenueSplit(gross, false)

	// Creator sirf 0% (free uploader - kuch nahi milta)
	if !split.Creator.Equal(decimal.NewFromInt(0)) {
		t.Errorf("free creator should get 0%% = 0, got %s", split.Creator.String())
	}

	// Viewer 60%
	if !split.Viewer.Equal(decimal.NewFromInt(600)) {
		t.Errorf("viewer should get 60%% = 600, got %s", split.Viewer.String())
	}

	// Platform 60% + 0% = gets full 40%
	if !split.Platform.Equal(decimal.NewFromInt(400)) {
		t.Errorf("platform should get 40%% = 400, got %s", split.Platform.String())
	}

	total := split.Viewer.Add(split.Creator).Add(split.Platform)
	if !total.Equal(gross) {
		t.Errorf("total must equal gross: %s vs %s", total.String(), gross.String())
	}
}

// TestRevenueSplitRoundingConserves - rounding se paisa create/destroy nahi hona chahiye
func TestRevenueSplitRoundingConserves(t *testing.T) {
	// Ajeeb amounts jinke pe rounding error aata hai
	amounts := []string{"0.01", "0.03", "1.11", "7.77", "13.35", "99.99", "123.456"}

	for _, a := range amounts {
		gross := decimal.RequireFromString(a)
		for _, subscribed := range []bool{true, false} {
			split := CalculateRevenueSplit(gross, subscribed)
			total := split.Viewer.Add(split.Creator).Add(split.Platform)

			// Total aur gross dono 2dp hone chahiye
			//
			// NOTE: decimal.Decimal ek STRUCT hai (value + exp fields), isliye
			// "!=" se compare karne par 0.01 vs 0.01 bhi unequal aa jata hai
			// (exponent different hone par). Isliye .Equal() use karna zaroori hai.
			if !total.Round(2).Equal(gross.Round(2)) {
				t.Errorf("amount %s (subscribed=%v): total %s != gross %s",
					a, subscribed, total.String(), gross.String())
			}
		}
	}
}

// TestCampaignEconomics - 1000 din me 10 impressions example
func TestCampaignEconomics(t *testing.T) {
	campaign := &AdCampaign{
		CampaignID:        "camp-1",
		TotalBudget:       decimal.NewFromInt(1000),
		DurationDays:      100,
		DailyImpressions:  10,
		CreatorSubscribed: true,
	}

	eco := CalculateCampaignEconomics(campaign)

	// 100 days × 10 = 1000 impressions
	if eco.TotalImpressions != 1000 {
		t.Errorf("expected 1000 impressions, got %d", eco.TotalImpressions)
	}

	// Per impression = 1000/1000 = ₹1
	if !eco.PerImpression.Equal(decimal.NewFromInt(1)) {
		t.Errorf("per impression should be 1, got %s", eco.PerImpression.String())
	}

	// Totals match the split
	if !eco.ViewerTotal.Equal(decimal.NewFromInt(600)) {
		t.Errorf("viewer total should be 600, got %s", eco.ViewerTotal.String())
	}
	if !eco.CreatorTotal.Equal(decimal.NewFromInt(200)) {
		t.Errorf("creator total should be 200, got %s", eco.CreatorTotal.String())
	}
	if !eco.PlatformTotal.Equal(decimal.NewFromInt(200)) {
		t.Errorf("platform total should be 200, got %s", eco.PlatformTotal.String())
	}
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

// TestPlanPricingIndia - India plans
func TestPlanPricingIndia(t *testing.T) {
	tests := []struct {
		tier      PlanTier
		price     string
		minBalan  string
	}{
		{TierQuarterly, "300", "1000"},
		{TierBiannual, "500", "1000"},
		{TierAnnual, "1000", "1000"},
	}

	for _, tc := range tests {
		plan, err := GetPlan(RegionIndia, tc.tier)
		if err != nil {
			t.Fatalf("GetPlan(India, %s) error: %v", tc.tier, err)
		}
		if !plan.Price.Equal(decimal.RequireFromString(tc.price)) {
			t.Errorf("India %s price: expected %s, got %s", tc.tier, tc.price, plan.Price.String())
		}
		if !plan.MinBalance.Equal(decimal.RequireFromString(tc.minBalan)) {
			t.Errorf("India %s min balance: expected %s, got %s",
				tc.tier, tc.minBalan, plan.MinBalance.String())
		}
	}
}

// TestPlanPricingHighCurrency - USD plans
func TestPlanPricingHighCurrency(t *testing.T) {
	tests := []struct {
		tier     PlanTier
		price    string
		minBalan string
	}{
		{TierQuarterly, "150", "1000"},
		{TierBiannual, "250", "1000"},
		{TierAnnual, "500", "1000"},
	}

	for _, tc := range tests {
		plan, err := GetPlan(RegionHigh, tc.tier)
		if err != nil {
			t.Fatalf("GetPlan(High, %s) error: %v", tc.tier, err)
		}
		if plan.Currency != "USD" {
			t.Errorf("High currency should be USD, got %s", plan.Currency)
		}
		if !plan.Price.Equal(decimal.RequireFromString(tc.price)) {
			t.Errorf("High %s price: expected %s, got %s", tc.tier, tc.price, plan.Price.String())
		}
		if !plan.MinBalance.Equal(decimal.RequireFromString(tc.minBalan)) {
			t.Errorf("High %s min balance: expected %s, got %s",
				tc.tier, tc.minBalan, plan.MinBalance.String())
		}
	}
}

// TestPlanPricingLowCurrency - low currency plans
func TestPlanPricingLowCurrency(t *testing.T) {
	tests := []struct {
		tier     PlanTier
		price    string
		minBalan string
	}{
		{TierQuarterly, "450", "3000"},
		{TierBiannual, "750", "3000"},
		{TierAnnual, "1500", "3000"},
	}

	for _, tc := range tests {
		plan, err := GetPlan(RegionLow, tc.tier)
		if err != nil {
			t.Fatalf("GetPlan(Low, %s) error: %v", tc.tier, err)
		}
		if !plan.Price.Equal(decimal.RequireFromString(tc.price)) {
			t.Errorf("Low %s price: expected %s, got %s", tc.tier, tc.price, plan.Price.String())
		}
		if !plan.MinBalance.Equal(decimal.RequireFromString(tc.minBalan)) {
			t.Errorf("Low %s min balance: expected %s, got %s",
				tc.tier, tc.minBalan, plan.MinBalance.String())
		}
	}
}

// TestCreatorPlansAreViewerPlans - creator plans = viewer plans
// EXACTLY (user directive: purani creator 50% law DELETED —
// creator ka old plan delete, storage free, creator ab viewer
// plan hi leta hai).
func TestCreatorPlansAreViewerPlans(t *testing.T) {
	// Creator ke liye koi alag discount matrix nahi — viewer
	// plan ka full price.
	plan, err := GetPlanForUser(RegionIndia, TierQuarterly, DiscountEligibility{}, DiscountNone)
	if err != nil {
		t.Fatalf("GetPlanForUser error: %v", err)
	}
	if plan.DiscountPercent != 0 {
		t.Errorf("creator (no matrix): expected 0%% discount, got %d%%", plan.DiscountPercent)
	}
	if !plan.Price.Equal(decimal.NewFromInt(300)) {
		t.Errorf("creator (no matrix): expected full ₹300, got %s", plan.Price.String())
	}
}

// TestStudentDiscountMatrix - AURA-verified student/tutor/
// tuition center ko 25%.
func TestStudentDiscountMatrix(t *testing.T) {
	plan, err := GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{IsVerifiedStudent: true}, DiscountStudent)
	if err != nil {
		t.Fatalf("GetPlanForUser error: %v", err)
	}
	if plan.DiscountPercent != DiscountPercent {
		t.Errorf("student matrix: expected %d%%, got %d%%", DiscountPercent, plan.DiscountPercent)
	}
	// 300 ka 25% discount = 225
	if !plan.Price.Equal(decimal.NewFromInt(225)) {
		t.Errorf("student matrix: expected ₹225, got %s", plan.Price.String())
	}
}

// TestTwelveMonthDiscountMatrix - 12-month commitment (monthly-
// billed) ko 25%.
func TestTwelveMonthDiscountMatrix(t *testing.T) {
	plan, err := GetPlanForUser(RegionIndia, TierAnnual,
		DiscountEligibility{IsTwelveMonthCommitment: true}, DiscountTwelveMonth)
	if err != nil {
		t.Fatalf("GetPlanForUser error: %v", err)
	}
	if plan.DiscountPercent != DiscountPercent {
		t.Errorf("twelve-month matrix: expected %d%%, got %d%%", DiscountPercent, plan.DiscountPercent)
	}
	// 1000 ka 25% discount = 750
	if !plan.Price.Equal(decimal.NewFromInt(750)) {
		t.Errorf("twelve-month matrix: expected ₹750, got %s", plan.Price.String())
	}
}

// TestDiscountNoStacking - student + 12-month dono eligible ho
// to bhi EXACTLY ONE matrix (25%), dual-compounding (50%) blocked.
func TestDiscountNoStacking(t *testing.T) {
	plan, err := GetPlanForUser(RegionIndia, TierAnnual,
		DiscountEligibility{IsVerifiedStudent: true, IsTwelveMonthCommitment: true},
		DiscountStudent) // user ne student matrix choose kiya
	if err != nil {
		t.Fatalf("GetPlanForUser error: %v", err)
	}
	if plan.DiscountPercent != DiscountPercent {
		t.Errorf("dual-eligible: expected exactly %d%% (one matrix), got %d%%",
			DiscountPercent, plan.DiscountPercent)
	}
	// 1000 ka 25% = 750 — 50% (₹500) NAHI
	if !plan.Price.Equal(decimal.NewFromInt(750)) {
		t.Errorf("dual-eligible: expected ₹750 (one 25%% matrix), got %s", plan.Price.String())
	}
}

// TestDiscountIneligibleChoiceRejected - ineligible matrix error.
func TestDiscountIneligibleChoiceRejected(t *testing.T) {
	// Student verify nahi hua — student matrix reject.
	if _, err := GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{}, DiscountStudent); err == nil {
		t.Error("unverified student matrix must be rejected")
	}
	// 12-month commitment nahi — twelve_month matrix reject.
	if _, err := GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{}, DiscountTwelveMonth); err == nil {
		t.Error("twelve-month matrix without commitment must be rejected")
	}
}

// TestUnknownDiscountMatrix - unknown matrix reject.
func TestUnknownDiscountMatrix(t *testing.T) {
	if _, err := GetPlanForUser(RegionIndia, TierQuarterly,
		DiscountEligibility{}, "bogus"); err == nil {
		t.Error("unknown matrix must be rejected")
	}
}

// TestUnknownRegionAndTier - invalid input handle
func TestUnknownRegionAndTier(t *testing.T) {
	if _, err := GetPlan("mars", TierAnnual); err == nil {
		t.Error("unknown region should return error")
	}
	if _, err := GetPlan(RegionIndia, "lifetime"); err == nil {
		t.Error("tier not in table should return error")
	}
}

// ---------------------------------------------------------------------------
// Minimum balance (Q1.1 - per user wallet)
// ---------------------------------------------------------------------------

// TestMinimumBalanceIsPerUserAndCheckable
func TestMinimumBalanceIsPerUserAndCheckable(t *testing.T) {
	plan, _ := GetPlan(RegionIndia, TierQuarterly)

	// Balance minimum se NEECHE
	meets, shortfall := CalculateMinBalanceCheck(decimal.NewFromInt(400), plan)
	if meets {
		t.Error("balance 400 should NOT meet minimum 1000")
	}
	if !shortfall.Equal(decimal.NewFromInt(600)) {
		t.Errorf("shortfall should be 600, got %s", shortfall.String())
	}

	// Balance minimum ke BARABAR
	meets, _ = CalculateMinBalanceCheck(decimal.NewFromInt(1000), plan)
	if !meets {
		t.Error("balance 1000 should meet minimum 1000")
	}

	// Balance minimum se UPAR -> withdrawal unrestricted
	meets, _ = CalculateMinBalanceCheck(decimal.NewFromInt(5000), plan)
	if !meets {
		t.Error("balance 5000 should meet minimum (withdrawal unrestricted)")
	}
}

// TestCampaignZeroImpressions - edge case
func TestCampaignZeroImpressions(t *testing.T) {
	campaign := &AdCampaign{
		TotalBudget:      decimal.NewFromInt(1000),
		DurationDays:     0,
		DailyImpressions: 0,
	}
	eco := CalculateCampaignEconomics(campaign)
	if eco.TotalImpressions != 0 {
		t.Errorf("zero impressions expected, got %d", eco.TotalImpressions)
	}
}

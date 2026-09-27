// Ad Revenue Guard - device-level monetization fraud control
//
// CONTEXT: Ye platform SELF-HOSTED hai - koi third-party ad network nahi.
// Users khud content upload karte hain, channels banate hain, aur plans ke
// mutabiq unko AD REVENUE milta hai.
//
// ISKA MATLAB: agar ek user 3 accounts bana le (1 device pe) aur teeno se
// ad impressions collect kare, to wo APNI HI earnings inflate kar raha hai.
// Ye "ad fraud against own platform" hai - aur industry me iske liye
// standard control DEVICE-LEVEL capping hai, account blocking nahi.
//
// KYON ACCOUNT BLOCK NAHI KIYA (user complaint se bachega):
// Industry practice (Google AdSense, IAB) ye hai:
//   - One person = ONE PAYOUT, but multiple ACCOUNTS are allowed
//   - Fraud rokta hai DEVICE + PAYOUT identity se, account se nahi
//   - Flag for manual REVIEW, auto-ban nahi (false positives se bachta hai)
//
// ISLIYE ye guard:
//   1. Device se linked accounts ke combined ad revenue track karta hai
//   2. Device pe ek MONTHLY CAP lagata hai (industry standard practice)
//   3. Cap cross hone par account ko "review" me daalta hai - block NAHI karta
//   4. Payout identity (UPI/bank) duplicate check alag layer hai
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"fmt"
	"time"

	"github.com/shopspring/decimal"

	"newproject/services/billing-service/src/model"
)

// DeviceAdRevenueGuard device-level ad revenue cap enforce karta hai
type DeviceAdRevenueGuard struct {
	repo model.DeviceAdRevenueRepository
}

// NewDeviceAdRevenueGuard naya guard banata hai
func NewDeviceAdRevenueGuard(repo model.DeviceAdRevenueRepository) *DeviceAdRevenueGuard {
	return &DeviceAdRevenueGuard{repo: repo}
}

// MultiAccountPolicy - industry standard constants
//
// NOTE: Ye values CONFIG se aani chahiye production me. Yahan defaults hain
// taaki SSOT principle maintain rahe (code me magic numbers nahi).
type MultiAccountPolicy struct {
	// MaxAccountsPerDevice: kitne accounts allow (SPEC: 3)
	MaxAccountsPerDevice int
	// MonthlyDeviceRevenueCapINR: ek device pe max ad revenue per month.
	// 2nd/3rd account se aane wala revenue yahan count hota hai.
	MonthlyDeviceRevenueCapINR decimal.Decimal
	// ReviewThresholdINR: isse zyada device revenue = manual review flag.
	// NOTE: ye cap se ALAG hai - review zyada jaldi trigger hota hai
	// taaki suspicious activity jaldi pakad me aaye.
	ReviewThresholdINR decimal.Decimal
	// VelocityWindow: kitne time me N registrations = flag (bonus farming)
	VelocityWindow time.Duration
	// VelocityMaxRegistrations: is window me max registrations per device
	VelocityMaxRegistrations int
}

// DefaultMultiAccountPolicy - safe industry-aligned defaults
//
// Hinglish: industry standard defaults - INP se zyada generous kyunki
// hum block nahi karte, sirf cap + review karte hain
func DefaultMultiAccountPolicy() MultiAccountPolicy {
	return MultiAccountPolicy{
		MaxAccountsPerDevice:        3,
		MonthlyDeviceRevenueCapINR:  decimal.NewFromInt(5000), // ₹5000/device/month
		ReviewThresholdINR:          decimal.NewFromInt(1500), // ₹1500 se review flag
		VelocityWindow:              24 * time.Hour,
		VelocityMaxRegistrations:     3,
	}
}

// RevenueCheckResult - ad revenue record karne ka outcome
type RevenueCheckResult struct {
	// Ye device pe is mahine ka total revenue
	DeviceMonthlyRevenue decimal.Decimal
	// Cap cross ho gaya?
	CapExceeded bool
	// Review zaroori hai?
	RequiresReview bool
	// User-facing reason (saaf message)
	Reason string
	// Is account ko revenue milega ya nahi
	RevenueAllowed bool
}

// RecordAdRevenue ad revenue ko device level par record karta hai aur
// cap/review check karta hai
//
// FLOW:
//   1. Device ka is mahine ka total nikalo (saare linked accounts ka combined)
//   2. Naya revenue add karo
//   3. Cap check karo
//   4. Review check karo
//
// Hinglish: device ka total revenue dekho, cap check karo, flag lagao
func (g *DeviceAdRevenueGuard) RecordAdRevenue(
	ctx context.Context,
	deviceFingerprint string,
	userID uint,
	amount decimal.Decimal,
	policy MultiAccountPolicy,
) (*RevenueCheckResult, error) {

	// Fingerprint nahi hai to track nahi kar sakte - but block bhi nahi karenge
	// (user ko unnecessarily punish nahi karenge)
	if deviceFingerprint == "" {
		return &RevenueCheckResult{
			RevenueAllowed: true,
			Reason:         "no device fingerprint - tracking skipped",
		}, nil
	}

	// ---- Is mahine ka record nikalo (ya banao) ----
	period := currentPeriod()

	record, err := g.repo.GetOrCreate(ctx, deviceFingerprint, period)
	if err != nil {
		return nil, err
	}

	// ---- Combined device revenue (pehle ka + naya) ----
	previousTotal := decimal.NewFromFloat(record.TotalRevenue)
	newTotal := previousTotal.Add(amount)

	// Record update karo
	record.TotalRevenue, _ = newTotal.Float64()
	record.AdImpressions += record.AdImpressions // (record me already set hai)
	record.UpdatedAt = time.Now()

	// ---- Cap check ----
	capExceeded := newTotal.GreaterThan(policy.MonthlyDeviceRevenueCapINR)

	// ---- Review check ----
	requiresReview := newTotal.GreaterThanOrEqual(policy.ReviewThresholdINR)

	// Decision:
	//   - Cap cross = revenue SUSPEND (record karte rahenge, payout nahi)
	//   - Review = flag (payout jaata hai, manual review ke liye mark)
	//   - Normal = full revenue
	revenueAllowed := !capExceeded

	reason := "within limits"
	switch {
	case capExceeded:
		reason = fmt.Sprintf(
			"device monthly cap reached (₹%s of ₹%s) - revenue held pending review",
			newTotal.String(), policy.MonthlyDeviceRevenueCapINR.String())
	case requiresReview:
		reason = fmt.Sprintf(
			"device flagged for manual review (₹%s from multiple linked accounts)",
			newTotal.String())
	}

	// Record persist karo
	record.RequiresReview = requiresReview
	record.CapExceeded = capExceeded
	record.RevenueHeld = capExceeded

	if err := g.repo.Save(ctx, record); err != nil {
		return nil, err
	}

	return &RevenueCheckResult{
		DeviceMonthlyRevenue: newTotal,
		CapExceeded:          capExceeded,
		RequiresReview:       requiresReview,
		Reason:               reason,
		RevenueAllowed:       revenueAllowed,
	}, nil
}

// GetDeviceStatus device ka current monetization status deta hai
// (dashboard / admin panel ke liye)
func (g *DeviceAdRevenueGuard) GetDeviceStatus(
	ctx context.Context, deviceFingerprint string, policy MultiAccountPolicy,
) (map[string]interface{}, error) {

	record, err := g.repo.Get(ctx, deviceFingerprint, currentPeriod())
	if err != nil {
		return nil, err
	}

	if record == nil {
		return map[string]interface{}{
			"has_revenue": false,
			"message":     "no ad revenue recorded this period",
		}, nil
	}

	utilisation := decimal.NewFromInt(0)
	if policy.MonthlyDeviceRevenueCapINR.GreaterThan(decimal.Zero) {
		utilisation = decimal.NewFromFloat(record.TotalRevenue).
			Div(policy.MonthlyDeviceRevenueCapINR).
			Mul(decimal.NewFromInt(100))
	}

	return map[string]interface{}{
		"has_revenue":           true,
		"device_revenue":        decimal.NewFromFloat(record.TotalRevenue).String(),
		"cap":                   policy.MonthlyDeviceRevenueCapINR.String(),
		"cap_utilisation_pct":   utilisation.String(),
		"ad_impressions":        record.AdImpressions,
		"linked_accounts":       record.LinkedAccounts,
		"requires_review":       record.RequiresReview,
		"cap_exceeded":          record.CapExceeded,
		"revenue_held":          record.RevenueHeld,
		"period":                record.Period,
	}, nil
}

// currentPeriod - "YYYY-MM" format me current month
func currentPeriod() string {
	return time.Now().UTC().Format("2006-01")
}

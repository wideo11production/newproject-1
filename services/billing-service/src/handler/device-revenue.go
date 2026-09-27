// Device ad revenue - superadmin ledger ke liye
//
// KYUN YE ALAG FILE HAI:
// `users` table AUTH database me hai, aur `device_ad_revenue` BILLING database me.
// Postgres me cross-database SQL JOIN possible NAHI hai. Isliye:
//   - auth-service   -> user identity + registration date deta hai
//   - billing-service (ye file) -> device earnings deta hai
//   - superadmin app  -> dono ko merge karke ek unified row banata hai
//
// AGAR YE GALAT APPROACH HOTA (sirf auth-service se join), to device revenue
// kabhi show nahi hota - kyunki wo table bilkul alag DB me hai.
//
// Hinglish: cross-DB join nahi hota isliye dono services alag data dete hain
package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/service"
)

// DeviceRevenueRow - ek device ka revenue summary
type DeviceRevenueRow struct {
	DeviceID      string  `json:"device_id"`
	Period        string  `json:"period"`
	TotalRevenue  float64 `json:"total_revenue"`
	AdImpressions int64   `json:"ad_impressions"`
	LinkedAccounts int64  `json:"linked_accounts"`
	// Revenue split (server-calculated - client kabhi calculate nahi karta)
	ViewerShare  float64 `json:"viewer_share"`
	PlatformShare float64 `json:"platform_share"`
	CreatorShare float64 `json:"creator_share"`
	RequiresReview bool  `json:"requires_review"`
	CapExceeded    bool  `json:"cap_exceeded"`
	RevenueHeld    bool  `json:"revenue_held"`
	FlaggedReason  string `json:"flagged_reason"`
	// AdSpendUsagePct: cap ka kitna use hua (0-100+)
	CapUsagePct float64 `json:"cap_usage_pct"`
}

// capPolicy mirrors the device cap policy (5000 INR / 1500 review).
//
// NOTE: ye SINGLE SOURCE OF TRUTH `service.DefaultMultiAccountPolicy()` hai -
// wahi values tests me lock hain. Yahan duplicate nahi kar rahe, reference
// kar rahe hain - warna policy aur UI drift kar jayenge.
var capPolicy = service.DefaultMultiAccountPolicy()

// GetDeviceRevenues - saare devices ka ad revenue return karta hai
// Superadmin Awareness grid ise use karke "Per-Device Ad Earnings" column
// populate karta hai.
func (h *PayoutHandler) GetDeviceRevenues(c *gin.Context) {
	// period optional filter (default: current month)
	period := c.Query("period")
	if period == "" {
		period = time.Now().UTC().Format("2006-01")
	}

	var records []model.DeviceAdRevenue
	if err := h.db.WithContext(c.Request.Context()).
		Where("period = ?", period).
		Order("total_revenue DESC").
		Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load device revenue"})
		return
	}

	rows := make([]DeviceRevenueRow, 0, len(records))
	for _, r := range records {
		total := float64(r.TotalRevenue)

		// ---- Revenue split (SERVER side - client se kabhi calculate nahi hota) ----
		// Product spec: Viewer 60% | Platform 20% | Creator 20% (subscribed)
		// Free creator case: Viewer 60% | Creator 10% | Platform 30%
		// Yahan baseline (subscribed) dikhate hain - actual split settlement
		// time pe ledger me hota hai.
		viewerShare := total * 0.60
		platformShare := total * 0.20
		creatorShare := total * 0.20

		// Cap usage percentage (5000 INR cap ke against)
		capUsage := 0.0
		if capPolicy.MonthlyDeviceRevenueCapINR.GreaterThan(decimal.Zero) {
			capUsage = float64(total) / capPolicy.MonthlyDeviceRevenueCapINR.InexactFloat64() * 100
		}

		rows = append(rows, DeviceRevenueRow{
			DeviceID:       r.DeviceID,
			Period:         r.Period,
			TotalRevenue:   total,
			AdImpressions:  r.AdImpressions,
			LinkedAccounts: int64(r.LinkedAccounts),
			ViewerShare:    viewerShare,
			PlatformShare:  platformShare,
			CreatorShare:   creatorShare,
			RequiresReview: r.RequiresReview,
			CapExceeded:    r.CapExceeded,
			RevenueHeld:    r.RevenueHeld,
			FlaggedReason:  r.FlaggedReason,
			CapUsagePct:    capUsage,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"period":       period,
		"count":        len(rows),
		"devices":      rows,
		"cap_inr":      capPolicy.MonthlyDeviceRevenueCapINR.String(),
		"review_at_inr": capPolicy.ReviewThresholdINR.String(),
	})
}

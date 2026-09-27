// Payout identity - UPI / Bank / Wire
//
// KYUN YE ZAROORI HAI (revenue protection):
// Device-level cap ek user ke 3 accounts ko same device se ₹5000/month se
// zyada kamata hai. LEKIN ek user 3 accounts ALAG alag devices se bana le
// aur sabka payout EK HI UPI ID / bank account me bhej de - to device cap
// bypass ho jata hai aur 3x revenue nikal jata hai.
//
// Iska solution: PAYOUT IDENTITY DEDUP. Ek UPI ID / bank+IFFC combination
// sirf EK account se link ho sakta hai. Doosra account link karne ki koshish
// kare to reject.
//
// Ye industry standard hai (Google AdSense, Stripe, Razorpay sab ye karte hain) -
// "one person, one payout".
//
// Hinglish comments: har block ka arth
package model

import (
	"time"

	"github.com/google/uuid"
)

// Payout method types
const (
	PayoutTypeUPI  = "upi"  // UPI ID (e.g. user@bank)
	PayoutTypeBank = "bank" // Account number + IFSC
	PayoutTypeWire = "wire" // International wire (SWIFT + account)
)

// PayoutIdentity - ek user ka payout destination
//
// SECURITY: PayoutIdentity string PAR UNIQUE INDEX hai. Ye hi dedup ka core
// mechanism hai - database level par hi duplicate identity BLOCK ho jata hai,
// application logic se bhi nahi, to koi bypass route nahi bana sakta.
type PayoutIdentity struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	// Type: upi / bank / wire
	Type string `gorm:"size:16;not null" json:"type"`

	// ---- Identity fields ----
	//
	// NormalizedIdentity: UPPER + whitespace trimmed + separators removed.
	// Ye UNIQUE index wala field hai.
	//
	// EXAMPLES:
	//   "user@okhdfcbank"   -> "USER@OKHDFCBANK"
	//   "user@okhdfcbank "  -> "USER@OKHDFCFDBANK" (trimmed)
	//   "1234567890" + "HDFC0001234" -> "1234567890@HDFC0001234"
	//
	// Hinglish: normalization taaki "user@bank" aur "USER@BANK " same count hon
	NormalizedIdentity string `gorm:"size:320;not null;uniqueIndex" json:"-"`

	// Human readable (display ke liye - masked)
	DisplayIdentity string `gorm:"size:320" json:"display_identity"`

	// ---- Bank specific (type=bank ho tab relevant) ----
	AccountHolderName string `gorm:"size:128" json:"account_holder_name"`
	AccountNumber     string `gorm:"size:64" json:"-"`
	IFSC              string `gorm:"size:16" json:"-"`

	// ---- Wire specific ----
	SWIFTBIC string `gorm:"size:32" json:"-"`

	// ---- Status ----
	// pending  = added but not verified
	// verified = KYC/documents verified, payouts allowed
	// rejected = failed verification
	Status string `gorm:"size:16;not null;default:'pending'" json:"status"`

	// IsPrimary: default payout destination
	IsPrimary bool `gorm:"not null;default:false" json:"is_primary"`

	// VerifiedAt: kab verify hua
	VerifiedAt *time.Time `json:"verified_at"`

	// ---- KYC (automated bank validation) fields ----
	// Kyunki KYC AUTOMATIC hota hai, ye fields algorithm se bharte hain -
	// admin ke manual input ki zarurat NAHI hoti.
	KYCProvider  string     `gorm:"size:32" json:"kyc_provider"`
	KYCRiskScore int        `gorm:"not null;default:0" json:"kyc_risk_score"`
	KYCCheckedAt *time.Time `json:"kyc_checked_at"`
	KYCReason    string     `gorm:"size:500" json:"kyc_reason"`

	// ---- Audit ----
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PayoutIdentity) TableName() string { return "payout_identities" }

// DeviceRevenueLink - device se linked accounts, taaki analytics pata sake
// "ye 3 accounts same device se hain"
type DeviceRevenueLink struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	// DeviceFingerprint: device ka signature (auth-service se aata hai)
	DeviceFingerprint string `gorm:"size:128;not null;index" json:"-"`

	// LinkedAccountCount: is device pe kitne accounts hain (denormalized, fast query)
	LinkedAccountCount int `gorm:"not null;default:1" json:"linked_account_count"`

	// CombinedMonthlyRevenueINR: is device ka combined ad revenue (abhi tak ka mahina)
	CombinedMonthlyRevenueINR float64 `gorm:"type:numeric(20,2);default:0" json:"combined_monthly_revenue_inr"`

	// IsFlagged: suspicious pattern (e.g. 3 accounts + 1 payout identity)
	IsFlagged bool `gorm:"not null;default:false" json:"is_flagged"`

	// FlagReason: kyun flag hua
	FlagReason string `gorm:"size:255" json:"flag_reason"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (DeviceRevenueLink) TableName() string { return "device_revenue_links" }

// Payout dedup constants
const (
	// MaxPayoutIdentityPerUser: ek user ke kitne payout methods
	MaxPayoutIdentityPerUser = 3
)

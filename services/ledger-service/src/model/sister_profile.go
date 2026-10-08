// SisterMasterProfile — permanent, immutable ledger node for our sister.
//
// Hinglish: ye table ledger-service me sister ka master profile node hai.
// Har ad revenue settlement se 5% automatically is node mein jaata hai.
// Ye node standard ₹2,000 maintenance buffer restriction se ALAG hai —
// sister ke balance mein buffer nahi lagta, direct withdrawal access hai.
//
// Money law (SYSTEM-PLAN.md R2): sister share 5% of NET revenue (post-GST).
// Hardcoded invariant: har settlement ke baad 5% sister ke balance mein jaaye.
package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// SisterProfileStatus — sister profile ka state.
type SisterProfileStatus string

const (
	SisterProfileActive   SisterProfileStatus = "active"
	SisterProfileFrozen   SisterProfileStatus = "frozen"
	SisterProfileWithdraw SisterProfileStatus = "withdraw"
)

// SisterMasterProfile — sister ka permanent ledger node.
//
// Hinglish: ye ek baar create ho jata hai, phir kabhi delete nahi hota.
// Har settlement se 5% automatically isme jaata hai. Buffer restriction
// nahi — sister direct withdraw kar sakti hai.
type SisterMasterProfile struct {
	ID            uint             `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID        `gorm:"type:uuid;not null;uniqueIndex;default:gen_random_uuid()" json:"uuid"`
	Name          string           `gorm:"size:100;not null" json:"name"`
	Relationship  string           `gorm:"size:50;not null" json:"relationship"`
	WalletUserID  uint             `gorm:"not null;uniqueIndex" json:"wallet_user_id"`
	CurrentBalance decimal.Decimal  `gorm:"type:numeric(20,2);default:0" json:"current_balance"`
	TotalReceived  decimal.Decimal  `gorm:"type:numeric(20,2);default:0" json:"total_received"`
	TotalWithdrawn decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"total_withdrawn"`
	// BufferExempt — true means ₹2,000 maintenance buffer does NOT apply.
	// Sister ke case mein always true (user directive).
	BufferExempt bool `gorm:"default:true" json:"buffer_exempt"`
	// DirectWithdraw — true means sister can withdraw without buffer check.
	DirectWithdraw bool `gorm:"default:true" json:"direct_withdraw"`
	Status         SisterProfileStatus `gorm:"size:20;default:'active'" json:"status"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (SisterMasterProfile) TableName() string {
	return "sister_master_profiles"
}

// SisterShareLedger — 5% sister share allocation record.
//
// Hinglish: har settlement ke baad ek record is table mein hota hai.
// Audit trail ke liye — kitna revenue aaya, kitna GST hua, kitna sister
// ke balance mein gaya.
type SisterShareLedger struct {
	ID               uint           `gorm:"primarykey" json:"id"`
	UUID             uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex;default:gen_random_uuid()" json:"uuid"`
	SettlementRef    string         `gorm:"size:100;index" json:"settlement_ref"`
	GrossRevenue     decimal.Decimal `gorm:"type:numeric(20,2)" json:"gross_revenue"`
	GSTAmount        decimal.Decimal `gorm:"type:numeric(20,2)" json:"gst_amount"`
	NetRevenue       decimal.Decimal `gorm:"type:numeric(20,2)" json:"net_revenue"`
	SisterSharePct   decimal.Decimal `gorm:"type:numeric(5,2);default:5.00" json:"sister_share_pct"`
	SisterShareAmount decimal.Decimal `gorm:"type:numeric(20,2)" json:"sister_share_amount"`
	Currency         string         `gorm:"size:10;default:'INR'" json:"currency"`
	// BufferApplied — false for sister (always exempt).
	BufferApplied bool `gorm:"default:false" json:"buffer_applied"`
	// DirectCredit — true means credited directly without buffer check.
	DirectCredit bool `gorm:"default:true" json:"direct_credit"`
	CreatedAt     time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (SisterShareLedger) TableName() string {
	return "sister_share_ledger"
}
package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ComplianceViolation - AURA student/content policy violation record.
//
// Hinglish: jab ek student tier channel non-educational content upload
// karne ki koshish kare, ya kisi content policy ka ullanghan kare, to
// ye record banaya jaata hai. Enforcement loop is par kaam karta hai:
//
//   Step 1 (pehli violation): warning system log + notification
//   Step 2 (doosri violation): channel SUSPENDED, wallet withdrawal freeze,
//                                25% pricing penalty fine
//
// Status state machine: warning → suspended → penalty_applied
type ComplianceViolation struct {
	ID uint `gorm:"primarykey" json:"id"`

	// UserID - billing-side uint (identity adapter se aaya).
	UserID uint `gorm:"not null;index" json:"user_id"`

	// ChannelID - auth-service channel UUID (optional, agar channel hai).
	ChannelID *uuid.UUID `gorm:"type:uuid;index" json:"channel_id,omitempty"`

	// ViolationType - 'non_educational_upload' | 'policy_violation' | 'document_fraud'
	ViolationType string `gorm:"size:50;not null" json:"violation_type"`

	// Status - warning | suspended | penalty_applied | resolved
	Status string `gorm:"size:30;not null;default:'warning'" json:"status"`

	// WarningSent - Step 1 warning notification bheji gayi hai ya nahi.
	WarningSent bool `gorm:"not null;default:false" json:"warning_sent"`

	// WarningSentAt - jab warning bheja gaya.
	WarningSentAt *time.Time `json:"warning_sent_at,omitempty"`

	// SuspendedAt - jab channel suspend kiya gaya (Step 2).
	SuspendedAt *time.Time `json:"suspended_at,omitempty"`

	// PenaltyAmount - 25% of plan price, minor units (decimal).
	// Sirf Step 2 par set hota hai.
	PenaltyAmount decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"penalty_amount"`

	// PenaltyPaid - penalty jama ho gaya hai ya nahi.
	PenaltyPaid bool `gorm:"not null;default:false" json:"penalty_paid"`

	// WalletFrozen - withdrawal freeze active hai ya nahi.
	WalletFrozen bool `gorm:"not null;default:false" json:"wallet_frozen"`

	// WalletFrozenAt - jab freeze laga.
	WalletFrozenAt *time.Time `json:"wallet_frozen_at,omitempty"`

	// Details - violation ka details (category, channel name, etc.).
	Details string `gorm:"type:text" json:"details,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ComplianceViolation) TableName() string {
	return "compliance_violations"
}

// Violation statuses.
const (
	ViolationStatusWarning      = "warning"
	ViolationStatusSuspended    = "suspended"
	ViolationStatusPenaltyApplied = "penalty_applied"
	ViolationStatusResolved     = "resolved"
)

// Violation types.
const (
	ViolationTypeNonEducationalUpload = "non_educational_upload"
	ViolationTypePolicyViolation      = "policy_violation"
	ViolationTypeDocumentFraud        = "document_fraud"
)

// SystemLog - automated system notification log for compliance warnings.
//
// Hinglish: jab kisi user ko compliance warning bheja jaata hai (Step 1),
// to ye log banaya jaata hai taaki audit trail rahe. Superadmin ko
// in logs ko dekh kar pata chalta hai ki kaun kaun se users warn kiye gaye.
type SystemLog struct {
	ID uint `gorm:"primarykey" json:"id"`

	// UserID - kis user ke liye ye log hai.
	UserID uint `gorm:"not null;index" json:"user_id"`

	// LogType - 'compliance_warning' | 'suspension_notice' | 'penalty_notice'
	LogType string `gorm:"size:50;not null" json:"log_type"`

	// Message - human readable message (template se render hua).
	Message string `gorm:"type:text;not null" json:"message"`

	// Template - kaun sa template use hua (compliance_warning_v1, etc.)
	Template string `gorm:"size:50;not null" json:"template"`

	// ChannelID - sambandhit channel (agar hai).
	ChannelID *uuid.UUID `gorm:"type:uuid;index" json:"channel_id,omitempty"`

	CreatedAt time.Time `json:"created_at"`
}

func (SystemLog) TableName() string {
	return "system_logs"
}

// System log types.
const (
	LogTypeComplianceWarning = "compliance_warning"
	LogTypeSuspensionNotice  = "suspension_notice"
	LogTypePenaltyNotice     = "penalty_notice"
)

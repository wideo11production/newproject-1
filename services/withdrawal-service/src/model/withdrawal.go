package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type KYCStatus string

const (
	KYCStatusNotSubmitted  KYCStatus = "not_submitted"
	KYCStatusPending       KYCStatus = "pending"
	KYCStatusVerified      KYCStatus = "verified"
	KYCStatusRejected      KYCStatus = "rejected"
)

type KYCDocumentType string

const (
	KYCDocAadhaar KYCStatus = "aadhaar"
	KYCDocPAN     KYCStatus = "pan"
	KYCDocPassport KYCStatus = "passport"
	KYCDocDrivingLicense KYCStatus = "driving_license"
)

type KYC struct {
	ID              uint             `gorm:"primarykey" json:"id"`
	UUID            uuid.UUID        `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID          uint             `gorm:"uniqueIndex;not null" json:"user_id"`
	DocumentType    KYCDocumentType  `gorm:"size:30;not null" json:"document_type"`
	DocumentNumber  string           `gorm:"size:100" json:"document_number"`
	DocumentImage   string           `gorm:"type:text" json:"document_image"`
	Status          KYCStatus        `gorm:"size:20;default:'not_submitted'" json:"status"`
	VerifiedBy      *uint            `json:"verified_by,omitempty"`
	VerifiedAt      *time.Time       `json:"verified_at,omitempty"`
	RejectionReason string          `gorm:"type:text" json:"rejection_reason"`
	CreatedAt       time.Time        `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time        `gorm:"autoUpdateTime" json:"updated_at"`
}

func (KYC) TableName() string {
	return "kyc_records"
}

type WithdrawalStatus string

const (
	WStatusPendingReview  WithdrawalStatus = "pending_review"
	WStatusApproved       WithdrawalStatus = "approved"
	WStatusRejected       WithdrawalStatus = "rejected"
	WStatusProcessing     WithdrawalStatus = "processing"
	WStatusCompleted      WithdrawalStatus = "completed"
	WStatusFailed         WithdrawalStatus = "failed"
	WStatusCancelled      WithdrawalStatus = "cancelled"
)

type BankProvider string

const (
	BankProviderManual   BankProvider = "manual"
	BankProviderRazorpay BankProvider = "razorpay"
	BankProviderStripe   BankProvider = "stripe"
	BankProviderPaypal   BankProvider = "paypal"
)

type WithdrawalRequest struct {
	ID              uint           `gorm:"primarykey" json:"id"`
	UUID            uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID          uint           `gorm:"not null;index" json:"user_id"`
	WalletID        uint           `gorm:"not null" json:"wallet_id"`
	Amount          decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Fee             decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"fee"`
	NetAmount       decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"net_amount"`
	Currency        string          `gorm:"size:3;default:'INR'" json:"currency"`
	Status          WithdrawalStatus `gorm:"size:20;default:'pending_review'" json:"status"`
	PaymentMethod   string          `gorm:"size:50;not null" json:"payment_method"`
	BankAccountID   *uint           `json:"bank_account_id,omitempty"`
	UpiID           string          `gorm:"size:100" json:"upi_id"`
	Provider        BankProvider    `gorm:"size:30;default:'manual'" json:"provider"`
	ProviderRef     string          `gorm:"size:100" json:"provider_ref"`
	ProviderFee     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"provider_fee"`
	KYCRequired     bool            `gorm:"default:false" json:"kyc_required"`
	ApprovalLevel   int             `gorm:"default:0" json:"approval_level"`
	ApprovedBy      *uint           `json:"approved_by,omitempty"`
	ApprovedAt      *time.Time      `json:"approved_at,omitempty"`
	ProcessedBy     *uint           `json:"processed_by,omitempty"`
	ProcessedAt     *time.Time      `json:"processed_at,omitempty"`
	CompletedAt     *time.Time      `json:"completed_at,omitempty"`
	RejectionReason string          `gorm:"type:text" json:"rejection_reason"`
	Notes           string          `gorm:"type:text" json:"notes"`
	CreatedAt       time.Time        `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time        `gorm:"autoUpdateTime" json:"updated_at"`
}

func (WithdrawalRequest) TableName() string {
	return "withdrawal_requests"
}

type WithdrawalConfig struct {
	ID              uint            `gorm:"primarykey" json:"id"`
	UUID            uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	MinAmount       decimal.Decimal `gorm:"type:numeric(20,2);default:10" json:"min_amount"`
	MaxAmount       decimal.Decimal `gorm:"type:numeric(20,2);default:100000" json:"max_amount"`
	FeeRate         decimal.Decimal `gorm:"type:numeric(20,2);default:0.02" json:"fee_rate"`
	MinFee          decimal.Decimal `gorm:"type:numeric(20,2);default:1" json:"min_fee"`
	MaxFee          decimal.Decimal `gorm:"type:numeric(20,2);default:100" json:"max_fee"`
	ProcessingTime  string          `gorm:"size:50;default:'2-3 business days'" json:"processing_time"`
	KYCThreshold    decimal.Decimal `gorm:"type:numeric(20,2);default:1000" json:"kyc_threshold"`
	DailyLimit      decimal.Decimal `gorm:"type:numeric(20,2);default:50000" json:"daily_limit"`
	WeeklyLimit     decimal.Decimal `gorm:"type:numeric(20,2);default:200000" json:"weekly_limit"`
	IsKYCRequired   bool            `gorm:"default:true" json:"is_kyc_required"`
	CreatedAt       time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (WithdrawalConfig) TableName() string {
	return "withdrawal_configs"
}

type WithdrawalLimit struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UserID        uint            `gorm:"not null;index" json:"user_id"`
	Type          string          `gorm:"size:20;not null" json:"type"` // daily, weekly, monthly
	Limit         decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"limit"`
	Used          decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"used"`
	PeriodStart   time.Time       `json:"period_start"`
	PeriodEnd     time.Time       `json:"period_end"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (WithdrawalLimit) TableName() string {
	return "withdrawal_limits"
}

type BankAccount struct {
	ID            uint      `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID        uint      `gorm:"not null;index" json:"user_id"`
	AccountHolder string    `gorm:"size:255;not null" json:"account_holder"`
	AccountNumber string    `gorm:"size:50;not null" json:"account_number"`
	IFSC          string    `gorm:"size:11;not null" json:"ifsc"`
	BankName      string    `gorm:"size:100" json:"bank_name"`
	Branch        string    `gorm:"size:100" json:"branch"`
	AccountType   string    `gorm:"size:20" json:"account_type"`
	IsDefault     bool      `gorm:"default:false" json:"is_default"`
	Verified      bool      `gorm:"default:false" json:"verified"`
	CreatedAt     time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (BankAccount) TableName() string {
	return "bank_accounts"
}

type ApprovalRule struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Level     int            `gorm:"not null" json:"level"`
	MinAmount decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"min_amount"`
	MaxAmount decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"max_amount"`
	Role      string         `gorm:"size:50;not null" json:"role"`
	IsAuto    bool           `gorm:"default:false" json:"is_auto"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
}

func (ApprovalRule) TableName() string {
	return "approval_rules"
}

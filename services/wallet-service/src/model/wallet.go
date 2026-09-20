package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type BalanceType string

const (
	BalanceTypeAvailable   BalanceType = "available"
	BalanceTypePending     BalanceType = "pending"
	BalanceTypeHeld        BalanceType = "held"
	BalanceTypeWithdrawable BalanceType = "withdrawable"
)

type Wallet struct {
	ID        uint            `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	UserID    uint            `gorm:"uniqueIndex;not null" json:"user_id"`
	Currency  string          `gorm:"size:3;default:'INR'" json:"currency"`
	Available decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"available"`
	Pending   decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"pending"`
	Held      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"held"`
	Withdrawable decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"withdrawable"`
	CreatedAt time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Wallet) TableName() string {
	return "wallets"
}

type TransactionType string

const (
	TxnTypeCredit  TransactionType = "credit"
	TxnTypeDebit   TransactionType = "debit"
	TxnTypeHold    TransactionType = "hold"
	TxnTypeRelease TransactionType = "release"
	TxnTypeRefund  TransactionType = "refund"
)

type TransactionStatus string

const (
	TxnStatusPending   TransactionStatus = "pending"
	TxnStatusCompleted TransactionStatus = "completed"
	TxnStatusFailed    TransactionStatus = "failed"
	TxnStatusCancelled TransactionStatus = "cancelled"
)

type Transaction struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	WalletID      uint            `gorm:"not null;index" json:"wallet_id"`
	UserID        uint            `gorm:"not null;index" json:"user_id"`
	Type          TransactionType `gorm:"size:20;not null" json:"type"`
	Status        TransactionStatus `gorm:"size:20;default:'pending'" json:"status"`
	Amount        decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	BalanceBefore decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"balance_before"`
	BalanceAfter  decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"balance_after"`
	ReferenceType string          `gorm:"size:50" json:"reference_type"`
	ReferenceID   string          `gorm:"size:100" json:"reference_id"`
	Description   string          `gorm:"type:text" json:"description"`
	Metadata      string          `gorm:"type:text" json:"metadata"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
	CompletedAt   *time.Time      `json:"completed_at,omitempty"`
}

func (Transaction) TableName() string {
	return "transactions"
}

type WithdrawalStatus string

const (
	WithdrawalStatusPending  WithdrawalStatus = "pending"
	WithdrawalStatusApproved WithdrawalStatus = "approved"
	WithdrawalStatusRejected WithdrawalStatus = "rejected"
	WithdrawalStatusProcessing WithdrawalStatus = "processing"
	WithdrawalStatusCompleted WithdrawalStatus = "completed"
	WithdrawalStatusFailed   WithdrawalStatus = "failed"
)

type Withdrawal struct {
	ID              uint            `gorm:"primarykey" json:"id"`
	UUID            uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	WalletID        uint            `gorm:"not null;index" json:"wallet_id"`
	UserID          uint            `gorm:"not null;index" json:"user_id"`
	Amount          decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Fee             decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"fee"`
	NetAmount       decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"net_amount"`
	Status          WithdrawalStatus `gorm:"size:20;default:'pending'" json:"status"`
	BankAccountID   *uint           `gorm:"index" json:"bank_account_id"`
	UpiID           string          `gorm:"size:100" json:"upi_id"`
	ProcessedBy     *uint           `json:"processed_by,omitempty"`
	RejectionReason string          `gorm:"type:text" json:"rejection_reason"`
	CreatedAt       time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
	CompletedAt     *time.Time      `json:"completed_at,omitempty"`
}

func (Withdrawal) TableName() string {
	return "withdrawals"
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
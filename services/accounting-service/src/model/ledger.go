package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type AccountType string

const (
	AccountTypeAsset     AccountType = "asset"
	AccountTypeLiability AccountType = "liability"
	AccountTypeEquity    AccountType = "equity"
	AccountTypeRevenue   AccountType = "revenue"
	AccountTypeExpense   AccountType = "expense"
)

type Account struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Code        string          `gorm:"size:20;uniqueIndex;not null" json:"code"`
	Name        string          `gorm:"size:255;not null" json:"name"`
	Type        AccountType     `gorm:"size:20;not null" json:"type"`
	Description string          `gorm:"type:text" json:"description"`
	IsActive    bool            `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Account) TableName() string {
	return "accounts"
}

type JournalStatus string

const (
	JournalStatusDraft   JournalStatus = "draft"
	JournalStatusPosted  JournalStatus = "posted"
	JournalStatusVoided  JournalStatus = "voided"
)

type Journal struct {
	ID          uint          `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID     `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Reference   string        `gorm:"size:100" json:"reference"`
	Description string        `gorm:"type:text" json:"description"`
	Status      JournalStatus `gorm:"size:20;default:'draft'" json:"status"`
	PostedAt    *time.Time    `json:"posted_at,omitempty"`
	CreatedAt   time.Time     `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time     `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Journal) TableName() string {
	return "journals"
}

type EntrySide string

const (
	EntrySideDebit  EntrySide = "debit"
	EntrySideCredit EntrySide = "credit"
)

type Entry struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	JournalID   uint            `gorm:"not null;index" json:"journal_id"`
	AccountID   uint            `gorm:"not null;index" json:"account_id"`
	AccountName string          `gorm:"size:255" json:"account_name"`
	Side        EntrySide       `gorm:"size:10;not null" json:"side"`
	Amount      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Description string          `gorm:"type:text" json:"description"`
	Reference   string          `gorm:"size:100" json:"reference"`
	Metadata    string          `gorm:"type:text" json:"metadata"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (Entry) TableName() string {
	return "entries"
}

type TransactionStatus string

const (
	TxnStatusPending   TransactionStatus = "pending"
	TxnStatusCompleted TransactionStatus = "completed"
	TxnStatusFailed    TransactionStatus = "failed"
)

type Transaction struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	JournalID     uint            `gorm:"not null;index" json:"journal_id"`
	Status        TransactionStatus `gorm:"size:20;default:'pending'" json:"status"`
	TotalDebit    decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"total_debit"`
	TotalCredit   decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"total_credit"`
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

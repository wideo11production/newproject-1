package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type AuditEventType string

const (
	AuditEventTransactionCreate AuditEventType = "transaction.create"
	AuditEventTransactionUpdate AuditEventType = "transaction.update"
	AuditEventJournalPost       AuditEventType = "journal.post"
	AuditEventJournalVoid       AuditEventType = "journal.void"
	AuditEventAccountCreate     AuditEventType = "account.create"
	AuditEventWalletCredit      AuditEventType = "wallet.credit"
	AuditEventWalletDebit       AuditEventType = "wallet.debit"
	AuditEventWithdrawalCreate  AuditEventType = "withdrawal.create"
	AuditEventWithdrawalApprove AuditEventType = "withdrawal.approve"
	AuditEventWithdrawalReject  AuditEventType = "withdrawal.reject"
)

type AuditEvent struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UUID      uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	EventType AuditEventType `gorm:"size:50;not null;index" json:"event_type"`
	Source    string         `gorm:"size:100;not null" json:"source"`
	ActorID   *uint          `json:"actor_id,omitempty"`
	ActorType string         `gorm:"size:50" json:"actor_type,omitempty"`
	ResourceID string        `gorm:"size:100;index" json:"resource_id"`
	Resource   string        `gorm:"size:100" json:"resource"`
	Data       string        `gorm:"type:text" json:"data"`
	Hash       string        `gorm:"size:64" json:"hash"`
	PrevHash   string        `gorm:"size:64" json:"prev_hash"`
	Timestamp  time.Time     `gorm:"index" json:"timestamp"`
}

func (AuditEvent) TableName() string {
	return "audit_events"
}

type ReconciliationStatus string

const (
	ReconStatusPending    ReconciliationStatus = "pending"
	ReconStatusMatched    ReconciliationStatus = "matched"
	ReconStatusMismatched ReconciliationStatus = "mismatched"
	ReconStatusResolved   ReconciliationStatus = "resolved"
)

type Reconciliation struct {
	ID          uint                   `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID              `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Source      string                 `gorm:"size:100;not null" json:"source"`
	Target      string                 `gorm:"size:100;not null" json:"target"`
	Reference   string                 `gorm:"size:100" json:"reference"`
	Status      ReconciliationStatus   `gorm:"size:20;default:'pending'" json:"status"`
	StartTime   time.Time              `json:"start_time"`
	EndTime     time.Time              `json:"end_time"`
	SourceTotal decimal.Decimal        `gorm:"type:numeric(20,2)" json:"source_total"`
	TargetTotal decimal.Decimal        `gorm:"type:numeric(20,2)" json:"target_total"`
	Variance    decimal.Decimal        `gorm:"type:numeric(20,2);default:0" json:"variance"`
	MismatchCount int                    `json:"mismatch_count"`
	ResolvedBy  *uint                  `json:"resolved_by,omitempty"`
	ResolvedAt  *time.Time             `json:"resolved_at,omitempty"`
	Notes       string                 `gorm:"type:text" json:"notes"`
	CreatedAt   time.Time              `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time              `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Reconciliation) TableName() string {
	return "reconciliations"
}

type ReconciliationItem struct {
	ID               uint                   `gorm:"primarykey" json:"id"`
	ReconciliationID uint                   `gorm:"not null;index" json:"reconciliation_id"`
	SourceID         string                 `gorm:"size:100" json:"source_id"`
	SourceAmount     decimal.Decimal        `gorm:"type:numeric(20,2)" json:"source_amount"`
	TargetID         string                 `gorm:"size:100" json:"target_id"`
	TargetAmount     decimal.Decimal        `gorm:"type:numeric(20,2)" json:"target_amount"`
	Status           ReconciliationStatus   `gorm:"size:20;default:'pending'" json:"status"`
	Variance         decimal.Decimal        `gorm:"type:numeric(20,2);default:0" json:"variance"`
	Notes            string                 `gorm:"type:text" json:"notes"`
}

func (ReconciliationItem) TableName() string {
	return "reconciliation_items"
}

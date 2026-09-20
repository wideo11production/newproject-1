package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/ledger-service/src/model"
	"newproject/services/ledger-service/src/repository"
)

type LedgerService struct {
	auditRepo        repository.AuditEventRepository
	reconRepo        repository.ReconciliationRepository
	reconItemRepo    repository.ReconciliationItemRepository
}

func NewLedgerService(
	auditRepo repository.AuditEventRepository,
	reconRepo repository.ReconciliationRepository,
	reconItemRepo repository.ReconciliationItemRepository,
) *LedgerService {
	return &LedgerService{
		auditRepo:     auditRepo,
		reconRepo:     reconRepo,
		reconItemRepo: reconItemRepo,
	}
}

func (s *LedgerService) RecordEvent(ctx context.Context, eventType model.AuditEventType, source string, actorID *uint, actorType string, resourceID, resource, data string) (*model.AuditEvent, error) {
	latest, _ := s.auditRepo.GetLatest(ctx)
	prevHash := ""
	if latest != nil {
		prevHash = latest.Hash
	}

	event := &model.AuditEvent{
		UUID:      uuid.New(),
		EventType: eventType,
		Source:    source,
		ActorID:   actorID,
		ActorType: actorType,
		ResourceID: resourceID,
		Resource:  resource,
		Data:      data,
		PrevHash:  prevHash,
		Timestamp: time.Now().UTC(),
	}

	event.Hash = computeEventHash(event, prevHash)

	if err := s.auditRepo.Create(ctx, event); err != nil {
		return nil, err
	}

	return event, nil
}

func computeEventHash(event *model.AuditEvent, prevHash string) string {
	data := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s",
		event.UUID.String(),
		event.EventType,
		event.Source,
		event.ResourceID,
		event.Resource,
		event.Data,
		prevHash,
		event.Timestamp.Format(time.RFC3339Nano),
	)
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

func (s *LedgerService) GetEvent(ctx context.Context, id uint) (*model.AuditEvent, error) {
	return s.auditRepo.GetByID(ctx, id)
}

func (s *LedgerService) GetEventByUUID(ctx context.Context, uuid string) (*model.AuditEvent, error) {
	return s.auditRepo.GetByUUID(ctx, uuid)
}

func (s *LedgerService) ListEventsByType(ctx context.Context, eventType model.AuditEventType, limit, offset int) ([]*model.AuditEvent, error) {
	return s.auditRepo.GetByEventType(ctx, eventType, limit, offset)
}

func (s *LedgerService) ListEventsBySource(ctx context.Context, source string, limit, offset int) ([]*model.AuditEvent, error) {
	return s.auditRepo.GetBySource(ctx, source, limit, offset)
}

func (s *LedgerService) ListEventsByTimeRange(ctx context.Context, start, end string, limit, offset int) ([]*model.AuditEvent, error) {
	return s.auditRepo.GetByTimeRange(ctx, start, end, limit, offset)
}

func (s *LedgerService) VerifyChain(ctx context.Context) (bool, error) {
	latest, err := s.auditRepo.GetLatest(ctx)
	if err != nil {
		return false, err
	}
	if latest == nil {
		return true, nil
	}

	event := latest
	for i := 0; i < 1000; i++ {
		expectedHash := computeEventHash(event, event.PrevHash)
		if expectedHash != event.Hash {
			return false, fmt.Errorf("hash mismatch at event %d", event.ID)
		}

		prev, err := s.auditRepo.GetByID(ctx, event.ID-1)
		if err != nil {
			break
		}
		event = prev
	}

	return true, nil
}

func (s *LedgerService) StartReconciliation(ctx context.Context, source, target, reference string, startTime, endTime time.Time) (*model.Reconciliation, error) {
	recon := &model.Reconciliation{
		UUID:        uuid.New(),
		Source:      source,
		Target:      target,
		Reference:   reference,
		Status:      model.ReconStatusPending,
		StartTime:   startTime,
		EndTime:     endTime,
		SourceTotal: decimal.Zero,
		TargetTotal: decimal.Zero,
		Variance:    decimal.Zero,
	}

	if err := s.reconRepo.Create(ctx, recon); err != nil {
		return nil, err
	}

	return recon, nil
}

func (s *LedgerService) AddReconciliationItem(ctx context.Context, reconID uint, sourceID, sourceAmount, targetID, targetAmount string) error {
	sourceAmt, err := decimal.NewFromString(sourceAmount)
	if err != nil {
		return errors.New("invalid source amount")
	}
	targetAmt, err := decimal.NewFromString(targetAmount)
	if err != nil {
		return errors.New("invalid target amount")
	}

	status := model.ReconStatusMatched
	variance := sourceAmt.Sub(targetAmt)
	if !variance.IsZero() {
		status = model.ReconStatusMismatched
	}

	item := &model.ReconciliationItem{
		ReconciliationID: reconID,
		SourceID:         sourceID,
		SourceAmount:     sourceAmt,
		TargetID:         targetID,
		TargetAmount:     targetAmt,
		Status:           status,
		Variance:         variance,
	}

	return s.reconItemRepo.Create(ctx, item)
}

func (s *LedgerService) CompleteReconciliation(ctx context.Context, reconID uint) (*model.Reconciliation, error) {
	recon, err := s.reconRepo.GetByID(ctx, reconID)
	if err != nil {
		return nil, err
	}

	items, err := s.reconItemRepo.GetByReconciliationID(ctx, reconID)
	if err != nil {
		return nil, err
	}

	var sourceTotal, targetTotal, variance decimal.Decimal
	mismatchCount := 0

	for _, item := range items {
		sourceTotal = sourceTotal.Add(item.SourceAmount)
		targetTotal = targetTotal.Add(item.TargetAmount)
		if item.Status != model.ReconStatusMatched {
			mismatchCount++
			variance = variance.Add(item.Variance)
		}
	}

	recon.SourceTotal = sourceTotal
	recon.TargetTotal = targetTotal
	recon.Variance = variance
	recon.MismatchCount = mismatchCount

	if variance.IsZero() {
		recon.Status = model.ReconStatusMatched
	} else {
		recon.Status = model.ReconStatusMismatched
	}

	if err := s.reconRepo.Update(ctx, recon); err != nil {
		return nil, err
	}

	return recon, nil
}

func (s *LedgerService) ResolveReconciliation(ctx context.Context, reconID uint, resolvedBy uint, notes string) (*model.Reconciliation, error) {
	recon, err := s.reconRepo.GetByID(ctx, reconID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	recon.Status = model.ReconStatusResolved
	recon.ResolvedBy = &resolvedBy
	recon.ResolvedAt = &now
	recon.Notes = notes

	if err := s.reconRepo.Update(ctx, recon); err != nil {
		return nil, err
	}

	return recon, nil
}

func (s *LedgerService) GetReconciliation(ctx context.Context, id uint) (*model.Reconciliation, error) {
	return s.reconRepo.GetByID(ctx, id)
}

func (s *LedgerService) GetReconciliationByUUID(ctx context.Context, uuid string) (*model.Reconciliation, error) {
	return s.reconRepo.GetByUUID(ctx, uuid)
}

func (s *LedgerService) ListReconciliations(ctx context.Context, source string, limit, offset int) ([]*model.Reconciliation, error) {
	if source != "" {
		return s.reconRepo.GetBySource(ctx, source, limit, offset)
	}
	return s.reconRepo.GetPending(ctx, limit)
}

func (s *LedgerService) GetReconciliationItems(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error) {
	return s.reconItemRepo.GetByReconciliationID(ctx, reconID)
}

func (s *LedgerService) GetMismatchedItems(ctx context.Context, reconID uint) ([]*model.ReconciliationItem, error) {
	return s.reconItemRepo.GetMismatches(ctx, reconID)
}

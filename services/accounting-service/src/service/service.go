package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/accounting-service/src/model"
	"newproject/services/accounting-service/src/repository"
)

type AccountingService struct {
	accountRepo repository.AccountRepository
	journalRepo repository.JournalRepository
	entryRepo   repository.EntryRepository
	txnRepo     repository.TransactionRepository
}

func NewAccountingService(
	accountRepo repository.AccountRepository,
	journalRepo repository.JournalRepository,
	entryRepo repository.EntryRepository,
	txnRepo repository.TransactionRepository,
) *AccountingService {
	return &AccountingService{
		accountRepo: accountRepo,
		journalRepo: journalRepo,
		entryRepo:   entryRepo,
		txnRepo:     txnRepo,
	}
}

type JournalEntryRequest struct {
	AccountID   uint            `json:"account_id" binding:"required"`
	Side        model.EntrySide `json:"side" binding:"required"`
	Amount      decimal.Decimal `json:"amount" binding:"required"`
	Description string          `json:"description"`
	Reference   string          `json:"reference"`
}

type CreateJournalRequest struct {
	Reference   string              `json:"reference"`
	Description string              `json:"description"`
	Entries     []JournalEntryRequest `json:"entries" binding:"required,min=2"`
	RefType     string              `json:"reference_type"`
	RefID       string              `json:"reference_id"`
}

func (s *AccountingService) CreateAccount(ctx context.Context, code, name string, accountType model.AccountType, description string) (*model.Account, error) {
	_, err := s.accountRepo.GetByCode(ctx, code)
	if err == nil {
		return nil, fmt.Errorf("account with code %s already exists", code)
	}
	if err != repository.ErrAccountNotFound {
		return nil, err
	}

	account := &model.Account{
		UUID:        uuid.New(),
		Code:        code,
		Name:        name,
		Type:        accountType,
		Description: description,
		IsActive:    true,
	}
	if err := s.accountRepo.Create(ctx, account); err != nil {
		return nil, err
	}
	return account, nil
}

func (s *AccountingService) GetAccount(ctx context.Context, id uint) (*model.Account, error) {
	return s.accountRepo.GetByID(ctx, id)
}

func (s *AccountingService) GetAccountByCode(ctx context.Context, code string) (*model.Account, error) {
	return s.accountRepo.GetByCode(ctx, code)
}

func (s *AccountingService) ListAccounts(ctx context.Context, limit, offset int) ([]*model.Account, error) {
	return s.accountRepo.List(ctx, limit, offset)
}

func (s *AccountingService) ListAccountsByType(ctx context.Context, accountType model.AccountType, limit, offset int) ([]*model.Account, error) {
	return s.accountRepo.ListByType(ctx, accountType, limit, offset)
}

func (s *AccountingService) UpdateAccount(ctx context.Context, account *model.Account) error {
	return s.accountRepo.Update(ctx, account)
}

func (s *AccountingService) GetJournal(ctx context.Context, id uint) (*model.Journal, error) {
	return s.journalRepo.GetByID(ctx, id)
}

func (s *AccountingService) GetJournalByUUID(ctx context.Context, uuid string) (*model.Journal, error) {
	return s.journalRepo.GetByUUID(ctx, uuid)
}

func (s *AccountingService) PostJournal(ctx context.Context, journalID uint) error {
	journal, err := s.journalRepo.GetByID(ctx, journalID)
	if err != nil {
		return err
	}
	if journal.Status != model.JournalStatusDraft {
		return errors.New("journal is not in draft status")
	}

	entries, err := s.entryRepo.GetByJournalID(ctx, journalID)
	if err != nil {
		return err
	}

	var totalDebit, totalCredit decimal.Decimal
	for _, entry := range entries {
		if entry.Side == model.EntrySideDebit {
			totalDebit = totalDebit.Add(entry.Amount)
		} else {
			totalCredit = totalCredit.Add(entry.Amount)
		}
	}

	if !totalDebit.Equal(totalCredit) {
		return repository.ErrUnbalancedJournal
	}

	now := time.Now()
	journal.Status = model.JournalStatusPosted
	journal.PostedAt = &now
	return s.journalRepo.Update(ctx, journal)
}

func (s *AccountingService) VoidJournal(ctx context.Context, journalID uint) error {
	journal, err := s.journalRepo.GetByID(ctx, journalID)
	if err != nil {
		return err
	}
	if journal.Status == model.JournalStatusVoided {
		return errors.New("journal already voided")
	}

	journal.Status = model.JournalStatusVoided
	return s.journalRepo.Update(ctx, journal)
}

func (s *AccountingService) CreateTransaction(ctx context.Context, req CreateJournalRequest) (*model.Transaction, error) {
	if len(req.Entries) < 2 {
		return nil, errors.New("journal must have at least 2 entries")
	}

	var totalDebit, totalCredit decimal.Decimal
	for _, entry := range req.Entries {
		if entry.Side == model.EntrySideDebit {
			totalDebit = totalDebit.Add(entry.Amount)
		} else {
			totalCredit = totalCredit.Add(entry.Amount)
		}
	}

	if !totalDebit.Equal(totalCredit) {
		return nil, repository.ErrUnbalancedJournal
	}

	journal := &model.Journal{
		UUID:        uuid.New(),
		Reference:   req.Reference,
		Description: req.Description,
		Status:      model.JournalStatusDraft,
	}
	if err := s.journalRepo.Create(ctx, journal); err != nil {
		return nil, err
	}

	var entries []*model.Entry
	for _, e := range req.Entries {
		account, err := s.accountRepo.GetByID(ctx, e.AccountID)
		if err != nil {
			return nil, err
		}
		entry := &model.Entry{
			UUID:        uuid.New(),
			JournalID:   journal.ID,
			AccountID:   e.AccountID,
			AccountName: account.Name,
			Side:        e.Side,
			Amount:      e.Amount,
			Description: e.Description,
			Reference:   e.Reference,
		}
		entries = append(entries, entry)
	}

	if err := s.entryRepo.CreateBatch(ctx, entries); err != nil {
		return nil, err
	}

	txn := &model.Transaction{
		UUID:          uuid.New(),
		JournalID:     journal.ID,
		Status:        model.TxnStatusPending,
		TotalDebit:    totalDebit,
		TotalCredit:   totalCredit,
		ReferenceType: req.RefType,
		ReferenceID:   req.RefID,
		Description:   req.Description,
	}
	if err := s.txnRepo.Create(ctx, txn); err != nil {
		return nil, err
	}

	return s.PostTransaction(ctx, txn.ID)
}

func (s *AccountingService) PostTransaction(ctx context.Context, txnID uint) (*model.Transaction, error) {
	txn, err := s.txnRepo.GetByID(ctx, txnID)
	if err != nil {
		return nil, err
	}
	if txn.Status != model.TxnStatusPending {
		return nil, errors.New("transaction is not in pending status")
	}

	if err := s.PostJournal(ctx, txn.JournalID); err != nil {
		return nil, err
	}

	now := time.Now()
	txn.Status = model.TxnStatusCompleted
	txn.CompletedAt = &now
	if err := s.txnRepo.Update(ctx, txn); err != nil {
		return nil, err
	}

	return txn, nil
}

func (s *AccountingService) GetTransaction(ctx context.Context, id uint) (*model.Transaction, error) {
	return s.txnRepo.GetByID(ctx, id)
}

func (s *AccountingService) GetTransactionByUUID(ctx context.Context, uuid string) (*model.Transaction, error) {
	return s.txnRepo.GetByUUID(ctx, uuid)
}

func (s *AccountingService) GetTransactionByReference(ctx context.Context, refType, refID string) (*model.Transaction, error) {
	return s.txnRepo.GetByReference(ctx, refType, refID)
}

func (s *AccountingService) GetTransactionEntries(ctx context.Context, txnID uint) ([]*model.Entry, error) {
	txn, err := s.txnRepo.GetByID(ctx, txnID)
	if err != nil {
		return nil, err
	}
	return s.entryRepo.GetByJournalID(ctx, txn.JournalID)
}

func (s *AccountingService) GetAccountBalance(ctx context.Context, accountID uint) (decimal.Decimal, error) {
	account, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil {
		return decimal.Zero, err
	}

	entries, err := s.entryRepo.GetByAccountID(ctx, accountID)
	if err != nil {
		return decimal.Zero, err
	}

	var balance decimal.Decimal
	for _, entry := range entries {
		if entry.AccountID != accountID {
			continue
		}
		if entry.Side == model.EntrySideDebit {
			switch account.Type {
			case model.AccountTypeAsset, model.AccountTypeExpense:
				balance = balance.Add(entry.Amount)
			default:
				balance = balance.Sub(entry.Amount)
			}
		} else {
			switch account.Type {
			case model.AccountTypeLiability, model.AccountTypeEquity, model.AccountTypeRevenue:
				balance = balance.Add(entry.Amount)
			default:
				balance = balance.Sub(entry.Amount)
			}
		}
	}

	return balance, nil
}

func (s *AccountingService) GetTrialBalance(ctx context.Context, limit, offset int) (map[uint]decimal.Decimal, error) {
	accounts, err := s.accountRepo.List(ctx, limit, offset)
	if err != nil {
		return nil, err
	}

	balances := make(map[uint]decimal.Decimal)
	for _, account := range accounts {
		balance, err := s.GetAccountBalance(ctx, account.ID)
		if err != nil {
			return nil, err
		}
		balances[account.ID] = balance
	}
	return balances, nil
}

func (s *AccountingService) GetJournalEntries(ctx context.Context, journalID uint) ([]*model.Entry, error) {
	return s.entryRepo.GetByJournalID(ctx, journalID)
}

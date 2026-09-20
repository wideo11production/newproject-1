package repository

import (
	"context"
	"errors"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/accounting-service/src/model"
)

var (
	ErrAccountNotFound      = errors.New("account not found")
	ErrJournalNotFound      = errors.New("journal not found")
	ErrTransactionNotFound  = errors.New("transaction not found")
	ErrEntryNotFound        = errors.New("entry not found")
	ErrUnbalancedJournal    = errors.New("journal is not balanced: debits must equal credits")
)

type AccountRepository interface {
	Create(ctx context.Context, account *model.Account) error
	GetByID(ctx context.Context, id uint) (*model.Account, error)
	GetByCode(ctx context.Context, code string) (*model.Account, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Account, error)
	List(ctx context.Context, limit, offset int) ([]*model.Account, error)
	ListByType(ctx context.Context, accountType model.AccountType, limit, offset int) ([]*model.Account, error)
	Update(ctx context.Context, account *model.Account) error
}

type JournalRepository interface {
	Create(ctx context.Context, journal *model.Journal) error
	GetByID(ctx context.Context, id uint) (*model.Journal, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Journal, error)
	Update(ctx context.Context, journal *model.Journal) error
}

type EntryRepository interface {
	Create(ctx context.Context, entry *model.Entry) error
	CreateBatch(ctx context.Context, entries []*model.Entry) error
	GetByID(ctx context.Context, id uint) (*model.Entry, error)
	GetByJournalID(ctx context.Context, journalID uint) ([]*model.Entry, error)
	GetByAccountID(ctx context.Context, accountID uint) ([]*model.Entry, error)
}

type TransactionRepository interface {
	Create(ctx context.Context, txn *model.Transaction) error
	GetByID(ctx context.Context, id uint) (*model.Transaction, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Transaction, error)
	GetByReference(ctx context.Context, refType, refID string) (*model.Transaction, error)
	Update(ctx context.Context, txn *model.Transaction) error
	ListPending(ctx context.Context, limit int) ([]*model.Transaction, error)
}

type accountRepository struct {
	db *gorm.DB
}

func NewAccountRepository(db *gorm.DB) AccountRepository {
	return &accountRepository{db: db}
}

func (r *accountRepository) Create(ctx context.Context, account *model.Account) error {
	return r.db.WithContext(ctx).Create(account).Error
}

func (r *accountRepository) GetByID(ctx context.Context, id uint) (*model.Account, error) {
	var account model.Account
	err := r.db.WithContext(ctx).First(&account, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	return &account, nil
}

func (r *accountRepository) GetByCode(ctx context.Context, code string) (*model.Account, error) {
	var account model.Account
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	return &account, nil
}

func (r *accountRepository) GetByUUID(ctx context.Context, uuid string) (*model.Account, error) {
	var account model.Account
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&account).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	return &account, nil
}

func (r *accountRepository) List(ctx context.Context, limit, offset int) ([]*model.Account, error) {
	var accounts []*model.Account
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Limit(limit).Offset(offset).Find(&accounts).Error
	return accounts, err
}

func (r *accountRepository) ListByType(ctx context.Context, accountType model.AccountType, limit, offset int) ([]*model.Account, error) {
	var accounts []*model.Account
	err := r.db.WithContext(ctx).Where("type = ? AND is_active = ?", accountType, true).Limit(limit).Offset(offset).Find(&accounts).Error
	return accounts, err
}

func (r *accountRepository) Update(ctx context.Context, account *model.Account) error {
	return r.db.WithContext(ctx).Save(account).Error
}

type journalRepository struct {
	db *gorm.DB
}

func NewJournalRepository(db *gorm.DB) JournalRepository {
	return &journalRepository{db: db}
}

func (r *journalRepository) Create(ctx context.Context, journal *model.Journal) error {
	return r.db.WithContext(ctx).Create(journal).Error
}

func (r *journalRepository) GetByID(ctx context.Context, id uint) (*model.Journal, error) {
	var journal model.Journal
	err := r.db.WithContext(ctx).First(&journal, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJournalNotFound
		}
		return nil, err
	}
	return &journal, nil
}

func (r *journalRepository) GetByUUID(ctx context.Context, uuid string) (*model.Journal, error) {
	var journal model.Journal
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&journal).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJournalNotFound
		}
		return nil, err
	}
	return &journal, nil
}

func (r *journalRepository) Update(ctx context.Context, journal *model.Journal) error {
	return r.db.WithContext(ctx).Save(journal).Error
}

type entryRepository struct {
	db *gorm.DB
}

func NewEntryRepository(db *gorm.DB) EntryRepository {
	return &entryRepository{db: db}
}

func (r *entryRepository) Create(ctx context.Context, entry *model.Entry) error {
	return r.db.WithContext(ctx).Create(entry).Error
}

func (r *entryRepository) CreateBatch(ctx context.Context, entries []*model.Entry) error {
	return r.db.WithContext(ctx).Create(&entries).Error
}

func (r *entryRepository) GetByID(ctx context.Context, id uint) (*model.Entry, error) {
	var entry model.Entry
	err := r.db.WithContext(ctx).First(&entry, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEntryNotFound
		}
		return nil, err
	}
	return &entry, nil
}

func (r *entryRepository) GetByJournalID(ctx context.Context, journalID uint) ([]*model.Entry, error) {
	var entries []*model.Entry
	err := r.db.WithContext(ctx).Where("journal_id = ?", journalID).Order("created_at asc").Find(&entries).Error
	return entries, err
}

func (r *entryRepository) GetByAccountID(ctx context.Context, accountID uint) ([]*model.Entry, error) {
	var entries []*model.Entry
	err := r.db.WithContext(ctx).Where("account_id = ?", accountID).Order("created_at asc").Find(&entries).Error
	return entries, err
}

type transactionRepository struct {
	db *gorm.DB
}

func NewTransactionRepository(db *gorm.DB) TransactionRepository {
	return &transactionRepository{db: db}
}

func (r *transactionRepository) Create(ctx context.Context, txn *model.Transaction) error {
	return r.db.WithContext(ctx).Create(txn).Error
}

func (r *transactionRepository) GetByID(ctx context.Context, id uint) (*model.Transaction, error) {
	var txn model.Transaction
	err := r.db.WithContext(ctx).First(&txn, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTransactionNotFound
		}
		return nil, err
	}
	return &txn, nil
}

func (r *transactionRepository) GetByUUID(ctx context.Context, uuid string) (*model.Transaction, error) {
	var txn model.Transaction
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&txn).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTransactionNotFound
		}
		return nil, err
	}
	return &txn, nil
}

func (r *transactionRepository) GetByReference(ctx context.Context, refType, refID string) (*model.Transaction, error) {
	var txn model.Transaction
	err := r.db.WithContext(ctx).Where("reference_type = ? AND reference_id = ?", refType, refID).First(&txn).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTransactionNotFound
		}
		return nil, err
	}
	return &txn, nil
}

func (r *transactionRepository) Update(ctx context.Context, txn *model.Transaction) error {
	return r.db.WithContext(ctx).Save(txn).Error
}

func (r *transactionRepository) ListPending(ctx context.Context, limit int) ([]*model.Transaction, error) {
	var txns []*model.Transaction
	err := r.db.WithContext(ctx).Where("status = ?", model.TxnStatusPending).Order("created_at asc").Limit(limit).Find(&txns).Error
	return txns, err
}

type AccountBalanceView struct {
	AccountID uint            `json:"account_id"`
	AccountName string        `json:"account_name"`
	Side      string          `json:"side"`
	Amount    decimal.Decimal `json:"amount"`
}

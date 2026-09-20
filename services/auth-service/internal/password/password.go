package password

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidHash = errors.New("invalid hash")
	ErrMismatch    = errors.New("password mismatch")
)

const (
	DefaultCost = 12
	MinCost     = 10
	MaxCost     = 14
)

type PasswordService struct {
	cost int
}

func NewPasswordService(cost int) *PasswordService {
	if cost < MinCost {
		cost = MinCost
	}
	if cost > MaxCost {
		cost = MaxCost
	}
	return &PasswordService{cost: cost}
}

func DefaultPasswordService() *PasswordService {
	return NewPasswordService(DefaultCost)
}

func (s *PasswordService) Hash(password string) (string, error) {
	if len(password) == 0 {
		return "", errors.New("password cannot be empty")
	}
	if len(password) > 72 {
		return "", errors.New("password too long (max 72 characters)")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), s.cost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func (s *PasswordService) Verify(password, hash string) error {
	if len(password) == 0 {
		return ErrMismatch
	}
	if len(hash) == 0 {
		return ErrInvalidHash
	}

	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return ErrMismatch
		}
		return ErrInvalidHash
	}
	return nil
}

func (s *PasswordService) NeedsRehash(hash string) (bool, error) {
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		return false, ErrInvalidHash
	}
	return cost < s.cost, nil
}

func (s *PasswordService) RehashIfNeeded(password, hash string) (string, error) {
	needsRehash, err := s.NeedsRehash(hash)
	if err != nil {
		return "", err
	}

	if needsRehash {
		return s.Hash(password)
	}
	return hash, nil
}
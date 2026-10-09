package password

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
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

	// ---- CORRUPTED HASH GUARD ----
	//
	// A bcrypt hash is exactly 60 bytes and starts with `$2a$`, `$2b$`, or
	// `$2y$`. Anything else is not a bcrypt hash - it is a database corruption,
	// a column truncation, or a row that was never hashed at all.
	//
	// WHY THIS RETURNS ErrMismatch AND NOT ErrInvalidHash: the caller
	// (`service.Login`) maps ErrMismatch -> 401 "invalid credentials" and
	// ErrInvalidHash -> 500 "login failed". A 500 on a credential check is the
	// wrong shape: it tells the client "our server is broken" rather than "those
	// credentials do not match", and every 500 burns a rate-limit slot on a
	// request that was never an attack. The user with a corrupted hash row is
	// locked out either way; the difference is whether the lockout looks like
	// a credential failure (correct, retryable, rate-limited as normal) or a
	// server outage (wrong, triggers support tickets, and the rate limiter
	// cannot tell the difference).
	//
	// The hash is still logged at WARN so the corruption is visible in ops
	// without being exposed to the client.
	if len(hash) != 60 || (hash[:4] != "$2a$" && hash[:4] != "$2b$" && hash[:4] != "$2y$") {
		log.Warn().Str("hash_prefix", safeHashPrefix(hash)).Int("hash_len", len(hash)).
			Msg("password hash is not a valid bcrypt format; treating as credential mismatch")
		return ErrMismatch
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

// HashToken hashes a bearer token (JWT) using SHA-256.
//
// KYUN bcrypt nahi: bcrypt ka input limit 72 bytes hai aur uske liye design hi
// slow-by-intent hai. Ek JWT refresh token 400+ characters ka hota hai, isliye
// bcrypt use karne par "password too long" error aa jata tha aur registration
// 500 ke saath fail ho jati thi. Tokens high-entropy hote hain (user ke paas
// password nahi), isliye unke liye SHA-256 fast aur sahi choice hai.
// Tokens verify karne ke liye bhi wahi hash use hota hai.
//
// Hinglish: password ke liye bcrypt, token ke liye SHA-256 - dono ka alag purpose hai
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// safeHashPrefix returns a non-secret, log-safe representation of a hash.
//
// It deliberately never returns the full hash: a bcrypt hash is not secret
// (it is offline-crackable given the repo), but logging it raw invites the
// next person to paste it into a test fixture or a support ticket. The first
// four characters (the `$2a$/` prefix) ARE useful — they prove which variant
// was used — so they are kept; the rest is replaced by its length.
func safeHashPrefix(hash string) string {
	if len(hash) == 0 {
		return "<empty>"
	}
	prefix := hash
	if len(prefix) > 4 {
		prefix = prefix[:4]
	}
	return fmt.Sprintf("%s:<%d chars>", prefix, len(hash))
}

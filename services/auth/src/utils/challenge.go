package utils

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"

	"github.com/duo-labs/webauthn/webauthn"
)

// ChallengeStore handles generation and storage of challenges and session data
type ChallengeStore struct {
	sessions map[string]*webauthn.SessionData
	mu       sync.RWMutex
	ttl      time.Duration
}

// NewChallengeStore creates a new challenge store
func NewChallengeStore(ttl time.Duration) *ChallengeStore {
	return &ChallengeStore{
		sessions: make(map[string]*webauthn.SessionData),
		ttl:      ttl,
	}
}

// GenerateChallenge creates a cryptographically random challenge
func (c *ChallengeStore) GenerateChallenge() []byte {
	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		// In practice, this should never happen, but handle just in case
		panic("failed to generate random challenge: " + err.Error())
	}
	return challenge
}

// StoreSessionData stores session data associated with a user ID
func (c *ChallengeStore) StoreSessionData(userID string, sessionData *webauthn.SessionData) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.sessions[userID] = sessionData
	// Start a goroutine to delete after TTL
	go func() {
		time.Sleep(c.ttl)
		c.mu.Lock()
		delete(c.sessions, userID)
		c.mu.Unlock()
	}()
	return nil
}

// GetSessionData retrieves and deletes session data for a user ID
func (c *ChallengeStore) GetSessionData(userID string) (*webauthn.SessionData, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	sessionData, exists := c.sessions[userID]
	if !exists {
		return nil, errors.New("session data not found or expired")
	}
	// Delete after retrieval (one-time use)
	delete(c.sessions, userID)
	return sessionData, nil
}

// errors package import
import "errors"

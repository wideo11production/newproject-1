package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type MFAChallenge struct {
	ChallengeID string    `json:"challenge_id"`
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type MFAChallengeStore struct {
	client *redis.Client
	ttl    time.Duration
}

func NewMFAChallengeStore(client *redis.Client, ttl time.Duration) *MFAChallengeStore {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &MFAChallengeStore{client: client, ttl: ttl}
}

func (s *MFAChallengeStore) Create(ctx context.Context, userID uuid.UUID, email string) (*MFAChallenge, error) {
	ch := &MFAChallenge{
		ChallengeID: uuid.New().String(),
		UserID:      userID,
		Email:       email,
		ExpiresAt:   time.Now().Add(s.ttl),
		CreatedAt:   time.Now(),
	}
	key := fmt.Sprintf("mfa:challenge:%s", ch.ChallengeID)
	b, err := json.Marshal(ch)
	if err != nil {
		return nil, err
	}
	if err := s.client.Set(ctx, key, b, s.ttl).Err(); err != nil {
		return nil, err
	}
	return ch, nil
}

func (s *MFAChallengeStore) Get(ctx context.Context, challengeID string) (*MFAChallenge, error) {
	key := fmt.Sprintf("mfa:challenge:%s", challengeID)
	b, err := s.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("challenge not found or expired")
	}
	if err != nil {
		return nil, err
	}
	var ch MFAChallenge
	if err := json.Unmarshal(b, &ch); err != nil {
		return nil, err
	}
	if time.Now().After(ch.ExpiresAt) {
		_ = s.client.Del(ctx, key).Err()
		return nil, fmt.Errorf("challenge expired")
	}
	return &ch, nil
}

func (s *MFAChallengeStore) Delete(ctx context.Context, challengeID string) error {
	key := fmt.Sprintf("mfa:challenge:%s", challengeID)
	return s.client.Del(ctx, key).Err()
}

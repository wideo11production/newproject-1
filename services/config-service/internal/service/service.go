package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"services/config-service/internal/model"
	"services/config-service/internal/repository"
)

type ConfigService struct {
	repo    *repository.ConfigRepository
	redis   *redis.Client
	nats    *nats.Conn
	cacheTTL time.Duration
}

func NewConfigService(repo *repository.ConfigRepository, redis *redis.Client, nats *nats.Conn) *ConfigService {
	return &ConfigService{
		repo:     repo,
		redis:    redis,
		nats:     nats,
		cacheTTL: 5 * time.Minute,
	}
}

func (s *ConfigService) Create(ctx context.Context, config *model.Config, userID string) error {
	// Validate
	if config.Key == "" || config.Value == "" || config.Type == "" {
		return ErrInvalidConfig
	}

	// Set defaults
	if config.Version == 0 {
		config.Version = 1
	}
	if config.Environment == "" {
		config.Environment = "all"
	}

	// Create in database
	if err := s.repo.Create(ctx, config); err != nil {
		return err
	}

	// Save history
	history := &model.ConfigHistory{
		ConfigID:  config.ID,
		Key:       config.Key,
		Value:     config.Value,
		Action:    "create",
		ChangedBy: userID,
	}
	if err := s.repo.SaveHistory(ctx, history); err != nil {
		log.Error().Err(err).Msg("Failed to save config history")
	}

	// Invalidate cache
	s.repo.InvalidateCache(ctx, config.Key)

	// Publish event
	s.publishConfigEvent(ctx, config.Key, "created", config)

	return nil
}

func (s *ConfigService) Get(ctx context.Context, key, environment string) (*model.Config, error) {
	// Try cache first
	if cached, err := s.repo.GetCached(ctx, key); err == nil {
		return cached, nil
	}

	// Fetch from database
	config, err := s.repo.GetByKey(ctx, key, environment)
	if err != nil {
		return nil, err
	}

	// Cache result
	s.repo.SetCache(ctx, config, s.cacheTTL)

	return config, nil
}

func (s *ConfigService) GetByID(ctx context.Context, id uuid.UUID) (*model.Config, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *ConfigService) List(ctx context.Context, environment string, limit, offset int) ([]*model.Config, int, error) {
	return s.repo.List(ctx, environment, limit, offset)
}

func (s *ConfigService) Update(ctx context.Context, id uuid.UUID, updates map[string]interface{}, userID string) (*model.Config, error) {
	// Get existing config
	config, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	// Save history with old value
	history := &model.ConfigHistory{
		ConfigID:  config.ID,
		Key:       config.Key,
		Value:     config.Value,
		Action:    "update",
		ChangedBy: userID,
	}
	if err := s.repo.SaveHistory(ctx, history); err != nil {
		log.Error().Err(err).Msg("Failed to save config history")
	}

	// Apply updates
	if value, ok := updates["value"].(string); ok {
		config.Value = value
	}
	if value, ok := updates["type"].(string); ok {
		config.Type = value
	}
	if value, ok := updates["description"].(string); ok {
		config.Description = value
	}
	if value, ok := updates["is_secret"].(bool); ok {
		config.IsSecret = value
	}
	if value, ok := updates["environment"].(string); ok {
		config.Environment = value
	}

	// Update in database
	if err := s.repo.Update(ctx, config); err != nil {
		return nil, err
	}

	// Invalidate cache
	s.repo.InvalidateCache(ctx, config.Key)

	// Publish event
	s.publishConfigEvent(ctx, config.Key, "updated", config)

	return config, nil
}

func (s *ConfigService) Delete(ctx context.Context, id uuid.UUID, userID string) error {
	config, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	// Save history
	history := &model.ConfigHistory{
		ConfigID:  config.ID,
		Key:       config.Key,
		Value:     config.Value,
		Action:    "delete",
		ChangedBy: userID,
	}
	if err := s.repo.SaveHistory(ctx, history); err != nil {
		log.Error().Err(err).Msg("Failed to save config history")
	}

	// Delete from database
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}

	// Invalidate cache
	s.repo.InvalidateCache(ctx, config.Key)

	// Publish event
	s.publishConfigEvent(ctx, config.Key, "deleted", config)

	return nil
}

func (s *ConfigService) History(ctx context.Context, configID uuid.UUID, limit, offset int) ([]*model.ConfigHistory, error) {
	return s.repo.History(ctx, configID, limit, offset)
}

func (s *ConfigService) Watch(ctx context.Context, keys []string) (<-chan *model.Config, error) {
	// Subscribe to NATS subject for config changes
	subject := "config.changes.>"
	msgCh := make(chan *nats.Msg, 100)
	sub, err := s.nats.ChanSubscribe(subject, msgCh)
	if err != nil {
		return nil, err
	}

	ch := make(chan *model.Config, 100)
	go func() {
		defer close(ch)
		defer sub.Unsubscribe()
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-msgCh:
				var event ConfigChangeEvent
				if err := json.Unmarshal(msg.Data, &event); err != nil {
					log.Error().Err(err).Msg("Failed to unmarshal config event")
					continue
				}
				// Filter by requested keys
				for _, key := range keys {
					if event.Key == key || key == "*" {
						config := &model.Config{
							Key:   event.Key,
							Value: event.Value,
							Type:  event.Type,
						}
						select {
						case ch <- config:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()

	return ch, nil
}

type ConfigChangeEvent struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Type     string `json:"type"`
	Action   string `json:"action"`
	Timestamp int64 `json:"timestamp"`
}

func (s *ConfigService) publishConfigEvent(ctx context.Context, key, action string, config *model.Config) {
	event := ConfigChangeEvent{
		Key:       key,
		Value:     config.Value,
		Type:      config.Type,
		Action:    action,
		Timestamp: time.Now().Unix(),
	}
	data, _ := json.Marshal(event)
	subject := "config.changes." + key
	if err := s.nats.Publish(subject, data); err != nil {
		log.Error().Err(err).Str("subject", subject).Msg("Failed to publish config event")
	}
}

// Errors
var (
	ErrInvalidConfig = &ServiceError{Code: "INVALID_CONFIG", Message: "Invalid configuration data"}
	ErrNotFound      = &ServiceError{Code: "NOT_FOUND", Message: "Configuration not found"}
)

type ServiceError struct {
	Code    string
	Message string
}

func (e *ServiceError) Error() string {
	return e.Message
}
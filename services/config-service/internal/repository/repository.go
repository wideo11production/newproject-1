package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	redislib "github.com/redis/go-redis/v9"

	"services/config-service/internal/model"
)

type ConfigRepository struct {
	db    *pgxpool.Pool
	redis *redislib.Client
}

func NewConfigRepository(db *pgxpool.Pool) *ConfigRepository {
	return &ConfigRepository{db: db}
}

func (r *ConfigRepository) SetRedis(redis *redislib.Client) {
	r.redis = redis
}

func (r *ConfigRepository) Create(ctx context.Context, config *model.Config) error {
	query := `
		INSERT INTO configs (key, value, type, description, is_secret, environment, version)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`
	return r.db.QueryRow(ctx, query,
		config.Key, config.Value, config.Type, config.Description,
		config.IsSecret, config.Environment, config.Version,
	).Scan(&config.ID, &config.CreatedAt, &config.UpdatedAt)
}

func (r *ConfigRepository) GetByKey(ctx context.Context, key, environment string) (*model.Config, error) {
	query := `
		SELECT id, key, value, type, description, is_secret, environment, version, created_at, updated_at
		FROM configs
		WHERE key = $1 AND (environment = $2 OR environment = 'all') AND deleted_at IS NULL
		ORDER BY CASE WHEN environment = 'all' THEN 1 ELSE 0 END
		LIMIT 1
	`
	var config model.Config
	err := r.db.QueryRow(ctx, query, key, environment).Scan(
		&config.ID, &config.Key, &config.Value, &config.Type,
		&config.Description, &config.IsSecret, &config.Environment,
		&config.Version, &config.CreatedAt, &config.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *ConfigRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.Config, error) {
	query := `
		SELECT id, key, value, type, description, is_secret, environment, version, created_at, updated_at
		FROM configs
		WHERE id = $1 AND deleted_at IS NULL
	`
	var config model.Config
	err := r.db.QueryRow(ctx, query, id).Scan(
		&config.ID, &config.Key, &config.Value, &config.Type,
		&config.Description, &config.IsSecret, &config.Environment,
		&config.Version, &config.CreatedAt, &config.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *ConfigRepository) List(ctx context.Context, environment string, limit, offset int) ([]*model.Config, int, error) {
	countQuery := `
		SELECT COUNT(*) FROM configs
		WHERE (environment = $1 OR environment = 'all') AND deleted_at IS NULL
	`
	var total int
	err := r.db.QueryRow(ctx, countQuery, environment).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := `
		SELECT id, key, value, type, description, is_secret, environment, version, created_at, updated_at
		FROM configs
		WHERE (environment = $1 OR environment = 'all') AND deleted_at IS NULL
		ORDER BY key
		LIMIT $2 OFFSET $3
	`
	rows, err := r.db.Query(ctx, query, environment, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var configs []*model.Config
	for rows.Next() {
		var config model.Config
		if err := rows.Scan(
			&config.ID, &config.Key, &config.Value, &config.Type,
			&config.Description, &config.IsSecret, &config.Environment,
			&config.Version, &config.CreatedAt, &config.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		configs = append(configs, &config)
	}

	return configs, total, nil
}

func (r *ConfigRepository) Update(ctx context.Context, config *model.Config) error {
	query := `
		UPDATE configs
		SET value = $1, type = $2, description = $3, is_secret = $4, environment = $5, version = version + 1, updated_at = NOW()
		WHERE id = $6 AND deleted_at IS NULL
		RETURNING version, updated_at
	`
	return r.db.QueryRow(ctx, query,
		config.Value, config.Type, config.Description,
		config.IsSecret, config.Environment, config.ID,
	).Scan(&config.Version, &config.UpdatedAt)
}

func (r *ConfigRepository) Delete(ctx context.Context, id uuid.UUID) error {
	query := `UPDATE configs SET deleted_at = NOW() WHERE id = $1`
	_, err := r.db.Exec(ctx, query, id)
	return err
}

func (r *ConfigRepository) History(ctx context.Context, configID uuid.UUID, limit, offset int) ([]*model.ConfigHistory, error) {
	query := `
		SELECT id, config_id, key, value, action, changed_by, created_at
		FROM config_histories
		WHERE config_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.db.Query(ctx, query, configID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []*model.ConfigHistory
	for rows.Next() {
		var h model.ConfigHistory
		if err := rows.Scan(&h.ID, &h.ConfigID, &h.Key, &h.Value, &h.Action, &h.ChangedBy, &h.CreatedAt); err != nil {
			return nil, err
		}
		history = append(history, &h)
	}
	return history, nil
}

func (r *ConfigRepository) SaveHistory(ctx context.Context, history *model.ConfigHistory) error {
	query := `
		INSERT INTO config_histories (config_id, key, value, action, changed_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`
	return r.db.QueryRow(ctx, query,
		history.ConfigID, history.Key, history.Value, history.Action, history.ChangedBy,
	).Scan(&history.ID, &history.CreatedAt)
}

func (r *ConfigRepository) InvalidateCache(ctx context.Context, key string) error {
	if r.redis == nil {
		return nil
	}
	cacheKey := "config:" + key
	return r.redis.Del(ctx, cacheKey).Err()
}

func (r *ConfigRepository) GetCached(ctx context.Context, key string) (*model.Config, error) {
	if r.redis == nil {
		return nil, redislib.Nil
	}
	cacheKey := "config:" + key
	data, err := r.redis.Get(ctx, cacheKey).Bytes()
	if err != nil {
		return nil, err
	}
	var config model.Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *ConfigRepository) SetCache(ctx context.Context, config *model.Config, ttl time.Duration) error {
	if r.redis == nil {
		return nil
	}
	cacheKey := "config:" + config.Key
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return r.redis.Set(ctx, cacheKey, data, ttl).Err()
}
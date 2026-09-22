package repository

import (
	"context"

	"gorm.io/gorm"

	"newproject/services/bot-service/src/model"
)

// Repository defines the interface for data access.
type Repository interface {
	CreateChat(ctx context.Context, chat *model.Chat) error
	CreateMessage(ctx context.Context, message *model.Message) error
	GetMessagesByChatID(ctx context.Context, chatID uint, limit int) ([]model.Message, error)
	GetChatByID(ctx context.Context, chatID uint) (*model.Chat, error)
	CreateKnowledge(ctx context.Context, knowledge *model.Knowledge) error
	UpdateKnowledge(ctx context.Context, knowledge *model.Knowledge) error
}

// postgresRepository implements Repository using GORM and Postgres.
type postgresRepository struct {
	DB *gorm.DB
}

// NewPostgresRepository creates a new PostgreSQL repository.
func NewPostgresRepository(db *gorm.DB) Repository {
	return &postgresRepository{DB: db}
}

// CreateChat creates a new chat record.
func (r *postgresRepository) CreateChat(ctx context.Context, chat *model.Chat) error {
	return r.DB.WithContext(ctx).Create(chat).Error
}

// CreateMessage creates a new message record.
func (r *postgresRepository) CreateMessage(ctx context.Context, message *model.Message) error {
	return r.DB.WithContext(ctx).Create(message).Error
}

// GetMessagesByChatID retrieves messages for a given chat, ordered by creation time ascending.
func (r *postgresRepository) GetMessagesByChatID(ctx context.Context, chatID uint, limit int) ([]model.Message, error) {
	var messages []model.Message
	err := r.DB.WithContext(ctx).
		Where("chat_id = ?", chatID).
		Order("created_at ASC").
		Limit(limit).
		Find(&messages).Error
	return messages, err
}

// GetChatByID retrieves a chat by its ID.
func (r *postgresRepository) GetChatByID(ctx context.Context, chatID uint) (*model.Chat, error) {
	var chat model.Chat
	err := r.DB.WithContext(ctx).
		Where("id = ?", chatID).
		First(&chat).Error
	if err != nil {
		return nil, err
	}
	return &chat, nil
}

// CreateKnowledge creates a new knowledge record.
func (r *postgresRepository) CreateKnowledge(ctx context.Context, knowledge *model.Knowledge) error {
	return r.DB.WithContext(ctx).Create(knowledge).Error
}

// UpdateKnowledge updates an existing knowledge record.
func (r *postgresRepository) UpdateKnowledge(ctx context.Context, knowledge *model.Knowledge) error {
	return r.DB.WithContext(ctx).Save(knowledge).Error
}
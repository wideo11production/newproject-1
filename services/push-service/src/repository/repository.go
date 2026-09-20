package repository

import (
	"context"
	"errors"

	"newproject/services/push-service/src/model"
	"gorm.io/gorm"
)

var (
	ErrSubscriptionNotFound = errors.New("subscription not found")
	ErrMessageNotFound      = errors.New("message not found")
)

type SubscriptionRepository interface {
	Create(ctx context.Context, sub *model.PushSubscription) error
	GetByUserID(ctx context.Context, userID uint) ([]*model.PushSubscription, error)
	GetByEndpoint(ctx context.Context, endpoint string) (*model.PushSubscription, error)
	GetByID(ctx context.Context, id uint) (*model.PushSubscription, error)
	Update(ctx context.Context, sub *model.PushSubscription) error
	DeleteByID(ctx context.Context, id uint) error
	DeleteByUserID(ctx context.Context, userID uint) error
	CountActive(ctx context.Context) (int64, error)
}

type MessageRepository interface {
	Create(ctx context.Context, msg *model.PushMessage) error
	GetByID(ctx context.Context, id uint) (*model.PushMessage, error)
	GetPending(ctx context.Context, limit int) ([]*model.PushMessage, error)
	Update(ctx context.Context, msg *model.PushMessage) error
	DeleteByID(ctx context.Context, id uint) error
}

type subscriptionRepository struct {
	db *gorm.DB
}

func NewSubscriptionRepository(db *gorm.DB) SubscriptionRepository {
	return &subscriptionRepository{db: db}
}

func (r *subscriptionRepository) Create(ctx context.Context, sub *model.PushSubscription) error {
	return r.db.WithContext(ctx).Create(sub).Error
}

func (r *subscriptionRepository) GetByUserID(ctx context.Context, userID uint) ([]*model.PushSubscription, error) {
	var subs []*model.PushSubscription
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&subs).Error
	return subs, err
}

func (r *subscriptionRepository) GetByEndpoint(ctx context.Context, endpoint string) (*model.PushSubscription, error) {
	var sub model.PushSubscription
	err := r.db.WithContext(ctx).Where("endpoint = ?", endpoint).First(&sub).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) GetByID(ctx context.Context, id uint) (*model.PushSubscription, error) {
	var sub model.PushSubscription
	err := r.db.WithContext(ctx).First(&sub, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *subscriptionRepository) Update(ctx context.Context, sub *model.PushSubscription) error {
	return r.db.WithContext(ctx).Save(sub).Error
}

func (r *subscriptionRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.PushSubscription{}, id).Error
}

func (r *subscriptionRepository) DeleteByUserID(ctx context.Context, userID uint) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.PushSubscription{}).Error
}

func (r *subscriptionRepository) CountActive(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.PushSubscription{}).Count(&count).Error
	return count, err
}

type messageRepository struct {
	db *gorm.DB
}

func NewMessageRepository(db *gorm.DB) MessageRepository {
	return &messageRepository{db: db}
}

func (r *messageRepository) Create(ctx context.Context, msg *model.PushMessage) error {
	return r.db.WithContext(ctx).Create(msg).Error
}

func (r *messageRepository) GetByID(ctx context.Context, id uint) (*model.PushMessage, error) {
	var msg model.PushMessage
	err := r.db.WithContext(ctx).First(&msg, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}
	return &msg, nil
}

func (r *messageRepository) GetPending(ctx context.Context, limit int) ([]*model.PushMessage, error) {
	var msgs []*model.PushMessage
	err := r.db.WithContext(ctx).Where("status = ?", "pending").Limit(limit).Find(&msgs).Error
	return msgs, err
}

func (r *messageRepository) Update(ctx context.Context, msg *model.PushMessage) error {
	return r.db.WithContext(ctx).Save(msg).Error
}

func (r *messageRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.PushMessage{}, id).Error
}

package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/newproject/services/normalnotification/src/model"
	"gorm.io/gorm"
)

var (
	ErrNotificationNotFound = errors.New("notification not found")
)

// NotificationRepository defines methods for notification storage
type NotificationRepository interface {
	Create(ctx context.Context, notification *model.Notification) error
	GetByID(ctx context.Context, id uint) (*model.Notification, error)
	GetByUUID(ctx context.Context, uuid uuid.UUID) (*model.Notification, error)
	Update(ctx context.Context, notification *model.Notification) error
	DeleteByID(ctx context.Context, id uint) error
	ListByStatus(ctx context.Context, status string) ([]*model.Notification, error)
}

// notificationRepository implements NotificationRepository using GORM
type notificationRepository struct {
	db *gorm.DB
}

// NewNotificationRepository creates a new NotificationRepository
func NewNotificationRepository(db *gorm.DB) NotificationRepository {
	return &notificationRepository{db: db}
}

func (r *notificationRepository) Create(ctx context.Context, notification *model.Notification) error {
	return r.db.WithContext(ctx).Create(notification).Error
}

func (r *notificationRepository) GetByID(ctx context.Context, id uint) (*model.Notification, error) {
	var notification model.Notification
	err := r.db.WithContext(ctx).First(&notification, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotificationNotFound
		}
		return nil, err
	}
	return &notification, nil
}

func (r *notificationRepository) GetByUUID(ctx context.Context, uuid uuid.UUID) (*model.Notification, error) {
	var notification model.Notification
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&notification).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotificationNotFound
		}
		return nil, err
	}
	return &notification, nil
}

func (r *notificationRepository) Update(ctx context.Context, notification *model.Notification) error {
	return r.db.WithContext(ctx).Save(notification).Error
}

func (r *notificationRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Notification{}).Error
}

func (r *notificationRepository) ListByStatus(ctx context.Context, status string) ([]*model.Notification, error) {
	var notifications []*model.Notification
	err := r.db.WithContext(ctx).Where("status = ?", status).Find(&notifications).Error
	if err != nil {
		return nil, err
	}
	return notifications, nil
}
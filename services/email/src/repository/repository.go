package repository

import (
	"context"
	"errors"

	"newproject/services/email/src/model"
	"gorm.io/gorm"
)

var (
	ErrEmailTemplateNotFound = errors.New("email template not found")
)

// EmailTemplateRepository defines methods for email template storage
type EmailTemplateRepository interface {
	Create(ctx context.Context, template *model.EmailTemplate) error
	GetByID(ctx context.Context, id uint) (*model.EmailTemplate, error)
	GetByName(ctx context.Context, name string) (*model.EmailTemplate, error)
	Update(ctx context.Context, template *model.EmailTemplate) error
	DeleteByID(ctx context.Context, id uint) error
	List(ctx context.Context) ([]*model.EmailTemplate, error)
}

// emailTemplateRepository implements EmailTemplateRepository using GORM
type emailTemplateRepository struct {
	db *gorm.DB
}

// NewEmailTemplateRepository creates a new EmailTemplateRepository
func NewEmailTemplateRepository(db *gorm.DB) EmailTemplateRepository {
	return &emailTemplateRepository{db: db}
}

func (r *emailTemplateRepository) Create(ctx context.Context, template *model.EmailTemplate) error {
	return r.db.WithContext(ctx).Create(template).Error
}

func (r *emailTemplateRepository) GetByID(ctx context.Context, id uint) (*model.EmailTemplate, error) {
	var template model.EmailTemplate
	err := r.db.WithContext(ctx).First(&template, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEmailTemplateNotFound
		}
		return nil, err
	}
	return &template, nil
}

func (r *emailTemplateRepository) GetByName(ctx context.Context, name string) (*model.EmailTemplate, error) {
	var template model.EmailTemplate
	err := r.db.WithContext(ctx).Where("name = ?", name).First(&template).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEmailTemplateNotFound
		}
		return nil, err
	}
	return &template, nil
}

func (r *emailTemplateRepository) Update(ctx context.Context, template *model.EmailTemplate) error {
	return r.db.WithContext(ctx).Save(template).Error
}

func (r *emailTemplateRepository) DeleteByID(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.EmailTemplate{}).Error
}

func (r *emailTemplateRepository) List(ctx context.Context) ([]*model.EmailTemplate, error) {
	var templates []*model.EmailTemplate
	err := r.db.WithContext(ctx).Find(&templates).Error
	if err != nil {
		return nil, err
	}
	return templates, nil
}
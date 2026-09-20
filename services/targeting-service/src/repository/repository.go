package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"newproject/services/targeting-service/src/model"
)

var (
	ErrCategoryNotFound         = errors.New("category not found")
	ErrTargetRuleNotFound       = errors.New("target rule not found")
	ErrCategoryAlreadyExists     = errors.New("category already exists")
)

type CategoryRepository interface {
	Create(ctx context.Context, category *model.Category) error
	GetByID(ctx context.Context, id uint) (*model.Category, error)
	GetByCode(ctx context.Context, code string) (*model.Category, error)
	GetByUUID(ctx context.Context, uuid string) (*model.Category, error)
	List(ctx context.Context, parentID *uint, limit, offset int) ([]*model.Category, error)
	ListByType(ctx context.Context, categoryType string, limit, offset int) ([]*model.Category, error)
	Update(ctx context.Context, category *model.Category) error
	Delete(ctx context.Context, id uint) error
}

type TargetRuleRepository interface {
	Create(ctx context.Context, rule *model.TargetRule) error
	CreateBatch(ctx context.Context, rules []*model.TargetRule) error
	GetByID(ctx context.Context, id uint) (*model.TargetRule, error)
	GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.TargetRule, error)
	Update(ctx context.Context, rule *model.TargetRule) error
	Delete(ctx context.Context, id uint) error
	DeleteByCampaignID(ctx context.Context, campaignID uint) error
}

type CategoryTree struct {
	Category    *model.Category   `json:"category"`
	Children    []*CategoryTree   `json:"children,omitempty"`
	Depth       int               `json:"depth"`
}

type categoryRepository struct {
	db *gorm.DB
}

func NewCategoryRepository(db *gorm.DB) CategoryRepository {
	return &categoryRepository{db: db}
}

func (r *categoryRepository) Create(ctx context.Context, category *model.Category) error {
	// Check if category code already exists
	_, err := r.GetByCode(ctx, category.Code)
	if err == nil {
		return ErrCategoryAlreadyExists
	}
	if err != ErrCategoryNotFound {
		return err
	}

	return r.db.WithContext(ctx).Create(category).Error
}

func (r *categoryRepository) GetByID(ctx context.Context, id uint) (*model.Category, error) {
	var category model.Category
	err := r.db.WithContext(ctx).First(&category, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCategoryNotFound
		}
		return nil, err
	}
	return &category, nil
}

func (r *categoryRepository) GetByCode(ctx context.Context, code string) (*model.Category, error) {
	var category model.Category
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&category).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCategoryNotFound
		}
		return nil, err
	}
	return &category, nil
}

func (r *categoryRepository) GetByUUID(ctx context.Context, uuid string) (*model.Category, error) {
	var category model.Category
	err := r.db.WithContext(ctx).Where("uuid = ?", uuid).First(&category).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCategoryNotFound
		}
		return nil, err
	}
	return &category, nil
}

func (r *categoryRepository) List(ctx context.Context, parentID *uint, limit, offset int) ([]*model.Category, error) {
	var categories []*model.Category
	query := r.db.WithContext(ctx).Where("is_active = ?", true)
	if parentID != nil {
		query = query.Where("parent_id = ?", parentID)
	} else {
		query = query.Where("parent_id IS NULL")
	}
	err := query.Order("name asc").Limit(limit).Offset(offset).Find(&categories).Error
	return categories, err
}

func (r *categoryRepository) ListByType(ctx context.Context, categoryType string, limit, offset int) ([]*model.Category, error) {
	var categories []*model.Category
	err := r.db.WithContext(ctx).Where("type = ? AND is_active = ?", categoryType, true).Order("name asc").Limit(limit).Offset(offset).Find(&categories).Error
	return categories, err
}

func (r *categoryRepository) Update(ctx context.Context, category *model.Category) error {
	return r.db.WithContext(ctx).Save(category).Error
}

func (r *categoryRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.Category{}, id).Error
}

type targetRuleRepository struct {
	db *gorm.DB
}

func NewTargetRuleRepository(db *gorm.DB) TargetRuleRepository {
	return &targetRuleRepository{db: db}
}

func (r *targetRuleRepository) Create(ctx context.Context, rule *model.TargetRule) error {
	return r.db.WithContext(ctx).Create(rule).Error
}

func (r *targetRuleRepository) CreateBatch(ctx context.Context, rules []*model.TargetRule) error {
	return r.db.WithContext(ctx).Create(&rules).Error
}

func (r *targetRuleRepository) GetByID(ctx context.Context, id uint) (*model.TargetRule, error) {
	var rule model.TargetRule
	err := r.db.WithContext(ctx).First(&rule, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTargetRuleNotFound
		}
		return nil, err
	}
	return &rule, nil
}

func (r *targetRuleRepository) GetByCampaignID(ctx context.Context, campaignID uint) ([]*model.TargetRule, error) {
	var rules []*model.TargetRule
	err := r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Find(&rules).Error
	return rules, err
}

func (r *targetRuleRepository) Update(ctx context.Context, rule *model.TargetRule) error {
	return r.db.WithContext(ctx).Save(rule).Error
}

func (r *targetRuleRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&model.TargetRule{}, id).Error
}

func (r *targetRuleRepository) DeleteByCampaignID(ctx context.Context, campaignID uint) error {
	return r.db.WithContext(ctx).Where("campaign_id = ?", campaignID).Delete(&model.TargetRule{}).Error
}

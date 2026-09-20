package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"newproject/services/targeting-service/src/model"
	"newproject/services/targeting-service/src/repository"
)

type TargetingService struct {
	categoryRepo repository.CategoryRepository
	ruleRepo     repository.TargetRuleRepository
}

func NewTargetingService(
	categoryRepo repository.CategoryRepository,
	ruleRepo repository.TargetRuleRepository,
) *TargetingService {
	return &TargetingService{
		categoryRepo: categoryRepo,
		ruleRepo:     ruleRepo,
	}
}

func (s *TargetingService) CreateCategory(ctx context.Context, name, code, categoryType, description string, parentID *uint) (*model.Category, error) {
	if code == "" {
		return nil, errors.New("code is required")
	}

	_, err := s.categoryRepo.GetByCode(ctx, code)
	if err == nil {
		return nil, errors.New("category with this code already exists")
	}
	if err != repository.ErrCategoryNotFound {
		return nil, err
	}

	if parentID != nil {
		parent, err := s.categoryRepo.GetByID(ctx, *parentID)
		if err != nil {
			return nil, err
		}
	}

	category := &model.Category{
		UUID:        uuid.New(),
		Name:        name,
		Code:        code,
		Type:        categoryType,
		Description: description,
		ParentID:    parentID,
		IsActive:    true,
	}

	if err := s.categoryRepo.Create(ctx, category); err != nil {
		return nil, err
	}

	return category, nil
}

func (s *TargetingService) GetCategory(ctx context.Context, id uint) (*model.Category, error) {
	return s.categoryRepo.GetByID(ctx, id)
}

func (s *TargetingService) GetCategoryByCode(ctx context.Context, code string) (*model.Category, error) {
	return s.categoryRepo.GetByCode(ctx, code)
}

func (s *TargetingService) ListCategories(ctx context.Context, parentID *uint, limit, offset int) ([]*model.Category, error) {
	return s.categoryRepo.List(ctx, parentID, limit, offset)
}

func (s *TargetingService) ListCategoriesByType(ctx context.Context, categoryType string, limit, offset int) ([]*model.Category, error) {
	return s.categoryRepo.ListByType(ctx, categoryType, limit, offset)
}

func (s *TargetingService) UpdateCategory(ctx context.Context, category *model.Category) error {
	return s.categoryRepo.Update(ctx, category)
}

func (s *TargetingService) DeleteCategory(ctx context.Context, id uint) error {
	// Check if category has children
	childCount := s.categoryRepo.List(context.Background(), &id, 1, 0)
	if len(childCount) > 0 {
		return errors.New("cannot delete category with children")
	}

	// Check if category has targeting rules
	rules, err := s.ruleRepo.GetByCampaignID(ctx, id)
	if err != nil {
		return err
	}
	if len(rules) > 0 {
		return errors.New("cannot delete category used in targeting rules")
	}

	return s.categoryRepo.Delete(ctx, id)
}

func (s *TargetingService) CreateTargetingRule(ctx context.Context, campaignID uint, field, operator, value string, isInclude bool) (*model.TargetRule, error) {
	rule := &model.TargetRule{
		UUID:      uuid.New(),
		CampaignID: campaignID,
		Field:     field,
		Operator:  operator,
		Value:     value,
		IsInclude: isInclude,
	}

	if err := s.ruleRepo.Create(ctx, rule); err != nil {
		return nil, err
	}

	return rule, nil
}

func (s *TargetingService) GetTargetingRules(ctx context.Context, campaignID uint) ([]*model.TargetRule, error) {
	return s.ruleRepo.GetByCampaignID(ctx, campaignID)
}

func (s *TargetingService) UpdateTargetingRule(ctx context.Context, rule *model.TargetRule) error {
	return s.ruleRepo.Update(ctx, rule)
}

func (s *TargetingService) DeleteTargetingRule(ctx context.Context, id uint) error {
	return s.ruleRepo.Delete(ctx, id)
}

func (s *TargetingService) ClearTargetingRules(ctx context.Context, campaignID uint) error {
	return s.ruleRepo.DeleteByCampaignID(ctx, campaignID)
}

func (s *TargetingService) BuildTargetingTree(ctx context.Context, limit, offset int) ([]*CategoryTree, error) {
	// Get root categories (those with no parent)
	rootCategories, err := s.categoryRepo.List(ctx, nil, limit, offset)
	if err != nil {
		return nil, err
	}

	var tree []*CategoryTree
	for _, cat := range rootCategories {
		tree = append(tree, &CategoryTree{Category: cat, Depth: 0})
	}

	return tree, nil
}

func (s *TargetingService) GetAllCountries(ctx context.Context) ([]model.CountryCode, error) {
	var countries []model.CountryCode
	for _, c := range []model.CountryCode{
		model.CountryCodeUS, model.CountryCodeCA, model.CountryCodeUK, model.CountryCodeIN,
		model.CountryCodeDE, model.CountryCodeFR, model.CountryCodeJP, model.CountryCodeBR,
	} {
		countries = append(countries, c)
	}
	return countries, nil
}

func (s *TargetingService) GetAllLanguages(ctx context.Context) ([]model.LanguageCode, error) {
	var languages []model.LanguageCode
	for _, l := range []model.LanguageCode{
		model.LanguageCodeEN, model.LanguageCodeES, model.LanguageCodeFR, model.LanguageCodeDE,
		model.LanguageCodeIT, model.LanguageCodePT, model.LanguageCodeHI, model.LanguageCodeJA,
	} {
		languages = append(languages, l)
	}
	return languages, nil
}

func (s *TargetingService) GetAllChannels(ctx context.Context) ([]model.ChannelType, error) {
	var channels []model.ChannelType
	for _, c := range []model.ChannelType{
		model.ChannelTypeVideoChannel, model.ChannelTypeNews, model.ChannelTypeSports,
		model.ChannelTypeGaming, model.ChannelTypeEntertainment, model.ChannelTypeTech,
		model.ChannelTypeLifestyle, model.ChannelTypeEducation,
	} {
		channels = append(channels, c)
	}
	return channels, nil
}

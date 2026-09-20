package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/campaign-service/src/model"
	"newproject/services/campaign-service/src/repository"
)

type CampaignService struct {
	campaignRepo repository.CampaignRepository
	targetingRepo repository.TargetingRuleRepository
	statRepo     repository.CampaignStatRepository
}

func NewCampaignService(
	campaignRepo repository.CampaignRepository,
	targetingRepo repository.TargetingRuleRepository,
	statRepo repository.CampaignStatRepository,
) *CampaignService {
	return &CampaignService{
		campaignRepo:  campaignRepo,
		targetingRepo: targetingRepo,
		statRepo:      statRepo,
	}
}

type TargetingRuleRequest struct {
	Field     string `json:"field" binding:"required"`
	Operator  string `json:"operator" binding:"required"`
	Value     string `json:"value" binding:"required"`
	IsInclude bool   `json:"is_include"`
}

func (s *CampaignService) CreateCampaign(ctx context.Context, name, code, description string, advertiserID uint, budget, cpc, cpm string, startDate, endDate time.Time, targeting, adFormat string, frequencyCap, frequencyWindow, priority int) (*model.Campaign, error) {
	_, err := s.campaignRepo.GetByCode(ctx, code)
	if err == nil {
		return nil, errors.New("campaign with this code already exists")
	}
	if err != repository.ErrCampaignNotFound {
		return nil, err
	}

	budgetDec, err := decimal.NewFromString(budget)
	if err != nil {
		return nil, errors.New("invalid budget")
	}
	if budgetDec.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("budget must be positive")
	}

	cpcDec, _ := decimal.NewFromString(cpc)
	cpmDec, _ := decimal.NewFromString(cpm)

	campaign := &model.Campaign{
		UUID:              uuid.New(),
		Name:              name,
		Code:              code,
		Description:       description,
		AdvertiserID:      advertiserID,
		Status:            model.CampaignStatusDraft,
		Budget:            budgetDec,
		Remaining:         budgetDec,
		Currency:          "INR",
		CPC:               cpcDec,
		CPM:               cpmDec,
		StartDate:         startDate,
		EndDate:           endDate,
		Targeting:         targeting,
		AdFormat:          adFormat,
		FrequencyCap:      frequencyCap,
		FrequencyWindow:   frequencyWindow,
		Priority:          priority,
		IsActive:          true,
	}

	if err := s.campaignRepo.Create(ctx, campaign); err != nil {
		return nil, err
	}

	return campaign, nil
}

func (s *CampaignService) GetCampaign(ctx context.Context, id uint) (*model.Campaign, error) {
	return s.campaignRepo.GetByID(ctx, id)
}

func (s *CampaignService) GetCampaignByUUID(ctx context.Context, uuid string) (*model.Campaign, error) {
	return s.campaignRepo.GetByUUID(ctx, uuid)
}

func (s *CampaignService) GetCampaignByCode(ctx context.Context, code string) (*model.Campaign, error) {
	return s.campaignRepo.GetByCode(ctx, code)
}

func (s *CampaignService) ListCampaigns(ctx context.Context, advertiserID uint, limit, offset int) ([]*model.Campaign, error) {
	if advertiserID > 0 {
		return s.campaignRepo.GetByAdvertiserID(ctx, advertiserID, limit, offset)
	}
	return s.campaignRepo.GetByStatus(ctx, model.CampaignStatusActive, limit, offset)
}

func (s *CampaignService) UpdateCampaign(ctx context.Context, campaign *model.Campaign) error {
	return s.campaignRepo.Update(ctx, campaign)
}

func (s *CampaignService) StartCampaign(ctx context.Context, id uint, approverID uint) (*model.Campaign, error) {
	campaign, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if campaign.Status != model.CampaignStatusDraft {
		return nil, errors.New("campaign is not in draft status")
	}

	now := time.Now()
	campaign.Status = model.CampaignStatusActive
	campaign.ApprovedBy = &approverID
	campaign.ApprovedAt = &now

	if err := s.campaignRepo.Update(ctx, campaign); err != nil {
		return nil, err
	}

	return campaign, nil
}

func (s *CampaignService) PauseCampaign(ctx context.Context, id uint) (*model.Campaign, error) {
	campaign, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if campaign.Status != model.CampaignStatusActive {
		return nil, errors.New("campaign is not active")
	}

	campaign.Status = model.CampaignStatusPaused
	if err := s.campaignRepo.Update(ctx, campaign); err != nil {
		return nil, err
	}

	return campaign, nil
}

func (s *CampaignService) ResumeCampaign(ctx context.Context, id uint) (*model.Campaign, error) {
	campaign, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if campaign.Status != model.CampaignStatusPaused {
		return nil, errors.New("campaign is not paused")
	}

	campaign.Status = model.CampaignStatusActive
	if err := s.campaignRepo.Update(ctx, campaign); err != nil {
		return nil, err
	}

	return campaign, nil
}

func (s *CampaignService) RejectCampaign(ctx context.Context, id uint, approverID uint, reason string) (*model.Campaign, error) {
	campaign, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if campaign.Status != model.CampaignStatusDraft {
		return nil, errors.New("campaign is not in draft status")
	}

	now := time.Now()
	campaign.Status = model.CampaignStatusRejected
	campaign.ApprovedBy = &approverID
	campaign.ApprovedAt = &now
	campaign.RejectionReason = reason

	if err := s.campaignRepo.Update(ctx, campaign); err != nil {
		return nil, err
	}

	return campaign, nil
}

func (s *CampaignService) CompleteCampaign(ctx context.Context, id uint) (*model.Campaign, error) {
	campaign, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	campaign.Status = model.CampaignStatusCompleted
	return campaign, s.campaignRepo.Update(ctx, campaign)
}

func (s *CampaignService) GetActiveCampaigns(ctx context.Context, limit, offset int) ([]*model.Campaign, error) {
	return s.campaignRepo.GetActive(ctx, limit, offset)
}

func (s *CampaignService) GetExpiringCampaigns(ctx context.Context, days int) ([]*model.Campaign, error) {
	before := time.Now().AddDate(0, 0, days)
	return s.campaignRepo.GetExpiring(ctx, before)
}

func (s *CampaignService) AddTargetingRule(ctx context.Context, campaignID uint, req TargetingRuleRequest) (*model.TargetingRule, error) {
	rule := &model.TargetingRule{
		UUID:      uuid.New(),
		CampaignID: campaignID,
		Field:     req.Field,
		Operator:  req.Operator,
		Value:     req.Value,
		IsInclude: req.IsInclude,
	}

	if err := s.targetingRepo.Create(ctx, rule); err != nil {
		return nil, err
	}

	return rule, nil
}

func (s *CampaignService) GetTargetingRules(ctx context.Context, campaignID uint) ([]*model.TargetingRule, error) {
	return s.targetingRepo.GetByCampaignID(ctx, campaignID)
}

func (s *CampaignService) UpdateTargetingRule(ctx context.Context, rule *model.TargetingRule) error {
	return s.targetingRepo.Update(ctx, rule)
}

func (s *CampaignService) DeleteTargetingRule(ctx context.Context, id uint) error {
	return s.targetingRepo.Delete(ctx, id)
}

func (s *CampaignService) ClearTargetingRules(ctx context.Context, campaignID uint) error {
	return s.targetingRepo.DeleteByCampaignID(ctx, campaignID)
}

func (s *CampaignService) RecordStat(ctx context.Context, campaignID uint, date time.Time, impressions, clicks int, spent string, conversions int, revenue string) (*model.CampaignDailyStat, error) {
	day := date.UTC()

	stat, err := s.statRepo.GetByCampaignAndDate(ctx, campaignID, day)
	if err != nil {
		stat = &model.CampaignDailyStat{
			CampaignID:  campaignID,
			Date:        day,
		}
	}

	spentDec, _ := decimal.NewFromString(spent)
	revenueDec, _ := decimal.NewFromString(revenue)

	stat.Impressions += impressions
	stat.Clicks += clicks
	stat.Spent = stat.Spent.Add(spentDec)
	stat.Conversions += conversions
	stat.Revenue = stat.Revenue.Add(revenueDec)

	if err := s.statRepo.UpdateOrCreate(ctx, stat); err != nil {
		return nil, err
	}

	if spentDec.GreaterThan(decimal.Zero) {
		_ = s.campaignRepo.AddSpent(ctx, campaignID, spentDec)
	}

	return stat, nil
}

func (s *CampaignService) GetStats(ctx context.Context, campaignID uint, limit, offset int) ([]*model.CampaignDailyStat, error) {
	return s.statRepo.GetByCampaign(ctx, campaignID, limit, offset)
}

func (s *CampaignService) CheckBudget(ctx context.Context, campaignID uint, spendAmount decimal.Decimal) error {
	campaign, err := s.campaignRepo.GetByID(ctx, campaignID)
	if err != nil {
		return err
	}

	if campaign.Remaining.LessThan(spendAmount) {
		return repository.ErrInsufficientBudget
	}

	return nil
}

func (s *CampaignService) DeductBudget(ctx context.Context, campaignID uint, amount decimal.Decimal) error {
	campaign, err := s.campaignRepo.GetByID(ctx, campaignID)
	if err != nil {
		return err
	}

	if campaign.Remaining.LessThan(amount) {
		return repository.ErrInsufficientBudget
	}

	return s.campaignRepo.AddSpent(ctx, campaignID, amount)
}

func (s *CampaignService) GetTargetingJson(campaign *model.Campaign) map[string]interface{} {
	if campaign.Targeting == "" {
		return map[string]interface{}{}
	}

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(campaign.Targeting), &result); err != nil {
		return map[string]interface{}{}
	}
	return result
}

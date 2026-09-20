package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"newproject/services/push-gateway/src/model"
	"newproject/services/push-gateway/src/repository"
)

type PushGatewayService struct {
	templateRepo   repository.TemplateRepository
	campaignRepo   repository.CampaignRepository
	analyticsRepo  repository.AnalyticsRepository
	configRepo     repository.PlatformConfigRepository
	scheduledRepo  repository.ScheduledPushRepository
}

func NewPushGatewayService(
	templateRepo repository.TemplateRepository,
	campaignRepo repository.CampaignRepository,
	analyticsRepo repository.AnalyticsRepository,
	configRepo repository.PlatformConfigRepository,
	scheduledRepo repository.ScheduledPushRepository,
) *PushGatewayService {
	return &PushGatewayService{
		templateRepo:  templateRepo,
		campaignRepo:  campaignRepo,
		analyticsRepo: analyticsRepo,
		configRepo:    configRepo,
		scheduledRepo: scheduledRepo,
	}
}

func (s *PushGatewayService) CreateTemplate(ctx context.Context, req CreateTemplateRequest) (*model.PushTemplate, error) {
	t := &model.PushTemplate{
		UUID:      uuid.New(),
		Name:      req.Name,
		Category:  req.Category,
		Title:     req.Title,
		Body:      req.Body,
		Icon:      req.Icon,
		Image:     req.Image,
		URL:       req.URL,
		Action:    req.Action,
		Variables: req.Variables,
	}
	if err := s.templateRepo.Create(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

func (s *PushGatewayService) GetTemplate(ctx context.Context, id uint) (*model.PushTemplate, error) {
	return s.templateRepo.GetByID(ctx, id)
}

func (s *PushGatewayService) GetTemplateByUUID(ctx context.Context, uuid string) (*model.PushTemplate, error) {
	return s.templateRepo.GetByUUID(ctx, uuid)
}

func (s *PushGatewayService) GetTemplatesByCategory(ctx context.Context, category string) ([]*model.PushTemplate, error) {
	return s.templateRepo.GetByCategory(ctx, category)
}

func (s *PushGatewayService) UpdateTemplate(ctx context.Context, id uint, req CreateTemplateRequest) (*model.PushTemplate, error) {
	t, err := s.templateRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	t.Name = req.Name
	t.Category = req.Category
	t.Title = req.Title
	t.Body = req.Body
	t.Icon = req.Icon
	t.Image = req.Image
	t.URL = req.URL
	t.Action = req.Action
	t.Variables = req.Variables
	if err := s.templateRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

func (s *PushGatewayService) DeleteTemplate(ctx context.Context, id uint) error {
	return s.templateRepo.Delete(ctx, id)
}

func (s *PushGatewayService) RenderTemplate(template *model.PushTemplate, vars map[string]string) (string, string) {
	title := template.Title
	body := template.Body
	for k, v := range vars {
		placeholder := "{{" + k + "}}"
		title = strings.ReplaceAll(title, placeholder, v)
		body = strings.ReplaceAll(body, placeholder, v)
	}
	return title, body
}

func (s *PushGatewayService) CreateCampaign(ctx context.Context, req CreateCampaignRequest) (*model.PushCampaign, error) {
	_, err := s.templateRepo.GetByID(ctx, req.TemplateID)
	if err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	c := &model.PushCampaign{
		UUID:        uuid.New(),
		Name:        req.Name,
		TemplateID:  req.TemplateID,
		TargetType:  req.TargetType,
		TargetQuery: req.TargetQuery,
		ScheduledAt: req.ScheduledAt,
		Status:      "draft",
	}
	if err := s.campaignRepo.Create(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *PushGatewayService) GetCampaign(ctx context.Context, id uint) (*model.PushCampaign, error) {
	return s.campaignRepo.GetByID(ctx, id)
}

func (s *PushGatewayService) GetCampaignByUUID(ctx context.Context, uuid string) (*model.PushCampaign, error) {
	return s.campaignRepo.GetByUUID(ctx, uuid)
}

func (s *PushGatewayService) ListCampaigns(ctx context.Context, limit, offset int) ([]*model.PushCampaign, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.campaignRepo.List(ctx, limit, offset)
}

func (s *PushGatewayService) UpdateCampaign(ctx context.Context, id uint, req CreateCampaignRequest) (*model.PushCampaign, error) {
	c, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	c.Name = req.Name
	c.TemplateID = req.TemplateID
	c.TargetType = req.TargetType
	c.TargetQuery = req.TargetQuery
	c.ScheduledAt = req.ScheduledAt
	if req.ScheduledAt != nil {
		c.Status = "scheduled"
	}
	if err := s.campaignRepo.Update(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *PushGatewayService) DeleteCampaign(ctx context.Context, id uint) error {
	return s.campaignRepo.Delete(ctx, id)
}

func (s *PushGatewayService) ScheduleCampaign(ctx context.Context, id uint, scheduledAt time.Time) error {
	c, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	c.ScheduledAt = &scheduledAt
	c.Status = "scheduled"
	return s.campaignRepo.Update(ctx, c)
}

func (s *PushGatewayService) LaunchCampaign(ctx context.Context, id uint) error {
	c, err := s.campaignRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	c.Status = "sending"
	return s.campaignRepo.Update(ctx, c)
}

func (s *PushGatewayService) GetPendingCampaigns(ctx context.Context) ([]*model.PushCampaign, error) {
	return s.campaignRepo.GetPending(ctx)
}

func (s *PushGatewayService) RecordEvent(ctx context.Context, campaignID, subscriptionID uint, eventType, platform string, metadata map[string]interface{}) error {
	metaJSON, _ := json.Marshal(metadata)
	a := &model.PushAnalytics{
		CampaignID:     campaignID,
		SubscriptionID: subscriptionID,
		EventType:      eventType,
		Platform:       platform,
		Metadata:       string(metaJSON),
	}
	return s.analyticsRepo.Create(ctx, a)
}

func (s *PushGatewayService) GetAnalytics(ctx context.Context, campaignID uint) (map[string]int64, error) {
	return s.analyticsRepo.GetStats(ctx, campaignID)
}

func (s *PushGatewayService) GetPlatformConfigs(ctx context.Context) ([]*model.PlatformConfig, error) {
	return s.configRepo.GetAll(ctx)
}

func (s *PushGatewayService) GetPlatformConfig(ctx context.Context, name string) (*model.PlatformConfig, error) {
	return s.configRepo.GetByName(ctx, name)
}

func (s *PushGatewayService) UpsertPlatformConfig(ctx context.Context, req PlatformConfigRequest) (*model.PlatformConfig, error) {
	existing, err := s.configRepo.GetByName(ctx, req.Name)
	if err != nil && err != repository.ErrConfigNotFound {
		return nil, err
	}
	if existing == nil {
		existing = &model.PlatformConfig{Name: req.Name}
	}
	configJSON, _ := json.Marshal(req.Config)
	existing.Enabled = req.Enabled
	existing.Config = string(configJSON)
	existing.Priority = req.Priority
	if existing.ID == 0 {
		if err := s.configRepo.Create(ctx, existing); err != nil {
			return nil, err
		}
	} else {
		if err := s.configRepo.Update(ctx, existing); err != nil {
			return nil, err
		}
	}
	return existing, nil
}

func (s *PushGatewayService) SchedulePush(ctx context.Context, req SchedulePushRequest) (*model.ScheduledPush, error) {
	sp := &model.ScheduledPush{
		UUID:        uuid.New(),
		UserID:      req.UserID,
		Title:       req.Title,
		Body:        req.Body,
		Icon:        req.Icon,
		URL:         req.URL,
		ScheduledAt: req.ScheduledAt,
		Status:      "pending",
	}
	if err := s.scheduledRepo.Create(ctx, sp); err != nil {
		return nil, err
	}
	return sp, nil
}

func (s *PushGatewayService) GetScheduledPush(ctx context.Context, id uint) (*model.ScheduledPush, error) {
	return s.scheduledRepo.GetByID(ctx, id)
}

func (s *PushGatewayService) GetPendingScheduledPushes(ctx context.Context) ([]*model.ScheduledPush, error) {
	return s.scheduledRepo.GetPending(ctx, time.Now())
}

func (s *PushGatewayService) UpdateScheduledPushStatus(ctx context.Context, id uint, status, errorMsg string) error {
	sp, err := s.scheduledRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	sp.Status = status
	sp.LastError = errorMsg
	sp.AttemptCount++
	return s.scheduledRepo.Update(ctx, sp)
}

type CreateTemplateRequest struct {
	Name      string `json:"name" binding:"required"`
	Category  string `json:"category" binding:"required"`
	Title     string `json:"title" binding:"required"`
	Body      string `json:"body" binding:"required"`
	Icon      string `json:"icon,omitempty"`
	Image     string `json:"image,omitempty"`
	URL       string `json:"url,omitempty"`
	Action    string `json:"action,omitempty"`
	Variables string `json:"variables,omitempty"`
}

type CreateCampaignRequest struct {
	Name        string     `json:"name" binding:"required"`
	TemplateID  uint       `json:"template_id" binding:"required"`
	TargetType  string     `json:"target_type" binding:"required"`
	TargetQuery string     `json:"target_query,omitempty"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`
}

type PlatformConfigRequest struct {
	Name     string                 `json:"name" binding:"required"`
	Enabled  bool                   `json:"enabled"`
	Config   map[string]interface{} `json:"config,omitempty"`
	Priority int                    `json:"priority"`
}

type SchedulePushRequest struct {
	UserID     uint      `json:"user_id" binding:"required"`
	Title      string    `json:"title" binding:"required"`
	Body       string    `json:"body" binding:"required"`
	Icon       string    `json:"icon,omitempty"`
	URL        string    `json:"url,omitempty"`
	ScheduledAt time.Time `json:"scheduled_at" binding:"required"`
}
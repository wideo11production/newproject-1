package service

import (
	"context"
	"errors"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/ads-service/src/model"
	"newproject/services/ads-service/src/repository"
)

type AdDeliveryRequest struct {
	PlacementCode string `json:"placement_code" binding:"required"`
	Country       string `json:"country"`
	Region        string `json:"region"`
	City          string `json:"city"`
	Device        string `json:"device"`
	UserID        *uint  `json:"user_id,omitempty"`
}

type AdDeliveryResponse struct {
	AdID     uint   `json:"ad_id"`
	UUID     string `json:"uuid"`
	Name     string `json:"name"`
	AdType   string `json:"ad_type"`
	HTML     string `json:"html_content"`
	MediaURL string `json:"media_url"`
	TargetURL string `json:"target_url"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	CPM      string `json:"cpm"`
}

type AdService struct {
	adRepo        repository.AdRepository
	placementRepo repository.PlacementRepository
	slotRepo      repository.AdSlotRepository
	impRepo       repository.ImpressionRepository
	clickRepo     repository.ClickRepository
	convRepo      repository.ConversionRepository
}

func NewAdService(
	adRepo repository.AdRepository,
	placementRepo repository.PlacementRepository,
	slotRepo repository.AdSlotRepository,
	impRepo repository.ImpressionRepository,
	clickRepo repository.ClickRepository,
	convRepo repository.ConversionRepository,
) *AdService {
	return &AdService{
		adRepo:        adRepo,
		placementRepo: placementRepo,
		slotRepo:      slotRepo,
		impRepo:       impRepo,
		clickRepo:     clickRepo,
		convRepo:      convRepo,
	}
}

func (s *AdService) CreateAd(ctx context.Context, campaignID uint, name, adType, htmlContent, mediaURL, targetURL string, width, height int, cpc, cpm string) (*model.Ad, error) {
	if targetURL == "" {
		return nil, errors.New("target_url is required")
	}

	var at model.AdType
	switch adType {
	case "banner":
		at = model.AdTypeBanner
	case "video":
		at = model.AdTypeVideo
	case "native":
		at = model.AdTypeNative
	case "overlay":
		at = model.AdTypeOverlay
	case "sponsored":
		at = model.AdTypeSponsored
	default:
		return nil, errors.New("invalid ad_type")
	}

	cpcDec, err := decimal.NewFromString(cpc)
	if err != nil {
		cpcDec = decimal.Zero
	}
	cpmDec, err := decimal.NewFromString(cpm)
	if err != nil {
		cpmDec = decimal.Zero
	}

	ad := &model.Ad{
		UUID:      uuid.New(),
		CampaignID: campaignID,
		Name:      name,
		AdType:    at,
		Status:    model.AdStatusDraft,
		HTMLContent: htmlContent,
		MediaURL:  mediaURL,
		TargetURL: targetURL,
		Width:     width,
		Height:    height,
		CPC:       cpcDec,
		CPM:       cpmDec,
	}

	if err := s.adRepo.Create(ctx, ad); err != nil {
		return nil, err
	}

	return ad, nil
}

func (s *AdService) GetAd(ctx context.Context, id uint) (*model.Ad, error) {
	return s.adRepo.GetByID(ctx, id)
}

func (s *AdService) GetAdByUUID(ctx context.Context, uuid string) (*model.Ad, error) {
	return s.adRepo.GetByUUID(ctx, uuid)
}

func (s *AdService) ListAds(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Ad, error) {
	return s.adRepo.GetByCampaignID(ctx, campaignID, limit, offset)
}

func (s *AdService) UpdateAd(ctx context.Context, ad *model.Ad) error {
	return s.adRepo.Update(ctx, ad)
}

func (s *AdService) ActivateAd(ctx context.Context, id uint) error {
	ad, err := s.adRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	ad.Status = model.AdStatusActive
	return s.adRepo.Update(ctx, ad)
}

func (s *AdService) PauseAd(ctx context.Context, id uint) error {
	ad, err := s.adRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	ad.Status = model.AdStatusPaused
	return s.adRepo.Update(ctx, ad)
}

func (s *AdService) CreatePlacement(ctx context.Context, name, code, adType, page, zone string, width, height int) (*model.AdPlacement, error) {
	var at model.AdType
	switch adType {
	case "banner":
		at = model.AdTypeBanner
	case "video":
		at = model.AdTypeVideo
	case "native":
		at = model.AdTypeNative
	case "overlay":
		at = model.AdTypeOverlay
	case "sponsored":
		at = model.AdTypeSponsored
	default:
		return nil, errors.New("invalid ad_type")
	}

	placement := &model.AdPlacement{
		UUID:     uuid.New(),
		Name:     name,
		Code:     code,
		AdType:   at,
		Page:     page,
		Zone:     zone,
		Width:    width,
		Height:   height,
		IsActive: true,
	}

	if err := s.placementRepo.Create(ctx, placement); err != nil {
		return nil, err
	}

	return placement, nil
}

func (s *AdService) GetPlacement(ctx context.Context, id uint) (*model.AdPlacement, error) {
	return s.placementRepo.GetByID(ctx, id)
}

func (s *AdService) GetPlacementByCode(ctx context.Context, code string) (*model.AdPlacement, error) {
	return s.placementRepo.GetByCode(ctx, code)
}

func (s *AdService) ListPlacements(ctx context.Context, adType model.AdType, limit, offset int) ([]*model.AdPlacement, error) {
	return s.placementRepo.GetByAdType(ctx, adType, limit, offset)
}

func (s *AdService) UpdatePlacement(ctx context.Context, placement *model.AdPlacement) error {
	return s.placementRepo.Update(ctx, placement)
}

func (s *AdService) CreateAdSlot(ctx context.Context, placementID uint, adID uint, score string) (*model.AdSlot, error) {
	scoreDec, err := decimal.NewFromString(score)
	if err != nil {
		scoreDec = decimal.Zero
	}

	slot := &model.AdSlot{
		UUID:        uuid.New(),
		PlacementID: placementID,
		AdID:        adID,
		Score:       scoreDec,
		Priority:    0,
		IsEnabled:   true,
	}

	if err := s.slotRepo.Create(ctx, slot); err != nil {
		return nil, err
	}

	return slot, nil
}

func (s *AdService) GetAdSlots(ctx context.Context, placementID uint, limit, offset int) ([]*model.AdSlot, error) {
	return s.slotRepo.GetByPlacementID(ctx, placementID, limit, offset)
}

func (s *AdService) UpdateAdSlot(ctx context.Context, slot *model.AdSlot) error {
	return s.slotRepo.Update(ctx, slot)
}

func (s *AdService) DeliverAd(ctx context.Context, req AdDeliveryRequest) (*AdDeliveryResponse, error) {
	placement, err := s.placementRepo.GetByCode(ctx, req.PlacementCode)
	if err != nil {
		return nil, repository.ErrPlacementNotFound
	}
	if !placement.IsActive {
		return nil, repository.ErrPlacementInactive
	}

	slots, err := s.slotRepo.GetActiveByPlacement(ctx, placement.ID)
	if err != nil || len(slots) == 0 {
		return nil, nil
	}

	rand.Shuffle(len(slots), func(i, j int) {
		slots[i], slots[j] = slots[j], slots[i]
	})

	var selectedSlot *model.AdSlot
	for _, slot := range slots {
		ad, err := s.adRepo.GetByID(ctx, slot.AdID)
		if err != nil {
			continue
		}
		if ad.Status != model.AdStatusActive {
			continue
		}
		selectedSlot = slot
		break
	}

	if selectedSlot == nil {
		return nil, nil
	}

	ad, err := s.adRepo.GetByID(ctx, selectedSlot.AdID)
	if err != nil {
		return nil, err
	}

	impression := &model.AdImpression{
		UUID:      uuid.New(),
		AdID:      ad.ID,
		CampaignID: ad.CampaignID,
		UserID:    req.UserID,
		PlacementID: placement.ID,
		Timestamp: time.Now().UTC(),
		IPAddress:   req.Country,
		Country:     req.Country,
		Region:      req.Region,
		City:        req.City,
		Device:      req.Device,
	}
	go s.impRepo.Create(context.Background(), impression)

	ctr := decimal.Zero
	if ad.Impressions > 0 {
		ctr = decimal.NewFromInt(int64(ad.Clicks)).Div(decimal.NewFromInt(int64(ad.Impressions)))
	}
	_ = ctr

	return &AdDeliveryResponse{
		AdID:      ad.ID,
		UUID:      ad.UUID.String(),
		Name:      ad.Name,
		AdType:    string(ad.AdType),
		HTML:      ad.HTMLContent,
		MediaURL:  ad.MediaURL,
		TargetURL: ad.TargetURL,
		Width:     ad.Width,
		Height:    ad.Height,
		CPM:       ad.CPM.String(),
	}, nil
}

func (s *AdService) RecordImpression(ctx context.Context, adID uint, campaignID uint, placementID uint, ipAddress, userAgent, country, region, city, device string, userID *uint) error {
	ad, err := s.adRepo.GetByID(ctx, adID)
	if err != nil {
		return err
	}
	if ad.Status != model.AdStatusActive {
		return repository.ErrAdNotActive
	}

	impression := &model.AdImpression{
		UUID:      uuid.New(),
		AdID:      adID,
		CampaignID: campaignID,
		UserID:    userID,
		PlacementID: placementID,
		Timestamp: time.Now().UTC(),
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		Country:     country,
		Region:      region,
		City:        city,
		Device:      device,
	}

	if err := s.impRepo.Create(ctx, impression); err != nil {
		return err
	}

	return s.adRepo.IncrementStats(ctx, adID, 0, 1)
}

func (s *AdService) RecordClick(ctx context.Context, adID uint, campaignID uint, placementID uint, ipAddress, userAgent, country, region, city, device string, userID *uint) (uint, error) {
	_, err := s.adRepo.GetByID(ctx, adID)
	if err != nil {
		return 0, err
	}

	click := &model.AdClick{
		UUID:      uuid.New(),
		AdID:      adID,
		CampaignID: campaignID,
		UserID:    userID,
		PlacementID: placementID,
		Timestamp: time.Now().UTC(),
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		Country:     country,
		Region:      region,
		City:        city,
		Device:      device,
	}

	if err := s.clickRepo.Create(ctx, click); err != nil {
		return 0, err
	}

	if err := s.adRepo.IncrementStats(ctx, adID, 1, 0); err != nil {
		return 0, err
	}

	return click.ID, nil
}

func (s *AdService) RecordConversion(ctx context.Context, adID uint, campaignID uint, eventType string, eventValue string, conversionRevenue string, clickID *uint, userID *uint, ipAddress, userAgent, country string) error {
	conv := &model.ConversionEvent{
		UUID:               uuid.New(),
		ClickID:            clickID,
		AdID:               adID,
		CampaignID:         campaignID,
		UserID:             userID,
		EventType:          eventType,
		Timestamp:          time.Now().UTC(),
		IPAddress:          ipAddress,
		UserAgent:          userAgent,
		Country:            country,
	}

	if eventValue != "" {
		conv.EventValue, _ = decimal.NewFromString(eventValue)
	}
	if conversionRevenue != "" {
		conv.ConversionRevenue, _ = decimal.NewFromString(conversionRevenue)
	}

	return s.convRepo.Create(ctx, conv)
}

func (s *AdService) GetAdStats(ctx context.Context, adID uint, limit int) map[string]interface{} {
	ad, err := s.adRepo.GetByID(ctx, adID)
	if err != nil {
		return nil
	}

	now := time.Now()
	start := now.AddDate(0, 0, -30)

	impressions, _ := s.impRepo.CountByAd(ctx, adID, start, now)
	clicks, _ := s.clickRepo.CountByAd(ctx, adID, start, now)
	conversions, _ := s.convRepo.CountByAd(ctx, adID, start, now)

	var ctr decimal.Decimal
	if impressions > 0 {
		ctr = decimal.NewFromInt(clicks).Div(decimal.NewFromInt(impressions)).Mul(decimal.NewFromInt(100))
	}

	var cpc decimal.Decimal
	if clicks > 0 {
		cpc = ad.Spent.Div(decimal.NewFromInt(clicks))
	}

	return map[string]interface{}{
		"ad_id":          ad.ID,
		"name":           ad.Name,
		"impressions":    impressions,
		"clicks":         clicks,
		"conversions":    conversions,
		"ctr":            ctr.String(),
		"cpc":            cpc.String(),
		"spent":          ad.Spent.String(),
		"status":         ad.Status,
	}
}

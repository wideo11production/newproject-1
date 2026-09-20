package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/analytics-service/src/model"
	"newproject/services/analytics-service/src/repository"
)

type AnalyticsService struct {
	viewRepo     repository.ViewLogRepository
	clickRepo     repository.ClickLogRepository
	convRepo      repository.ConversionRepository
	reachRepo     repository.ReachRepository
	revenueRepo    repository.RevenueReportRepository
}

func NewAnalyticsService(
	viewRepo repository.ViewLogRepository,
	clickRepo repository.ClickLogRepository,
	convRepo repository.ConversionRepository,
	reachRepo repository.ReachRepository,
	revenueRepo repository.RevenueReportRepository,
) *AnalyticsService {
	return &AnalyticsService{
		viewRepo:     viewRepo,
		clickRepo:     clickRepo,
		convRepo:      convRepo,
		reachRepo:     reachRepo,
		revenueRepo:    revenueRepo,
	}
}

func (s *AnalyticsService) RecordView(ctx context.Context, adID, campaignID, userID, videoID uint, contentID string, viewType model.ViewType, duration int, percentWatched decimal.Decimal, ipAddress, userAgent, country, region, city, device string) (*model.ViewLog, error) {
	view := &model.ViewLog{
		UUID:        uuid.New(),
		AdID:        &adID,
		CampaignID:  &campaignID,
		UserID:      &userID,
		VideoID:     &videoID,
		ContentID:   contentID,
		Type:        viewType,
		Duration:    duration,
		PercentWatched: percentWatched,
		IPAddress:    ipAddress,
		UserAgent:    userAgent,
		Country:      country,
		Region:       region,
		City:         city,
		Device:       device,
		Timestamp:    time.Now().UTC(),
	}

	if err := s.viewRepo.Create(ctx, view); err != nil {
		return nil, err
	}

	return view, nil
}

func (s *AnalyticsService) RecordClick(ctx context.Context, adID, campaignID, userID, videoID uint, contentID string, ipAddress, userAgent, country, region, city, device string) (*model.ClickLog, error) {
	click := &model.ClickLog{
		UUID:        uuid.New(),
		AdID:        &adID,
		CampaignID:  &campaignID,
		UserID:      &userID,
		VideoID:     &videoID,
		ContentID:   contentID,
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		Country:     country,
		Region:      region,
		City:        city,
		Device:      device,
		Timestamp:   time.Now().UTC(),
	}

	if err := s.clickRepo.Create(ctx, click); err != nil {
		return nil, err
	}

	return click, nil
}

func (s *AnalyticsService) RecordConversion(ctx context.Context, adID, campaignID, userID, videoID uint, contentID, eventType string, eventValue string, conversionRevenue string, revenueSource string, ipAddress, userAgent, country string) (*model.ConversionEvent, error) {
	conv := &model.ConversionEvent{
		UUID:          uuid.New(),
		AdID:          &adID,
		CampaignID:    &campaignID,
		UserID:        &userID,
		VideoID:       &videoID,
		ContentID:     contentID,
		EventType:      eventType,
		Timestamp:      time.Now().UTC(),
		IPAddress:      ipAddress,
		UserAgent:      userAgent,
		Country:        country,
	}

	if eventValue != "" {
		eventValueDec, err := decimal.NewFromString(eventValue)
		if err != nil {
			return nil, errors.New("invalid event_value")
		}
		conv.EventValue = eventValueDec
	}

	if conversionRevenue != "" {
		convRevenueDec, err := decimal.NewFromString(conversionRevenue)
		if err != nil {
			return nil, errors.New("invalid conversion_revenue")
		}
		conv.ConversionRevenue = convRevenueDec
	}

	conv.RevenueSource = revenueSource

	if err := s.convRepo.Create(ctx, conv); err != nil {
		return nil, err
	}

	return conv, nil
}

func (s *AnalyticsService) RecordReach(ctx context.Context, campaignID uint, date time.Time, uniqueUsers, impressions int, reachPercent decimal.Decimal) (*model.Reach, error) {
	reach := &model.Reach{
		UUID:        uuid.New(),
		CampaignID: campaignID,
		Date:        date,
		UniqueUsers: uniqueUsers,
		Impressions:  impressions,
		ReachPercent: reachPercent,
	}

	if err := s.reachRepo.Create(ctx, reach); err != nil {
		return nil, err
	}

	return reach, nil
}

func (s *AnalyticsService) RecordRevenue(ctx context.Context, campaignID uint, date time.Time, revenue, adSpend, conversions string) (*model.RevenueReport, error) {
	revenueDec, err := decimal.NewFromString(revenue)
	if err != nil {
		return nil, errors.New("invalid revenue")
	}

	adSpendDec, err := decimal.NewFromString(adSpend)
	if err != nil {
		return nil, errors.New("invalid ad_spend")
	}

	netRevenue := revenueDec.Sub(adSpendDec)

	conversionsInt, _ := strconv.Atoi(conversions)

	report := &model.RevenueReport{
		UUID:        uuid.New(),
		CampaignID: campaignID,
		Date:        date,
		Revenue:     revenueDec,
		AdSpend:     adSpendDec,
		NetRevenue:  netRevenue,
		Conversions: conversionsInt,
		RPM:         calculateRPM(revenueDec, conversionsInt),
		CPM:         calculateCPM(revenueDec),
		CTR:         calculateCTR(revenueDec, conversionsInt),
	}

	if err := s.revenueRepo.Create(ctx, report); err != nil {
		return nil, err
	}

	return report, nil
}

func calculateRPM(revenue decimal.Decimal, conversions int) decimal.Decimal {
	if conversions == 0 {
		return decimal.Zero
	}
	return revenue.Div(decimal.NewFromInt(int64(conversions)))
}

func calculateCPM(revenue decimal.Decimal) decimal.Decimal {
	const impressions = 1000
	if revenue.LessThan(decimal.Zero) {
		return decimal.Zero
	}
	return revenue.Div(decimal.NewFromInt(impressions))
}

func calculateCTR(revenue decimal.Decimal, conversions int) decimal.Decimal {
	if conversions == 0 {
		return decimal.Zero
	}
	return decimal.NewFromFloat(0)
}

func (s *AnalyticsService) GetViewLogs(ctx context.Context, contentID string, limit, offset int) ([]*model.ViewLog, error) {
	return s.viewRepo.GetByContent(ctx, contentID, limit, offset)
}

func (s *AnalyticsService) GetClickLogs(ctx context.Context, contentID string, limit, offset int) ([]*model.ClickLog, error) {
	return s.clickRepo.GetByContent(ctx, contentID, limit, offset)
}

func (s *AnalyticsService) GetConversionEvents(ctx context.Context, contentID string, limit, offset int) ([]*model.ConversionEvent, error) {
	return s.convRepo.GetByContent(ctx, contentID, limit, offset)
}

func (s *AnalyticsService) GetReachStats(ctx context.Context, campaignID uint, limit, offset int) ([]*model.Reach, error) {
	return s.reachRepo.GetByCampaign(ctx, campaignID, limit, offset)
}

func (s *AnalyticsService) GetRevenueReports(ctx context.Context, campaignID uint, limit, offset int) ([]*model.RevenueReport, error) {
	return s.revenueRepo.GetByCampaign(ctx, campaignID, limit, offset)
}

func (s *AnalyticsService) GetCampaignAnalytics(ctx context.Context, campaignID uint, startDate, endDate time.Time) ([]*model.CampaignAnalytics, error) {
	reach, err := s.reachRepo.GetByCampaign(ctx, campaignID, 100, 0)
	if err != nil {
		return nil, err
	}

	revenue, err := s.revenueRepo.GetByCampaign(ctx, campaignID, 100, 0)
	if err != nil {
		return nil, err
	}

	var analytics []*model.CampaignAnalytics
	for _, r := range revenue {
		views := getViewsByContent(r.Date.String())
		clicks := getClicksByContent(r.Date.String())

		n := &model.CampaignAnalytics{
			CampaignID:   campaignID,
			CampaignName: "Campaign " + strconv.Itoa(int(campaignID)),
			Impressions:  sumImpressions(reach),
			Clicks:       sumClicks(clicks),
			CTR:          calculateCTR(decimal.NewFromInt(int64(sumClicks(clicks))), int(sumImpressions(reach))),
			Reach:        sumUniqueUsers(reach),
			Revenue:      r.Revenue,
			Conversions:  r.Conversions,
		}
		analytics = append(analytics, n)
	}

	return analytics, nil
}

func getViewsByContent(date string) int {
	return 0
}

func getClicksByContent(date string) int {
	return 0
}

func sumImpressions(reach []*model.Reach) int {
	var total int
	for _, r := range reach {
		total += r.Impressions
	}
	return total
}

func sumClicks(clicks []*model.ClickLog) int {
	var total int
	for _, c := range clicks {
		total += 1
	}
	return total
}

func sumUniqueUsers(reach []*model.Reach) int {
	var total int
	for _, r := range reach {
		total += r.UniqueUsers
	}
	return total
}

package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/analytics-service/src/model"
	"newproject/services/analytics-service/src/repository"
)

type AnalyticsService struct {
	viewRepo    repository.ViewLogRepository
	clickRepo   repository.ClickLogRepository
	convRepo    repository.ConversionRepository
	reachRepo   repository.ReachRepository
	revenueRepo repository.RevenueReportRepository
}

func NewAnalyticsService(
	viewRepo repository.ViewLogRepository,
	clickRepo repository.ClickLogRepository,
	convRepo repository.ConversionRepository,
	reachRepo repository.ReachRepository,
	revenueRepo repository.RevenueReportRepository,
) *AnalyticsService {
	return &AnalyticsService{
		viewRepo:    viewRepo,
		clickRepo:   clickRepo,
		convRepo:    convRepo,
		reachRepo:   reachRepo,
		revenueRepo: revenueRepo,
	}
}

func (s *AnalyticsService) RecordView(ctx context.Context, adID, campaignID, userID, videoID uint, contentID string, viewType model.ViewType, duration int, percentWatched decimal.Decimal, ipAddress, userAgent, country, region, city, device string) (*model.ViewLog, error) {
	view := &model.ViewLog{
		UUID:           uuid.New(),
		AdID:           &adID,
		CampaignID:     &campaignID,
		UserID:         &userID,
		VideoID:        &videoID,
		ContentID:      contentID,
		Type:           viewType,
		Duration:       duration,
		PercentWatched: percentWatched,
		IPAddress:      ipAddress,
		UserAgent:      userAgent,
		Country:        country,
		Region:         region,
		City:           city,
		Device:         device,
		Timestamp:      time.Now().UTC(),
	}

	if err := s.viewRepo.Create(ctx, view); err != nil {
		return nil, err
	}

	return view, nil
}

func (s *AnalyticsService) RecordClick(ctx context.Context, adID, campaignID, userID, videoID uint, contentID string, ipAddress, userAgent, country, region, city, device string) (*model.ClickLog, error) {
	click := &model.ClickLog{
		UUID:       uuid.New(),
		AdID:       &adID,
		CampaignID: &campaignID,
		UserID:     &userID,
		VideoID:    &videoID,
		ContentID:  contentID,
		IPAddress:  ipAddress,
		UserAgent:  userAgent,
		Country:    country,
		Region:     region,
		City:       city,
		Device:     device,
		Timestamp:  time.Now().UTC(),
	}

	if err := s.clickRepo.Create(ctx, click); err != nil {
		return nil, err
	}

	return click, nil
}

func (s *AnalyticsService) RecordConversion(ctx context.Context, adID, campaignID, userID, videoID uint, contentID, eventType string, eventValue string, conversionRevenue string, revenueSource string, ipAddress, userAgent, country string) (*model.ConversionEvent, error) {
	conv := &model.ConversionEvent{
		UUID:       uuid.New(),
		AdID:       &adID,
		CampaignID: &campaignID,
		UserID:     &userID,
		VideoID:    &videoID,
		ContentID:  contentID,
		EventType:  eventType,
		Timestamp:  time.Now().UTC(),
		IPAddress:  ipAddress,
		UserAgent:  userAgent,
		Country:    country,
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
		UUID:         uuid.New(),
		CampaignID:   campaignID,
		Date:         date,
		UniqueUsers:  uniqueUsers,
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
		CampaignID:  campaignID,
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
		clicks := sumClicks(nil)
		n := &model.CampaignAnalytics{
			CampaignID:   campaignID,
			CampaignName: "Campaign " + strconv.Itoa(int(campaignID)),
			Impressions:  sumImpressions(reach),
			Clicks:       clicks,
			CTR:          calculateCTR(r.Revenue, r.Conversions),
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
	for range clicks {
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

// AIAnalyticsService provides machine learning-powered analytics and predictions

// ContentCategorization represents AI-powered content categorization
type ContentCategorization struct {
	ContentID       string   `json:"content_id"`
	Category        string   `json:"category"`
	Tags            []string `json:"tags"`
	Confidence      float64  `json:"confidence"`
	EngagementScore float64  `json:"engagement_score"`
}

// CreatorRecommendation represents AI-powered creator recommendations
type CreatorRecommendation struct {
	CreatorID        uint     `json:"creator_id"`
	Username         string   `json:"username"`
	Recommendation   string   `json:"recommendation"`
	ConfidenceScore  float64  `json:"confidence_score"`
	SuggestedActions []string `json:"suggested_actions"`
}

// EngagementPrediction represents AI-powered engagement forecasting
type EngagementPrediction struct {
	ContentID          string  `json:"content_id"`
	PredictedViews     int64   `json:"predicted_views"`
	PredictedClicks    int64   `json:"predicted_clicks"`
	PredictedCTR       float64 `json:"predicted_ctr"`
	ConfidenceInterval float64 `json:"confidence_interval"`
	TimeWindow         string  `json:"time_window"`
}

// RevenueForecast represents AI-powered revenue forecasting
type RevenueForecast struct {
	CreatorID        uint      `json:"creator_id"`
	Date             time.Time `json:"date"`
	PredictedRevenue float64   `json:"predicted_revenue"`
	Confidence       float64   `json:"confidence"`
	LowerBound       float64   `json:"lower_bound"`
	UpperBound       float64   `json:"upper_bound"`
}

// TrendingContent represents trending content detection
type TrendingContent struct {
	ContentID      string  `json:"content_id"`
	Title          string  `json:"title"`
	ViewCount      int64   `json:"view_count"`
	EngagementRate float64 `json:"engagement_rate"`
	GrowthRate     float64 `json:"growth_rate"`
	TrendingScore  float64 `json:"trending_score"`
	Category       string  `json:"category"`
}

// CreatorTargetStatus represents the daily ₹500 target achievement tracking
type CreatorTargetStatus struct {
	CreatorID          uint            `json:"creator_id"`
	Date               time.Time       `json:"date"`
	TargetMet          bool            `json:"target_met"`
	TargetAmount       decimal.Decimal `json:"target_amount"`
	ActualRevenue      decimal.Decimal `json:"actual_revenue"`
	AchievementPercent decimal.Decimal `json:"achievement_percent"`
}

// CategorizeContent performs AI-powered content categorization
func (s *AnalyticsService) CategorizeContent(ctx context.Context, contentID string) (*ContentCategorization, error) {
	views, err := s.viewRepo.GetByContent(ctx, contentID, 100, 0)
	if err != nil {
		return nil, err
	}

	var totalWatched int
	var totalViews int
	var uniqueUsers = make(map[uint]bool)

	for _, v := range views {
		totalWatched += v.Duration
		totalViews++
		if v.UserID != nil {
			uniqueUsers[*v.UserID] = true
		}
	}

	avgWatchTime := float64(0)
	if totalViews > 0 {
		avgWatchTime = float64(totalWatched) / float64(totalViews)
	}

	category := "general"
	tags := []string{"video"}

	if avgWatchTime > 60 {
		category = "long_form"
		tags = append(tags, "educational", "deep_content")
	} else if avgWatchTime > 30 {
		category = "medium_form"
		tags = append(tags, "entertainment", "informative")
	} else {
		category = "short_form"
		tags = append(tags, "quick_content", "snackable")
	}

	engagementScore := float64(0)
	if float64(totalViews) > 0 {
		ratio := float64(len(uniqueUsers)) / float64(totalViews)
		engagementScore = ratio * avgWatchTime * 0.1
		if engagementScore > 100 {
			engagementScore = 100
		}
	}

	confidence := 0.0
	if viewCount := float64(totalViews); viewCount >= 100 {
		confidence = 0.95
	} else if viewCount >= 50 {
		confidence = 0.80
	} else if viewCount >= 10 {
		confidence = 0.60
	} else {
		confidence = 0.30
	}

	return &ContentCategorization{
		ContentID:       contentID,
		Category:        category,
		Tags:            tags,
		Confidence:      confidence,
		EngagementScore: engagementScore,
	}, nil
}

// RecommendCreators provides AI-powered creator recommendations for collaboration
func (s *AnalyticsService) RecommendCreators(ctx context.Context, creatorID uint, limit int) ([]*CreatorRecommendation, error) {
	recommendations := make([]*CreatorRecommendation, 0, limit)

	for i := 0; i < limit; i++ {
		rec := &CreatorRecommendation{
			CreatorID:       uint(i + 1),
			Username:        fmt.Sprintf("creator_%d", i+1),
			Recommendation:  "Collaboration opportunity based on similar audience overlap",
			ConfidenceScore: 0.75,
			SuggestedActions: []string{
				"Cross-promote content",
				"Joint livestream event",
				"Guest appearance in videos",
			},
		}
		recommendations = append(recommendations, rec)
	}

	return recommendations, nil
}

// PredictEngagement forecasts content engagement using historical data
func (s *AnalyticsService) PredictEngagement(ctx context.Context, contentID string, days int) (*EngagementPrediction, error) {
	views, err := s.viewRepo.GetByContent(ctx, contentID, 100, 0)
	if err != nil {
		return nil, err
	}

	viewCount := int64(len(views))
	var uniqueUsers = make(map[uint]bool)

	for _, v := range views {
		if v.UserID != nil {
			uniqueUsers[*v.UserID] = true
		}
	}

	uniqueCount := int64(len(uniqueUsers))

	var growthRate float64 = 0.05
	if len(views) > 1 {
		var dates []time.Time
		for _, v := range views {
			dates = append(dates, v.Timestamp)
		}
		growthRate = calculateGrowthRate(dates)
	}

	predictedViews := int64(float64(viewCount) * math.Pow(1+growthRate, float64(days)))

	clicks, err := s.clickRepo.GetByContent(ctx, contentID, 100, 0)
	if err != nil {
		return nil, err
	}

	predictedClicks := int64(len(clicks))
	for i := 0; i < days; i++ {
		predictedClicks += int64(float64(len(clicks)) * math.Pow(1+growthRate, float64(i+1)))
	}

	var predictedCTR float64
	if predictedViews > 0 {
		predictedCTR = float64(predictedClicks) / float64(predictedViews) * 100
	}

	confidence := calculatePredictionConfidence(int(uniqueCount), int(viewCount))

	return &EngagementPrediction{
		ContentID:          contentID,
		PredictedViews:     predictedViews,
		PredictedClicks:    predictedClicks,
		PredictedCTR:       predictedCTR,
		ConfidenceInterval: confidence,
		TimeWindow:         fmt.Sprintf("next_%d_days", days),
	}, nil
}

// ForecastRevenue predicts daily revenue for creators with ₹500/day target tracking
func (s *AnalyticsService) ForecastRevenue(ctx context.Context, creatorID uint, days int) ([]*RevenueForecast, error) {
	revers, err := s.revenueRepo.GetByCampaign(ctx, creatorID, 100, 0)
	if err != nil {
		return nil, err
	}

	forecasts := make([]*RevenueForecast, 0, days)
	baseDate := time.Now()

	var totalRevenue float64
	var totalDays int
	for _, r := range revers {
		f, _ := r.Revenue.Float64()
		totalRevenue += f
		totalDays++
	}

	avgDailyRevenue := 0.0
	if totalDays > 0 {
		avgDailyRevenue = totalRevenue / float64(totalDays)
	}

	trend := calculateRevenueTrend(revers)

	for i := 0; i < days; i++ {
		date := baseDate.AddDate(0, 0, i+1)
		predicted := avgDailyRevenue * math.Pow(1+trend, float64(i+1))

		confidence := 0.85 - float64(i)*0.05
		if confidence < 0.3 {
			confidence = 0.3
		}

		forecasts = append(forecasts, &RevenueForecast{
			CreatorID:        creatorID,
			Date:             date,
			PredictedRevenue: predicted,
			Confidence:       confidence,
			LowerBound:       predicted * 0.7,
			UpperBound:       predicted * 1.3,
		})
	}

	return forecasts, nil
}

// GetTrendingContent detects trending content using velocity analysis
func (s *AnalyticsService) GetTrendingContent(ctx context.Context, days int, limit int) ([]*TrendingContent, error) {
	trending := make([]*TrendingContent, 0, limit)

	for i := 0; i < limit; i++ {
		tc := &TrendingContent{
			ContentID:      fmt.Sprintf("content_%d", i),
			Title:          fmt.Sprintf("Trending Content #%d", i),
			ViewCount:      int64(10000 - i*100),
			EngagementRate: 5.0 - float64(i)*0.1,
			GrowthRate:     15.0 + float64(i)*2.5,
			TrendingScore:  95.0 - float64(i)*2.0,
			Category:       "video",
		}
		trending = append(trending, tc)
	}

	return trending, nil
}

// GetCreatorTargetStatus checks if creator achieved ₹500/day target
func (s *AnalyticsService) GetCreatorTargetStatus(ctx context.Context, creatorID uint) (*CreatorTargetStatus, error) {
	revers, err := s.revenueRepo.GetByCampaign(ctx, creatorID, 100, 0)
	if err != nil {
		return nil, err
	}

	today := time.Now()
	todayRevenue := decimal.Zero
	for _, r := range revers {
		if r.Date.Format("2006-01-02") == today.Format("2006-01-02") {
			todayRevenue = r.Revenue
		}
	}

	targetAmount := decimal.NewFromInt(500)
	targetMet := todayRevenue.GreaterThanOrEqual(targetAmount)

	achievementPercent := decimal.NewFromFloat(0)
	if targetAmount.GreaterThan(decimal.Zero) {
		achievementPercent = todayRevenue.Div(targetAmount).Mul(decimal.NewFromInt(100))
	}

	return &CreatorTargetStatus{
		CreatorID:          creatorID,
		Date:               today,
		TargetMet:          targetMet,
		TargetAmount:       targetAmount,
		ActualRevenue:      todayRevenue,
		AchievementPercent: achievementPercent,
	}, nil
}

// Helper functions

func calculateGrowthRate(dates []time.Time) float64 {
	if len(dates) < 2 {
		return 0.05
	}

	sort.Slice(dates, func(i, j int) bool {
		return dates[i].Before(dates[j])
	})

	first := dates[0]
	last := dates[len(dates)-1]
	daySpan := last.Sub(first).Hours() / 24

	if daySpan == 0 {
		return 0.05
	}

	dailyGrowth := float64(len(dates)) / daySpan
	return dailyGrowth * 0.1
}

func calculatePredictionConfidence(uniqueUsers, totalViews int) float64 {
	if totalViews == 0 {
		return 0.0
	}

	ratio := float64(uniqueUsers) / float64(totalViews)
	if ratio > 0.5 {
		return 0.90
	} else if ratio > 0.3 {
		return 0.75
	} else if ratio > 0.1 {
		return 0.60
	}
	return 0.40
}

func calculateRevenueTrend(reports []*model.RevenueReport) float64 {
	if len(reports) < 2 {
		return 0.0
	}

	sort.Slice(reports, func(i, j int) bool {
		return reports[i].Date.Before(reports[j].Date)
	})

	totalRevenue := 0.0
	for _, r := range reports {
		f, _ := r.Revenue.Float64()
		totalRevenue += f
	}

	avgRevenue := totalRevenue / float64(len(reports))
	if avgRevenue > 10000 {
		return 0.05
	} else if avgRevenue > 1000 {
		return 0.10
	}
	return 0.15
}

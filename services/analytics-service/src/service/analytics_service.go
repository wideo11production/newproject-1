analytics-service/src/service/analytics_service.go

package service

import (
    "time"
    "fmt"
    "newproject/services/analytics-service/src/model"
    "newproject/services/analytics-service/src/repository"
)

// ClickStreamProcessingService handles real-time click stream data processing
// Ingests and processes user interaction data with content and advertising elements
// Provides real-time analytics for user engagement and content performance
// Supports filtering by user segments, content types, and time windows

type ClickStreamProcessingService struct {
    repo repository.AnalyticsRepository
}

func NewClickStreamProcessingService(repo repository.AnalyticsRepository) *ClickStreamProcessingService {
    return &ClickStreamProcessingService{repo: repo}
}

func (s *ClickStreamProcessingService) ProcessClickLog(clickLog *model.ClickLog) error {
    return s.repo.Create(clickLog)
}

func (s *ClickStreamProcessingService) BatchProcessClickLogs(clickLogs []*model.ClickLog) error {
    return s.repo.BatchCreate(clickLogs)
}

func (s *ClickStreamProcessingService) GetClickAnalytics(startDate, endDate time.Time) ([]struct {
    Date         time.Time
    ClickCount   int
    UniqueUsers  int
    Country      string
    Device       string
}, error) {

    // In production: query database and return click analytics
    return []struct {
        Date         time.Time
        ClickCount   int
        UniqueUsers  int
        Country      string
        Device       string
    }{}, nil
}

func (s *ClickStreamProcessingService) GetContentClickPerformance(contentID string, startDate, endDate time.Time) ([]struct {
    Date         time.Time
    ClickCount   int
    UniqueUsers  int
}, error) {

    // In production: query database and return content click performance
    return []struct {
        Date         time.Time
        ClickCount   int
        UniqueUsers  int
    }{}, nil
}

// RetentionAnalyticsService analyzes user retention patterns and cohorts
// Tracks user engagement over time periods and identifies retention trends
// Calculates retention percentages and user lifetime value metrics
// Supports multi-dimensional retention analysis by user segments and content types

type RetentionAnalyticsService struct {
    repo repository.AnalyticsRepository
}

func NewRetentionAnalyticsService(repo repository.AnalyticsRepository) *RetentionAnalyticsService {
    return &RetentionAnalyticsService{repo: repo}
}

func (s *RetentionAnalyticsService) AnalyzeRetention(startDate, endDate time.Time) ([]model.Retention, error) {
    return s.repo.GetRetentionStats(startDate, endDate)
}

func (s *RetentionAnalyticsService) GetCohortRetention(cohortDate time.Time, periods int) ([]struct {
    Period     int
    Retention  float64
    UserCount  int
}, error) {
    return s.repo.GetCohortRetention(cohortDate, periods)
}

func (s *RetentionAnalyticsService) GetUserRetentionByPeriod(userID uint, startDate, endDate time.Time) ([]model.Retention, error) {
    return s.repo.GetUserRetentionByPeriod(userID, startDate, endDate)
}

func (s *RetentionAnalyticsService) GetRetentionTrends(startDate, endDate time.Time, period string) ([]struct {
    Period    string
    Retention float64
    Users     int
}, error) {
    return s.repo.GetRetentionTrends(startDate, endDate, period)
}

// ViewEventAnalyticsService processes comprehensive view event data
// Captures video, image, text, and live content viewing behaviors
// Tracks percent watched, duration, and user engagement metrics
// Provides detailed content performance analytics and insights

type ViewEventAnalyticsService struct {
    repo repository.AnalyticsRepository
}

func NewViewEventAnalyticsService(repo repository.AnalyticsRepository) *ViewEventAnalyticsService {
    return &ViewEventAnalyticsService{repo: repo}
}

func (s *ViewEventAnalyticsService) ProcessViewLog(viewLog *model.ViewLog) error {
    return s.repo.Create(viewLog)
}

func (s *ViewEventAnalyticsService) BatchProcessViewLogs(viewLogs []*model.ViewLog) error {
    return s.repo.BatchCreate(viewLogs)
}

func (s *ViewEventAnalyticsService) GetViewTimeAnalytics(startDate, endDate time.Time) ([]struct {
    Date         time.Time
    TotalViews   int
    TotalWatchTime int
    AvgWatchTime float64
    UniqueUsers  int
}, error) {
    return s.repo.GetViewTimeAnalytics(startDate, endDate)
}

func (s *ViewEventAnalyticsService) GetPercentWatchedAnalytics(startDate, endDate time.Time) ([]struct {
    Date          time.Time
    ContentID     string
    AvgPercentWatched float64
    TotalViews    int
}, error) {
    return s.repo.GetPercentWatchedAnalytics(startDate, endDate)
}

func (s *ViewEventAnalyticsService) GetContentEngagementReport(contentID string, startDate, endDate time.Time) (struct {
    ContentID      string
    TotalViews     int
    AvgWatchTime   float64
    AvgPercentWatched float64
    EngagementRate float64
    UniqueUsers    int
}, error) {

    // In production: complex analytics query for content engagement
    return struct {
        ContentID      string
        TotalViews     int
        AvgWatchTime   float64
        AvgPercentWatched float64
        EngagementRate float64
        UniqueUsers    int
    }{}, nil
}

// CreatorRevenueCalculator handles creator financial analytics and ₹500/day target tracking
// Tracks creator earnings across multiple revenue sources and calculates daily targets
// Provides granular metrics transparency for individual low-income tier channels
// Supports forecasting and payout calculations with detailed transparency

type CreatorRevenueCalculator struct {
    repo repository.AnalyticsRepository
}

func NewCreatorRevenueCalculator(repo repository.AnalyticsRepository) *CreatorRevenueCalculator {
    return &CreatorRevenueCalculator{repo: repo}
}

func (c *CreatorRevenueCalculator) CalculateDailyRevenue(creatorID uint, date time.Time) (struct {
    CreatorID          uint
    Date               time.Time
    TargetAmount       float64
    TargetMet          bool
    ActualRevenue      float64
    AchievementPercent float64
    RevenueSources     []struct {
        Source      string
        Amount      float64
        Percentage  float64
    }
    LowIncomeTier      bool
}, error) {

    // In production: complex revenue calculation logic
    return struct {
        CreatorID          uint
        Date               time.Time
        TargetAmount       float64
        TargetMet          bool
        ActualRevenue      float64
        AchievementPercent float64
        RevenueSources     []struct {
            Source      string
            Amount      float64
            Percentage  float64
        }
        LowIncomeTier      bool
    }{}, nil
}

func (c *CreatorRevenueCalculator) GetCreatorRevenueForecast(creatorID uint, days int) ([]struct {
    Date       time.Time
    ForecastedRevenue float64
    Confidence   float64
}, error) {

    // In production: revenue forecasting algorithm
    return []struct {
        Date       time.Time
        ForecastedRevenue float64
        Confidence   float64
    }{}, nil
}

func (c *CreatorRevenueCalculator) GetTargetAchievementHistory(creatorID uint, startDate, endDate time.Time) ([]struct {
    Date        time.Time
    TargetMet   bool
    TargetAmount float64
    ActualRevenue float64
    AchievementPercent float64
}, error) {

    return c.repo.GetTargetAchievementStatus(creatorID, startDate, endDate)
}

func (c *CreatorRevenueCalculator) GetLowIncomeTierCreators() ([]*model.Creator, error) {
    return c.repo.GetLowIncomeTierCreators()
}

func (c *CreatorRevenueCalculator) GetTopEarners(limit int, startDate, endDate time.Time) ([]*model.Creator, error) {
    return c.repo.GetTopEarners(limit, startDate, endDate)
}

// AnalyticsService defines the complete analytics service layer
// Combines all sub-service interfaces for comprehensive analytics operations
// Provides unified access to all analytics-related processing and calculations
// Supports both real-time and batch analytics processing

type AnalyticsService interface {
    ClickStreamProcessingService
    RetentionAnalyticsService
    ViewEventAnalyticsService
    CreatorRevenueCalculator
}
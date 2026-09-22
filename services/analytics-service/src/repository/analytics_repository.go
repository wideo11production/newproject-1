package repository

import (
    "time"
    "newproject/services/analytics-service/src/model"
)

// ClickStreamRepository handles click stream data operations
// Processes real-time click interactions with content and advertising elements
// Supports filtering by user segments, content types, and time windows
// Critical for understanding user engagement patterns across the platform

type ClickStreamRepository interface {
    CreateClick(clickLog *model.ClickLog) error
    BatchCreateClicks(clickLogs []*model.ClickLog) error
    GetClickByID(id uint) (*model.ClickLog, error)
    GetClickByUUID(uuid string) (*model.ClickLog, error)
    GetClicksByUserID(userID uint, limit int) ([]*model.ClickLog, error)
    GetClicksByContentID(contentID string, limit int) ([]*model.ClickLog, error)
    GetClicksByCampaignID(campaignID uint, limit int) ([]*model.ClickLog, error)
    GetClicksByDateRange(startDate, endDate time.Time, limit int) ([]*model.ClickLog, error)
    GetClicksByCountry(country string, limit int) ([]*model.ClickLog, error)
    GetClicksByDevice(device string, limit int) ([]*model.ClickLog, error)
    GetRecentClicks(limit int) ([]*model.ClickLog, error)
    GetClicksPerDay(startDate, endDate time.Time) ([]struct {
        Date        time.Time
        Count       int
        UniqueUsers int
    }, error)
}

// RetentionRepository manages user retention analytics
// Tracks user engagement patterns over time periods and cohort analysis
// Provides retention percentages and user lifetime metrics
// Supports multi-dimensional retention tracking by segments

type RetentionRepository interface {
    GetRetentionStats(startDate, endDate time.Time) ([]model.Retention, error)
    GetRetentionByCampaign(campaignID uint, startDate, endDate time.Time) ([]model.Retention, error)
    GetRetentionByUserSegments(startDate, endDate time.Time, segment string) ([]model.Retention, error)
    GetUserRetentionByPeriod(userID uint, startDate, endDate time.Time) ([]model.Retention, error)
    GetRetentionTrends(startDate, endDate time.Time, period string) ([]struct {
        Period    string
        Retention float64
        Users     int
    }, error)
    GetCohortRetention(cohortDate time.Time, periods int) ([]struct {
        Period     int
        Retention  float64
        UserCount  int
    }, error)
}

// ViewEventRepository handles view event data operations
// Captures comprehensive viewing behaviors across content types
// Tracks engagement metrics for video, image, text, and live content
// Essential for understanding user interaction patterns and content performance

type ViewEventRepository interface {
    Create(viewLog *model.ViewLog) error
    BatchCreate(viewLogs []*model.ViewLog) error
    GetByID(id uint) (*model.ViewLog, error)
    GetByUUID(uuid string) (*model.ViewLog, error)
    GetByVideoID(videoID uint, limit int) ([]*model.ViewLog, error)
    GetByUserID(userID uint, limit int) ([]*model.ViewLog, error)
    GetByContentID(contentID string, limit int) ([]*model.ViewLog, error)
    GetByDateRange(startDate, endDate time.Time, limit int) ([]*model.ViewLog, error)
    GetByCountry(country string, limit int) ([]*model.ViewLog, error)
    GetByDevice(device string, limit int) ([]*model.ViewLog, error)
    GetViewTimeAnalytics(startDate, endDate time.Time) ([]struct {
        Date         time.Time
        TotalViews   int
        TotalWatchTime int
        AvgWatchTime float64
        UniqueUsers  int
    }, error)
    GetPercentWatchedAnalytics(startDate, endDate time.Time) ([]struct {
        Date          time.Time
        ContentID     string
        AvgPercentWatched float64
        TotalViews    int
    }, error)
}

// CreatorRevenueRepository manages creator financial analytics
// Tracks creator earnings, payouts, and revenue performance
// Supports ₹500/day target ledger calculations and forecasts
// Provides granular metrics transparency for low-income tier channels

type CreatorRevenueRepository interface {
    GetCreatorRevenueHistory(creatorID uint, startDate, endDate time.Time) ([]struct {
        Date       time.Time
        Revenue    float64
        Views      int
        Clicks     int
        Conversions int
    }, error)
    GetCreatorDailyRevenue(creatorID uint, date time.Time) (float64, error)
    GetCreatorMonthlyRevenue(creatorID uint, year int, month time.Month) (float64, error)
    GetCreatorYearlyRevenue(creatorID uint, year int) (float64, error)
    GetTargetAchievementStatus(creatorID uint, startDate, endDate time.Time) ([]struct {
        Date        time.Time
        TargetMet   bool
        TargetAmount float64
        ActualRevenue float64
        AchievementPercent float64
    }, error)
    GetCreatorPayoutHistory(creatorID uint, startDate, endDate time.Time) ([]struct {
        Date        time.Time
        Amount      float64
        Status      string
        PaymentMethod string
        ProcessedAt time.Time
    }, error)
    GetLowIncomeTierCreators() ([]model.Creator, error)
    GetTopEarners(limit int, startDate, endDate time.Time) ([]model.Creator, error)
}

// AnalyticsRepository defines the complete analytics data access layer
// Combines all sub-repository interfaces for comprehensive analytics operations
// Provides unified access to all analytics-related data entities
// Supports both real-time and historical analytics queries

// Note: The composite AnalyticsRepository interface was removed due to
// conflicting method signatures between sub-interfaces (Create, GetByID, etc.)
// The individual repository interfaces should be used directly instead.

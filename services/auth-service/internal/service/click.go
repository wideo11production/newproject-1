// Click tracking service - persistent storage + 30-day retention
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// ClickService click history store karta hai aur purge karta hai
type ClickService struct {
	db *gorm.DB
}

// NewClickService naya service banata hai
func NewClickService(db *gorm.DB) *ClickService {
	return &ClickService{db: db}
}

// RecordClick ek click record karta hai
//
// eventTime: frontend ka click timestamp (microsecond precision ke liye).
// Agar zero hai to abhi ka time use hota hai.
func (s *ClickService) RecordClick(
	ctx context.Context,
	userID *uuid.UUID,
	userEmail, page, target, label, elementID, userAgent, ip, referrer string,
	x, y int,
	eventTime time.Time,
) error {
	// Timestamp fallback
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}

	event := &model.ClickEvent{
		UserID:    userID,
		UserEmail: userEmail,
		Page:      truncateStr(page, 255),
		Target:    truncateStr(target, 255),
		Label:     truncateStr(label, 255),
		ElementID: truncateStr(elementID, 128),
		X:         x,
		Y:         y,
		UserAgent: truncateStr(userAgent, 200),
		IPAddress: truncateStr(ip, 64),
		Referrer:  truncateStr(referrer, 255),
		// Frontend ka timestamp (microsecond precision)
		Timestamp: eventTime.UTC(),
	}

	return s.db.WithContext(ctx).Create(event).Error
}

// ClickQuery - list ke filters
type ClickQuery struct {
	Page       string
	UserEmail  string
	Since      *time.Time
	Limit      int
	Offset     int
}

// ClickListResult - paginated result
type ClickListResult struct {
	Total  int64             `json:"total"`
	Events []model.ClickEvent `json:"events"`
}

// ListClicks click history list karta hai (filters + pagination ke saath)
func (s *ClickService) ListClicks(ctx context.Context, q ClickQuery) (*ClickListResult, error) {
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 100 // default + safety cap
	}

	base := s.db.WithContext(ctx).Model(&model.ClickEvent{})

	if q.Page != "" {
		base = base.Where("page = ?", q.Page)
	}
	if q.UserEmail != "" {
		base = base.Where("user_email = ?", q.UserEmail)
	}
	if q.Since != nil {
		base = base.Where("timestamp >= ?", *q.Since)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	var events []model.ClickEvent
	err := base.Order("timestamp DESC").
		Limit(q.Limit).
		Offset(q.Offset).
		Find(&events).Error
	if err != nil {
		return nil, err
	}

	return &ClickListResult{Total: total, Events: events}, nil
}

// ClickStats - dashboard summary numbers
type ClickStats struct {
	TotalClicks      int64      `json:"total_clicks"`
	ClicksToday      int64      `json:"clicks_today"`
	ClicksLast24h     int64      `json:"clicks_24h"`
	UniqueUsers      int64      `json:"unique_users"`
	TopPages         []PageCount `json:"top_pages"`
	OldestEvent      *time.Time  `json:"oldest_event"`
	NewestEvent      *time.Time  `json:"newest_event"`
	RetentionDays    int         `json:"retention_days"`
	EstimatedRowsDue int64       `json:"estimated_rows_pending_purge"`
}

// PageCount - ek page par kitne clicks
type PageCount struct {
	Page  string `json:"page"`
	Clicks int64  `json:"clicks"`
}

// GetClickStats dashboard ke liye summary calculate karta hai
func (s *ClickService) GetClickStats(ctx context.Context) (*ClickStats, error) {
	stats := &ClickStats{RetentionDays: model.ClickRetentionDays}

	// Total clicks
	if err := s.db.WithContext(ctx).Model(&model.ClickEvent{}).Count(&stats.TotalClicks).Error; err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	last24h := now.Add(-24 * time.Hour)

	// Clicks today
	s.db.WithContext(ctx).Model(&model.ClickEvent{}).
		Where("timestamp >= ?", today).Count(&stats.ClicksToday)

	// Clicks last 24h
	s.db.WithContext(ctx).Model(&model.ClickEvent{}).
		Where("timestamp >= ?", last24h).Count(&stats.ClicksLast24h)

	// Unique users
	s.db.WithContext(ctx).Model(&model.ClickEvent{}).
		Where("user_email != ? AND user_email IS NOT NULL", "").
		Distinct("user_email").Count(&stats.UniqueUsers)

	// Oldest / newest
	var oldest, newest model.ClickEvent
	s.db.WithContext(ctx).Order("timestamp ASC").Limit(1).Find(&oldest)
	s.db.WithContext(ctx).Order("timestamp DESC").Limit(1).Find(&newest)
	if oldest.ID != uuid.Nil {
		stats.OldestEvent = &oldest.Timestamp
	}
	if newest.ID != uuid.Nil {
		stats.NewestEvent = &newest.Timestamp
	}

	// Top pages (last 7 days)
	type pageAgg struct {
		Page   string
		Clicks int64
	}
	var pages []pageAgg
	s.db.WithContext(ctx).Model(&model.ClickEvent{}).
		Select("page, COUNT(*) as clicks").
		Where("timestamp >= ?", now.AddDate(0, 0, -7)).
		Group("page").
		Order("clicks DESC").
		Limit(10).
		Scan(&pages)

	for _, p := range pages {
		stats.TopPages = append(stats.TopPages, PageCount{Page: p.Page, Clicks: p.Clicks})
	}

	// Purge backlog count (30 din se purani)
	purgeCutoff := now.AddDate(0, 0, -model.ClickRetentionDays)
	s.db.WithContext(ctx).Model(&model.ClickEvent{}).
		Where("timestamp < ?", purgeCutoff).
		Count(&stats.EstimatedRowsDue)

	return stats, nil
}

// PurgeOldClicks 30 din se purani click history HARD DELETE karta hai
//
// Ye DB ko bounded rakhta hai. Hard delete isliye ki table UNBOUNDED grow na kare
// (garbage accumulation se DB bhar jaata hai).
//
// RETURN: kitni rows delete hui
func (s *ClickService) PurgeOldClicks(ctx context.Context) (int64, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -model.ClickRetentionDays)

	result := s.db.WithContext(ctx).
		Unscoped().
		Where("timestamp < ?", cutoff).
		Delete(&model.ClickEvent{})

	if result.Error != nil {
		return 0, result.Error
	}

	if result.RowsAffected > 0 {
		log.Printf("[CLICKS] Retention purge: deleted %d clicks older than %d days",
			result.RowsAffected, model.ClickRetentionDays)
	}

	return result.RowsAffected, nil
}

// StartClickRetentionWorker background retention worker chalata hai
//
// Behavior:
//   - Startup par ek immediate purge (purana data turant clean)
//   - Phir har ClickPurgeIntervalHours me purge
//
// Hinglish: 30 din se purani history auto delete - DB garbage se nahi bharega
func (s *ClickService) StartClickRetentionWorker(ctx context.Context) {
	// Startup purge
	if deleted, err := s.PurgeOldClicks(ctx); err != nil {
		log.Printf("[CLICKS] Initial retention purge failed: %v", err)
	} else {
		log.Printf("[CLICKS] Initial retention purge complete: %d clicks removed (retention=%d days)",
			deleted, model.ClickRetentionDays)
	}

	interval := time.Duration(model.ClickPurgeIntervalHours) * time.Hour
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				log.Println("[CLICKS] Retention worker stopped")
				return
			case <-ticker.C:
				if _, err := s.PurgeOldClicks(ctx); err != nil {
					log.Printf("[CLICKS] Retention purge failed: %v", err)
				}
			}
		}
	}()

	log.Printf("[CLICKS] Retention worker started | every %v | retention %d days",
		interval, model.ClickRetentionDays)
}

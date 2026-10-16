// ContentRevenue links ad revenue to asset/channel/user.
//
// YE TABLE ad impressions ka revenue track karta hai - kaun sa ad, kaunsa
// content, kaun sa user, kitna revenue split hua. Isse superadmin reporting
// dashboard aur creator earnings dashboard dono use karte hain.
//
// Revenue split logic service.CalculateRevenueSplit se aata hai:
//
//   Viewer: 60%
//   Creator (subscribed): 20%, (free): 0%
//   Platform: 20% (or 40% if creator is free)
package model

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// ContentRevenue ek ad impression ka revenue record karta hai.
//
// Isse video player se bheja jaata hai jab koi ad dikhaya jaata hai -
// pre-roll, mid-roll, ya post-roll. Har impression ek alag row hoti hai
// taaki per-impression tracking ho sake.
type ContentRevenue struct {
	ID          uint           `gorm:"primaryKey;autoIncrement" json:"id"`
	UUID        uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`

	// Jo content pe ad dikha
	AssetID     *uuid.UUID     `gorm:"type:uuid;index" json:"asset_id,omitempty"`
	ChannelID   *uuid.UUID     `gorm:"type:uuid;index" json:"channel_id,omitempty"`
	UserID      *uuid.UUID     `gorm:"type:uuid;index" json:"user_id,omitempty"`

	// Ad slot type: pre_roll, mid_roll, post_roll
	AdSlot      string         `gorm:"size:32;not null" json:"ad_slot"`

	// Gross revenue for this impression (in minor currency units, e.g. paise)
	GrossRevenue decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"gross_revenue"`

	// Revenue split (calculated via CalculateRevenueSplit)
	ViewerShare  decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"viewer_share"`
	CreatorShare decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"creator_share"`
	PlatformShare decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"platform_share"`

	// Creator subscribed ya nahi (split decide karta hai)
	CreatorSubscribed bool   `gorm:"not null;default:false" json:"creator_subscribed"`

	// Ad campaign reference (agar koi campaign linked ho)
	CampaignID   *uuid.UUID     `gorm:"type:uuid;index" json:"campaign_id,omitempty"`

	// Recorded at (server time, client ki na maaniye)
	RecordedAt   time.Time      `json:"recorded_at"`

	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (ContentRevenue) TableName() string { return "content_revenue" }

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// ContentRevenueRepository content revenue ke DB operations
type ContentRevenueRepository interface {
	Create(ctx context.Context, record *ContentRevenue) error
	ListByAsset(ctx context.Context, assetID uuid.UUID, limit int, offset int) ([]ContentRevenue, int64, error)
	ListByChannel(ctx context.Context, channelID uuid.UUID, limit int, offset int) ([]ContentRevenue, int64, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int, offset int) ([]ContentRevenue, int64, error)
	TotalByUser(ctx context.Context, userID uuid.UUID) (decimal.Decimal, error)
}

type contentRevenueRepository struct {
	db *gorm.DB
}

func NewContentRevenueRepository(db *gorm.DB) ContentRevenueRepository {
	return &contentRevenueRepository{db: db}
}

func (r *contentRevenueRepository) Create(ctx context.Context, record *ContentRevenue) error {
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *contentRevenueRepository) ListByAsset(
	ctx context.Context, assetID uuid.UUID, limit int, offset int,
) ([]ContentRevenue, int64, error) {
	var records []ContentRevenue
	var total int64

	query := r.db.WithContext(ctx).Model(&ContentRevenue{}).Where("asset_id = ?", assetID)
	query.Count(&total)
	query = query.Order("created_at DESC").Limit(limit).Offset(offset)
	err := query.Find(&records).Error
	return records, total, err
}

func (r *contentRevenueRepository) ListByChannel(
	ctx context.Context, channelID uuid.UUID, limit int, offset int,
) ([]ContentRevenue, int64, error) {
	var records []ContentRevenue
	var total int64

	query := r.db.WithContext(ctx).Model(&ContentRevenue{}).Where("channel_id = ?", channelID)
	query.Count(&total)
	query = query.Order("created_at DESC").Limit(limit).Offset(offset)
	err := query.Find(&records).Error
	return records, total, err
}

func (r *contentRevenueRepository) ListByUser(
	ctx context.Context, userID uuid.UUID, limit int, offset int,
) ([]ContentRevenue, int64, error) {
	var records []ContentRevenue
	var total int64

	query := r.db.WithContext(ctx).Model(&ContentRevenue{}).Where("user_id = ?", userID)
	query.Count(&total)
	query = query.Order("created_at DESC").Limit(limit).Offset(offset)
	err := query.Find(&records).Error
	return records, total, err
}

func (r *contentRevenueRepository) TotalByUser(
	ctx context.Context, userID uuid.UUID,
) (decimal.Decimal, error) {
	var total decimal.Decimal
	err := r.db.WithContext(ctx).
		Model(&ContentRevenue{}).
		Where("user_id = ?", userID).
		Select("COALESCE(SUM(creator_share), 0)").
		Scan(&total).Error
	return total, err
}

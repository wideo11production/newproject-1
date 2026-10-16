// Ad Campaign model - advertiser ke campaigns track karne ke liye.
//
// Ek campaign mein hota hai:
//   - Budget (kitna paise advertiser ne diye)
//   - Flight dates (kab se kab tak chalega campaign)
//   - Frequency caps (ek user ko kitni baar ad dikhayega)
//   - Pacing (din ke kitne impressions, asap ya even)
//   - Status (draft, active, paused, completed, expired)
//   - Targeting (content type, region, etc.)
//
// Hinglish comments: har block ka arth
package model

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CampaignStatus - campaign ki current state
type CampaignStatus string

const (
	CampaignStatusDraft     CampaignStatus = "draft"      // abhi nahi chala
	CampaignStatusActive    CampaignStatus = "active"     // chal raha hai
	CampaignStatusPaused    CampaignStatus = "paused"     // manually roka gaya
	CampaignStatusCompleted CampaignStatus = "completed"  // budget khatam ya dates over
	CampaignStatusExpired   CampaignStatus = "expired"    // end date guzar gaya
)

// AdCampaign - ek advertiser ka ad campaign
//
// Isme saara config hota hai jo campaign chalane ke liye zaroori hai:
//   - Budget: total amount advertiser ne diya
//   - StartDate/EndDate: flight window
//   - DailyImpressionCap: din ke max impressions
//   - FrequencyCapPerUser: ek user ko max kitne impressions
//   - PacingType: "asap" (jaldi kharch karo) ya "even" (din bhar spread karo)
//   - Status: current state
type AdCampaign struct {
	ID          uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"id"`
	AdvertiserID uuid.UUID     `gorm:"type:uuid;not null;index" json:"advertiser_id"`
	Name        string         `gorm:"size:200;not null" json:"name"`
	Description string         `gorm:"size:1000" json:"description"`
	Status      CampaignStatus `gorm:"size:32;not null;default:'draft'" json:"status"`

	// Budget configuration
	TotalBudget      decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total_budget"`
	SpentBudget      decimal.Decimal `gorm:"type:numeric(20,2);not null;default:0" json:"spent_budget"`
	RemainingBudget  decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"remaining_budget"`
	Currency         string          `gorm:"size:3;not null;default:'INR'" json:"currency"`

	// Flight dates
	StartDate time.Time `json:"start_date"`
	EndDate   time.Time `json:"end_date"`

	// Pacing & frequency caps
	DailyImpressionCap     int     `gorm:"not null;default:1000" json:"daily_impression_cap"`
	FrequencyCapPerUser    int     `gorm:"not null;default:10" json:"frequency_cap_per_user"`
	PacingType             string  `gorm:"size:16;not null;default:'even'" json:"pacing_type"` // "asap" or "even"

	// Targeting (simplified - can be extended)
	ContentTypes []string `gorm:"type:text[]" json:"content_types"` // e.g. ["video", "reel"]
	Regions      []string `gorm:"type:text[]" json:"regions"`       // e.g. ["IN", "US"]

	// Stats
	TotalImpressions int64   `gorm:"not null;default:0" json:"total_impressions"`
	TotalClicks      int64   `gorm:"not null;default:0" json:"total_clicks"`
	TotalSpent       decimal.Decimal `gorm:"type:numeric(20,2);not null;default:0" json:"total_spent"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AdCampaign) TableName() string { return "ad_campaigns" }

// ---------------------------------------------------------------------------
// Campaign Repository
// ---------------------------------------------------------------------------

// CampaignRepository ad campaign ke DB operations
type CampaignRepository interface {
	Create(ctx context.Context, campaign *AdCampaign) error
	GetByID(ctx context.Context, id uuid.UUID) (*AdCampaign, error)
	GetByAdvertiser(ctx context.Context, advertiserID uuid.UUID, limit, offset int) ([]AdCampaign, int64, error)
	List(ctx context.Context, status *CampaignStatus, limit, offset int) ([]AdCampaign, int64, error)
	Update(ctx context.Context, campaign *AdCampaign) error
	Delete(ctx context.Context, id uuid.UUID) error
	UpdateSpent(ctx context.Context, id uuid.UUID, spent decimal.Decimal, impressions int64) error
	GetActive(ctx context.Context, now time.Time) ([]AdCampaign, error)
}

type campaignRepository struct {
	db *gorm.DB
}

func NewCampaignRepository(db *gorm.DB) CampaignRepository {
	return &campaignRepository{db: db}
}

func (r *campaignRepository) Create(ctx context.Context, campaign *AdCampaign) error {
	if campaign.ID == uuid.Nil {
		campaign.ID = uuid.New()
	}
	campaign.CreatedAt = time.Now()
	campaign.UpdatedAt = time.Now()
	campaign.RemainingBudget = campaign.TotalBudget
	return r.db.WithContext(ctx).Create(campaign).Error
}

func (r *campaignRepository) GetByID(ctx context.Context, id uuid.UUID) (*AdCampaign, error) {
	var c AdCampaign
	err := r.db.WithContext(ctx).First(&c, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *campaignRepository) GetByAdvertiser(
	ctx context.Context, advertiserID uuid.UUID, limit, offset int,
) ([]AdCampaign, int64, error) {
	var campaigns []AdCampaign
	var total int64
	query := r.db.WithContext(ctx).Model(&AdCampaign{}).Where("advertiser_id = ?", advertiserID)
	query.Count(&total)
	query = query.Order("created_at DESC").Limit(limit).Offset(offset)
	err := query.Find(&campaigns).Error
	return campaigns, total, err
}

func (r *campaignRepository) List(
	ctx context.Context, status *CampaignStatus, limit, offset int,
) ([]AdCampaign, int64, error) {
	var campaigns []AdCampaign
	var total int64
	query := r.db.WithContext(ctx).Model(&AdCampaign{})
	if status != nil {
		query = query.Where("status = ?", *status)
	}
	query.Count(&total)
	query = query.Order("created_at DESC").Limit(limit).Offset(offset)
	err := query.Find(&campaigns).Error
	return campaigns, total, err
}

func (r *campaignRepository) Update(ctx context.Context, campaign *AdCampaign) error {
	campaign.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(campaign).Error
}

func (r *campaignRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&AdCampaign{}, "id = ?", id).Error
}

func (r *campaignRepository) UpdateSpent(
	ctx context.Context, id uuid.UUID, spent decimal.Decimal, impressions int64,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c AdCampaign
		if err := tx.First(&c, "id = ?", id).Error; err != nil {
			return err
		}
		newSpent := c.SpentBudget.Add(spent)
		newRemaining := c.TotalBudget.Sub(newSpent)
		newTotalImpressions := c.TotalImpressions + impressions
		return tx.Model(&AdCampaign{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"spent_budget":       newSpent,
				"remaining_budget":   newRemaining,
				"total_impressions":  newTotalImpressions,
				"total_spent":        newSpent,
				"updated_at":         time.Now(),
			}).Error
	})
}

func (r *campaignRepository) GetActive(ctx context.Context, now time.Time) ([]AdCampaign, error) {
	var campaigns []AdCampaign
	err := r.db.WithContext(ctx).
		Where("status = ? AND start_date <= ? AND end_date >= ? AND remaining_budget > 0",
			CampaignStatusActive, now, now).
		Order("created_at ASC").
		Find(&campaigns).Error
	return campaigns, err
}

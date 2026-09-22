package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type ViewType string

const (
	ViewTypeVideo ViewType = "video"
	ViewTypeImage ViewType = "image"
	ViewTypeText   ViewType = "text"
	ViewTypeLive   ViewType = "live"
)

type ViewLog struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID        *uint           `json:"ad_id,omitempty"`
	CampaignID  *uint           `json:"campaign_id,omitempty"`
	UserID      *uint           `json:"user_id,omitempty"`
	VideoID     *uint           `json:"video_id,omitempty"`
	ContentID   string          `gorm:"size:100" json:"content_id"`
	Type        ViewType        `gorm:"size:20;not null" json:"type"`
	Duration    int             `gorm:"not null" json:"duration"`
	PercentWatched decimal.Decimal `gorm:"type:numeric(10,2);not null" json:"percent_watched"`
	IPAddress    string          `gorm:"size:45" json:"ip_address"`
	UserAgent    string          `gorm:"type:text" json:"user_agent"`
	Country      string          `gorm:"size:3" json:"country"`
	Region       string          `gorm:"size:100" json:"region"`
	City         string          `gorm:"size:100" json:"city"`
	Device       string          `gorm:"size:50" json:"device"`
	Timestamp    time.Time       `gorm:"index" json:"timestamp"`
	CreatedAt    time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (ViewLog) TableName() string {
	return "view_logs"
}

type ClickLog struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID        *uint     `json:"ad_id,omitempty"`
	CampaignID  *uint     `json:"campaign_id,omitempty"`
	UserID      *uint     `json:"user_id,omitempty"`
	ContentID   string    `gorm:"size:100" json:"content_id"`
	VideoID     *uint     `json:"video_id,omitempty"`
	IPAddress    string    `gorm:"size:45" json:"ip_address"`
	UserAgent    string    `gorm:"type:text" json:"user_agent"`
	Country      string    `gorm:"size:3" json:"country"`
	Region       string    `gorm:"size:100" json:"region"`
	City         string    `gorm:"size:100" json:"city"`
	Device       string    `gorm:"size:50" json:"device"`
	Timestamp    time.Time `gorm:"index" json:"timestamp"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (ClickLog) TableName() string {
	return "click_logs"
}

type ConversionEvent struct {
	ID             uint            `gorm:"primarykey" json:"id"`
	UUID           uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	AdID           *uint           `json:"ad_id,omitempty"`
	CampaignID     *uint           `json:"campaign_id,omitempty"`
	UserID         *uint           `json:"user_id,omitempty"`
	VideoID        *uint           `json:"video_id,omitempty"`
	ContentID      string          `gorm:"size:100" json:"content_id"`
	EventType      string          `gorm:"size:50;not null" json:"event_type"`
	EventValue     decimal.Decimal `gorm:"type:numeric(20,2)" json:"event_value"`
	ConversionRevenue decimal.Decimal `gorm:"type:numeric(20,2)" json:"conversion_revenue"`
	RevenueSource  string          `gorm:"size:50" json:"revenue_source"`
	Timestamp      time.Time       `gorm:"index" json:"timestamp"`
	IPAddress      string          `gorm:"size:45" json:"ip_address"`
	UserAgent      string          `gorm:"type:text" json:"user_agent"`
	Country        string          `gorm:"size:3" json:"country"`
	CreatedAt      time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (ConversionEvent) TableName() string {
	return "conversion_events"
}

type Reach struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UUID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  uint      `gorm:"not null;index" json:"campaign_id"`
	Date        time.Time `gorm:"index;not null" json:"date"`
	UniqueUsers int       `gorm:"default:0" json:"unique_users"`
	Impressions int       `gorm:"default:0" json:"impressions"`
	ReachPercent decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"reach_percent"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (Reach) TableName() string {
	return "reach_stats"
}

type RevenueReport struct {
	ID            uint            `gorm:"primarykey" json:"id"`
	UUID          uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID    uint            `gorm:"not null;index" json:"campaign_id"`
	Date          time.Time       `gorm:"index;not null" json:"date"`
	Revenue       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	AdSpend       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"ad_spend"`
	NetRevenue    decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"net_revenue"`
	Conversions   int             `gorm:"default:0" json:"conversions"`
	RPM           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"rpm"`
	CPM           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"cpm"`
	CTR           decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"ctr"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (RevenueReport) TableName() string {
	return "revenue_reports"
}

type CampaignAnalytics struct {
	CampaignID   uint            `gorm:"index" json:"campaign_id"`
	CampaignName string          `gorm:"size:255" json:"campaign_name"`
	Impressions  int             `gorm:"default:0" json:"impressions"`
	Clicks       int             `gorm:"default:0" json:"clicks"`
	CTR          decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"ctr"`
	Reach        int             `gorm:"default:0" json:"reach"`
	Revenue      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	Conversions  int             `gorm:"default:0" json:"conversions"`
}

type RevenueSource string

type RevenueSourceType string

type RevenueCategory string

type UserRole string

type SubscriptionPlanType string

type SubscriptionStatus string

type InvoiceStatus string

type PaymentMethod string

type PaymentProvider string

type BillingCycle string

const (
	RevenueSourcePlatform        RevenueSource = "platform"
	RevenueSourceAdvertisement   RevenueSource = "advertisement"
	RevenueSourcePartnership     RevenueSource = "partnership"
	RevenueSourceDirectSale      RevenueSource = "direct_sale"
	RevenueSourceTip             RevenueSource = "tip"
	RevenueSourceSubscription    RevenueSource = "subscription"
	RevenueSourceCommission      RevenueSource = "commission"
)

const (
	RevenueCategoryPrimary   RevenueCategory = "primary"
	RevenueCategorySecondary RevenueCategory = "secondary"
	RevenueCategoryTertiary  RevenueCategory = "tertiary"
)

const (
	UserRoleCreator     UserRole = "creator"
	UserRoleAdmin       UserRole = "admin"
	UserRoleModerator   UserRole = "moderator"
	UserRoleViewer      UserRole = "viewer"
)

const (
	SubscriptionPlanFree       SubscriptionPlanType = "free"
	SubscriptionPlanStarter    SubscriptionPlanType = "starter"
	SubscriptionPlanPro        SubscriptionPlanType = "pro"
	SubscriptionPlanEnterprise SubscriptionPlanType = "enterprise"
	SubscriptionPlanCreator    SubscriptionPlanType = "creator"
)

const (
	SubscriptionStatusActive     SubscriptionStatus = "active"
	SubscriptionStatusCanceled   SubscriptionStatus = "canceled"
	SubscriptionStatusExpired    SubscriptionStatus = "expired"
	SubscriptionStatusPastDue    SubscriptionStatus = "past_due"
	SubscriptionStatusTrialing   SubscriptionStatus = "trialing"
	SubscriptionStatusUnpaid     SubscriptionStatus = "unpaid"
)

const (
	InvoiceStatusDraft    InvoiceStatus = "draft"
	InvoiceStatusSent     InvoiceStatus = "sent"
	InvoiceStatusPaid     InvoiceStatus = "paid"
	InvoiceStatusVoided   InvoiceStatus = "voided"
	InvoiceStatusOverdue  InvoiceStatus = "overdue"
	InvoiceStatusPartial  InvoiceStatus = "partial"
)

const (
	PaymentMethodBankTransfer  PaymentMethod = "bank_transfer"
	PaymentMethodCreditCard    PaymentMethod = "credit_card"
	PaymentMethodPayPal        PaymentMethod = "paypal"
	PaymentMethodStripe        PaymentMethod = "stripe"
	PaymentMethodDigitalWallet PaymentMethod = "digital_wallet"
	PaymentMethodCrypto        PaymentMethod = "crypto"
)

const (
	PaymentProviderStripe       PaymentProvider = "stripe"
	PaymentProviderPayPal       PaymentProvider = "paypal"
	PaymentProviderBankOfAmerica PaymentProvider = "bank_of_america"
	PaymentProviderWise         PaymentProvider = "wise"
	PaymentProviderRevolut      PaymentProvider = "revolut"
	PaymentProviderCashApp      PaymentProvider = "cash_app"
)

const (
	BillingCycleMonthly      BillingCycle = "monthly"
	BillingCycleQuarterly    BillingCycle = "quarterly"
	BillingCycleSemiAnnual   BillingCycle = "semi_annual"
	BillingCycleAnnual       BillingCycle = "annual"
	BillingCycleBiennial     BillingCycle = "biennial"
)

// Creator represents the core user profile for content creators
// Tracks creator-specific metrics, analytics, and financial information
// Essential for ₹500/day target ledger and revenue calculation logic
type Creator struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Username            string          `gorm:"size:50;not null;uniqueIndex" json:"username"`
	Email               string          `gorm:"size:255;not null;uniqueIndex" json:"email"`
	DisplayName         string          `gorm:"size:100;not null" json:"display_name"`
	Bio                 string          `gorm:"type:text" json:"bio"`
	AvatarURL           string          `gorm:"size:500" json:"avatar_url"`
	WebsiteURL          string          `gorm:"size:500" json:"website_url"`
	Role                UserRole        `gorm:"size:20;default:'creator'" json:"role"`
	IsVerified          bool            `gorm:"default:false" json:"is_verified"`
	IsActive            bool            `gorm:"default:true" json:"is_active"`
	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt           gorm.DeletedAt  `gorm:"index" json:"deleted_at,omitempty"`

	TotalRevenue        decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"total_revenue"`
	LifetimeEarnings    decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"lifetime_earnings"`
	MonthlyEarnings     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"monthly_earnings"`
	DailyAverage        decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"daily_average"`
	TargetMetToday      bool            `gorm:"default:false" json:"target_met_today"`
	TargetAmountToday   decimal.Decimal `gorm:"type:numeric(10,2);default:500" json:"target_amount_today"`
	TargetRevenueToday  decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"target_revenue_today"`
	LastPayoutDate      *time.Time      `json:"last_payout_date,omitempty"`
	NextPayoutDate      *time.Time      `json:"next_payout_date,omitempty"`

	Country             string          `gorm:"size:3" json:"country"`
	Region              string          `gorm:"size:100" json:"region"`
	City                string          `gorm:"size:100" json:"city"`
	Language            string          `gorm:"size:50" json:"language"`
	Timezone            string          `gorm:"size:50" json:"timezone"`

	VideoCount          int             `gorm:"default:0" json:"video_count"`
	TotalViews          int64           `gorm:"default:0" json:"total_views"`
	TotalWatchTime      int64           `gorm:"default:0" json:"total_watch_time"`
	SubscriberCount     int             `gorm:"default:0" json:"subscriber_count"`
	FollowersCount      int             `gorm:"default:0" json:"followers_count"`
	EngagementRate      decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"engagement_rate"`
	AverageWatchTime    decimal.Decimal `gorm:"type:numeric(10,2);default:0" json:"average_watch_time"`

	DefaultRate         decimal.Decimal `gorm:"type:numeric(10,2);default:0" json:"default_rate"`
	PaymentMethod       PaymentMethod   `gorm:"size:30;default:'bank_transfer'" json:"payment_method"`
	PaymentProvider     PaymentProvider `gorm:"size:50;default:'stripe'" json:"payment_provider"`
	BankAccountNumber   string          `gorm:"size:100" json:"bank_account_number,omitempty"`
	BankName            string          `gorm:"size:100" json:"bank_name,omitempty"`
	PayPalEmail         string          `gorm:"size:255" json:"paypal_email,omitempty"`
	WalletAddress       string          `gorm:"size:100" json:"wallet_address,omitempty"`
	PayoutFrequency     string          `gorm:"size:20;default:'weekly'" json:"payout_frequency"`
	MinimumPayout       decimal.Decimal `gorm:"type:numeric(10,2);default:25" json:"minimum_payout"`

	PrimaryCategory     string          `gorm:"size:100" json:"primary_category"`
	SecondaryCategory   string          `gorm:"size:100" json:"secondary_category"`
	Tags                string          `gorm:"type:text" json:"tags"`
	ContentLanguage     string          `gorm:"size:50" json:"content_language"`

	AnalyticsId         string          `gorm:"size:100;uniqueIndex" json:"analytics_id"`
	TrackingPixelId     string          `gorm:"size:100" json:"tracking_pixel_id"`

	Metadata            string          `gorm:"type:text" json:"metadata"`
	Notes               string          `gorm:"type:text" json:"notes"`
}

func (Creator) TableName() string {
	return "creators"
}

type SubscriptionPlan struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name                string          `gorm:"size:100;not null;uniqueIndex" json:"name"`
	Description         string          `gorm:"type:text" json:"description"`
	Price               decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"price"`
	Currency            string          `gorm:"size:3;default:'USD'" json:"currency"`
	Interval            BillingCycle    `gorm:"size:20;not null" json:"interval"`
	IntervalCount       int             `gorm:"default:1" json:"interval_count"`
	PlanType            SubscriptionPlanType `gorm:"size:20;not null" json:"plan_type"`

	MaxVideos           int             `gorm:"default:-1" json:"max_videos"`
	MaxStorageGB        int             `gorm:"default:100" json:"max_storage_gb"`
	MaxBandwidthGB      int             `gorm:"default:1000" json:"max_bandwidth_gb"`
	MaxSubscribers      int             `gorm:"default:-1" json:"max_subscribers"`
	MaxAnalytics        bool            `gorm:"default:true" json:"max_analytics"`
	PrioritySupport     bool            `gorm:"default:false" json:"priority_support"`
	CustomDomain        bool            `gorm:"default:false" json:"custom_domain"`
	WhiteLabel          bool            `gorm:"default:false" json:"white_label"`

	HasAds              bool            `gorm:"default:false" json:"has_ads"`
	MonetizationEnabled bool            `gorm:"default:true" json:"monetization_enabled"`
	RevenueShare        decimal.Decimal `gorm:"type:numeric(10,4);default:0.70" json:"revenue_share"`
	TipEnabled          bool            `gorm:"default:true" json:"tip_enabled"`
	SubscriptionEnabled bool            `gorm:"default:true" json:"subscription_enabled"`

	IsFeatured          bool            `gorm:"default:false" json:"is_featured"`
	IsRecommended       bool            `gorm:"default:false" json:"is_recommended"`
	TrialDays           int             `gorm:"default:0" json:"trial_days"`
	SetupFee            decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"setup_fee"`
	TaxRate             decimal.Decimal `gorm:"type:numeric(5,4);default:0.18" json:"tax_rate"`
	TaxInclusive        bool            `gorm:"default:false" json:"tax_inclusive"`

	IsActive            bool            `gorm:"default:true" json:"is_active"`
	IsPublic            bool            `gorm:"default:true" json:"is_public"`
	DisplayOrder        int             `gorm:"default:0" json:"display_order"`
	ValidFrom           *time.Time      `json:"valid_from,omitempty"`
	ValidTo             *time.Time      `json:"valid_to,omitempty"`

	IconURL             string          `gorm:"size:500" json:"icon_url"`
	BannerURL           string          `gorm:"size:500" json:"banner_url"`
	FeaturesJSON        string          `gorm:"type:text" json:"features_json"`
	BenefitsJSON        string          `gorm:"type:text" json:"benefits_json"`
	FAQJSON             string          `gorm:"type:text" json:"faq_json"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (SubscriptionPlan) TableName() string {
	return "subscription_plans"
}

type Subscription struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CreatorID           uint            `gorm:"not null;index" json:"creator_id"`
	PlanID              uint            `gorm:"not null;index" json:"plan_id"`
	Status              SubscriptionStatus `gorm:"size:20;not null" json:"status"`
	StartDate           time.Time       `gorm:"not null" json:"start_date"`
	EndDate             time.Time       `gorm:"not null" json:"end_date"`
	NextBillingDate     time.Time       `gorm:"not null" json:"next_billing_date"`
	BillingCycle        BillingCycle    `gorm:"size:20;not null" json:"billing_cycle"`
	Price               decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"price"`
	Currency            string          `gorm:"size:3;default:'USD'" json:"currency"`

	TrialStartedAt      *time.Time      `json:"trial_started_at,omitempty"`
	TrialEndsAt         *time.Time      `json:"trial_ends_at,omitempty"`
	TrialUsed           bool            `gorm:"default:false" json:"trial_used"`

	LastPaymentDate     *time.Time      `json:"last_payment_date,omitempty"`
	NextPaymentDue      time.Time       `gorm:"not null" json:"next_payment_due"`
	PaymentAttempts     int             `gorm:"default:0" json:"payment_attempts"`
	FailedPaymentCount  int             `gorm:"default:0" json:"failed_payment_count"`

	CancelAtPeriodEnd   bool            `gorm:"default:false" json:"cancel_at_period_end"`
	CanceledAt          *time.Time      `json:"canceled_at,omitempty"`
	CancelReason        string          `gorm:"type:text" json:"cancel_reason,omitempty"`
	CancellationFee     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"cancellation_fee"`

	CurrentPeriodStart  time.Time       `gorm:"not null" json:"current_period_start"`
	CurrentPeriodEnd    time.Time       `gorm:"not null" json:"current_period_end"`
	UsageData           string          `gorm:"type:text" json:"usage_data"`

	Metadata            string          `gorm:"type:text" json:"metadata"`
	Notes               string          `gorm:"type:text" json:"notes"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

type TaxRate struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Name                string          `gorm:"size:100;not null;uniqueIndex" json:"name"`
	Code                string          `gorm:"size:20;not null;uniqueIndex" json:"code"`
	Rate                decimal.Decimal `gorm:"type:numeric(5,4);not null" json:"rate"`
	Description         string          `gorm:"type:text" json:"description"`
	TaxType             RevenueSource   `gorm:"size:30;not null" json:"tax_type"`
	TaxCategory         RevenueCategory `gorm:"size:30;not null" json:"tax_category"`
	IsCompound          bool            `gorm:"default:false" json:"is_compound"`
	IsInclusive         bool            `gorm:"default:false" json:"is_inclusive"`

	Country             string          `gorm:"size:3;not null" json:"country"`
	State               string          `gorm:"size:100" json:"state,omitempty"`
	City                string          `gorm:"size:100" json:"city,omitempty"`
	ZipCode             string          `gorm:"size:20" json:"zip_code,omitempty"`
	Priority            int             `gorm:"default:0" json:"priority"`

	EffectiveFrom       time.Time       `gorm:"not null" json:"effective_from"`
	EffectiveTo         *time.Time      `json:"effective_to,omitempty"`

	IsActive            bool            `gorm:"default:true" json:"is_active"`
	IsDefault           bool            `gorm:"default:false" json:"is_default"`

	Metadata            string          `gorm:"type:text" json:"metadata"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (TaxRate) TableName() string {
	return "tax_rates"
}

type InvoiceItem struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	InvoiceID           uint            `gorm:"not null;index" json:"invoice_id"`
	Description         string          `gorm:"size:500;not null" json:"description"`
	Quantity            decimal.Decimal `gorm:"type:numeric(10,2);default:1" json:"quantity"`
	UnitPrice           decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"unit_price"`
	DiscountPercentage  decimal.Decimal `gorm:"type:numeric(5,4);default:0" json:"discount_percentage"`
	TaxRateID           *uint           `json:"tax_rate_id,omitempty"`
	TaxRate             TaxRate         `gorm:"foreignKey:TaxRateID" json:"tax_rate,omitempty"`
	TaxAmount           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"tax_amount"`
	ItemTotal           decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"item_total"`
	ItemType            RevenueSource   `gorm:"size:30;not null" json:"item_type"`
	RevenueSource       RevenueSource   `gorm:"size:30;not null" json:"revenue_source"`
	Category            RevenueCategory `gorm:"size:30;not null" json:"category"`
	IsTaxExempt         bool            `gorm:"default:false" json:"is_tax_exempt"`

	CreatorShare        decimal.Decimal `gorm:"type:numeric(10,4);default:0.70" json:"creator_share"`
	PlatformShare       decimal.Decimal `gorm:"type:numeric(10,4);default:0.30" json:"platform_share"`
	CreatorAmount       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"creator_amount"`
	PlatformAmount      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"platform_amount"`

	Metadata            string          `gorm:"type:text" json:"metadata"`
	Notes               string          `gorm:"type:text" json:"notes"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (InvoiceItem) TableName() string {
	return "invoice_items"
}

type Payment struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CreatorID           uint            `gorm:"not null;index" json:"creator_id"`
	Amount              decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	Currency            string          `gorm:"size:3;default:'USD'" json:"currency"`
	Status              InvoiceStatus   `gorm:"size:20;not null" json:"status"`
	PaymentMethod       PaymentMethod   `gorm:"size:30;not null" json:"payment_method"`
	PaymentProvider     PaymentProvider `gorm:"size:50;not null" json:"payment_provider"`
	PaymentDate         time.Time       `gorm:"not null" json:"payment_date"`
	ProcessedAt         time.Time       `gorm:"autoCreateTime" json:"processed_at"`

	TransactionID       string          `gorm:"size:100;uniqueIndex" json:"transaction_id"`
	ReferenceID         string          `gorm:"size:100;index" json:"reference_id"`
	ChargeID            string          `gorm:"size:100" json:"charge_id"`
	PaymentIntentID     string          `gorm:"size:100" json:"payment_intent_id"`

	NetAmount           decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"net_amount"`
	PlatformFee         decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"platform_fee"`
	TaxAmount           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"tax_amount"`
	Fees                decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"fees"`
	GrossAmount         decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"gross_amount"`

	GatewayResponse     string          `gorm:"type:text" json:"gateway_response"`
	FailureCode         string          `gorm:"size:50" json:"failure_code"`
	FailureMessage      string          `gorm:"type:text" json:"failure_message"`
	CardLast4           string          `gorm:"size:4" json:"card_last4"`
	CardBrand           string          `gorm:"size:50" json:"card_brand"`
	ExpiryMonth         string          `gorm:"size:2" json:"expiry_month"`
	ExpiryYear          string          `gorm:"size:4" json:"expiry_year"`

	BankName            string          `gorm:"size:100" json:"bank_name"`
	BankAccountType     string          `gorm:"size:50" json:"bank_account_type"`
	AccountHolderName   string          `gorm:"size:100" json:"account_holder_name"`
	RoutingNumber       string          `gorm:"size:20" json:"routing_number"`

	PayPalOrderID       string          `gorm:"size:100" json:"paypal_order_id"`
	PayPalCaptureID     string          `gorm:"size:100" json:"paypal_capture_id"`

	WalletType          string          `gorm:"size:50" json:"wallet_type"`
	WalletAddress       string          `gorm:"size:100" json:"wallet_address"`

	Metadata            string          `gorm:"type:text" json:"metadata"`
	Notes               string          `gorm:"type:text" json:"notes"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Payment) TableName() string {
	return "payments"
}

// ManualExpense represents manually recorded expenses for creator business operations
// Supports detailed expense tracking with vendor information, tax calculations, and approval workflows
type ManualExpense struct {
	gorm.Model
	UUID                uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CreatorID           uint            `gorm:"not null;index" json:"creator_id"`
	Description         string          `gorm:"size:500;not null" json:"description"`
	Amount              decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"amount"`
	ExpenseDate         time.Time       `gorm:"not null" json:"expense_date"`
	Category            RevenueCategory `gorm:"size:30;not null" json:"category"`
	ExpenseType         RevenueSource   `gorm:"size:30;not null" json:"expense_type"`
	RevenueSource       RevenueSource   `gorm:"size:30;not null" json:"revenue_source"`
	Status              InvoiceStatus   `gorm:"size:20;default:'pending'" json:"status"`

	PaymentMethod       PaymentMethod   `gorm:"size:30;default:'manual'" json:"payment_method"`
	PaymentDate         *time.Time      `json:"payment_date,omitempty"`
	PaidBy              string          `gorm:"size:100" json:"paid_by"`

	VendorName          string          `gorm:"size:100" json:"vendor_name"`
	VendorEmail         string          `gorm:"size:255" json:"vendor_email"`
	VendorPhone         string          `gorm:"size:20" json:"vendor_phone"`
	ReceiptURL          string          `gorm:"size:500" json:"receipt_url"`
	ReceiptNumber       string          `gorm:"size:50" json:"receipt_number"`

	TaxRateID           *uint           `json:"tax_rate_id,omitempty"`
	TaxRate             TaxRate         `gorm:"foreignKey:TaxRateID" json:"tax_rate,omitempty"`
	TaxAmount           decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"tax_amount"`
	TotalAmount         decimal.Decimal `gorm:"type:numeric(20,2);not null" json:"total_amount"`
	RefundAmount        decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"refund_amount"`
	RefundDate          *time.Time      `json:"refund_date,omitempty"`
	RefundReason        string          `gorm:"type:text" json:"refund_reason,omitempty"`

	BusinessPurpose     string          `gorm:"size:200" json:"business_purpose"`
	Department          string          `gorm:"size:100" json:"department"`
	ProjectID           string          `gorm:"size:100" json:"project_id"`
	CostCenter          string          `gorm:"size:50" json:"cost_center"`
	BudgetCode          string          `gorm:"size:50" json:"budget_code"`

	ApprovedBy          string          `gorm:"size:100" json:"approved_by"`
	ApprovedDate        *time.Time      `json:"approved_date,omitempty"`
	ApprovedAmount      decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"approved_amount"`

	Country             string          `gorm:"size:3" json:"country"`
	State               string          `gorm:"size:100" json:"state"`
	City                string          `gorm:"size:100" json:"city"`
	ZipCode             string          `gorm:"size:20" json:"zip_code"`
	ExpenseTypeDetail   string          `gorm:"size:200" json:"expense_type_detail"`

	Metadata            string          `gorm:"type:text" json:"metadata"`
	Notes               string          `gorm:"type:text" json:"notes"`

	CreatedAt           time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (ManualExpense) TableName() string {
	return "manual_expenses"
}

// Retention represents user retention analytics
// Tracks user engagement patterns over time periods and cohort analysis
// Provides retention percentages and user lifetime metrics
type Retention struct {
	gorm.Model
	UUID        uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	CampaignID  *uint           `json:"campaign_id,omitempty"`
	UserID      *uint           `json:"user_id,omitempty"`
	Period      string          `gorm:"size:20;not null" json:"period"`
	Date        time.Time       `gorm:"index;not null" json:"date"`
	Retained    int             `gorm:"default:0" json:"retained"`
	Churned     int             `gorm:"default:0" json:"churned"`
	RetentionPercent decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"retention_percent"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (Retention) TableName() string {
	return "retention_stats"
}

// CreatorAnalytics represents aggregated creator performance analytics
// Combines revenue, engagement, and content performance metrics
// Essential for dashboard and reporting features
type CreatorAnalytics struct {
	gorm.Model
	CreatorID   uint            `gorm:"not null;index" json:"creator_id"`
	Date        time.Time       `gorm:"index;not null" json:"date"`
	Views       int64           `gorm:"default:0" json:"views"`
	Clicks      int64           `gorm:"default:0" json:"clicks"`
	WatchTime   int64           `gorm:"default:0" json:"watch_time"`
	Engagement  decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"engagement"`
	Revenue     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	Subscribers int             `gorm:"default:0" json:"subscribers"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (CreatorAnalytics) TableName() string {
	return "creator_analytics"
}

// EngagementMetrics represents content engagement metrics
// Tracks detailed engagement patterns including time-based and interaction-based metrics
type EngagementMetrics struct {
	gorm.Model
	ContentID      string          `gorm:"size:100;not null;index" json:"content_id"`
	VideoID        *uint           `json:"video_id,omitempty"`
	Date           time.Time       `gorm:"index;not null" json:"date"`
	Likes          int             `gorm:"default:0" json:"likes"`
	Dislikes       int             `gorm:"default:0" json:"dislikes"`
	Shares         int             `gorm:"default:0" json:"shares"`
	Comments       int             `gorm:"default:0" json:"comments"`
	Saves          int             `gorm:"default:0" json:"saves"`
	WatchTime      int             `gorm:"default:0" json:"watch_time"`
	CompletionRate decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"completion_rate"`
	EngagementRate decimal.Decimal `gorm:"type:numeric(10,4);default:0" json:"engagement_rate"`
	CreatedAt      time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (EngagementMetrics) TableName() string {
	return "engagement_metrics"
}

// VideoAnalytics represents video-level analytics metrics
// Comprehensive tracking of video performance across all engagement dimensions
type VideoAnalytics struct {
	gorm.Model
	VideoID       uint            `gorm:"not null;index" json:"video_id"`
	ContentID     string          `gorm:"size:100;not null;index" json:"content_id"`
	Date          time.Time       `gorm:"index;not null" json:"date"`
	Views         int64           `gorm:"default:0" json:"views"`
	Likes         int             `gorm:"default:0" json:"likes"`
	Comments      int             `gorm:"default:0" json:"comments"`
	Shares        int             `gorm:"default:0" json:"shares"`
	WatchTime     int64           `gorm:"default:0" json:"watch_time"`
	Subscribers   int             `gorm:"default:0" json:"subscribers"`
	Revenue       decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"revenue"`
	AdRevenue     decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"ad_revenue"`
	PremiumRevenue decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"premium_revenue"`
	MerchRevenue  decimal.Decimal `gorm:"type:numeric(20,2);default:0" json:"merch_revenue"`
	CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
}

func (VideoAnalytics) TableName() string {
	return "video_analytics"
}

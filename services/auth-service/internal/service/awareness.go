package service

// ============================================================================
// REGISTRATION TELEMETRY  -  "kaun, kab, kahan se, kis device se"
// ============================================================================
//
// REQUIREMENT: "superadmin ko pata chale so-and-so register hua hai, kis
// country se, kis continent se, konsa network, kaunsa device, kaunsa browser".
//
// Ye registration ke WAQT ek PERMANENT record likhta hai. Clicks alag table me
// jaate hain (bulk + purgeable); ye ek-time audit hai jo kabhi nahi mita.
//
// ---- NO DUMMY DATA EVER ----
// Country/continent sirf tab likhte hain jab TRUSTED proxy geo header ho.
// Local dev me wo header nahi hota -> NULL. Ye jaan-boojh kar hai:
// superadmin panel par khaali dikhna SAHI hai, jhootha dikhna galat.
// Kabhi bhi "Unknown"/"IN" jaisa default fill nahi karte.

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// RecordRegistration ek real registration event store karta hai.
//
// Isko handler me registration SUCCESS ke BAAD call karna chahiye - agar
// registration fail ho to record mat banao (warna "signups" count galat ho
// jayega).
func (s *AuthService) RecordRegistration(
	ctx context.Context,
	userID uuid.UUID,
	email, username string,
	ip, userAgent, referrer string,
	telemetry DeviceInfoParsed,
) error {
	rec := &model.UserRegistration{
		UserID:     userID,
		Email:      email,
		Username:   username,
		IPAddress:  truncateStr(ip, 64),
		UserAgent:  truncateStr(userAgent, 512),
		Country:    truncateStr(telemetry.Country, 2),
		Continent:  truncateStr(telemetry.Continent, 8),
		DeviceType: truncateStr(telemetry.DeviceType, 16),
		Browser:    truncateStr(telemetry.Browser, 64),
		OS:         truncateStr(telemetry.OS, 64),
		Referrer:   truncateStr(referrer, 512),
		CreatedAt:  time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Create(rec).Error
}

// ---------------------------------------------------------------------------
// SUPERADMIN AWARENESS GRID - aggregated REAL data
// ---------------------------------------------------------------------------

// AwarenessOverview - superadmin dashboard ka summary.
//
// SAARA data `user_registrations` + `users` se REAL rows par compute hota
// hai. Koi hardcoded/placeholder metric nahi - agar koi bucket empty hai to
// wo 0 dikhta hai, jo SACH hai.
type AwarenessOverview struct {
	// ---- Headline numbers ----
	TotalUsers         int64 `json:"total_users"`
	TotalVerified      int64 `json:"total_verified"`
	TotalUnverified    int64 `json:"total_unverified"`
	TotalRegistrations int64 `json:"total_registrations"`

	// ---- Signups over last 7 days (date -> count), real ----
	SignupsByDay []DayCount `json:"signups_by_day"`

	// ---- Device split (real) ----
	ByDevice []LabelledCount `json:"by_device"`

	// ---- Browser split (real) ----
	ByBrowser []LabelledCount `json:"by_browser"`

	// ---- OS split (real) ----
	ByOS []LabelledCount `json:"by_os"`

	// ---- Country split (real, non-null only) ----
	// NOTE: jahan country NULL hai (koi trusted geo header nahi tha) wo
	// "Unknown" bucket me NAHI aata - kyunki wo fabricate karna hoga.
	// Isliye sirf wahi countries dikhte hain jinka data SACH me hai.
	ByCountry        []CountryCount `json:"by_country"`
	CountriesMissing int64          `json:"countries_missing"`

	// ---- Continent split (real) ----
	ByContinent []LabelledCount `json:"by_continent"`
}

// DayCount - ek date par kitne signups
type DayCount struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// LabelledCount - label + count (device, browser, OS ke liye)
type LabelledCount struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

// CountryCount - country + continent + count
type CountryCount struct {
	Country   string `json:"country"`
	Continent string `json:"continent"`
	Count     int64  `json:"count"`
}

// GetAwarenessOverview REAL data se superadmin summary banata hai.
//
// SECURITY: ye sirf SUPERADMIN role wale callers ko serve karna chahiye
// (handler level pe role check hota hai). Data me koi PII leak nahi hoti
// jo already superadmin ke paas hai.
func (s *AuthService) GetAwarenessOverview(ctx context.Context) (*AwarenessOverview, error) {
	out := &AwarenessOverview{
		SignupsByDay: []DayCount{},
		ByDevice:     []LabelledCount{},
		ByBrowser:    []LabelledCount{},
		ByOS:         []LabelledCount{},
		ByCountry:    []CountryCount{},
		ByContinent:  []LabelledCount{},
	}

	// ---- Headline counts (users table se, REAL) ----
	row := struct {
		Total, Verified, Unverified int64
	}{}
	if err := s.db.WithContext(ctx).Model(&model.User{}).
		Select("COUNT(*) as total, COUNT(*) FILTER (WHERE is_verified) as verified, COUNT(*) FILTER (WHERE NOT is_verified) as unverified").
		Scan(&row).Error; err != nil {
		return nil, err
	}
	out.TotalUsers = row.Total
	out.TotalVerified = row.Verified
	out.TotalUnverified = row.Unverified

	// ---- Total registrations (registration audit table se) ----
	if err := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Count(&out.TotalRegistrations).Error; err != nil {
		return nil, err
	}

	// ---- Signups, last 7 days ----
	// NOTE: `date_trunc` timezone-aware grouping. Ye REAL rows group karta hai.
	sevenDaysAgo := time.Now().UTC().AddDate(0, 0, -6)
	var days []DayCount
	if err := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Select("TO_CHAR(date_trunc('day', created_at), 'YYYY-MM-DD') as date, COUNT(*) as count").
		Where("created_at >= ?", sevenDaysAgo).
		Group("date_trunc('day', created_at)").
		Order("date_trunc('day', created_at) ASC").
		Scan(&days).Error; err != nil {
		return nil, err
	}
	out.SignupsByDay = days

	// ---- Device split ----
	// NOTE: `NULLIF(TRIM(device_type),'')` khaali values ko alag bucket me
	// deta hai. Unhe hum "Unknown" NAHI bolte - wo label genuinely
	// "unknown" hota hai jab UA unreadable ho, jo alag hai.
	if err := s.groupCount(ctx, "device_type", &out.ByDevice); err != nil {
		return nil, err
	}
	if err := s.groupCount(ctx, "browser", &out.ByBrowser); err != nil {
		return nil, err
	}
	if err := s.groupCount(ctx, "os", &out.ByOS); err != nil {
		return nil, err
	}
	if err := s.groupCount(ctx, "continent", &out.ByContinent); err != nil {
		return nil, err
	}

	// ---- Country split (sirf jinka REAL data hai) ----
	var countries []CountryCount
	if err := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Select("country, MAX(continent) as continent, COUNT(*) as count").
		Where("country IS NOT NULL AND country <> ''").
		Group("country").
		Order("COUNT(*) DESC").
		Limit(50).
		Scan(&countries).Error; err != nil {
		return nil, err
	}
	out.ByCountry = countries

	// ---- Kitne registrations ka country MISSING hai ----
	// Ye transparency ke liye hai: admin ko pata chale kitne rows me geo
	// header nahi tha (local dev / direct IP). Isse wo judge kar sake ki
	// "5 countries" ka data kitna complete hai.
	var missing int64
	if err := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Where("country IS NULL OR country = ''").
		Count(&missing).Error; err != nil {
		return nil, err
	}
	out.CountriesMissing = missing

	return out, nil
}

// groupCount ek column par value->count grouping karta hai (top 20)
func (s *AuthService) groupCount(ctx context.Context, column string, out *[]LabelledCount) error {
	var rows []LabelledCount
	q := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Select(column + " as label, COUNT(*) as count").
		Where(column + " IS NOT NULL AND " + column + " <> ''").
		Group(column).
		Order("COUNT(*) DESC").
		Limit(20).
		Scan(&rows)
	if q.Error != nil {
		return q.Error
	}
	if rows == nil {
		rows = []LabelledCount{}
	}
	*out = rows
	return nil
}

// ---------------------------------------------------------------------------
// RECENT REGISTRATIONS - "kaun naya aaya" live list
// ---------------------------------------------------------------------------

// RecentRegistration - ek registration ka summary row
type RecentRegistration struct {
	Email      string    `json:"email"`
	Username   string    `json:"username"`
	IPAddress  string    `json:"ip_address"`
	Country    string    `json:"country"`
	Continent  string    `json:"continent"`
	DeviceType string    `json:"device_type"`
	Browser    string    `json:"browser"`
	OS         string    `json:"os"`
	Referrer   string    `json:"referrer"`
	CreatedAt  time.Time `json:"created_at"`
}

// ListRecentRegrations naye registrations live list karta hai.
func (s *AuthService) ListRecentRegistrations(ctx context.Context, limit int) ([]RecentRegistration, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []RecentRegistration
	if err := s.db.WithContext(ctx).Model(&model.UserRegistration{}).
		Select("email, username, ip_address, country, continent, device_type, browser, os, referrer, created_at").
		Order("created_at DESC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []RecentRegistration{}
	}
	return rows, nil
}

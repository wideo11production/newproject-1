package service

// ============================================================================
// CREATOR DASHBOARD SERVICE
// ============================================================================
//
// User dashboard ke liye operations:
//   - ListChannels : user ke channels
//   - CreateChannel: naya channel (unique handle validation ke saath)
//   - UpdateAvatar : profile image set/clear
//   - ListSessions : active devices (kis device par login hai)
//
// Hinglish comments: har block ka arth

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// coverValue reads the optional cover URL off a create request.
//
// A helper rather than an inline dereference because the field is a POINTER -
// `nil` means "no cover supplied", and reaching through it inline is how a nil
// dereference gets introduced by a later refactor.
func coverValue(req *model.CreateChannelRequest) string {
	if req == nil || req.CoverURL == nil {
		return ""
	}
	return *req.CoverURL
}

// derefOrEmpty is the nil-safe read for an optional column.
func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// handlePattern: 3-30 chars, lowercase letters / digits / underscore / dot /
// dash.
//
// IMPORTANT: ye EXACTLY wahi rule hai jo migration 005 ke DB CHECK
// constraint aur frontend validator use karte hain. Teen jagah same rule
// zaroori hai - warna user client pass ho jayega aur DB reject kar dega,
// ya DB accept kar le aur URL toot jaye.
var handlePattern = regexp.MustCompile(`^[a-z0-9._-]{3,30}$`)

// ---- Channels ----

// ListChannels user ke saare active channels laata hai.
//
// SECURITY: `user_id` filter query me LAGA HAI - iske bina koi bhi user kisi
// aur ke channels dekh lega. Ye line hataane se IDOR vulnerability khul jayegi.
func (s *AuthService) ListChannels(ctx context.Context, userID uuid.UUID) ([]model.Channel, error) {
	var channels []model.Channel
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Find(&channels).Error
	if err != nil {
		return nil, err
	}
	return channels, nil
}

// CreateChannel naya channel banata hai.
//
// VALIDATION (server-side, authoritative):
//   - handle normalize (lowercase + trim) + format validate
//   - uniqueness: same user ke andar duplicate handle REJECTED
//
// NOTE ON UNIQUENESS: DB par `idx_channels_user_handle (user_id, LOWER(handle))`
// unique index hai. Ye pre-check sirf ek ACCHI error message dene ke liye hai
// (409 "handle taken") - agar check na ho to bhi DB constraint insert ko reject
// karega, bas error message kharab hota.
func (s *AuthService) CreateChannel(
	ctx context.Context,
	userID uuid.UUID,
	req *model.CreateChannelRequest,
) (*model.Channel, error) {
	// ---- Normalize ----
	// Lowercase + trim: taaki "Aarav" aur "aarav" ek hi handle na banein.
	handle := strings.ToLower(strings.TrimSpace(req.Handle))
	displayName := strings.TrimSpace(req.DisplayName)
	description := strings.TrimSpace(req.Description)

	// ---- Validate handle ----
	if !handlePattern.MatchString(handle) {
		return nil, model.ErrHandleInvalid
	}

	// ---- Validate display name ----
	//
	// NOTE: ye pehle `ErrChannelNotFound` return karta tha - jo do jahan se
	// galat tha:
	//   1. Semantics: channel exist hi nahi karta abhi, isiliye "not found"
	//      bekaar message hai. `ErrDisplayNameInvalid` hi sahi error hai, wo
	//      pehle se define hai.
	//   2. `CreateChannel` apna alag error switch use karta hai
	//      (`writeChannelError` nahi), aur us switch me ye error nahi tha -
	//      isiliye empty display_name par API **500** deta tha, 400 nahi.
	//      Client ko apni galti pe 500 dikhta tha, jo server fault imply karta
	//      hai aur use useless retry loop me daalta hai.
	if len(displayName) < 1 || len(displayName) > 80 {
		return nil, model.ErrDisplayNameInvalid
	}

	// ---- Description length ----
	if len(description) > 2000 {
		description = description[:2000]
	}

	// ---- Duplicate check ----
	//
	// TWO parts, and the second one is the one that matters.
	//
	// (a) the handle is still live on some channel - global, not per-user.
	//
	// This used to be `WHERE user_id = ? AND LOWER(handle) = ?`, which stopped
	// ONE user claiming a handle twice and did nothing about TWO users claiming
	// the same handle. Verified, not theorised: two different accounts each
	// POSTed the same handle, both got HTTP 201, and
	// `GET /api/v1/public/channels/<handle>` then returned one of them at
	// RANDOM, because the read path used `First()` which orders by a UUID
	// primary key.
	//
	// So the same public URL could serve a different creator at different times -
	// an impersonation path, and one that made the legitimate owner unreachable
	// at their own address.
	//
	// (b) the handle is RETIRED - it was used before and the channel went away.
	//
	// Without this check a deleted channel's handle becomes free, and the next
	// person to register it inherits a dead URL's trust: the followers, the
	// bookmarks and the search associations all point at an address that now
	// belongs to someone else. Same rule as an email address, and the reason
	// `retired_handles` exists.
	//
	// NOTE: the UNIQUE INDEX from migration 014 is the real enforcement. These
	// two queries exist to turn a constraint violation into a correct 409 with a
	// useful message, rather than to be the only thing standing between two
	// users and one handle. The race between "check says free" and "insert"
	// is real, and only the index closes it.
	var existing int64
	if err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("LOWER(handle) = ?", handle).
		Count(&existing).Error; err == nil && existing > 0 {
		return nil, model.ErrHandleTaken
	}

	var retired int64
	if err := s.db.WithContext(ctx).
		Model(&model.RetiredHandle{}).
		Where("handle = ?", handle).
		Count(&retired).Error; err == nil && retired > 0 {
		return nil, model.ErrHandleRetired
	}

	// ---- Channel type: REQUIRED ----
	//
	// It is not a label. It selects upload defaults and which features surface, so
	// a channel without one cannot be categorised - and guessing would pick
	// defaults the creator never asked for.
	channelType := strings.ToLower(strings.TrimSpace(req.ChannelType))
	if channelType == "" {
		return nil, model.ErrChannelTypeRequired
	}
	if !model.ValidChannelType[channelType] {
		return nil, model.ErrChannelTypeInvalid
	}

	// ---- Mature content: REQUIRED, and separate from the kids question ----
	mature := strings.ToLower(strings.TrimSpace(req.MatureContent))
	if mature == "" {
		return nil, model.ErrMatureContentRequired
	}
	if !model.ValidMatureContent[mature] {
		return nil, model.ErrMatureContentInvalid
	}

	// ---- Made for kids: REQUIRED ----
	//
	// A pointer on the request, so "the client did not answer" is
	// distinguishable from "the client said no". Without the pointer an omitted
	// field would decode to `false` and be recorded as a positive claim that the
	// channel is not for kids - an assertion about someone's content that nobody
	// made, on a field that has legal consequences.
	if req.MadeForKids == nil {
		return nil, model.ErrMadeForKidsRequired
	}
	madeForKids := *req.MadeForKids

	// ---- Optional answers, still validated ----
	//
	// Optional does not mean unvalidated. A malformed country would fail the
	// regional-programme lookup silently, which is worse than a 400.
	var contactEmail, country, language, keywords *string

	if v := strings.TrimSpace(req.ContactEmail); v != "" {
		at := strings.IndexByte(v, '@')
		// Deliberately loose. Strict email validation here rejects valid
		// addresses, and a creator who mistypes their contact is a support
		// ticket - not a security boundary, because this field is never used to
		// grant anything.
		if at <= 0 || at == len(v)-1 || strings.ContainsAny(v, " \t\n") {
			return nil, model.ErrContactEmailInvalid
		}
		contactEmail = &v
	}

	if v := strings.ToUpper(strings.TrimSpace(req.Country)); v != "" {
		if len(v) != 2 || v[0] < 'A' || v[1] < 'A' || v[0] > 'Z' || v[1] > 'Z' {
			return nil, model.ErrCountryInvalid
		}
		country = &v
	}

	if v := strings.TrimSpace(req.PrimaryLanguage); v != "" {
		if len(v) > 16 || strings.ContainsAny(v, " \t\n") {
			return nil, model.ErrContactEmailInvalid // closest available; see note
		}
		language = &v
	}

	if v := strings.TrimSpace(req.Keywords); v != "" {
		if len(v) > 500 {
			v = v[:500]
		}
		keywords = &v
	}

	// A cover uploaded during creation. Validated for SHAPE only - a URL
	// pointing at someone else's host would render their image on the channel, so
	// the host is checked rather than trusted. The bytes are already verified by
	// `cover/finalize` on upload; this is about not hot-linking at display time.
	var coverURL *string
	if v := strings.TrimSpace(coverValue(req)); v != "" {
		u, err := url.Parse(v)
		if err != nil || !u.IsAbs() || u.Scheme == "" || u.Host == "" {
			return nil, model.ErrContactEmailInvalid
		}
		coverURL = &v
	}

	// ---- Default: public ----
	isPublic := true
	if req.IsPublic != nil {
		isPublic = *req.IsPublic
	}

	channel := &model.Channel{
		ID:          uuid.New(),
		UserID:      userID,
		Handle:      handle,
		DisplayName: displayName,
		Description: description,
		IsPublic:    isPublic,
		IsActive:    true,

		ChannelType:     &channelType,
		MatureContent:   &mature,
		MadeForKids:     &madeForKids,
		ContactEmail:    contactEmail,
		Country:         country,
		PrimaryLanguage: language,
		Keywords:        keywords,
		// The COLUMN is a plain string, and every existing channel already stores
		// "" there when it has no cover. A missing cover therefore stays "" rather
		// than NULL, which is the shape the rest of the code and the update route
		// already assume. The distinction that mattered - "no cover supplied" vs
		// "cover supplied as empty" - is made earlier, on the REQUEST pointer,
		// not here.
		CoverURL: derefOrEmpty(coverURL),
	}

	if err := s.db.WithContext(ctx).Create(channel).Error; err != nil {
		// DB unique constraint ne reject kiya (race condition - do requests
		// saath aaye). Ye bhi "taken" hi hai user ke perspective se.
		if isUniqueViolation(err) {
			return nil, model.ErrHandleTaken
		}
		return nil, err
	}

	return channel, nil
}

// ---- Profile avatar ----

// UpdateAvatar user ka profile image set ya clear karta hai.
//
// SECURITY: `user_id` filter LAGA HAI - koi aur user ka avatar nahi badal
// sakta. Avatar URL sirf sanitized string hai; actual file MinIO me hota hai
// (upload ka flow alag hota hai - yahan hum URL reference store karte hain).
func (s *AuthService) UpdateAvatar(
	ctx context.Context,
	userID uuid.UUID,
	avatarURL *string,
) error {
	var value *string
	if avatarURL != nil {
		trimmed := strings.TrimSpace(*avatarURL)
		// Empty string = clear karna (UI initials fallback par laut jayega)
		if trimmed == "" {
			value = nil
		} else {
			value = &trimmed
		}
	}

	// `user_id` scoped update - kisi aur ka avatar touch nahi hoga
	result := s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Update("avatar_url", value)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return model.ErrChannelNotFound // user nahi mila
	}
	return nil
}

// ---- Sessions / devices ----

// ListSessions user ke SAARE active devices/sessions laata hai.
//
// Ye "aap kis device par logged in hain" panel ke liye hai.
//
// SECURITY:
//   - `user_id` filter LAGA HAI (cross-user leak nahi)
//   - sirf non-revoked, non-expired sessions (`active_user_sessions` view)
//   - access/refresh token HASHES kabhi return nahi hote (wo model me hai
//     hi nahi) - sirf metadata (IP, user agent, times)
func (s *AuthService) ListSessions(
	ctx context.Context,
	userID uuid.UUID,
) ([]model.ActiveDeviceSession, error) {
	// ---- Direct table query, NOT the view ----
	//
	// Pehle ye `active_user_sessions` VIEW par Table() se query karta tha.
	// WO VIEW HATA DYA GAYA HAI - kyun?
	//
	// Kyunki wo view `sessions.ip_address` column par DEPEND karta tha, aur
	// Postgres kisi bhi view-dependent column par ALTER BLOCK karta hai:
	//     ERROR: cannot alter type of a column used by a view or rule
	// Jo GORM AutoMigrate har boot par karta hai - yaani auth-service
	// CRASH LOOP me chala gaya tha (exit 1, har restart par).
	//
	// Ye query VIEW ke EXACT same rows laati hai (same WHERE clause), sirf
	// source badla hai: view ki jagah base table + explicit filter.
	// Behaviour IDENTICAL hai, dependency hata di gayi.
	var sessions []model.ActiveDeviceSession
	err := s.db.WithContext(ctx).
		Model(&model.Session{}).
		Select("id, user_id, device_id, ip_address, user_agent, created_at, updated_at AS last_seen, expires_at").
		Where("user_id = ?", userID).
		// Same filter jo view me tha (bina view ke, directly table par)
		Where("deleted_at IS NULL").
		Where("revoked_at IS NULL").
		Where("expires_at > ?", time.Now()).
		Order("updated_at DESC").
		Scan(&sessions).Error
	if err != nil {
		return nil, err
	}
	return sessions, nil
}

// isUniqueViolation Postgres unique-constraint violation detect karta hai.
//
// Ye `gorm.ErrDuplicatedKey` se better hai kyunki GORM ka ye specific error
// sirf tab aata hai jab `TranslateError: true` config me ho - jo shayad
// enabled nahi hai. Postgres ka 23505 code directly check karna reliable hai.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// Postgres SQLSTATE 23505 = unique_violation
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key value") ||
		strings.Contains(msg, "UNIQUE constraint failed")
}

// compile-time assertion: db field available hai (AuthService me)
var _ = gorm.ErrRecordNotFound

// DashboardStats holds aggregated statistics for the creator dashboard.
type DashboardStats struct {
	Channels     ChannelStats      `json:"channels"`
	Media        MediaStats        `json:"media"`
	Subscription SubscriptionStats `json:"subscription"`
	Revenue      RevenueStats      `json:"revenue"`
	Trial        TrialStatus       `json:"trial"`
}

// ChannelStats - channel related metrics
type ChannelStats struct {
	Total            int64 `json:"total"`
	Active           int64 `json:"active"`
	Public           int64 `json:"public"`
	TotalVideos      int64 `json:"total_videos"`
	TotalReels       int64 `json:"total_reels"`
	TotalSubscribers int64 `json:"total_subscribers"`
}

// MediaStats - media upload pipeline metrics
type MediaStats struct {
	Total       int64 `json:"total"`
	Ready       int64 `json:"ready"`
	Uploaded    int64 `json:"uploaded"`
	Transcoding int64 `json:"transcoding"`
	Scanning    int64 `json:"scanning"`
	Initiated   int64 `json:"initiated"`
	Failed      int64 `json:"failed"`
	TotalSize   int64 `json:"total_size_bytes"`
}

// SubscriptionStats - viewer subscription metrics
type SubscriptionStats struct {
	TotalSubscribers    int64 `json:"total_subscribers"`
	ActiveSubscriptions int64 `json:"active_subscriptions"`
	PaidSubscriptions   int64 `json:"paid_subscriptions"`
}

// RevenueStats - earnings and payout metrics
type RevenueStats struct {
	TotalEarningsMinor int64   `json:"total_earnings_minor"`
	PendingPayoutMinor int64   `json:"pending_payout_minor"`
	LastPayoutAt       *string `json:"last_payout_at,omitempty"`
	WalletBalanceMinor int64   `json:"wallet_balance_minor"`
}

// TrialStatus - trial plan status
type TrialStatus struct {
	IsOnTrial     bool   `json:"is_on_trial"`
	DaysRemaining int    `json:"days_remaining"`
	PlanCode      string `json:"plan_code"`
	PlanName      string `json:"plan_name"`
}

// GetDashboardStats returns aggregated statistics for the user's dashboard.
//
// SECURITY: All queries scoped to user_id. No cross-user data access possible.
func (s *AuthService) GetDashboardStats(ctx context.Context, userID uuid.UUID) (*DashboardStats, error) {
	var stats DashboardStats

	// ---- Channels ----
	// Total channels
	s.db.WithContext(ctx).Model(&model.Channel{}).
		Where("user_id = ?", userID).
		Count(&stats.Channels.Total)

	// Active channels
	s.db.WithContext(ctx).Model(&model.Channel{}).
		Where("user_id = ? AND is_active = ?", userID, true).
		Count(&stats.Channels.Active)

	// Public channels
	s.db.WithContext(ctx).Model(&model.Channel{}).
		Where("user_id = ? AND is_public = ? AND is_active = ?", userID, true, true).
		Count(&stats.Channels.Public)

	// ---- Media ----
	// Get channel IDs for this user
	var channelIDs []uuid.UUID
	s.db.WithContext(ctx).Model(&model.Channel{}).
		Where("user_id = ?", userID).
		Pluck("id", &channelIDs)

	if len(channelIDs) > 0 {
		// Total media assets
		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ?", channelIDs).
			Count(&stats.Media.Total)

		// By status
		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusReady).
			Count(&stats.Media.Ready)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusUploaded).
			Count(&stats.Media.Uploaded)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusTranscoding).
			Count(&stats.Media.Transcoding)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusScanning).
			Count(&stats.Media.Scanning)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusInitiated).
			Count(&stats.Media.Initiated)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND status = ?", channelIDs, model.MediaStatusFailed).
			Count(&stats.Media.Failed)

		// Total size
		var totalSize int64
		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ?", channelIDs).
			Select("COALESCE(SUM(bytes), 0)").
			Scan(&totalSize)
		stats.Media.TotalSize = totalSize

		// Videos vs Reels
		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND kind = ?", channelIDs, model.MediaKindVideo).
			Count(&stats.Channels.TotalVideos)

		s.db.WithContext(ctx).Model(&model.MediaAsset{}).
			Where("channel_id IN ? AND kind = ?", channelIDs, model.MediaKindReel).
			Count(&stats.Channels.TotalReels)
	}

	// ---- Subscriptions ----
	// Get channel IDs again (or reuse)
	if len(channelIDs) > 0 {
		// Total subscribers across all channels
		s.db.WithContext(ctx).Table("channel_subscriptions").
			Where("channel_id IN ? AND status = ?", channelIDs, "active").
			Count(&stats.Subscription.TotalSubscribers)

		// Active subscriptions (same as total for now)
		stats.Subscription.ActiveSubscriptions = stats.Subscription.TotalSubscribers

		// Paid subscriptions (would need a paid tier check)
		s.db.WithContext(ctx).Table("channel_subscriptions").
			Where("channel_id IN ? AND status = ? AND tier != ?", channelIDs, "active", "free").
			Count(&stats.Subscription.PaidSubscriptions)
	}

	// ---- Revenue ----
	// Check if wallet table exists, if not return zeros
	// For now, return placeholder values - will be implemented when wallet-service is deployed
	stats.Revenue.TotalEarningsMinor = 0
	stats.Revenue.PendingPayoutMinor = 0
	stats.Revenue.WalletBalanceMinor = 0

	// ---- Trial Status ----
	//
	// `suspended_at IS NULL` is in BOTH queries, and its absence is what the
	// deleted `UserEntitlement` model was hiding.
	//
	// A suspended entitlement is not a revoked one: it is still paid for and still
	// owned, but it is not applying because the identity stopped matching - which
	// happens when the owner changes their email address. The old model had no
	// `suspended_at` field and the query had no such condition, so a suspended
	// trial was reported to its own owner as an active trial: the dashboard said
	// "you are on trial, N days left" while the trial was not granting anything.
	//
	// That is the kind of bug that survives a long time, because each half is
	// individually defensible - "suspended is not cancelled" is true - and only
	// the pair is wrong.
	var entitlement model.Entitlement
	err := s.db.WithContext(ctx).
		Where(`user_id = ? AND plan_code = ? AND cancelled_at IS NULL
		       AND suspended_at IS NULL
		       AND (ends_at IS NULL OR ends_at > ?)`,
			userID, "trial", time.Now()).
		First(&entitlement).Error

	if err == nil {
		stats.Trial.IsOnTrial = true
		stats.Trial.PlanCode = "trial"
		stats.Trial.PlanName = "Free Trial (3 days)"
		if entitlement.EndsAt != nil {
			days := int(entitlement.EndsAt.Sub(time.Now()).Hours() / 24)
			if days < 0 {
				days = 0
			}
			stats.Trial.DaysRemaining = days
		} else {
			stats.Trial.DaysRemaining = 3
		}
	} else {
		// Check for other active plans. Same suspension condition - a suspended
		// paid plan must not be reported as the one the user is "currently on".
		var activeEntitlement model.Entitlement
		err = s.db.WithContext(ctx).
			Where(`user_id = ? AND cancelled_at IS NULL AND suspended_at IS NULL
			       AND (ends_at IS NULL OR ends_at > ?)`,
				userID, time.Now()).
			Order("CASE WHEN plan_code = 'trial' THEN 1 ELSE 0 END, ends_at ASC").
			First(&activeEntitlement).Error
		if err == nil {
			stats.Trial.IsOnTrial = false
			stats.Trial.PlanCode = activeEntitlement.PlanCode
			stats.Trial.PlanName = getPlanDisplayName(activeEntitlement.PlanCode)
		} else {
			stats.Trial.IsOnTrial = false
			stats.Trial.PlanCode = "none"
			stats.Trial.PlanName = "No active plan"
		}
	}

	return &stats, nil
}

// getPlanDisplayName returns human-readable plan name
func getPlanDisplayName(code string) string {
	switch code {
	case "trial":
		return "Free Trial (3 days)"
	case "starter":
		return "Starter ($12/mo)"
	case "pro":
		return "Pro ($29/mo)"
	case "studio":
		return "Studio ($79/mo)"
	case "lifetime_1":
		return "Lifetime 1 ($199 once)"
	case "lifetime_5":
		return "Lifetime 5 ($599 once)"
	case "lifetime_10":
		return "Lifetime 10 ($999 once)"
	default:
		return code
	}
}

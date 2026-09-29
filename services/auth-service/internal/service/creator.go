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
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

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
	if len(displayName) < 1 || len(displayName) > 80 {
		return nil, model.ErrChannelNotFound // generic-ish; message below clearer
	}

	// ---- Description length ----
	if len(description) > 2000 {
		description = description[:2000]
	}

	// ---- Duplicate check (clear error ke liye) ----
	var existing int64
	if err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("user_id = ? AND LOWER(handle) = ?", userID, handle).
		Count(&existing).Error; err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, model.ErrHandleTaken
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
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
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

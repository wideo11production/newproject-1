package service

// ============================================================================
// USER SETTINGS SERVICE  -  SSOT for user preferences
// ============================================================================
//
// Design decisions:
//
//  1. LAZY CREATE
//     Har user ki settings row turant nahi banti. Pehli read par ban jaati
//     hai with defaults. Isse: (a) registration fast rehta hai, (b) naye
//     users ke liye migration backfill likhne ki zaroorat nahi.
//
//  2. GET-OR-CREATE (single query path)
//     Read aur create dono `GetOrCreateSettings` se - isliye caller ko
//     "row hai ya nahi" check karne ki zaroorat nahi.
//
//  3. SERVER VALIDATION, NOT JUST DB
//     DB par CHECK constraints hain, lekin invalid input ko DB tak pohonchane
//     se pehle 400 dena better UX hai aur galtiyan early pakadti hai.
//
//  4. ALLOWLIST, NOT BLACKLIST
//     Theme/accent/language ko allowlist se validate karte hain. Blacklist
//     (e.g. "javascript: reject karo") bypass ho sakta hai; allowlist nahi.
//
// Hinglish comments: har block ka arth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/wideo11/auth-service/internal/model"
)

// Settings validation errors - handler inhe map karega
var (
	// ErrInvalidTheme - theme allowed list me nahi hai
	ErrInvalidTheme = errors.New("invalid theme")
	// ErrInvalidAccent - accent palette me nahi hai
	ErrInvalidAccent = errors.New("invalid accent colour")
	// ErrInvalidLanguage - language supported list me nahi hai
	ErrInvalidLanguage = errors.New("invalid language code")
)

// GetOrCreateSettings user ki settings laata hai, aur nahi hai to DEFAULTS
// ke saath bana deta hai.
//
// `ON CONFLICT DO NOTHING` + re-select ka pattern use hua hai taaki do
// concurrent requests (double-click, StrictMode) race karke duplicate row na
// banaayein - kyunki user_id PRIMARY KEY hai, dobara insert fail hoga.
func (s *AuthService) GetOrCreateSettings(ctx context.Context, userID uuid.UUID) (*model.UserSettings, error) {
	var settings model.UserSettings

	// Attempt 1: padho
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&settings).Error
	if err == nil {
		return &settings, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Attempt 2: defaults ke saath banao.
	// NOTE: zero-value struct insert karne se GORM `DEFAULT` column values
	// use karta hai (theme='dark', accent='#5794f2' etc.) - isliye hume
	// explicitly set karne ki zaroorat nahi.
	newSettings := model.UserSettings{
		UserID:    userID,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&newSettings).Error; err != nil {
		return nil, err
	}

	// Re-read: agar doosre request ne row bana di thi, to wo milegi.
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&settings).Error; err != nil {
		return nil, err
	}
	return &settings, nil
}

// UpdateSettings partial update karta hai.
//
// `*string` / `*bool` pointers isliye hain taki "field bheja hi nahi" aur
// "field bheja, value false" distinguish ho sakein (comment model
// `UpdateSettingsRequest` me bhi hai).
func (s *AuthService) UpdateSettings(
	ctx context.Context,
	userID uuid.UUID,
	req *model.UpdateSettingsRequest,
) (*model.UserSettings, error) {
	// Row ensure karo (user ne kabhi settings open hi nahi ki)
	current, err := s.GetOrCreateSettings(ctx, userID)
	if err != nil {
		return nil, err
	}

	// ---- Server-side validation (fail fast, clear errors) ----
	updates := map[string]any{}

	if req.Theme != nil {
		t := strings.TrimSpace(*req.Theme)
		if !model.IsValidTheme(t) {
			return nil, ErrInvalidTheme
		}
		updates["theme"] = t
	}

	if req.Accent != nil {
		// Normalize: uppercase hex ko lowercase me le jaate hain taki
		// "#5794F2" aur "#5794f2" same maane jaayein.
		a := strings.ToLower(strings.TrimSpace(*req.Accent))
		if !model.IsValidAccent(a) {
			return nil, ErrInvalidAccent
		}
		updates["accent"] = a
	}

	if req.Language != nil {
		l := strings.ToLower(strings.TrimSpace(*req.Language))
		if !model.IsValidLanguage(l) {
			return nil, ErrInvalidLanguage
		}
		updates["language"] = l
	}

	// Booleans - pointer nil check se direct set
	if req.ContentUploadEnabled != nil {
		updates["content_upload_enabled"] = *req.ContentUploadEnabled
	}
	if req.SubscriptionsEnabled != nil {
		updates["subscriptions_enabled"] = *req.SubscriptionsEnabled
	}
	if req.EmailNotifications != nil {
		updates["email_notifications"] = *req.EmailNotifications
	}

	// Kuch nahi bheja -> current return karo (no-op update)
	if len(updates) == 0 {
		return current, nil
	}

	updates["updated_at"] = time.Now()

	// NOTE: `Model().Updates(map)` - GORM sirf map ke keys update karta hai,
	// baaki columns untouched rehte hain (partial update semantics).
	if err := s.db.WithContext(ctx).
		Model(&model.UserSettings{}).
		Where("user_id = ?", userID).
		Updates(updates).Error; err != nil {
		return nil, err
	}

	// Updated row wapas padho (source of truth DB se, cache nahi)
	var updated model.UserSettings
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&updated).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

// GetSettingsResponse user ki identity + settings ek saath deta hai.
//
// ONE CALL principle: settings page ko alag se profile fetch karne ki
// zaroorat nahi - ek read me sab mil jaata hai (SSOT).
func (s *AuthService) GetSettingsResponse(ctx context.Context, userID uuid.UUID) (*model.GetSettingsResponse, error) {
	settings, err := s.GetOrCreateSettings(ctx, userID)
	if err != nil {
		return nil, err
	}

	resp := &model.GetSettingsResponse{
		Theme:                settings.Theme,
		Accent:               settings.Accent,
		Language:             settings.Language,
		ContentUploadEnabled: settings.ContentUploadEnabled,
		SubscriptionsEnabled: settings.SubscriptionsEnabled,
		EmailNotifications:   settings.EmailNotifications,
	}

	// ---- Effective upload capability (Phase B2) ----
	//
	// Toggle (intent) aur actual allowed state alag ho sakte hain - unverified
	// ya inactive account ka toggle ON dikhta hai par upload allowed nahi.
	// Frontend ko dono chahiye warna user ko bina samjhe 403 milega.
	//
	// NOTE: error par `resp` ke defaults (false / "") rehne dete hain. Ye
	// FAIL-CLOSED hai - settings page dikhna zaroori hai, aur agar policy
	// evaluate na ho payi to "allowed = false" hi dikhana safe hai.
	if decision, dErr := s.IsContentUploadAllowed(ctx, userID); dErr == nil {
		resp.ContentUploadAllowed = decision.Allowed
		resp.ContentUploadReason = string(decision.Reason)
	}

	// Identity alag se - agar user row mile to bhar do, warna identity fields
	// khali chhod do (settings phir bhi kaam karengi).
	if user, uErr := s.userRepo.GetByID(ctx, userID); uErr == nil {
		resp.Email = user.Email
		resp.Username = user.Username
		resp.FullName = user.FullName
		resp.AvatarURL = user.AvatarURL
		resp.Role = user.Role
	}

	return resp, nil
}

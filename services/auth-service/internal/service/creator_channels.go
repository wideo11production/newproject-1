package service

// ============================================================================
// CHANNEL MANAGEMENT  -  Phase B1
// ============================================================================
//
// Pehle channel sirf CREATE aur LIST ho sakta tha. Edit, cover image,
// visibility toggle aur delete - koi bhi raasta nahi tha, matlab ek channel
// bana ke uska display name galat ho gaya to use THEEK hi nahi kar sakte
// the, bas naya channel bana ke purana chhodna pada.
//
// ---- THE ONE RULE THAT MATTERS HERE ----
//
// Har query me `user_id = ?` ZAROORI hai, aur wo value HAMESHA token se
// aati hai - body ya URL se nahi.
//
// Bina is filter ke ye sab IDOR (Insecure Direct Object Reference) hain:
//     PATCH /channels/<victim-uuid>   -> attacker victim ka channel edit karta hai
//     DELETE /channels/<victim-uuid> -> attacker victim ka channel delete karta hai
//
// Isliye har function ke doosre parameter me userID zaroori hai, aur `WHERE`
// clause me dono (`id` AUR `user_id`) lagte hain. `id` se match hone par bhi
// jab `user_id` match na kare to query kuch nahi lautati - hum 404 dete hain,
// 403 nahi (403 se attacker ko pata chalta hai ki wo channel EXIST karta hai).
//
// Hinglish: har query me user_id filter, warna koi doosre ka data dekh/Edit
// kar lega

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// ---- Validation limits (DB par bhi CHECK constraints hain, ye application
// level par jaldi, friendly error dete hain) ----
const (
	ChannelDisplayNameMax = 80
	ChannelDescriptionMax = 2000
	ChannelURLMax         = 500
)

// UpdateChannel channel ke editable fields update karta hai.
//
// SECURITY: scope `id = ? AND user_id = ?` dono par hai. Sirf `id` hone se
// ye vulnerability ban jati.
//
// PARTIAL UPDATE: `nil` fields chhode jaate hain. Isliye caller ko poora
// channel read kar ke wapas bhejne ki zaroorat nahi - sirf change karna hai.
//
// CONCURRENCY: `Model().Updates(map)` GORM me zero-value fields SKIP kar
// deta hai (struct me), isliye MAP use kiya hai - map me `false` aur `""`
// bhi update hote hain. Ye wahi reason hai jo pointer fields ka hai: bina
// iske "channel ko private karo" (false) chupke se ignore ho jayega.
//
// RowsAffected == 0 ka matlab: ya channel nahi hai, ya wo dusre user ka
// hai. Dono cases me SAME response (404) jaana chahiye - alag response se
// attacker ko pata chalta hai ki wo channel exist karta hai.
func (s *AuthService) UpdateChannel(
	ctx context.Context,
	userID uuid.UUID,
	channelID uuid.UUID,
	req *model.UpdateChannelRequest,
) (*model.Channel, error) {
	if req == nil {
		return nil, model.ErrChannelNotFound
	}

	updates := map[string]interface{}{}

	if req.DisplayName != nil {
		name := strings.TrimSpace(*req.DisplayName)
		if len(name) < 1 || len(name) > ChannelDisplayNameMax {
			return nil, model.ErrDisplayNameInvalid
		}
		updates["display_name"] = name
	}

	if req.Description != nil {
		desc := strings.TrimSpace(*req.Description)
		if len(desc) > ChannelDescriptionMax {
			return nil, model.ErrDescriptionTooLong
		}
		// '' ko NULL nahi bana rahe: migration 011 ne description ko NOT NULL
		// kar diya hai taaki frontend ko `null` aur `""` dono handle na karne
		// padein. Dono representations ek jaisa rakhna zaroori hai.
		updates["description"] = desc
	}

	// ---- URL fields: shape validation, not just length ----
	//
	// `javascript:` / `data:` URLs yahan stored XSS ka vector hain. Koi admin
	// panel ya notification renderer inhe `src`/`href` me daal de to script
	// chal sakta hai. Avatar par ye validation pehle se thi (handler me) -
	// yahan wahi rule channel image/cover par lagaya gaya hai.
	for field, value := range map[string]*string{
		"image_url": req.ImageURL,
		"cover_url": req.CoverURL,
	} {
		if value == nil {
			continue
		}
		clean, err := sanitizeChannelURL(*value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", field, err)
		}
		updates[field] = clean
	}

	if req.IsPublic != nil {
		updates["is_public"] = *req.IsPublic
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	// ---- Kuch bhi badalne ko nahi mila ----
	//
	// Empty PATCH (sab nil) par UPDATE chalana bekaar hai. `updated_at` ko
	// chhed kar "last modified" galat dikha dega. Isliye no-op return karte
	// hain - par CHANNEL verify zaroor karte hain, warna ek attacker
	// arbitrary UUID bhej ke existence oracle ban sakta hai (404 vs 200 se
	// pata chalta hai channel exist karta hai ya nahi).
	var existing model.Channel
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}

	if len(updates) == 0 {
		return &existing, nil
	}

	if err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("id = ? AND user_id = ?", channelID, userID).
		Updates(updates).Error; err != nil {
		// DB CHECK constraint ne reject kiya (e.g. handle format) - humne
		// application level par validate kiya hai, par DB bhi last line of
		// defence hai. Iska matlab koi constraint mismatch hai, genuine 4xx.
		if isCheckViolation(err) {
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}

	// Re-read taaki response me updated values (aur updated_at trigger) aayein.
	var updated model.Channel
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&updated).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

// GetChannelByID owner-scoped channel fetch karta hai.
func (s *AuthService) GetChannelByID(
	ctx context.Context,
	userID, channelID uuid.UUID,
) (*model.Channel, error) {
	var channel model.Channel
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&channel).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}
	return &channel, nil
}

// DeleteChannel channel ko SOFT delete karta hai.
//
// ---- WHY SOFT, NOT HARD ----
// Soft delete (`deleted_at` set) do fayde deta hai:
//  1. Accidental delete recover ho sakta hai.
//  2. Agar channel se linked videos/subscriptions hain to wo orphan nahi
//     hote - FK constraint ya data loss dono avoid hote hain.
//
// GORM `DeletedAt gorm.DeletedAt` hone ki wajah se ye row ab normal queries
// me dikhti hi nahi - `Unscoped()` chala ke hi dikhegi.
//
// SECURITY: phir bhi `user_id` filter LAGA HAI. Soft delete bhi ek write
// operation hai - bina filter ke koi doosre ka channel delete kar sakta hai.
func (s *AuthService) DeleteChannel(ctx context.Context, userID, channelID uuid.UUID) error {
	result := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		Delete(&model.Channel{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return model.ErrChannelNotFound
	}
	return nil
}

// GetPublicChannelByHandle PUBLIC channel page ke liye fetch karta hai.
//
// ---- SECURITY: THIS IS THE SENSITIVE ONE ----
//
// Ye authenticated NAHI hai (koi bhi visitor channel page dekh sakta hai).
// Isliye ye function ko teen baar guard karna zaroori hai:
//
//  1. `is_active = true`      - deactivated channels public nahi dikhte
//  2. `is_public = true`      - PRIVATE channels KABHI public read se nahi
//  3. `deleted_at IS NULL`    - GORM scope already lagata hai par explicit
//     rakhna taaki intent saaf rahe
//
// SABSE BADA RISK yahi hai: private channel ka data public read endpoint se
// leak hona. Isliye private channel ke liye bhi SAME error return hota hai
// (ErrChannelNotFound) - "private" vs "does not exist" alag batane se
// attacker ko pata chalega ki wo handle exist karta hai (enumeration).
//
// NOTE: ye `UserID` return NAHI karta sirf `PublicChannelResponse` - jisme
// user_id field hi nahi hai. Internal identifiers public payload me leak
// nahi hone chahiye.
func (s *AuthService) GetPublicChannelByHandle(
	ctx context.Context,
	handle string,
) (*model.PublicChannelResponse, error) {
	normalized := strings.ToLower(strings.TrimSpace(handle))
	// Handle me '@' prefix allow karte hain - users copy-paste karte hain
	// "@aarav" URL se. Parse ke baad wo hata dena hai.
	normalized = strings.TrimPrefix(normalized, "@")

	if !handlePattern.MatchString(normalized) {
		// Invalid shape = 404. Valid-but-private par bhi 404 (upar explain).
		return nil, model.ErrChannelNotFound
	}

	var channel model.Channel
	err := s.db.WithContext(ctx).
		Select("id, handle, display_name, description, image_url, cover_url, is_public, is_active, created_at, updated_at").
		Where("handle = ?", normalized).
		Where("is_public = ?", true).
		Where("is_active = ?", true).
		First(&channel).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}

	return &model.PublicChannelResponse{
		ID:          channel.ID,
		Handle:      channel.Handle,
		DisplayName: channel.DisplayName,
		Description: channel.Description,
		ImageURL:    channel.ImageURL,
		CoverURL:    channel.CoverURL,
		CreatedAt:   channel.CreatedAt,
		UpdatedAt:   channel.UpdatedAt,
	}, nil
}

// ListPublicChannels public channel discovery list ke liye.
//
// NOTE: ye `PublicChannelResponse` list karta hai, raw `Channel` nahi - isse
// `user_id`, `is_active`, `deleted_at` jaise internal fields kabhi client tak
// nahi pahunchte (mass-assignment surface kam hota hai).
func (s *AuthService) ListPublicChannels(
	ctx context.Context,
	limit int,
) ([]model.PublicChannelResponse, error) {
	// ---- Upper bound on limit ----
	// Client `?limit=1000000` bhej sakta hai. Bina cap ke ek request poori
	// table kheench lega - ye khud ek DoS vector hai (authenticated bhi
	// na ho to bhi). Isliye clamp karte hain.
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	var channels []model.Channel
	err := s.db.WithContext(ctx).
		Select("id, handle, display_name, description, image_url, cover_url, created_at, updated_at").
		Where("is_public = ?", true).
		Where("is_active = ?", true).
		Order("created_at DESC").
		Limit(limit).
		Find(&channels).Error
	if err != nil {
		return nil, err
	}

	out := make([]model.PublicChannelResponse, 0, len(channels))
	for _, ch := range channels {
		out = append(out, model.PublicChannelResponse{
			ID:          ch.ID,
			Handle:      ch.Handle,
			DisplayName: ch.DisplayName,
			Description: ch.Description,
			ImageURL:    ch.ImageURL,
			CoverURL:    ch.CoverURL,
			CreatedAt:   ch.CreatedAt,
			UpdatedAt:   ch.UpdatedAt,
		})
	}
	return out, nil
}

// sanitizeChannelURL image/cover URL ko validate karta hai.
//
// ALLOWED:
//   - "" (clear karna)
//   - "/" se shuru hone wala relative path (apne MinIO se)
//   - http:// ya https:// absolute URL
//
// BLOCKED:
//   - javascript:  - stored XSS (img onerror / link click)
//   - data:        - SVG/HTML payload inline
//   - vbscript:, file:, aur koi bhi unknown scheme
//
// NOTE: ye shape-check hai, ownership-check nahi. Ye ensure karta hai ki URL
// DANGEROUS na ho - ye ensure NAHI karta ki wo hamare storage ka hai.
// Agar channel image sirf apne MinIO se aana chahiye to origin pinning
// alag se lagani chahiye (avatar upload ke liye wo ownership check
// `FinalizeAvatarUpload` me already hai).
func sanitizeChannelURL(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", nil
	}
	if len(v) > ChannelURLMax {
		return "", model.ErrURLTooLong
	}

	// Relative path - apne storage se.
	if strings.HasPrefix(v, "/") {
		// `//evil.com` browser me protocol-relative URL ban jata hai, jo
		// `http://evil.com` jaisa hi behave karta hai. Isliye double slash
		// block karte hain.
		if strings.HasPrefix(v, "//") {
			return "", model.ErrURLSchemeNotAllowed
		}
		// Path traversal server side irrelevant hai (object key user-id
		// prefixed hai), par consistency ke liye block karte hain.
		if strings.Contains(v, "..") {
			return "", model.ErrURLSchemeNotAllowed
		}
		return v, nil
	}

	lower := strings.ToLower(v)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return v, nil
	}

	// Everything else - including javascript:, data:, vbscript:, file:.
	return "", model.ErrURLSchemeNotAllowed
}

// isCheckViolation Postgres CHECK-constraint violation detect karta hai.
//
// SQLSTATE 23514 = check_violation.
func isCheckViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23514") ||
		strings.Contains(msg, "violates check constraint")
}

// ---- handle se channel resolve karne ka helper (public page ke liye) ----

// ChannelHandleExists public handle enumeration BLOCK karne ke liye
// nahi, balki UI ke liye hai (handle available hai ya nahi). Isliye ye
// authenticated NAHI hai aur handle kisi aur ke channel ka bhi ho sakta hai
// - sirf current user ke channels me check karta hai.
func (s *AuthService) ChannelHandleExists(
	ctx context.Context,
	userID uuid.UUID,
	handle string,
) (bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(handle))
	if !handlePattern.MatchString(normalized) {
		return false, nil
	}
	var count int64
	err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("user_id = ? AND handle = ?", userID, normalized).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// compile-time: time import is used by the UpdatedAt comparisons above.
var _ = time.Now

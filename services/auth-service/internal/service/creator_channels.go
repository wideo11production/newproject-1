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
	"log"
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
	// ---- Read the handle BEFORE deleting ----
	//
	// Needed because the handle must be retired, and after the delete there is
	// nothing left to read it from - soft-deleted rows exist, but depending on
	// them for this would mean a channel whose row was hard-removed leaves its
	// address free.
	var channel model.Channel
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		Select("id, handle, user_id").
		First(&channel).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return model.ErrChannelNotFound
		}
		return err
	}

	result := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		Delete(&model.Channel{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return model.ErrChannelNotFound
	}

	// ---- Retire the handle ----
	//
	// The channel is gone, so the address MUST NOT go with it.
	//
	// A channel handle is a public URL. Everything pointing at it - bookmarks,
	// search results, links someone shared - keeps pointing there after the
	// creator deletes it. If the handle became free, the next person to register
	// it would inherit that traffic and that trust, and nobody could tell the
	// difference by looking at the address. Same rule as an email address, which
	// is why this is not "delete and move on".
	//
	// Best-effort, and deliberately NOT fatal: the channel is already deleted by
	// this point, so failing the request would report an error for something that
	// already happened - and would leave the caller thinking the delete was
	// rolled back when it was not. The handle is the only thing still free, and
	// the unique index does not cover retired handles, so it is logged loudly
	// instead.
	uid := userID
	if err := model.UpsertRetiredHandle(s.db.WithContext(ctx), strings.ToLower(channel.Handle), &uid, "deleted"); err != nil {
		log.Printf("[CHANNELS] could not retire handle %q after deleting channel %s: %v - THE HANDLE MAY BE REUSABLE", channel.Handle, channelID, err)
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
	// ---------------------------------------------------------------------------
	// THE COLUMN ALLOWLIST, AND WHY IT IS GOOD NEWS
	// ---------------------------------------------------------------------------
	//
	// This is an explicit list rather than `SELECT *`, and that is the reason the
	// step-2 branding had to be added here by hand: a new private column added to
	// the model does NOT leak into the public payload by default. Someone has to
	// choose to publish it.
	//
	// That is worth keeping, and worth knowing about. `channels` has a
	// `contact_email` on it that must never be public, and with `SELECT *` the day
	// somebody adds a column nobody thinks about, it is on every public page until
	// somebody notices. With an allowlist the default is private.
	//
	// The cost is this: a field can be in `PublicChannelResponse`, documented, and
	// still not reach the client. That is exactly what happened to `logo_url`,
	// `tagline` and `brand_hue` - the DTO had all three and the page showed none of
	// them. `tools/check-channel-setup.mjs` asserts a visitor SEES the logo and the
	// tagline, because the only symptom otherwise is an empty banner on a channel
	// the creator has definitely finished setting up.
	//
	// Step-2 branding (migration 022) is public by design - it is the creator's own
	// content and it is the point of a channel page.
	//
	// The per-channel UPLOAD DEFAULTS are deliberately NOT here. They decide who
	// may comment and how an upload is classified; they are channel settings, not
	// public channel facts, and nothing on a public page needs them.
	err := s.db.WithContext(ctx).
		Select(`id, handle, display_name, description, image_url, cover_url,
		        logo_url, tagline, brand_hue, channel_type,
		        is_public, is_active, visibility, setup_step2_at, created_at, updated_at`).
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

	// Only the fields a visitor's page actually needs.
	//
	// `contact_email` is NOT here and must never be added: `channels` carries it,
	// it is private by definition, and this is the endpoint that has no
	// authentication at all.
	out := &model.PublicChannelResponse{
		ID:          channel.ID,
		Handle:      channel.Handle,
		DisplayName: channel.DisplayName,
		Description: channel.Description,
		// `image_url` first, `logo_url` second. A logo is the newer, better asset
		// and wins where both exist, but most channels predate step 2 and have only
		// `image_url`, so the page must still render something for them.
		ImageURL:  firstNonEmpty(channel.LogoURL, channel.ImageURL),
		CoverURL:  channel.CoverURL,
		Tagline:   channel.Tagline,
		BrandHue:  channel.BrandHue,
		CreatedAt: channel.CreatedAt,
		UpdatedAt: channel.UpdatedAt,
	}
	if channel.ChannelType != nil {
		out.ChannelType = channel.ChannelType
	}
	return out, nil
}

// firstNonEmpty returns the first non-blank value.
//
// Used for the avatar, where two columns hold the same idea at different ages.
// Naming the preference once means the by-handle page and the browse list cannot
// disagree about which image a channel is shown as - and "the card shows your
// logo but your page shows your old avatar" is the kind of inconsistency nobody
// reports and everybody notices.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ListPublicChannels public channel discovery list ke liye.
//
// NOTE: ye `PublicChannelResponse` list karta hai, raw `Channel` nahi - isse
// `user_id`, `is_active`, `deleted_at` jaise internal fields kabhi client tak
// nahi pahunchte (mass-assignment surface kam hota hai).
// PublicChannelStats is the per-channel aggregate the browse page needs.
//
// The counts are DERIVED, not stored:
//   - subscribers from the `channel_subscriber_counts` VIEW
//   - videos and reels from `media_assets`, counting only `ready` rows
//   - the latest thumbnail from the newest `ready` asset that has a poster
//
// Deriving them here rather than keeping denormalised columns is the same
// decision as everywhere else in this codebase: a stored counter drifts the
// first time something changes without going through the one place that
// increments it, and the drift is invisible.
type PublicChannelStats struct {
	SubscriberCount int64      `json:"subscriber_count"`
	VideoCount      int64      `json:"video_count"`
	ReelCount       int64      `json:"reel_count"`
	LatestThumbnail *string    `json:"latest_thumbnail,omitempty"`
	LatestUploadAt  *time.Time `json:"latest_upload_at,omitempty"`
}

// ListPublicChannels returns public channels with the counts a browse page
// needs, in ONE query.
//
// ---- WHY ONE QUERY AND NOT A LOOP ----
//
// The obvious implementation loads the channels and then, per channel, counts
// subscribers, counts videos, and fetches the newest poster. That is 1 + 3N
// queries, and a page showing 24 channels turns into 73 round trips. It also
// produces a page whose cards disagree with each other, because each count was
// read at a different instant.
//
// A LEFT JOIN LATERAL reads all three at the same statement, so a card's numbers
// are internally consistent - "250 subscribers, 12 videos" always describes one
// moment, not three.
func (s *AuthService) ListPublicChannels(
	ctx context.Context,
	limit int,
	channelType string,
) ([]model.PublicChannelResponse, []PublicChannelStats, error) {
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

	// ---- Filter by type, validated against the closed set ----
	//
	// An unvalidated type would reach the query as a filter that matches
	// nothing and looks like "this category has no channels" rather than "you
	// asked for something that does not exist".
	filterType := ""
	if t := strings.ToLower(strings.TrimSpace(channelType)); t != "" {
		if !model.ValidChannelType[t] {
			return nil, nil, fmt.Errorf("%w: %q", model.ErrChannelTypeInvalid, t)
		}
		filterType = t
	}

	type row struct {
		model.Channel
		SubscriberCount int64      `gorm:"column:subscriber_count"`
		VideoCount      int64      `gorm:"column:video_count"`
		ReelCount       int64      `gorm:"column:reel_count"`
		LatestThumbnail *string    `gorm:"column:latest_thumbnail"`
		LatestUploadAt  *time.Time `gorm:"column:latest_upload_at"`
	}

	// The counts and the newest poster now come from `channel_content_counts`
	// (migration 019) instead of literal zeros, so the browse page reflects real
	// uploads. Still ONE statement: two views joined, not a per-channel query.
	//
	// `COALESCE` is load-bearing. A channel with no media has NO ROW in the
	// content view, so the LEFT JOIN yields NULL - and a `null` on a card renders
	// as the string "null", which is a different and more confusing thing than the
	// zero it is supposed to be.
	// `logo_url` and `tagline` are here for the same reason they were added to
	// `GetPublicChannelByHandle`: a channel's identity is its logo, and a browse
	// card showing the old avatar while the channel page shows the logo is an
	// inconsistency nobody reports and everybody notices.
	//
	// An explicit column list rather than `SELECT *` for the same reason as the
	// by-handle query - see the comment there. `contact_email` is on this table and
	// must never appear in either.
	const browseSelect = "channels.id, channels.handle, channels.display_name, channels.description, " +
		"channels.image_url, channels.logo_url, channels.cover_url, channels.tagline, channels.brand_hue, " +
		"channels.channel_type, " +
		"channels.created_at, channels.updated_at, " +
		"COALESCE(sub.subscriber_count, 0) AS subscriber_count, " +
		"COALESCE(content.video_count, 0) AS video_count, " +
		"COALESCE(content.reel_count, 0) AS reel_count, " +
		"content.latest_thumbnail, content.latest_upload_at"

	var rows []row
	q := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Select(browseSelect).
		// `Joins`, not a hand-written `LEFT JOIN ...` chained on after a
		// selector. Both work in GORM, but a raw join reads as Go and the parser
		// reports it at the JOIN keyword with no hint that the problem is a
		// selector chain.
		Joins("LEFT JOIN channel_subscriber_counts sub ON sub.channel_id = channels.id").
		Joins("LEFT JOIN channel_content_counts content ON content.channel_id = channels.id").
		Where("channels.is_public = ?", true).
		Where("channels.is_active = ?", true)

	if filterType != "" {
		q = q.Where("channels.channel_type = ?", filterType)
	}

	err := q.Order("channels.created_at DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, nil, err
	}

	channels := make([]model.PublicChannelResponse, 0, len(rows))
	stats := make([]PublicChannelStats, 0, len(rows))
	for _, r := range rows {
		channels = append(channels, model.PublicChannelResponse{
			ID:          r.ID,
			Handle:      r.Handle,
			DisplayName: r.DisplayName,
			Description: r.Description,
			// Logo wins over the legacy avatar, same as on the channel page.
			ImageURL:    firstNonEmpty(r.LogoURL, r.ImageURL),
			CoverURL:    r.CoverURL,
			Tagline:     r.Tagline,
			BrandHue:    r.BrandHue,
			ChannelType: r.ChannelType,
			CreatedAt:   r.CreatedAt,
			UpdatedAt:   r.UpdatedAt,
		})
		stats = append(stats, PublicChannelStats{
			SubscriberCount: r.SubscriberCount,
			VideoCount:      r.VideoCount,
			ReelCount:       r.ReelCount,
			LatestThumbnail: r.LatestThumbnail,
			LatestUploadAt:  r.LatestUploadAt,
		})
	}
	return channels, stats, nil
}

// PublicChannelMedia is one published item on a channel's page.
//
// `kind` is carried explicitly rather than left for the client to infer from a
// URL: the browse page renders reels and videos differently, and a client that
// guesses gets one of them wrong.
type PublicChannelMedia struct {
	ID           uuid.UUID `json:"id"`
	Kind         string    `json:"kind"`
	Filename     string    `json:"filename"`
	DurationS    int       `json:"duration_seconds"`
	Width        int       `json:"width"`
	Height       int       `json:"height"`
	Bytes        int64     `json:"bytes"`
	PosterURL    *string   `json:"poster_url,omitempty"`
	HLSPublicURL *string   `json:"hls_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// ListPublicChannelMedia returns the published media for a channel.
//
// ONLY `ready`, and ONLY the channel's own. A private channel has no public
// media, so a caller cannot read someone's drafts through this route - and the
// private-channel case returns the same 404 as a missing one, so the route is
// not an existence oracle.
//
// `kind` filters to videos or reels; empty means both. Validated against the
// closed set, because an unfiltered `kind` would have to be escaped into SQL
// and an escaped one is still an extra surface.
func (s *AuthService) ListPublicChannelMedia(
	ctx context.Context,
	handle, kind string,
	limit, offset int,
) ([]PublicChannelMedia, int64, error) {
	if limit <= 0 {
		limit = 24
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	switch kind {
	case "", model.MediaKindVideo, model.MediaKindReel:
	default:
		return nil, 0, fmt.Errorf("unknown media kind %q", kind)
	}

	channel, err := s.GetPublicChannelByHandle(ctx, handle)
	if err != nil {
		return nil, 0, err
	}

	q := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("channel_id = ?", channel.ID).
		// READY only. An `initiated` asset has had nothing sent, a `scanning` one
		// may not even be a video, and a `failed` one certainly is not playable.
		// Listing them would put a grey tile on a creator's public page.
		Where("status = ?", model.MediaStatusReady)

	if kind != "" {
		q = q.Where("kind = ?", kind)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var assets []model.MediaAsset
	err = q.Select("id, kind, filename, duration_seconds, width, height, bytes, " +
		"poster_public_url, hls_public_url, created_at").
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&assets).Error
	if err != nil {
		return nil, 0, err
	}

	out := make([]PublicChannelMedia, 0, len(assets))
	for _, a := range assets {
		out = append(out, PublicChannelMedia{
			ID:           a.ID,
			Kind:         a.Kind,
			Filename:     a.Filename,
			DurationS:    a.DurationS,
			Width:        a.Width,
			Height:       a.Height,
			Bytes:        a.Bytes,
			PosterURL:    a.PosterPublicURL,
			HLSPublicURL: &a.HLSPublicURL,
			CreatedAt:    a.CreatedAt,
		})
	}
	return out, total, nil
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

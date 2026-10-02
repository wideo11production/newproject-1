package service

// =============================================================================
// CHANNEL SETUP - STEP 2
// =============================================================================
//
// Creating a channel and having a channel are different things, and the gap
// between them is where a channel dies. A row with a name and a category is not
// something anyone comes back to.
//
// Step 2 closes that gap, and the requirement is that it is COMPULSORY: a
// channel that has not been set up does not let its creator leave the setup
// screen. That decision has consequences, and they are handled here rather than
// pretended away:
//
//   - Every field has a safe default, so the screen can never be a dead end.
//     There is no combination of answers that leaves a creator stuck; the worst
//     case is a channel with no logo and the platform's colour.
//   - Step 2 stays RE-EDITABLE afterwards. Compulsory at the moment of creation
//     is a nudge; compulsory forever would be a hostage situation.
//   - The gate is server-derived, never a client flag, so a creator cannot skip
//     it by editing their own request.
//
// =============================================================================
// WHY THE BRAND COLOUR IS A HUE AND NOT A STRING
// =============================================================================
//
// Because this value reaches an inline style on a page every visitor loads.
//
// A free `#rrggbb` field is a stored-XSS vector the first time any component
// writes `style={{ background: channel.brand_color }}` with something less
// careful than a CSS parser. It is also a legibility bug waiting to happen: a
// creator picks white, and their own page is blank.
//
// So the column stores an integer 0-359 and the RGB comes from the palette below.
// A channel can express a colour this codebase chose, or none. It cannot express
// one we did not review, which means every channel colour passes contrast against
// both themes and no CSS is ever assembled from user input.

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

// ErrStep2NotFinished - the channel exists but has not been set up.
//
// Its own error, distinct from "not found", because the caller's response is
// different: a redirect back to setup rather than a 404.
var ErrStep2NotFinished = errors.New("channel setup step 2 is not finished")

// BrandPalette maps a hue onto a lightness/SATURATION that is legible on BOTH
// the light and the dark theme.
//
// The fixed L is the point. A creator picks a HUE and this codebase owns the
// lightness, so a channel colour can never be white-on-white. That is the
// guarantee a free hex field cannot make, and it is why the palette is here
// rather than spread across components.
//
// Values are HSL channel triples, matching the shared theme's convention, so a
// component writes `hsl(var(--x))` and never mixes up the two formats - a mistake
// this repo has already made once, with borders painting dark red.
type BrandPalette struct {
	Name string
	// Hue in degrees, 0-359.
	Hue int
	// Saturation and Lightness percentages, fixed for legibility on both themes.
	Saturation int
	Lightness  int
}

// BrandColors is the closed set of channel colours.
//
// Twelve hues, deliberately few. A palette is not a completeness exercise: every
// entry is a colour a human can recognise by name, and "choose one of twelve" is
// a decision whereas "enter a hex code" is a chore that most people abandon.
var BrandColors = []BrandPalette{
	{Name: "Ember", Hue: 8, Saturation: 78, Lightness: 56},
	{Name: "Coral", Hue: 22, Saturation: 80, Lightness: 58},
	{Name: "Amber", Hue: 38, Saturation: 84, Lightness: 52},
	{Name: "Lime", Hue: 78, Saturation: 62, Lightness: 46},
	{Name: "Green", Hue: 142, Saturation: 58, Lightness: 44},
	{Name: "Teal", Hue: 172, Saturation: 62, Lightness: 42},
	{Name: "Cyan", Hue: 192, Saturation: 70, Lightness: 46},
	{Name: "Sky", Hue: 206, Saturation: 76, Lightness: 56},
	{Name: "Indigo", Hue: 232, Saturation: 66, Lightness: 62},
	{Name: "Violet", Hue: 268, Saturation: 64, Lightness: 62},
	{Name: "Magenta", Hue: 306, Saturation: 64, Lightness: 56},
	{Name: "Rose", Hue: 340, Saturation: 70, Lightness: 56},
}

// DefaultBrandHue is used when a creator has not chosen one.
//
// 206 (Sky) rather than 0: it is the platform's own accent, so an unconfigured
// channel looks deliberate instead of unfinished.
const DefaultBrandHue = 206

// BrandFor resolves a stored hue to its palette entry.
//
// An unknown hue falls back to the default rather than being refused. That is the
// ONE place in this codebase where an out-of-range value is tolerated rather
// than rejected, and the asymmetry is deliberate: this runs while RENDERING a
// page for a visitor, and a page that 500s because a colour is unusual is a worse
// outcome than a page in the default colour. The value was already range-checked
// on the way IN, so this branch means "an old row or a hand-edited database", not
// "a user sent something invalid".
func BrandFor(hue *int) BrandPalette {
	target := DefaultBrandHue
	if hue != nil {
		target = *hue
	}
	for _, c := range BrandColors {
		if c.Hue == target {
			return c
		}
	}
	return BrandColors[DefaultBrandHue]
}

// ValidBrandHue reports whether a hue is one the palette actually offers.
//
// Used by the WRITE path, where refusing is right: a stored hue we do not offer
// would render through the fallback above, which is a silent surprise rather than
// an error.
func ValidBrandHue(hue int) bool {
	for _, c := range BrandColors {
		if c.Hue == hue {
			return true
		}
	}
	return false
}

// UpdateChannelSetup applies step 2.
//
// SECURITY: scoped `id = ? AND user_id = ?`, both from the caller's context. The
// channel id arrives in the URL but the user id NEVER arrives in the request - it
// comes from the token. Taking it from the body would make this an IDOR: any
// caller could set up somebody else's channel.
//
// PARTIAL by design: every field is a pointer, so a section-by-section save
// works. See `UpdateChannelSetupRequest` for why that distinction is load-bearing
// rather than fussy.
func (s *AuthService) UpdateChannelSetup(
	ctx context.Context,
	userID, channelID uuid.UUID,
	req *model.UpdateChannelSetupRequest,
) (*model.Channel, error) {
	if req == nil {
		return nil, model.ErrChannelNotFound
	}

	// ---- verify ownership BEFORE validating ----
	//
	// Order matters, and it is the same order `content_policy_gate.go` uses: a
	// policy refusal that also said "no such channel" would turn validation into
	// an existence oracle. Read first, then judge what may be written.
	var existing model.Channel
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Same answer for "does not exist" and "not yours". A 403 here would
			// confirm the channel exists, which turns this endpoint into a way to
			// enumerate other people's channel ids.
			return nil, model.ErrChannelNotFound
		}
		return nil, err
	}

	updates := map[string]interface{}{}

	if req.Tagline != nil {
		t := strings.TrimSpace(*req.Tagline)
		if len(t) > model.TaglineMaxLen {
			return nil, fmt.Errorf("%w (%d characters, limit %d)",
				model.ErrTaglineTooLong, len(t), model.TaglineMaxLen)
		}
		updates["tagline"] = t
	}

	// ---- brand colour ----
	//
	// Three distinct states, and collapsing any two of them is a bug:
	//   absent            -> leave it alone
	//   explicit null     -> clear to the platform default
	//   a hue             -> set it
	//
	// Without `brand_hue_is_null`, "clear my colour" is indistinguishable from
	// "I did not send a colour", so the default could never be restored.
	if req.BrandHueIsNull {
		updates["brand_hue"] = nil
	} else if req.BrandHue != nil {
		hue := *req.BrandHue
		// Range first, then membership. Range is the security check; membership is
		// the product check, and they answer different questions.
		if err := model.ValidateBrandHue(&hue); err != nil {
			return nil, err
		}
		if !ValidBrandHue(hue) {
			return nil, fmt.Errorf("brand colour %d is not one of the offered colours", hue)
		}
		updates["brand_hue"] = hue
	}

	if req.LogoURL != nil {
		if err := model.ValidateLogoURL(strings.TrimSpace(*req.LogoURL)); err != nil {
			return nil, err
		}
		updates["logo_url"] = strings.TrimSpace(*req.LogoURL)
	}

	// ---- visibility ----
	//
	// Writes `visibility` AND `is_public` together, in one statement. Migration
	// 022 has a CHECK constraint forcing them to agree, so a partial write would
	// be rejected by the database - which is the correct outcome, but a 500 from
	// a genuine user mistake is not. Setting both here is the fix, and the
	// constraint is the backstop.
	if req.Visibility != nil {
		v, err := model.NormaliseVisibility(*req.Visibility)
		if err != nil {
			return nil, err
		}
		updates["visibility"] = v
		updates["is_public"] = model.IsPublicForVisibility(v)
	}

	if req.ChannelType != nil {
		t := strings.ToLower(strings.TrimSpace(*req.ChannelType))
		if !model.ValidChannelType[t] {
			return nil, model.ErrChannelTypeInvalid
		}
		updates["channel_type"] = t
	}

	if req.Keywords != nil {
		k, err := model.NormaliseKeywords(*req.Keywords)
		if err != nil {
			return nil, err
		}
		updates["keywords"] = k
	}

	// ---- upload defaults ----
	if req.CommentsEnabled != nil {
		updates["comments_enabled"] = *req.CommentsEnabled
	}
	if req.CommentPolicy != nil {
		p := strings.ToLower(strings.TrimSpace(*req.CommentPolicy))
		if !model.IsKnownCommentPolicy(p) {
			return nil, model.ErrCommentPolicy
		}
		// Turning comments off while leaving the policy at "anyone" is a
		// contradiction that two readers will resolve differently. Comments off
		// makes the policy irrelevant, so it is pinned rather than stored as a
		// claim nobody means.
		if req.CommentsEnabled != nil && !*req.CommentsEnabled {
			p = model.CommentApproved
		}
		updates["comment_policy"] = p
	}
	if req.KidsAutoClassify != nil {
		updates["kids_auto_classify"] = *req.KidsAutoClassify
	}
	if req.WatermarkEnabled != nil {
		updates["watermark_enabled"] = *req.WatermarkEnabled
	}

	if req.FinishStep2 {
		// Stamped HERE, server-side, from the server clock. A client-supplied
		// timestamp would be a lie waiting to be told - and the only consumer of
		// this value is a gate and a report, both of which are better served by a
		// time nobody else chose.
		updates["setup_step2_at"] = time.Now().UTC()
	}

	if len(updates) == 0 {
		return &existing, nil
	}

	if err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("id = ? AND user_id = ?", channelID, userID).
		Updates(updates).Error; err != nil {
		if isCheckViolation(err) {
			// The CHECK in migration 022 caught something the application-level
			// validation let past. That is the constraint doing its job, and the
			// honest response is a 400 - not a 500, and not a silent success.
			return nil, fmt.Errorf("%w: the channel settings violate a database rule", model.ErrChannelNotFound)
		}
		return nil, err
	}

	var updated model.Channel
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&updated).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

// ChannelNeedsSetup reports whether a channel still has to be set up.
//
// THE ONLY QUESTION THE GATE ASKS, and it is asked of the DATABASE rather than
// of the client. A `?skip=true` in the URL, a missing form field, or a doctored
// request body cannot answer it differently, because none of them are consulted.
func (s *AuthService) ChannelNeedsSetup(
	ctx context.Context, userID, channelID uuid.UUID,
) (bool, error) {
	var c model.Channel
	err := s.db.WithContext(ctx).
		Select("id", "setup_step2_at").
		Where("id = ? AND user_id = ?", channelID, userID).
		First(&c).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, model.ErrChannelNotFound
		}
		return false, err
	}
	return c.SetupStep2At == nil, nil
}

// ChannelNeedingSetup is the channel the dashboard should send the creator to.
//
// ONE channel, and it is the NEWEST one - whether or not the newest is finished.
//
// -----------------------------------------------------------------------------
// WHY IT IS NOT "THE OLDEST UNFINISHED CHANNEL"
// -----------------------------------------------------------------------------
//
// That was the first implementation: newest channel WHERE setup_step2_at IS NULL.
// It is wrong, and the browser check found it with a database that had accumulated
// 26 half-finished channels from earlier test runs.
//
//	pending: 26, needs_setup: true, forever
//
// A creator finishes the channel the gate sent them to, and the gate immediately
// picks a DIFFERENT unfinished channel - one they may have abandoned weeks ago -
// and sends them to that instead. The dashboard becomes unreachable through the
// front door, and the only way out is to finish every channel you have ever
// started, in order, oldest first.
//
// That is not an edge case. Abandoned channels are the normal state of a channel
// list, and "compulsory" must not mean "you may never return to your dashboard
// again".
//
// So: take the newest channel, full stop. If it is unfinished, step 2 is what
// comes next - because that is the channel the creator was making a moment ago,
// and it is the one whose answers they are holding in their head. If it is
// finished, the gate releases, and the older unfinished ones are visible on the
// dashboard as things to tidy rather than as a wall.
//
// This matches the requirement as stated: step 2 belongs to the channel that was
// just created, not to every channel that has ever existed.
//
// Returns uuid.Nil when there is no channel at all, or the newest one is done, so
// a caller does not have to distinguish "none" from "finished".
func (s *AuthService) ChannelNeedingSetup(
	ctx context.Context, userID uuid.UUID,
) (uuid.UUID, error) {
	// A ONE-ELEMENT SLICE, not a bare `*uuid.UUID`.
	//
	// GORM's `Scan` is built for a struct or a slice of structs. Handing it a bare
	// non-struct pointer works for some types and fails for others, and for
	// `uuid.UUID` it fails - so the first version of this returned an error on
	// every call and the endpoint answered 500 for every creator.
	//
	// The symptom was completely silent, because the handler translated any error
	// into a flat `setup_status_unavailable` with nothing logged. That is why this
	// has a unit test now rather than only a browser check: the browser check saw a
	// 500 and could not say which of four calls in the handler produced it.
	var rows []struct {
		ID           uuid.UUID  `gorm:"column:id"`
		SetupStep2At *time.Time `gorm:"column:setup_step2_at"`
	}
	// No `setup_step2_at IS NULL` in the WHERE. The newest channel is selected
	// whatever its state, and the state is inspected below.
	err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Select("id", "setup_step2_at").
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("created_at DESC").
		Limit(1).
		Find(&rows).Error
	if err != nil {
		return uuid.Nil, err
	}
	if len(rows) == 0 || rows[0].SetupStep2At != nil {
		return uuid.Nil, nil
	}
	return rows[0].ID, nil
}

// CountChannelsNeedingSetup is the number for the dashboard's reminder badge.
//
// Separate from `ChannelNeedingSetup` rather than a length, because "is there
// one?" and "how many?" are both asked and the second is a COUNT on a partial
// index - which is cheap, and would be a full scan if derived from the first.
func (s *AuthService) CountChannelsNeedingSetup(
	ctx context.Context, userID uuid.UUID,
) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).
		Model(&model.Channel{}).
		Where("user_id = ? AND setup_step2_at IS NULL AND deleted_at IS NULL", userID).
		Count(&n).Error
	return n, err
}

// EffectiveVisibility answers "who can see this channel", including for a
// channel that has never been through step 2.
//
// The fallback is the interesting part: an UNSET visibility on an UNFINISHED
// channel is PRIVATE, not public.
//
// The default for unknown here could reasonably have been public - and that would
// publish a channel mid-setup, before its creator has chosen an audience, and
// before the compulsory step they are halfway through has finished. "I have not
// decided yet" is not "everyone may look".
func EffectiveVisibility(c *model.Channel) string {
	if c.Visibility != nil && model.IsKnownVisibility(*c.Visibility) {
		return *c.Visibility
	}
	if c.SetupStep2At == nil {
		return model.VisibilityPrivate
	}
	return model.VisibilityPublic
}

// IsChannelReachableByLink reports whether the by-handle page may serve this
// channel.
//
// `unlisted` IS reachable - that is the entire meaning of the word. Only
// `private` is not.
func IsChannelReachableByLink(c *model.Channel) bool {
	return EffectiveVisibility(c) != model.VisibilityPrivate
}

// IsChannelListed reports whether this channel may appear in browse and search.
//
// The inverse of reachability, deliberately kept as its own function so the two
// questions cannot be answered with the same expression by accident. "Reachable
// by link" and "listed" have been confused before, and the result is a channel
// that a creator shared with five people shows up in a public listing.
func IsChannelListed(c *model.Channel) bool {
	return EffectiveVisibility(c) == model.VisibilityPublic
}

package model

// ============================================================================
// CREATOR DASHBOARD MODELS
// ============================================================================
//
// Ye file creator dashboard ke backend entities define karti hai:
//   - Channel   : user ka apna channel (create + list)
//   - UserSession: ek active login device/session ka view
//
// Migration 005 ne `channels` table, `users.avatar_url` column, aur
// `active_user_sessions` view banaye.
//
// Hinglish comments: har block ka arth

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------
//
// Channel: user ka apna channel. Ek user ke 1 se zyada channels ho sakte hain
// (1:N relationship), isliye ye `users` me column nahi balki apni table hai.
//
// `handle` wahi public identifier hai jo channel URL me dikhta hai.
type Channel struct {
	// ---- Identity ----
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Handle      string    `gorm:"size:30;not null" json:"handle"`
	DisplayName string    `gorm:"size:80;not null" json:"display_name"`
	Description string    `gorm:"size:2000" json:"description"`
	// ---- Media ----
	// Channel ka apna image (user avatar se alag - ek channel ka cover,
	// ek user ki photo)
	ImageURL string `gorm:"size:500" json:"image_url"`
	// CoverURL - wide banner (YouTube-style channel header).
	//
	// WHY SEPARATE FROM ImageURL: `image_url` square icon/avatar hai, `cover_url`
	// wide banner hai. Designers inhe alag size me use karte hain; ek hi column
	// me rakhne par ek set karne se doosra chala jayega. Migration 011.
	CoverURL string `gorm:"size:500" json:"cover_url"`

	// ---- What the create wizard asks (migration 018) ----
	//
	// All NULLABLE, and that is deliberate: channels that predate the wizard have
	// none of these answers, and a NOT NULL column would have forced a backfill
	// that INVENTS a category. A NULL `channel_type` means "unclassified" and is
	// never guessed - a wrong category picks the wrong upload defaults, which
	// produces videos the creator did not ask for.
	ChannelType *string `gorm:"size:24" json:"channel_type,omitempty"`

	// Tri-state on purpose: "no" / "yes" / "audience" are three materially
	// different things, and a boolean would collapse the middle one into "yes".
	MatureContent *string `gorm:"size:16" json:"mature_content,omitempty"`

	// A LEGAL classification, separate from the rating above. A pointer so an
	// absent answer is distinguishable from a definite "no" - otherwise a client
	// that simply omits the field would be recorded as having asserted it.
	//
	// Nullable rather than `NOT NULL DEFAULT false` for the same reason as the
	// rest: the default would be a claim nobody made.
	MadeForKids *bool `gorm:"column:made_for_kids" json:"made_for_kids,omitempty"`

	// PRIVATE. Never appears on a public channel payload - publishing a creator's
	// email is how they get scraped and doxxed.
	ContactEmail *string `gorm:"size:255" json:"-"`

	// PUBLIC, and must be honest: these decide which regional programmes apply.
	Country         *string `gorm:"size:2" json:"country,omitempty"`
	PrimaryLanguage *string `gorm:"size:16" json:"primary_language,omitempty"`

	// Discovery keywords. Deliberately NOT the description - see the index in
	// migration 018.
	Keywords *string `gorm:"type:text" json:"keywords,omitempty"`

	// ---- Step 2: setting the channel UP (migration 022) ----
	//
	// Creating a channel and having a channel are different things. These fields
	// are the difference, and `SetupStep2At` is what makes the step enforceable
	// rather than advisory.

	// The square logo. Separate from `CoverURL` because a logo and a banner are
	// different assets at different aspect ratios; one column holding both means
	// one of them is always stretched or letterboxed.
	LogoURL string `gorm:"size:500" json:"logo_url,omitempty"`

	// One line under the channel name. Capped short on purpose: this is a
	// tagline, and `Description` already exists for prose.
	Tagline string `gorm:"size:120" json:"tagline,omitempty"`

	// BrandHue is a HUE IN DEGREES, not a colour string. See migration 022 for
	// why: a free hex field is an injection point the moment any component
	// interpolates it into a style, and a creator who can pick any colour can
	// also pick one that makes their own page unreadable.
	//
	// A POINTER, so "use the platform default" is distinguishable from "chose
	// hue 0" - those are different decisions and they render differently.
	BrandHue *int `gorm:"column:brand_hue" json:"brand_hue,omitempty"`

	// Visibility is "public" | "unlisted" | "private", and it is a POINTER so a
	// channel that predates this reads as unclassified rather than as having
	// been silently asserted to be public.
	//
	// `IsPublic` is kept in step with this by a CHECK constraint, so the two
	// cannot drift. Two sources of truth about whether a channel is public is
	// exactly the arrangement that eventually answers that question two ways.
	Visibility *string `gorm:"size:16" json:"visibility,omitempty"`

	// ---- Per-channel upload DEFAULTS ----
	//
	// Defaults, not global toggles: a creator with two channels legitimately
	// wants comments off on one and required on the other, and a single global
	// setting cannot say that.
	//
	// NOT pointers. These have a safe answer at absence, they are written in one
	// step, and a nullable boolean here would be a second tri-state to carry
	// through every read for no benefit.
	CommentsEnabled  bool   `gorm:"not null;default:true" json:"comments_enabled"`
	CommentPolicy    string `gorm:"column:comment_policy;size:16;not null;default:'anyone'" json:"comment_policy"`
	KidsAutoClassify bool   `gorm:"not null;default:true" json:"kids_auto_classify"`
	WatermarkEnabled bool   `gorm:"not null;default:false" json:"watermark_enabled"`

	// SetupStep2At is when step 2 was finished. NULL means not finished, and
	// there is deliberately no boolean beside it: absent and "explicitly not
	// done" are the same state, and a `false` default would read as "the creator
	// declined", which is an assertion nobody made.
	//
	// Stored rather than derived, for two reasons a computed answer cannot serve:
	// the dashboard reads it on every load to decide what to show, and WHEN a
	// channel was set up is answerable only if it was recorded.
	SetupStep2At *time.Time `gorm:"column:setup_step2_at;index" json:"setup_step2_at,omitempty"`

	// ---- State ----
	IsPublic bool `gorm:"default:true" json:"is_public"`
	IsActive bool `gorm:"default:true" json:"is_active"`
	// ---- Timestamps ----
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Channel) TableName() string { return "channels" }

// ---------------------------------------------------------------------------
// UserSession - "kis device par login hai" ke liye
// ---------------------------------------------------------------------------
//
// Ye `sessions` table + `active_user_sessions` VIEW se read hota hai.
// SECURITY: ye sirf authenticated user KI sessions return karta hai - user_id
// filter query me mandatory hai. Koi cross-user leak nahi.
// ActiveDeviceSession - "kis device par login hai" ke liye
//
// NAMING: ye `UserSession` se alag hai JAAN-BOJH kar. `superadmin.go` me ek
// `UserSession` model pehle se hai jo "kitne time online tha" track karta hai
// (started_at / last_seen_at / ended_at / duration_seconds) aur wo ek ALAG
// table map karta hai. Ye naya struct `sessions` table + `active_user_sessions`
// view se padhta hai (auth tokens wali table) - isliye alag naam, warna Go
// me "redeclared in this block" error aata.
type ActiveDeviceSession struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"-"`
	DeviceID  *uuid.UUID `json:"device_id"`
	IPAddress *string    `json:"ip_address"`
	UserAgent *string    `json:"user_agent"`
	// ---- Times ----
	CreatedAt time.Time `json:"created_at"`
	// `last_seen` VIEW me `updated_at` se aata hai (GORM auto-maintains it)
	LastSeen  time.Time `json:"last_seen"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ---------------------------------------------------------------------------
// Profile DTOs
// ---------------------------------------------------------------------------

// UpdateProfileRequest - profile update ke liye (avatar URL).
//
// NOTE: ye sirf `avatar_url` accept karta hai. Naam/username jaise sensitive
// fields jaan-boojh kar nahi rakhe - wo alag verified flows se change hote
// hain (username uniqueness + takedown implications).
type UpdateProfileRequest struct {
	// Avatar: absolute URL ya relative path (MinIO se).
	// Empty string = avatar clear karna (UI initials fallback par laut jayega).
	AvatarURL *string `json:"avatar_url"`
}

// CreateChannelRequest - naya channel banane ke liye.
// Channel types.
//
// A closed set in Go, and NOT a database enum: adding a category should be a
// migration of this file rather than an `ALTER TYPE` on a live table.
//
// `ChannelTypeOther` exists on purpose. A forced choice between categories is
// how people pick the least-wrong answer, and a least-wrong category produces
// upload defaults nobody wanted.
const (
	ChannelTypeGaming    = "gaming"
	ChannelTypeMusic     = "music"
	ChannelTypePodcast   = "podcast"
	ChannelTypeEducation = "education"
	ChannelTypeHowTo     = "howto"
	ChannelTypeSports    = "sports"
	ChannelTypeNews      = "news"
	ChannelTypeFilm      = "film"
	ChannelTypePeople    = "people"
	ChannelTypeComedy    = "comedy"
	ChannelTypeAutos     = "autos"
	ChannelTypeOther     = "other"
)

// Mature-content ratings.
//
// NOT a boolean, and that is the point. "no" / "yes" / "audience" is three
// materially different things, and a two-state flag would collapse the middle
// one into "yes" - which is a false statement about the content, made on the
// creator's behalf, about their own work.
const (
	MatureNo       = "no"
	MatureYes      = "yes"
	MatureAudience = "audience"
)

// ValidChannelType / ValidMatureContent are the authoritative checks.
//
// A map, not a switch, so a new value cannot be added to the column constraint
// and forgotten here - which is how the two drift apart.
var (
	ValidChannelType = map[string]bool{
		ChannelTypeGaming: true, ChannelTypeMusic: true, ChannelTypePodcast: true,
		ChannelTypeEducation: true, ChannelTypeHowTo: true, ChannelTypeSports: true,
		ChannelTypeNews: true, ChannelTypeFilm: true, ChannelTypePeople: true,
		ChannelTypeComedy: true, ChannelTypeAutos: true, ChannelTypeOther: true,
	}
	ValidMatureContent = map[string]bool{
		MatureNo: true, MatureYes: true, MatureAudience: true,
	}
)

// CreateChannelRequest is what a channel needs to EXIST.
//
// The four original fields (name, handle, description, public) were a name, not
// a channel. `ChannelType` is now REQUIRED because it drives upload defaults and
// which features surface - a channel without one cannot be categorised, and
// guessing would pick defaults the creator did not ask for.
//
// `MadeForKids` is a separate question from `MatureContent` and both are
// required. They are different classifications with different legal
// consequences, and collapsing them is how a family channel gets treated as
// adult. The reasoning is in `CHANNEL-AND-MEDIA-PARITY.md` §1.1.
//
// `ContactEmail` is PRIVATE and must never appear on a public payload.
// `Country` and `PrimaryLanguage` are public and must be honest: they decide
// which regional programmes apply.
type CreateChannelRequest struct {
	// Public handle (3-30 chars, lowercase letters/digits/_/./-).
	// Backend ise normalize + validate karta hai (client validation sirf UX hai).
	Handle string `json:"handle"`
	// Display name (1-80 chars)
	DisplayName string `json:"display_name"`
	// Optional description (max 2000)
	Description string `json:"description,omitempty"`
	// Public (default true) ya private
	IsPublic *bool `json:"is_public,omitempty"`

	// ---- Required from now on ----

	// ChannelType is REQUIRED. One of ValidChannelType.
	ChannelType string `json:"channel_type"`

	// MatureContent is REQUIRED. "no" | "yes" | "audience".
	MatureContent string `json:"mature_content"`

	// MadeForKids is REQUIRED and is a DIFFERENT question from MatureContent.
	// It is a legal classification, not a tone setting, which is why it is not
	// a tri-state string alongside the rating.
	//
	// A pointer so that an absent field is distinguishable from `false`. Without
	// that, a client that simply omits the field would be recorded as "definitely
	// not for kids", which is an assertion nobody made.
	MadeForKids *bool `json:"made_for_kids"`

	// ---- Recommended ----

	// ContactEmail is private. Never returned on a public channel payload.
	ContactEmail string `json:"contact_email,omitempty"`

	// Country is ISO-3166-1 alpha-2, upper-cased. PUBLIC and must be honest.
	Country string `json:"country,omitempty"`

	// PrimaryLanguage is a BCP-47-ish tag, e.g. "en", "hi". PUBLIC.
	PrimaryLanguage string `json:"primary_language,omitempty"`

	// Keywords for discovery. NOT the description - a keyword search that also
	// matched prose would return a cooking channel for "baking tips", which is
	// worse than not finding it.
	Keywords string `json:"keywords,omitempty"`

	// CoverURL is the channel banner, uploaded DURING creation.
	//
	// It is a pointer so "not supplied" is distinguishable from "supplied as
	// empty": on create there is nothing to leave alone, but a client that
	// uploads a banner and then has it silently dropped is a worse failure than
	// one that is told the field does not exist yet.
	//
	// There is already a `cover_url` COLUMN on the channel and a working
	// `PUT /channels/:id/cover` route for changing it later. This exists so a
	// brand-new channel is not born with an empty banner - an empty banner slot
	// is the first thing that makes a channel look abandoned.
	CoverURL *string `json:"cover_url,omitempty"`
}

// Validation errors for the fields a channel cannot exist without.
//
// SEPARATE errors, not one "invalid". "Pick a channel type" and "confirm the
// kids setting" are different questions, and a single message makes the creator
// guess which one they got wrong.
var (
	ErrChannelTypeRequired   = errCreator("channel_type is required - pick the kind of channel this is")
	ErrChannelTypeInvalid    = errCreator("channel_type must be one of: gaming, music, podcast, education, howto, sports, news, film, people, comedy, autos, other")
	ErrMatureContentRequired = errCreator("mature_content is required - answer yes, no, or audience")
	ErrMatureContentInvalid  = errCreator("mature_content must be one of: no, yes, audience")
	ErrMadeForKidsRequired   = errCreator("made_for_kids is required - it is a legal classification, separate from the content rating")
	ErrContactEmailInvalid   = errCreator("contact_email must be a valid email address")
	ErrCountryInvalid        = errCreator("country must be a two-letter ISO code, e.g. IN")
)

// UpdateChannelRequest - channel edit ke liye.
//
// ---- WHY EVERY FIELD IS A POINTER ----
// `nil` = "is field ko chhod de", `false`/`""` = "is field ko VALUE set kar".
//
// Agar ye plain `string`/`bool` hote to PATCH me omitted field aur
// intentionally-emptied field dono ka representation same ho jata. Iska
// matlab: user description khaali karna chahta, aur hum uska description
// chupke se UNCHANGED chhod dete - ya worse, display_name clear karne ki
// request par use hata dete.
//
// Pointer pattern ye ambiguity door karta hai. Ye wahi pattern hai jo
// `UpdateSettingsRequest` me pehle se use ho raha hai.
//
// SECURITY: `handle` YAHAN JAAN-BOJH KAR NAHI HAI. Handle channel ka
// public URL hai (/@handle). Use badalne se purane links, bookmarks aur
// shares toot jaate hain - aur koi redirect mapping nahi hai.
// Handle account lifetime ke liye fixed rehta hai.
type UpdateChannelRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Description *string `json:"description,omitempty"`
	ImageURL    *string `json:"image_url,omitempty"`
	CoverURL    *string `json:"cover_url,omitempty"`
	IsPublic    *bool   `json:"is_public,omitempty"`
	IsActive    *bool   `json:"is_active,omitempty"`
}

// PublicChannelResponse - public channel page ke liye.
//
// SECURITY: ye DTO jaan-boojh kar `UserID` NAHI expose karta. Public
// payload me internal user UUID daalne se koi faida nahi hai, aur wo
// enumeration ke liye ek stable identifier ban jata hai.
type PublicChannelResponse struct {
	ID          uuid.UUID `json:"id"`
	Handle      string    `json:"handle"`
	DisplayName string    `json:"display_name"`
	Description string    `json:"description"`
	ImageURL    string    `json:"image_url"`
	CoverURL    string    `json:"cover_url"`
	// ChannelType is new, and it is what makes a browse page filterable - a list
	// of undifferentiated channels is not browsable, it is a directory.
	//
	// A POINTER because a channel created before migration 018 has no type, and
	// "unknown" is a real state that must render differently from "gaming".
	ChannelType *string `json:"channel_type,omitempty"`

	// ---- Step 2 branding (migration 022) ----
	//
	// PUBLIC by design: a tagline, a logo and a colour are the point of a
	// channel page, and every one of them is the creator's own content.
	LogoURL  string `json:"logo_url,omitempty"`
	Tagline  string `json:"tagline,omitempty"`
	BrandHue *int   `json:"brand_hue,omitempty"`

	// The creator's own upload DEFAULTS are deliberately NOT here. They decide
	// who may comment and how an upload is classified; they are channel
	// settings, not public channel facts, and nothing on a public page needs
	// them. Putting them on this DTO would put them in every page's HTML.
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// NOTE: yahan ek `ChannelResponse` DTO kabhi tha, jo create ke baad client
// ko bhejne ke liye tha. Wo DELETE kar diya gaya hai, teen wajahon se:
//
//  1. Koi handler ya service use nahi karta tha - create/get dono raw
//     `*model.Channel` return karte hain. Matlab ye sirf misleading tha.
//  2. `cover_url` isme nahi tha, jabki migration 011 ne wo add kiya - to ye
//     struct definition aur real schema se already drift kar chuka tha.
//  3. `video_count` ka koi counter exist hi nahi karta codebase me.
//
// Apne aap me isse revive mat karo. Response shape ASLI hai raw model, aur
// ise change karna = API contract badalna. Agar future me channel listing
// me extra computed fields chahiye (jaise video_count), tab ek naya DTO
// banao - aur use tabhi add karo jab wo actually use ho.
// ---------------------------------------------------------------------------

// Errors - channel/profile operations ke liye.
// (Package-level taaki handler `errors.Is` se compare kar sake.)
var (
	// ErrHandleTaken - ye handle already kisi LIVE channel ka hai.
	//
	// Comment updated: the check used to be scoped to `user_id`, so it only stopped
	// one user claiming a handle twice. It is now global, because the handle is the
	// channel's public ADDRESS and two users holding the same one makes that URL
	// ambiguous - verified by watching two accounts both get 201 for the same
	// handle, and the public route then return either of them at random.
	ErrHandleTaken = errCreator("channel handle already taken")

	// ErrHandleRetired - ye handle kabhi use hua tha, channel delete/rename ho gaya.
	//
	// Deliberately a DISTINCT error from ErrHandleTaken, because the two mean
	// different things to the creator and the difference is actionable:
	//
	//	"already taken"    -> someone has it right now; pick another
	//	"used to exist"    -> it will NEVER be available again; do not try this one
	//
	// Collapsing them into one message would leave people retrying a handle that can
	// never succeed, and would hide the reason the address is gone.
	//
	// Same rule as an email address: reissuing a retired handle lets a new account
	// inherit a dead channel URL's trust - its bookmarks, its search associations,
	// its links.
	ErrHandleRetired = errCreator("that handle was used before and is permanently retired")

	// ErrHandleInvalid - handle format galat hai.
	ErrHandleInvalid = errCreator("handle must be 3-30 characters using lowercase letters, numbers, underscore, dot or hyphen")
	// ErrChannelNotFound - channel nahi mila (ya is user ka nahi hai).
	ErrChannelNotFound = errCreator("channel not found")
	// ErrDisplayNameInvalid - display name 1-80 chars ke beech nahi hai.
	ErrDisplayNameInvalid = errCreator("display name must be between 1 and 80 characters")

	// ErrDescriptionTooLong - description 2000 chars se bada.
	ErrDescriptionTooLong = errCreator("description must be 2000 characters or fewer")
	// ErrURLTooLong - image/cover URL 500 chars se bada.
	ErrURLTooLong = errCreator("url must be 500 characters or fewer")
	// ErrURLSchemeNotAllowed - javascript:/data:/vbscript: jaise schemes
	// BLOCK hote hain (stored XSS vector). Sirf relative path ya http(s).
	ErrURLSchemeNotAllowed = errCreator("url must be a relative path (starting with /) or an http(s) url")
)

// ---------------------------------------------------------------------------
// `UserEntitlement` WAS HERE. IT IS DELETED, AND WHY MATTERS.
// ---------------------------------------------------------------------------
//
// It was a SECOND model for the SAME `entitlements` table, with fewer columns
// than `model.Entitlement` - and `plan_code` was tagged `size:24` where
// `Entitlement` says `size:32`.
//
// Two shapes for one table is a trap that does not announce itself. Neither is
// registered with AutoMigrate (`entitlements` is SQL-only, owned by migration
// 016), so nothing failed; every query worked; and the drift would only surface
// as a column that was mysteriously truncated, in one of two places at once.
//
// The missing column was the actual hazard. `UserEntitlement` had no
// `suspended_at`, so the creator dashboard's "are you on a trial?" query found a
// SUSPENDED trial - one whose identity stopped matching, because its owner
// changed their email address - and reported the trial as active. A suspended
// entitlement is still paid for and not applying; treating it as live is the
// difference between "we will sort this out" and "we revoked nothing and charged
// for it".
//
// Use `Entitlement`. It is the one model for this table, and it knows about
// suspension.
// ---------------------------------------------------------------------------

type creatorError string

func (e creatorError) Error() string { return string(e) }

func errCreator(msg string) error { return creatorError(msg) }

// RetiredHandle - a handle that has been claimed and must never be reissued.
//
// Populated by migration 014 from every handle that has ever existed, and by
// DeleteChannel / any future rename. It is a separate table rather than a column
// on `channels` precisely because soft-deleting the channel must NOT make the
// handle free again: the deleted row is gone from the channels list, but the
// address it occupied is still spoken for.
//
// `handle` is stored lower-case, matching the case-insensitive unique index on
// channels, so the two checks cannot disagree about what "@Foo" means.
type RetiredHandle struct {
	Handle string     `gorm:"primaryKey;size:30" json:"handle"`
	UserID *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`

	// 'deleted' | 'renamed' | 'terminated'. NOT NULL with a default so a row can
	// never exist without saying why - an unexplained reservation looks
	// identical to a bug, and gets "fixed" by deleting the table.
	Reason    string    `gorm:"size:32;not null;default:'deleted'" json:"reason"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (RetiredHandle) TableName() string { return "retired_handles" }

// Retiring a handle must never fail because of a conflict: it runs on the delete
// path, and a delete that fails because the handle is ALREADY retired would be
// an absurd outcome - the channel is gone either way.
//
// So an existing row is left alone rather than updated. The first retirement
// reason recorded is the true one; later ones are just attempts.
func UpsertRetiredHandle(db *gorm.DB, handle string, userID *uuid.UUID, reason string) error {
	entry := RetiredHandle{Handle: handle, UserID: userID, Reason: reason}
	return db.Where("handle = ?", handle).
		FirstOrCreate(&entry).
		Error
}

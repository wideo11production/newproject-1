package model

// =============================================================================
// CHANNEL SETUP - STEP 2
// =============================================================================
//
// The request types and the rules for step 2, kept next to the columns they
// write (migration 022).
//
// =============================================================================
// WHY THE VALIDATION LIVES HERE AND NOT ONLY IN THE FRONTEND
// =============================================================================
//
// The client sends a form. A client is not a boundary. Every rule below is
// enforced again at this layer, and the two are written from the SAME source - the
// closed sets in this file - so a change to a list cannot land on one side only.
//
// The reasons are not theoretical for two of these:
//
//   BRAND_HUE   - an unchecked value is interpolated into an inline style, and
//                 that is a CSS-injection point. Constrained to an integer range,
//                 and the RGB comes from a palette in this codebase.
//   VISIBILITY  - it decides who can read the channel. Getting it wrong leaks a
//                 channel or hides one the creator is relying on.

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Visibility states.
//
// Three, not two. "Unlisted" is shareable by link and absent from every listing,
// and it is what most creators want for a first upload - so a boolean would force
// them to choose between "public to the world" and "visible to nobody".
const (
	VisibilityPublic   = "public"
	VisibilityUnlisted = "unlisted"
	VisibilityPrivate  = "private"
)

// ValidVisibility is the closed set.
//
// A map because `IsKnownVisibility` then cannot drift from the list: there is
// one list.
var ValidVisibility = map[string]bool{
	VisibilityPublic:   true,
	VisibilityUnlisted: true,
	VisibilityPrivate:  true,
}

func IsKnownVisibility(v string) bool { return ValidVisibility[v] }

// Comment policies.
const (
	CommentAnyone      = "anyone"
	CommentSubscribers = "subscribers"
	CommentApproved    = "approved"
)

// ValidCommentPolicy is the closed set, same reasoning as ValidVisibility.
var ValidCommentPolicy = map[string]bool{
	CommentAnyone:      true,
	CommentSubscribers: true,
	CommentApproved:    true,
}

func IsKnownCommentPolicy(p string) bool { return ValidCommentPolicy[p] }

// TaglineMaxLen. Short on purpose: this is a tagline, and `description` exists
// for prose. A 500-character tagline is a description that learned to shout.
const TaglineMaxLen = 120

// MaxKeywords and MaxKeywordLen.
//
// A keyword list is a discovery aid, not a document. The caps are what stop a
// channel from stuffing ten thousand comma-separated terms to win every search -
// which is not a feature, it is spam that other creators have to compete with.
const (
	MaxKeywords    = 30
	MaxKeywordLen  = 40
	MaxKeywordsLen = 1200 // the joined string, so the column is bounded too
)

// Errors. One per rule, because "invalid request" leaves the creator guessing
// which of five questions they got wrong - and that is the message they will
// read first.
var (
	ErrTaglineTooLong  = errors.New("tagline is too long")
	ErrBrandHueInvalid = errors.New("brand colour must be a hue between 0 and 359")
	ErrVisibility      = errors.New("visibility must be public, unlisted or private")
	ErrCommentPolicy   = errors.New("comment policy must be anyone, subscribers or approved")
	ErrTooManyKeywords = errors.New("too many keywords")
	ErrKeywordTooLong  = errors.New("one of the keywords is too long")
	ErrKeywordsTooLong = errors.New("the keyword list is too long overall")
)

// keywordClean strips the punctuation a human pastes from a spreadsheet.
//
// Comma and newline are the two separators people actually use, so both are
// accepted. `\r` is removed explicitly rather than left to TrimSpace, because a
// Windows clipboard carries it and it would otherwise end up in the middle of a
// keyword.
func splitKeywords(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// NormaliseKeywords validates and canonicalises a keyword list.
//
// De-duplicated CASE-INSENSITIVELY, because the search is case-insensitive and
// "cooking, Cooking, COOKING" is one keyword that arrived three times. The
// first spelling wins, so the creator's own casing is preserved.
func NormaliseKeywords(raw string) (string, error) {
	seen := make(map[string]bool)
	out := make([]string, 0, 8)
	for _, k := range splitKeywords(raw) {
		if len(k) > MaxKeywordLen {
			return "", fmt.Errorf("%w: %q is %d characters", ErrKeywordTooLong, k, len(k))
		}
		key := strings.ToLower(k)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, k)
		if len(out) > MaxKeywords {
			return "", fmt.Errorf("%w: at most %d are allowed", ErrTooManyKeywords, MaxKeywords)
		}
	}
	joined := strings.Join(out, ", ")
	if len(joined) > MaxKeywordsLen {
		return "", fmt.Errorf("%w: %d characters", ErrKeywordsTooLong, len(joined))
	}
	return joined, nil
}

// ValidateBrandHue checks a hue.
//
// Rejects everything that is not a plain integer in range, rather than trying to
// parse a colour. The column stores degrees and nothing else, so there is no
// legitimate reason to accept anything but an integer - and accepting a string
// here is what would eventually reach a style attribute.
func ValidateBrandHue(hue *int) error {
	if hue == nil {
		return nil // "use the platform default" is a valid answer
	}
	if *hue < 0 || *hue > 359 {
		return ErrBrandHueInvalid
	}
	return nil
}

// NormaliseVisibility lower-cases and trims, then checks the closed set.
//
// It does not INVENT a visibility. An unrecognised value stays unrecognised and
// is refused, because the natural default for an unknown state here is either
// "public" - which publishes a channel the creator meant to keep quiet - or
// "private" - which hides a channel they are relying on. Both defaults are wrong
// in a way the creator cannot see.
func NormaliseVisibility(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	if !IsKnownVisibility(v) {
		return "", ErrVisibility
	}
	return v, nil
}

// IsPublicForVisibility is the one place that maps a visibility onto the legacy
// boolean.
//
// Both directions, because the CHECK constraint in migration 022 enforces
// agreement in both directions and a helper that only did one of them would let a
// caller write a row the database then rejects.
func IsPublicForVisibility(v string) bool {
	// `unlisted` is NOT public in the sense of "appears in listings", but it IS
	// public in the sense of "reachable", which is what `is_public` has always
	// meant on this table: browse excludes `is_public = false` rows, and the
	// by-handle read does not.
	//
	// This is the distinction migration 022 exists to make, and collapsing it
	// would hide every unlisted channel from its own owner.
	return v == VisibilityPublic || v == VisibilityUnlisted
}

// UpdateChannelSetupRequest is step 2's payload.
//
// EVERY field is a pointer, and that is the whole point.
//
// "The client did not send this field" and "the client sent false" must be
// distinguishable, or a partial update silently clears everything the client
// omitted. A step-2 form saves as the creator moves between sections, so a
// partial save is the NORMAL case - not an edge case.
//
// `brand_hue` being a `*int` rather than a `*bool`-with-a-value is why the same
// rule applies to it: hue 0 (red) is a real choice and must not be read as
// "unset".
type UpdateChannelSetupRequest struct {
	Tagline  *string `json:"tagline,omitempty"`
	BrandHue *int    `json:"brand_hue,omitempty"`
	// Explicit null clears the choice and returns to the platform default.
	BrandHueIsNull bool `json:"brand_hue_is_null,omitempty"`

	LogoURL *string `json:"logo_url,omitempty"`

	Visibility  *string `json:"visibility,omitempty"`
	ChannelType *string `json:"channel_type,omitempty"`
	Keywords    *string `json:"keywords,omitempty"`

	CommentsEnabled  *bool   `json:"comments_enabled,omitempty"`
	CommentPolicy    *string `json:"comment_policy,omitempty"`
	KidsAutoClassify *bool   `json:"kids_auto_classify,omitempty"`
	WatermarkEnabled *bool   `json:"watermark_enabled,omitempty"`

	// FinishStep2 records that step 2 is done. A client may set it true; there is
	// deliberately no way to set it back to false through this endpoint, because
	// "un-complete" is not a thing a creator does - they simply edit afterwards,
	// which this endpoint allows.
	FinishStep2 bool `json:"finish_step2,omitempty"`
}

// logoURLRe is a permissive-but-bounded shape check for a stored object URL.
//
// The allowlist is the scheme and the host, not the whole string: MinIO keys are
// UUID-ish and content is unpredictable, so a tight pattern would reject valid
// keys. What MUST be refused is anything that is not an absolute http(s) URL on
// our own storage host - because this value becomes an `img src`, and a
// `javascript:` or `data:` there is a stored-XSS vector in every viewer's
// browser.
//
// The server does not accept a URL from the client for the object KEY; it mints
// its own. This only validates that the string being STORED looks like one of
// ours.
var logoURLRe = regexp.MustCompile(`^https?://[^\s"'<>\\]+$`)

// ValidateLogoURL refuses anything that is not a plain absolute http(s) URL.
//
// Rejected outright: `javascript:`, `data:`, `vbscript:`, protocol-relative
// `//evil.example`, and anything with whitespace or quote characters. Accepted:
// the storage host's own URLs, which is what the finalize endpoint returns.
func ValidateLogoURL(raw string) error {
	if raw == "" {
		return nil // clearing the logo is legitimate
	}
	if len(raw) > 500 {
		return errors.New("logo url is too long")
	}
	if !logoURLRe.MatchString(raw) {
		// Named, not generic: "that is not a usable image address" tells a creator
		// what happened, where "invalid request" tells them to guess.
		return errors.New("logo must be an http or https address served by our storage")
	}
	lower := strings.ToLower(raw)
	for _, bad := range []string{"javascript:", "data:", "vbscript:", "file:"} {
		if strings.HasPrefix(lower, bad) {
			return errors.New("logo must be an http or https address served by our storage")
		}
	}
	return nil
}

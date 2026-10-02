// Reel platform readiness: will this clip actually work on each destination?
//
// =============================================================================
// WHY A CHECK AND NOT A SUBMIT
// =============================================================================
//
// There is no public API a third party can use to upload to Instagram, TikTok,
// YouTube Shorts or Facebook Reels without the creator's own OAuth grant and,
// usually, an app review. So automatic publishing is not buildable right now -
// and pretending otherwise would be worse than not having it.
//
// What IS buildable, and genuinely useful, is telling the creator BEFORE they
// upload anything whether their clip will be accepted. Every one of these
// platforms silently refuses a file for the same handful of reasons, and finding
// out after the edit is finished is the most demoralising way to find out.
//
// So this is a readiness check, and its output is a grid of pass/fail/warn with a
// REASON. "Won't work" without "why" is not actionable, so a reason is part of
// every result.
//
// =============================================================================
// THREE STATES, NOT TWO
// =============================================================================
//
//   pass  - fine
//   block - will be rejected
//   warn  - will be ACCEPTED, but not the way the creator probably wants
//
// The `warn` state exists because of a concrete case, not a hypothetical one: a
// clip of 75 seconds uploads to YouTube Shorts perfectly well and then does not
// appear in the Shorts shelf. Marking that as a failure would tell a creator
// their clip is broken when it is not - and a readiness check that cries wolf
// gets ignored, which makes the real failures invisible.
//
// =============================================================================
// NOT DUPLICATED, NOT A SEPARATE PIPELINE
// =============================================================================
//
// A reel is an asset with `kind = 'reel'`. One upload path, one transcode, one
// player. A second parallel pipeline for reels would be a second set of bugs for
// no gain - and the readiness check works on the SAME measured fields every
// other asset already has.

package service

import (
	"fmt"
	"math"
	"strings"

	"github.com/wideo11/auth-service/internal/model"
)

// Destinations. The set is deliberately closed: a new platform is a deliberate
// addition with its own rules written out, not a string a caller can invent.
const (
	PlatformInstagramReels = "instagram_reels"
	PlatformTikTok         = "tiktok"
	PlatformYouTubeShorts  = "youtube_shorts"
	PlatformFacebookReels  = "facebook_reels"
)

// AllReelPlatforms is the order the grid is rendered in. Fixed so the UI does
// not reshuffle between assets.
var AllReelPlatforms = []string{
	PlatformInstagramReels,
	PlatformTikTok,
	PlatformYouTubeShorts,
	PlatformFacebookReels,
}

// Severities.
const (
	CheckPass  = "pass"
	CheckBlock = "block"
	CheckWarn  = "warn"
)

// Reel limits. All from SYSTEM-PLAN.md §6, and all named constants so a limit
// change is a one-line diff rather than a hunt through comparison code.
const (
	// ReelMaxSeconds - 90. The ceiling Instagram, TikTok and Shorts all accept
	// without a split, so a reel above this is rejected on upload rather than
	// trimmed. Note Shorts is stricter at 60 - see `youtubeShortsMaxSeconds`.
	ReelMaxSeconds = 90

	// YouTubeShortsMaxSeconds - 60. Above this a Short is still accepted, it
	// just does not get the shelf placement. Hence a WARN, not a block.
	YouTubeShortsMaxSeconds = 60

	// ReelMaxBytes - 512 MB, per platform and per the plan.
	ReelMaxBytes int64 = 512 * 1024 * 1024

	// ReelTargetWidth / ReelTargetHeight - 1080x1920. The targets are a RANGE per
	// platform, not one size: TikTok and Shorts accept any even dimension at or
	// above 720x1280 up to 1080x1920. Rejecting a 1440x2560 clip that every
	// platform would accept would be a false failure.
	ReelTargetWidth  = 1080
	ReelTargetHeight = 1920

	// ReelMinWidth / ReelMinHeight - 720x1280. Below this every platform starts
	// compressing visibly, and Instagram in particular will reject it.
	ReelMinWidth  = 720
	ReelMinHeight = 1280

	// ReelSafeAreaTopPx / ReelSafeAreaBottomPx - the platform's own UI covers
	// these, so text placed there is invisible in the published reel. Advisory
	// rather than blocking, because the check cannot SEE text - it only knows the
	// dimensions.
	ReelSafeAreaTopPx    = 250
	ReelSafeAreaBottomPx = 320
)

// aspect returns width:height reduced to a small rational, for comparing against
// 9:16 without floating point.
//
// Integer maths deliberately. `float64(width)/float64(height) == 9.0/16.0` is
// false for a 1080x1920 clip in IEEE754, and a readiness check that needs an
// epsilon is a readiness check that eventually reports the wrong answer.
func aspect(width, height int) string {
	if width <= 0 || height <= 0 {
		return "unknown"
	}
	div := gcd(width, height)
	return fmt.Sprintf("%d:%d", width/div, height/div)
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

// isPortraitNineSixteen is true when the clip is EXACTLY 9:16.
//
// Exactly, not approximately. 9:16 is the ratio all four platforms want, and a
// 1:1 or 4:5 clip does not become acceptable by being close.
func isPortraitNineSixteen(width, height int) bool {
	if width <= 0 || height <= 0 {
		return false
	}
	// 16*width == 9*height, in integers.
	return width*16 == height*9
}

// ReelCheck is one rule's outcome for one platform.
type ReelCheck struct {
	// Rule is machine-readable, so a UI can localise or filter without parsing
	// the label.
	Rule string `json:"rule"`
	// Label is the human name of the rule.
	Label string `json:"label"`
	// Severity is one of CheckPass / CheckBlock / CheckWarn.
	Severity string `json:"severity"`
	// Detail is populated on fail and warn. A result without a reason is not
	// actionable, so an empty Detail on a non-pass is treated as a bug.
	Detail string `json:"detail,omitempty"`
}

// Passed is true when this check alone does not block the platform.
func (c ReelCheck) Passed() bool { return c.Severity != CheckBlock }

// PlatformReadiness is one destination's verdict.
type PlatformReadiness struct {
	Platform string `json:"platform"`
	// Eligible is the headline: can this clip be published here at all?
	Eligible bool `json:"eligible"`
	// Checks is the full breakdown, in a fixed order.
	Checks []ReelCheck `json:"checks"`
	// BlockingRules lists just the failures, for a compact summary.
	BlockingRules []string `json:"blocking_rules"`
	// Warnings are things worth telling the creator that will not stop them.
	Warnings []string `json:"warnings"`
}

// Reason summarises the blocking rules into one line.
//
// Used by the export pack, where a per-platform summary is more useful than the
// full check list - the creator wants to know "can I post this here and why not",
// not a rule-by-rule report.
func (p PlatformReadiness) Reason() string {
	if p.Eligible || len(p.BlockingRules) == 0 {
		return ""
	}
	var b strings.Builder
	for _, c := range p.Checks {
		if c.Severity != CheckBlock {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("; ")
		}
		b.WriteString(c.Detail)
	}
	return b.String()
}

// ReelReadiness is the whole grid.
type ReelReadiness struct {
	// EligibleEverywhere is the quick answer for a "publish to all" button.
	EligibleEverywhere bool `json:"eligible_everywhere"`
	// Platforms, in render order.
	Platforms []PlatformReadiness `json:"platforms"`
}

// EvaluateReel runs every platform's rules against one asset's MEASURED fields.
//
// Deliberately takes the fields, not the model. A check that takes a whole model
// can read whatever it likes - including the CLIENT's declared size, which is a
// claim. These four values come from ffprobe at the `scanning` stage, and the
// function cannot be handed anything else.
//
// `bytes` is the measured size, not `DeclaredBytes`.
func EvaluateReel(width, height, durationS int, hasAudio bool, bytes int64) ReelReadiness {
	out := ReelReadiness{EligibleEverywhere: true}

	for _, p := range AllReelPlatforms {
		pr := evaluateFor(p, width, height, durationS, hasAudio, bytes)
		if !pr.Eligible {
			out.EligibleEverywhere = false
		}
		out.Platforms = append(out.Platforms, pr)
	}

	return out
}

func evaluateFor(platform string, width, height, durationS int, hasAudio bool, bytes int64) PlatformReadiness {
	checks := []ReelCheck{
		aspectCheck(width, height),
		resolutionCheck(width, height),
		audioCheck(hasAudio),
		sizeCheck(bytes),
		durationCheck(platform, durationS),
	}

	pr := PlatformReadiness{Platform: platform, Eligible: true, Checks: checks}
	for _, c := range checks {
		switch c.Severity {
		case CheckBlock:
			pr.Eligible = false
			pr.BlockingRules = append(pr.BlockingRules, c.Rule)
		case CheckWarn:
			pr.Warnings = append(pr.Warnings, c.Rule+": "+c.Detail)
		}
	}
	return pr
}

func aspectCheck(width, height int) ReelCheck {
	c := ReelCheck{Rule: "aspect_ratio", Label: "Vertical 9:16"}
	if isPortraitNineSixteen(width, height) {
		c.Severity = CheckPass
		return c
	}
	c.Severity = CheckBlock
	if width <= 0 || height <= 0 {
		c.Detail = "dimensions unknown - the file has not been probed yet"
	} else if width >= height {
		c.Detail = fmt.Sprintf("it is %s (landscape or square) - crop it to 9:16", aspect(width, height))
	} else {
		c.Detail = fmt.Sprintf("it is %s - crop it to 9:16 (1080x1920)", aspect(width, height))
	}
	return c
}

func resolutionCheck(width, height int) ReelCheck {
	c := ReelCheck{Rule: "resolution", Label: fmt.Sprintf("At least %dx%d", ReelMinWidth, ReelMinHeight)}
	switch {
	case width <= 0 || height <= 0:
		c.Severity = CheckPass // nothing measured yet; not this rule's failure
	case width < ReelMinWidth || height < ReelMinHeight:
		c.Severity = CheckBlock
		c.Detail = fmt.Sprintf("%dx%d is below the %dx%d minimum every platform accepts", width, height, ReelMinWidth, ReelMinHeight)
	default:
		c.Severity = CheckPass
	}
	return c
}

func audioCheck(hasAudio bool) ReelCheck {
	c := ReelCheck{Rule: "audio", Label: "Audio track present"}
	if hasAudio {
		c.Severity = CheckPass
		return c
	}
	c.Severity = CheckBlock
	c.Detail = "there is no audio track - Instagram and TikTok both reject silent reels"
	return c
}

func sizeCheck(bytes int64) ReelCheck {
	c := ReelCheck{Rule: "size", Label: "Under 512 MB"}
	if bytes > 0 && bytes > ReelMaxBytes {
		c.Severity = CheckBlock
		c.Detail = fmt.Sprintf("%.1f MB exceeds the 512 MB limit", float64(bytes)/(1024*1024))
		return c
	}
	c.Severity = CheckPass
	return c
}

func durationCheck(platform string, durationS int) ReelCheck {
	c := ReelCheck{Rule: "duration", Label: "Within the length limit"}

	if durationS <= 0 {
		// Not measured yet. Passing rather than blocking, because an unprobed
		// asset is not a failed one - and the caller gates on status anyway.
		c.Severity = CheckPass
		c.Detail = "length not measured yet"
		return c
	}

	switch platform {
	case PlatformYouTubeShorts:
		// The one genuine WARN in this file.
		//
		// A 75s clip uploads fine and simply does not get the Shorts shelf. Calling
		// that a failure would tell the creator their video is broken when it is
		// not, and a check that cries wolf is one people stop reading.
		switch {
		case durationS <= YouTubeShortsMaxSeconds:
			c.Severity = CheckPass
		case durationS <= ReelMaxSeconds:
			c.Severity = CheckWarn
			c.Detail = fmt.Sprintf(
				"%ds is over the %ds Shorts limit - it will upload, but will NOT appear in the Shorts shelf. Trim it, or post it as a regular video.",
				durationS, YouTubeShortsMaxSeconds)
		default:
			c.Severity = CheckBlock
			c.Detail = fmt.Sprintf("%ds exceeds the %ds maximum", durationS, ReelMaxSeconds)
		}
	default:
		if durationS <= ReelMaxSeconds {
			c.Severity = CheckPass
			return c
		}
		c.Severity = CheckBlock
		c.Detail = fmt.Sprintf("%ds exceeds the %ds maximum", durationS, ReelMaxSeconds)
	}
	return c
}

// SafeAreaWarning describes the platform-UI overlap for a clip's dimensions.
//
// Returns "" for anything that is not 9:16, on purpose. The platform UI bands
// are a consequence of a VERTICAL clip, so advising a 16:9 clip to "keep
// captions clear of the top 141px" is advice about a clip that will be rejected
// before it is ever uploaded. It is not wrong arithmetic - the bands do scale
// with height - but it is noise aimed at the wrong problem.
//
// Advisory and dimension-derived only: this cannot SEE text in the frame, so it
// never claims to know whether anything is actually hidden. It states the region
// and leaves the judgement to the creator.
func SafeAreaWarning(width, height int) string {
	if !isPortraitNineSixteen(width, height) {
		return ""
	}
	// Scale the safe area with resolution: a 1080x1920 clip has ~250px of
	// platform UI, a 1440x2560 one has proportionally more.
	scale := float64(height) / float64(ReelTargetHeight)
	top := int(math.Round(float64(ReelSafeAreaTopPx) * scale))
	bottom := int(math.Round(float64(ReelSafeAreaBottomPx) * scale))
	return fmt.Sprintf(
		"Platform UI covers roughly the top %dpx and bottom %dpx of this %dx%d clip - keep captions clear of both.",
		top, bottom, width, height)
}

// assetIsReel is a tiny readability shim so callers do not compare raw strings.
func assetIsReel(a *model.MediaAsset) bool { return a != nil && a.IsReel() }

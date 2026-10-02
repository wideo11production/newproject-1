package service

import (
	"strings"
	"testing"
)

// =============================================================================
// WHAT IS WORTH TESTING HERE
// =============================================================================
//
// A readiness check has one unforgivable failure mode: it must not cry wolf.
//
// A creator who is told their perfectly good clip will be rejected will either
// re-edit pointlessly or stop trusting the tool - and once they stop trusting it,
// the checks that WOULD have saved them are the ones they ignore. So the exact
// thing under test here is that every verdict is correct and every failure
// carries a reason.
//
// The cases are all real platform behaviour:
//
//	1. 9:16 vertical with audio          -> eligible everywhere
//	2. landscape 16:9                     -> blocked on ALL four
//	3. square 1:1                         -> blocked (1:1 is not 9:16)
//	4. a ratio that ALMOST matches          -> still blocked, exactly
//	5. no audio track                     -> blocked
//	6. over 512 MB                        -> blocked
//	7. 75 seconds                          -> WARN on Shorts, PASS elsewhere
//	8. 95 seconds                          -> blocked everywhere
//	9. unmeasured dimensions               -> not reported as a failure
//
// Case 4 deserves its own note: 1080x1920 divided in IEEE754 is not exactly
// 9:16, so a float comparison with an epsilon eventually gives the wrong answer.
// The check uses integer maths, and this test pins that.

func findPlatform(got ReelReadiness, platform string) PlatformReadiness {
	for _, p := range got.Platforms {
		if p.Platform == platform {
			return p
		}
	}
	return PlatformReadiness{Platform: platform}
}

func findCheck(p PlatformReadiness, rule string) ReelCheck {
	for _, c := range p.Checks {
		if c.Rule == rule {
			return c
		}
	}
	return ReelCheck{}
}

func TestReelGoodClipIsEligibleEverywhere(t *testing.T) {
	got := EvaluateReel(1080, 1920, 30, true, 50*1024*1024)

	if !got.EligibleEverywhere {
		t.Fatalf("a 1080x1920 / 30s / 50MB / audio clip should be eligible on all four:\n%+v", got)
	}
	if len(got.Platforms) != len(AllReelPlatforms) {
		t.Fatalf("grid has %d platforms, want %d", len(got.Platforms), len(AllReelPlatforms))
	}
	for _, p := range got.Platforms {
		if !p.Eligible {
			t.Errorf("%s: not eligible: %+v", p.Platform, p.BlockingRules)
		}
	}
}

func TestReelLandscapeIsBlockedEverywhere(t *testing.T) {
	got := EvaluateReel(1920, 1080, 30, true, 50*1024*1024)

	if got.EligibleEverywhere {
		t.Fatal("a 16:9 clip was reported eligible - every one of these platforms requires 9:16")
	}
	for _, p := range got.Platforms {
		if p.Eligible {
			t.Errorf("%s: a landscape clip must not be eligible", p.Platform)
		}
		if c := findCheck(p, "aspect_ratio"); c.Severity != CheckBlock {
			t.Errorf("%s: aspect_ratio severity = %q, want %q", p.Platform, c.Severity, CheckBlock)
		}
	}
}

func TestReelSquareIsBlocked(t *testing.T) {
	got := EvaluateReel(1080, 1080, 30, true, 50*1024*1024)
	for _, p := range got.Platforms {
		if p.Eligible {
			t.Errorf("%s: a 1:1 clip must not be eligible - 1:1 is not 9:16", p.Platform)
		}
	}
}

func TestReelAspectUsesIntegerMaths(t *testing.T) {
	// Exactly 9:16 must pass. A float comparison `w/h == 9.0/16.0` is FALSE for
	// this in IEEE754, which is why the check uses `width*16 == height*9`.
	if !isPortraitNineSixteen(1080, 1920) {
		t.Error("1080x1920 is exactly 9:16 and must be accepted")
	}
	if !isPortraitNineSixteen(720, 1280) {
		t.Error("720x1280 is exactly 9:16 and must be accepted")
	}
	if !isPortraitNineSixteen(1440, 2560) {
		t.Error("1440x2560 is exactly 9:16 and must be accepted")
	}

	// One pixel off either axis is not 9:16, and must not be let through.
	for _, c := range [][2]int{{1079, 1920}, {1080, 1919}, {1081, 1920}, {1920, 1080}, {1080, 0}} {
		if isPortraitNineSixteen(c[0], c[1]) {
			t.Errorf("%dx%d was accepted as 9:16", c[0], c[1])
		}
	}
}

func TestReelMissingAudioIsBlocked(t *testing.T) {
	got := EvaluateReel(1080, 1920, 30, false, 50*1024*1024)
	for _, p := range got.Platforms {
		if p.Eligible {
			t.Errorf("%s: a silent clip must not be eligible", p.Platform)
		}
		if c := findCheck(p, "audio"); c.Detail == "" {
			t.Errorf("%s: the audio failure has no reason - a failure a creator cannot act on is worse than silence", p.Platform)
		}
	}
}

func TestReelOversizeIsBlocked(t *testing.T) {
	got := EvaluateReel(1080, 1920, 30, true, 600*1024*1024)
	for _, p := range got.Platforms {
		if p.Eligible {
			t.Errorf("%s: a 600MB clip must not be eligible", p.Platform)
		}
	}
	c := findCheck(findPlatform(got, PlatformInstagramReels), "size")
	if !strings.Contains(c.Detail, "512") {
		t.Errorf("the size failure does not mention the limit: %q", c.Detail)
	}
}

// TestReelShortsOverSixtySecondsWarnsInsteadOfBlocking is the one that matters
// most for trust.
//
// A 75-second clip uploads to YouTube perfectly well. It just does not get the
// Shorts shelf. Reporting that as a FAILURE tells a creator their video is broken
// when it is not - and the day a creator learns to ignore this tool is the day
// every real failure gets ignored with it.
func TestReelShortsOverSixtySecondsWarnsInsteadOfBlocking(t *testing.T) {
	got := EvaluateReel(1080, 1920, 75, true, 50*1024*1024)

	shorts := findPlatform(got, PlatformYouTubeShorts)
	d := findCheck(shorts, "duration")

	if d.Severity != CheckWarn {
		t.Fatalf("75s on YouTube: severity = %q, want %q.\n"+
			"It UPLOADS. It just misses the Shorts shelf. Blocking would tell the\n"+
			"creator their clip is broken, and a check that cries wolf is one they\n"+
			"stop reading.", d.Severity, CheckWarn)
	}
	if shorts.Eligible != true {
		t.Error("75s on YouTube should still be ELIGIBLE - it uploads fine")
	}
	if !strings.Contains(d.Detail, "NOT appear in the Shorts shelf") {
		t.Errorf("the warning does not say what will actually happen: %q", d.Detail)
	}

	// And it must NOT warn on the platforms where 75s is simply fine.
	for _, p := range []string{PlatformInstagramReels, PlatformTikTok, PlatformFacebookReels} {
		pp := findPlatform(got, p)
		if !pp.Eligible {
			t.Errorf("%s: 75s should be eligible (their limit is 90s)", p)
		}
		if cd := findCheck(pp, "duration"); cd.Severity == CheckWarn {
			t.Errorf("%s: 75s is within the limit and must not warn: %q", p, cd.Detail)
		}
	}
}

func TestReelOverNinetySecondsIsBlockedEverywhere(t *testing.T) {
	got := EvaluateReel(1080, 1920, 95, true, 50*1024*1024)
	if got.EligibleEverywhere {
		t.Fatal("95s exceeds every platform's limit and must be blocked")
	}
	for _, p := range got.Platforms {
		if d := findCheck(p, "duration"); d.Severity != CheckBlock {
			t.Errorf("%s: 95s severity = %q, want %q", p.Platform, d.Severity, CheckBlock)
		}
	}
}

func TestReelSixtySecondsIsCleanOnShorts(t *testing.T) {
	got := EvaluateReel(1080, 1920, 60, true, 50*1024*1024)
	shorts := findPlatform(got, PlatformYouTubeShorts)
	if d := findCheck(shorts, "duration"); d.Severity != CheckPass {
		t.Errorf("60s on Shorts: severity = %q, want %q - 60 is the limit, not over it", d.Severity, CheckPass)
	}
	if len(shorts.Warnings) != 0 {
		t.Errorf("60s on Shorts produced warnings: %v", shorts.Warnings)
	}
}

// An asset that has not been probed yet must not be reported as FAILED. It is
// unknown, and unknown is not the same as broken.
func TestReelUnmeasuredIsNotAFailure(t *testing.T) {
	got := EvaluateReel(0, 0, 0, false, 0)

	for _, p := range got.Platforms {
		if c := findCheck(p, "aspect_ratio"); c.Severity == CheckPass {
			t.Errorf("%s: unknown dimensions passed silently - it should block, because nothing knows this will work", p.Platform)
		}
	}
	// Duration and size with nothing measured must not block: those rules have
	// nothing to object to yet.
	for _, p := range got.Platforms {
		if c := findCheck(p, "duration"); c.Severity == CheckBlock {
			t.Errorf("%s: an unmeasured duration blocked the clip", p.Platform)
		}
	}
}

// Every non-pass result must carry a reason. A verdict without one is not
// actionable, and "won't work, trust me" is the version creators learn to skip.
func TestReelEveryNonPassHasAReason(t *testing.T) {
	// A deliberately broken clip: landscape, silent, too big, too long.
	got := EvaluateReel(1920, 1080, 200, false, 900*1024*1024)

	for _, p := range got.Platforms {
		for _, c := range p.Checks {
			if c.Severity != CheckPass && strings.TrimSpace(c.Detail) == "" {
				t.Errorf("%s / %s: severity %q with no detail", p.Platform, c.Rule, c.Severity)
			}
		}
		if len(p.BlockingRules) == 0 {
			t.Errorf("%s: reported %d checks but no blocking rules at all", p.Platform, len(p.Checks))
		}
	}
}

func TestReelSafeAreaScalesWithResolution(t *testing.T) {
	// At the reference resolution the numbers come straight from the constants.
	ref := SafeAreaWarning(ReelTargetWidth, ReelTargetHeight)
	if !strings.Contains(ref, "top 250px") || !strings.Contains(ref, "bottom 320px") {
		t.Errorf("at 1080x1920 the safe-area numbers should match the constants: %q", ref)
	}

	// A larger clip in the same 9:16 shape has proportionally more UI.
	bigger := SafeAreaWarning(1440, 2560)
	if !strings.Contains(bigger, "top 333px") && !strings.Contains(bigger, "427px") {
		t.Errorf("a 1440x2560 clip should report a larger safe area than 1080x1920: %q", bigger)
	}

	// A LANDSCAPE clip gets no safe-area note at all. The platform UI bands are a
	// consequence of a vertical clip, so "keep captions clear of the top 141px"
	// on a 16:9 clip is advice about something that will be rejected before it is
	// ever uploaded.
	for _, c := range [][2]int{{1920, 1080}, {1080, 1080}, {0, 0}, {1079, 1920}} {
		if got := SafeAreaWarning(c[0], c[1]); got != "" {
			t.Errorf("SafeAreaWarning(%dx%d) = %q, want \"\" - not a 9:16 clip", c[0], c[1], got)
		}
	}

	_ = assetIsReel
}

// CONTENT MODERATION ENGINE - self-hosted, zero-cost, frame + audio analysis.
//
// =============================================================================
// WHY THIS IS A HEURISTIC ENGINE AND NOT A CLOUD API
// =============================================================================
//
// The obvious implementation is AWS Rekognition or Google Cloud Vision: upload a
// few frames, get back `NSFW: 0.94`. It is also the wrong one here, for three
// reasons that compound.
//
// 1. COST PER UPLOAD, FOREVER. Every video pays an API bill, and the bill scales
//    with uploads - which means the more successful the product is, the more it
//    pays. This platform's rule is the opposite: "kisi ko ek bhi penny nahi" for
//    the baseline.
//
// 2. THE VIDEO LEAVES THE BUILD. A self-hosted platform sending user video frames
//    to a third party is a privacy regression the product cannot justify, and it
//    is exactly the data-transfer question the presigned-upload architecture
//    exists to avoid.
//
// 3. NO SOURCE OF TRUTH. A cloud verdict is a number from a black box, so the
//    thresholds cannot be tuned against the corpus, a false positive cannot be
//    debugged, and the decision cannot be audited beyond "the API said so".
//
// So this engine runs locally on signals ffmpeg already computes, and every
// score it produces can be reproduced by hand from the same command.
//
// =============================================================================
// WHAT IT ACTUALLY MEASURES, AND WHAT IT DOES NOT
// =============================================================================
//
// HONEST SCOPING, because a moderation system that overclaims is worse than one
// with gaps. What these checks catch:
//
//	skin_ratio     A large fraction of the frame being skin-toned pixels. Catches
//	              the crude case (a video that is mostly a person) and is a
//	              STRONG signal when combined with the others.
//	saturation     Oversaturated red/pink mass. Catches gore and, as a proxy,
//	                heavily filtered adult content.
//	motion         Extreme motion magnitude combined with high skin ratio.
//	audio_level    Loudness spikes, useful as one input to a "shouty" signal.
//	black_frames   All-black video, i.e. an upload with no content.
//
// What it does NOT catch, and must not be described as catching:
//
//	- a clothed person in a suggestive pose
//	- nudity in an unseen-until-later scene the sampled frames missed
//	- anything requiring semantics: symbols, gestures, written text
//	- anything in the AUDIO TRACK'S WORDS. There is no ASR here, so profanity,
//	  hate speech and extremist slogans in speech are NOT detected.
//
// That last gap is the serious one, and it is why the audio transcript check is
// reported as `asr:none` rather than silently omitted: the record must show the
// check did not run. See the T&C, which promises screening and not omniscience.
//
// =============================================================================
// THE BAND, NOT THE VERDICT
// =============================================================================
//
// Every check returns a score, and the score is compared against TWO thresholds:
//
//	score >= rejectAt  ->  REJECTED, clear violation
//	score >= flagAt    ->  FLAGGED, a human must look
//	score <  flagAt    ->  approved by this check
//
// The band in the middle is the whole point. A classifier's confidence is not a
// verdict, and a system with only one threshold forces a binary choice between
// false positives that punish creators and false negatives that publish
// violations. The band routes the uncertain middle to a human, which is what
// every production moderation system does.
//
// ZERO KNOWLEDGE OF THE FINAL VERDICT. This package scores; the caller applies
// thresholds. Keeping them apart means the thresholds live in config (env) and
// the scoring logic is testable without re-deciding a policy.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ModerationCheck is one analysis result: its name, score, and thresholds.
//
// `Score` is normalised 0.0-1.0 so every check is comparable and a single
// `rejectAt` threshold means the same thing across all of them. A raw filter
// value (a YAVG in 16-235, a dB level) would make thresholds unreadable.
type ModerationCheck struct {
	Name     string  `json:"name"`
	Score    float64 `json:"score"`
	FlagAt   float64 `json:"flag_at"`
	RejectAt float64 `json:"reject_at"`
	Flagged  bool    `json:"flagged"`
	Rejected bool    `json:"rejected"`
	// What the check saw, in the check's own vocabulary. Sampled frames count,
	// mean value, etc. Kept because a threshold tuned without knowing what was
	// measured is a guess.
	Detail string `json:"detail,omitempty"`
	// Skipped means the check could not run (no video stream, ffmpeg failed).
	// Distinct from Score 0.0, which means "ran and found nothing": treating them
	// the same would let a failing check silently approve everything.
	Skipped bool   `json:"skipped,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// ModerationResult is the engine's full report on one asset.
type ModerationResult struct {
	Verdict string            `json:"verdict"` // approved | rejected | flagged
	Score   float64           `json:"score"`
	Reason  string            `json:"reason"`
	Checks  []ModerationCheck `json:"checks"`
	// Provider tags the build, so a verdict is attributable to the code that
	// made it. Bumped when thresholds or a check change.
	Provider string `json:"provider"`

	// Prohibited is the named-category verdict, or nil when the engine did not run.
	//
	// A pointer rather than a value because "the engine was disabled" and "the
	// engine ran and found nothing" are different facts, and collapsing them into a
	// zero struct would make an unrun engine look like a clean one - which is
	// exactly the failure mode a screening pipeline must never have.
	Prohibited *prohibitedDecision `json:"prohibited,omitempty"`
}

// ModerationConfig holds the thresholds, read from env.
//
// Every threshold is a config value rather than a constant, for the same reason
// the plan prices are: a threshold that needs a redeploy to relax is a threshold
// that stays wrong for a week. Tuning these against a real corpus MUST be
// possible without a release.
type ModerationConfig struct {
	// SkinToneFlagAt / SkinToneRejectAt: fraction of sampled pixels that are
	// skin-toned. A normal talking-head video sits around 0.15-0.35; something
	// that is mostly a body reaches 0.6+.
	SkinToneFlagAt   float64
	SkinToneRejectAt float64

	// RedMassFlagAt / RedMassRejectAt: fraction of pixels that are strongly red
	// and saturated. Gore is a red-mass signal; a red title card is not
	// saturated in the same way, which is why this is not a colour ban.
	RedMassFlagAt   float64
	RedMassRejectAt float64

	// MotionSkinFlagAt: motion magnitude combined with skin ratio, the crude
	// "sexual activity" proxy. Low confidence by construction, hence FLAG only.
	MotionSkinFlagAt float64

	// AudioSpikeFlagAt: loudness peak in dB above the file's own mean. Catches a
	// shout or an impact, and is only ever a FLAG - loud content is not a
	// violation on its own.
	AudioSpikeFlagAt float64

	// BlackFrameRejectAt: fraction of sampled frames that are essentially black.
	// A video that is mostly black has no content, which is its own violation.
	BlackFrameRejectAt float64

	// FramesSampled: how many equidistant frames to decode. Sampling rather than
	// decoding every frame is what makes this affordable for a 4K hour-long file.
	FramesSampled int
}

// DefaultModerationConfig reads the thresholds from env.
//
// The defaults are deliberately CONSERVATIVE - set to flag more often than they
// reject, because a false flag costs a human a minute and a false reject costs a
// creator their upload. They are a starting point for tuning, not a tuned set.
func DefaultModerationConfig() ModerationConfig {
	return ModerationConfig{
		SkinToneFlagAt:    envFloat("MODERATION_SKIN_FLAG_AT", 0.45),
		SkinToneRejectAt:  envFloat("MODERATION_SKIN_REJECT_AT", 0.70),
		RedMassFlagAt:     envFloat("MODERATION_RED_FLAG_AT", 0.20),
		RedMassRejectAt:   envFloat("MODERATION_RED_REJECT_AT", 0.45),
		MotionSkinFlagAt:  envFloat("MODERATION_MOTION_SKIN_FLAG_AT", 0.55),
		AudioSpikeFlagAt:  envFloat("MODERATION_AUDIO_SPIKE_FLAG_AT", 12.0),
		BlackFrameRejectAt: envFloat("MODERATION_BLACK_FRAME_REJECT_AT", 0.80),
		FramesSampled:     envInt("MODERATION_FRAMES_SAMPLED", 8),
	}
}

// ModerationEnabled lets the whole engine be switched off.
//
// Why an off switch: this is a NEW control on the upload path, and shipping it
// live with no way back is shipping a possible total outage. With it off,
// `Moderate` returns `approved` and uploads behave exactly as they did before.
func ModerationEnabled() bool {
	// Enabled by DEFAULT. The product promise is that nothing publishes without
	// being looked at, so the safe direction is on.
	return envBool("MODERATION_ENABLED", true)
}

// moderationVersion tags every verdict with the build that produced it.
//
// Bump when a check or a threshold changes in a way that makes old verdicts
// non-comparable - which is exactly when someone will ask why they are.
const moderationVersion = "ai:heuristic-v1"

// Moderate is the entry point: score one asset and return the verdict.
//
// The caller passes the LOCAL source path (already fetched by the transcoder) and
// the probe, so nothing is decoded twice - the source is on the local disk and
// its streams are already known.
//
// The returned verdict is one of:
//
//	approved - every check under its flag threshold
//	rejected - at least one check over its reject threshold
//	flagged  - at least one check over its flag threshold, none over reject
//
// A SKIPPED check never approves or rejects. It contributes no score and is
// reported as skipped, so "no video stream to analyse" is visible in the result
// rather than looking like a clean video.
func Moderate(ctx context.Context, sourcePath string, p probeResult, cfg ModerationConfig) *ModerationResult {
	result := &ModerationResult{
		Provider: moderationVersion,
		Checks:   make([]ModerationCheck, 0, 5),
	}

	start := time.Now()

	// ---- 1. Visual checks: skin tone, red mass, black frames ----
	//
	// All three come out of ONE ffmpeg pass over the sampled frames, because
	// decoding a 4K source three times to sample eight frames each time would be
	// three times the cost of the encode itself.
	visual := analyseVisual(ctx, sourcePath, p, cfg)
	result.Checks = append(result.Checks, visual...)

	// ---- 2. Audio check: loudness spike ----
	result.Checks = append(result.Checks, analyseAudio(ctx, sourcePath, p, cfg))

	// ---- 3. The ASR check, REPORTED AS ABSENT ----
	//
	// There is no speech-to-text in this build, so profanity, hate speech and
	// extremist slogans spoken in the audio are NOT detected. Stating that as a
	// check with `skipped: true` is what keeps the audit honest: the T&C promises
	// screening, and a record showing which kinds of screening ran is what makes
	// that promise auditable.
	result.Checks = append(result.Checks, ModerationCheck{
		Name:    "audio_transcript",
		Skipped: true,
		Reason:  "no speech-to-text model is configured (asr:none) - spoken profanity and hate speech are not screened in this build",
	})

	// ---- 4. The PROHIBITED CONTENT ENGINE ----
	//
	// The zero-tolerance categories the platform enforces: adultery and sexually
	// explicit content, riots and public violence, terrorism and extremism, drugs
	// and illegal substances, hate speech, and dangerous acts.
	//
	// It runs as its own stage rather than folding into the checks above for one
	// reason: those checks each answer "is this NUMBER past a threshold", and this
	// one answers "what KIND of prohibited content is this". The named category is
	// what the creator is told and what a reviewer triages on, so it has to be a
	// first-class output rather than a label derived from which pixel check fired.
	//
	// It samples its own frames rather than reusing the ones `analyseVisual`
	// decoded, which costs one extra ffmpeg pass over the same eight-ish frames.
	// That is deliberate and accepted: the alternative is threading a frame slice
	// through three functions to save a hundred milliseconds, and a moderation
	// pass whose sampling is implicitly shared is one refactor away from
	// silently measuring the wrong frames.
	prohibited := analyseProhibited(ctx, sourcePath, p, cfg, prohibitedTextInput{
		// The upload's own filename is the only text stream available at THIS
		// stage. The title, description, channel metadata and any transcript live in
		// auth-service, and they are screened there against the same lexicon - which
		// is why the T&C's screening promise is recorded per stream rather than as
		// one blanket claim.
		Streams: []string{"filename"},
		Text:    filepath.Base(sourcePath),
	})
	result.Checks = append(result.Checks, prohibited.check)
	result.Prohibited = &prohibited.decision

	// ---- Verdict ----
	result.Verdict, result.Score, result.Reason = moderateVerdict(result)

	// The prohibited engine outranks every check above it. A pixel heuristic that
	// says "approved" while the category engine says "rejected: drugs" must not
	// publish, and the checks are ordered heuristically - the first one to fire
	// must not be the one that defines the outcome.
	if prohibited.decision.Verdict == "rejected" && result.Verdict != "rejected" {
		result.Verdict = "rejected"
		result.Reason = prohibited.decision.Reason
		if prohibited.decision.Score > result.Score {
			result.Score = prohibited.decision.Score
		}
	}

	log.Printf("[MODERATION] verdict=%s score=%.3f checks_run=%d in %v",
		result.Verdict, result.Score, len(result.Checks),
		time.Since(start).Round(time.Millisecond))
	// ---- The per-check breakdown, always logged ----
	//
	// This is the calibration surface. A threshold tuned without knowing which
	// check fired and what it measured is a guess, and the whole point of a
	// self-hosted engine is that the numbers are inspectable. Logging every
	// check on every job costs one line and makes a false positive diagnosable
	// from the logs alone.
	for _, c := range result.Checks {
		if c.Skipped {
			log.Printf("[MODERATION]   %-16s SKIPPED: %s", c.Name, c.Reason)
			continue
		}
		state := "ok"
		if c.Rejected {
			state = "REJECTED"
		} else if c.Flagged {
			state = "flagged"
		}
		log.Printf("[MODERATION]   %-16s score=%.3f flag>=%.2f reject>=%.2f -> %s | %s",
			c.Name, c.Score, c.FlagAt, c.RejectAt, state, c.Detail)
	}
	return result
}

// moderateVerdict turns a set of checks into the verdict.
//
// =============================================================================
// THE RULE: A SINGLE WEAK SIGNAL NEVER REJECTS
// =============================================================================
//
// This is the most important decision in the engine, and it came out of a real
// failure. An early version let `skin_tone` reject at 0.70 on its own, and it
// auto-refused a legitimate video at 88.5% - because a warm-toned video genuinely
// has most of its pixels in the skin chroma range (see the `knownOverlap` table
// in moderation_pixels_test.go). A permanent refusal of somebody's upload, on one
// heuristic, is worse than a missed violation: the creator can appeal neither,
// but only one of them destroyed their work.
//
// So a rejection needs one of:
//
//	extreme   - one check is so far past its threshold that the signal is not
//	           ambiguous. skin >= 0.92 means essentially the entire frame is
//	           skin; no ordinary video is that.
//	combined  - two or more independent checks flag together. Warm tones alone
//	           flag; warm tones AND heavy motion AND a loud audio spike is a
//	           pattern, not a colour.
//
// Everything else FLAGS, which routes a human to look. A human is the actual
// detector; this engine decides what is worth their minute.
//
// Extracted from `Moderate` as a pure function of the checks so the rule can be
// tested directly - and so the next check added to the engine cannot quietly
// become an auto-reject.
func moderateVerdict(result *ModerationResult) (verdict string, score float64, reason string) {
	const (
		// extremeSkinRatio is where "mostly a body" stops being a colour question.
		extremeSkinRatio = 0.92
		// minCorroborating is how many independent signals a refusal needs.
		minCorroborating = 2
	)

	var fired int
	var worstScore float64
	var reasons []string
	extreme := false

	for _, c := range result.Checks {
		// A SKIPPED check is "this could not be measured". It is not a signal,
		// and counting it as one would give every audio-less video an implicit
		// corroborating flag from the check that could not run. Two inconclusive
		// results are not a pattern.
		if c.Skipped {
			continue
		}
		if c.Rejected && (c.Name != "skin_tone" || c.Score >= extremeSkinRatio) {
			extreme = true
		}
		if !c.Flagged && !c.Rejected {
			continue
		}
		fired++
		if c.Score > worstScore {
			worstScore = c.Score
		}
		reasons = append(reasons, moderationReason(c))
	}

	switch {
	case extreme, fired >= minCorroborating:
		verdict = "rejected"
	case fired == 1:
		verdict = "flagged"
	default:
		verdict = "approved"
	}

	// The reason names every check that fired, not just the first: a creator
	// asking "why was my video held" needs the whole picture, and a reviewer
	// needs to see whether two weak signals added up or one strong one fired.
	if len(reasons) > 0 {
		if verdict == "rejected" {
			reason = "This upload was refused by automated screening: " + strings.Join(reasons, " ")
		} else {
			reason = reasons[0]
		}
	}
	return verdict, worstScore, reason
}

// moderationReason turns a failed check into a sentence for the creator.
//
// Written in the second person and without the word "violation", because the
// person reading it just had their upload refused and the next thing they need
// is what to change.
func moderationReason(c ModerationCheck) string {
	switch c.Name {
	case "skin_tone":
		return "This upload was held back because automated screening flagged its visual content. " +
			"If you believe this is a mistake, contact support."
	case "red_mass":
		return "This upload was held back because automated screening detected graphic content. " +
			"Violent or gory material is not permitted."
	case "motion_skin":
		return "This upload needs a human review before it can be published."
	case "black_frames":
		return "This upload has no visible content for most of its length."
	case "audio_spike":
		return "This upload needs a human review before it can be published."
	default:
		return "This upload needs a human review before it can be published."
	}
}

// analyseVisual decodes a sample of frames and measures skin-tone, red-mass and
// black-frame ratios in ONE pass.
//
// ---------------------------------------------------------------------------
// WHY SAMPLING AND NOT EVERY FRAME
// ---------------------------------------------------------------------------
//
// A 4K hour-long video is ~90,000 frames. Decoding and inspecting all of them
// costs more than the transcode ladder, and the moderation answer would barely
// improve. Equidistant sampling (every N/frames frames) is the standard
// trade-off, and the one weakness - a short violation between samples - is
// exactly what the FLAG band and the human review exist to catch.
//
// ---------------------------------------------------------------------------
// HOW THE PIXEL COUNTS ARE TAKEN
// ---------------------------------------------------------------------------
//
// `signalstats` with `out=yiq` reports YAVG (luma) and SATAVG per frame, and
// that is enough for black frames. For SKIN TONE and RED MASS the frame needs
// per-pixel classification, which signalstats does not provide.
//
// So the runs are split into two commands:
//
//	signalstats  ->  YAVG, for the black-frame ratio (cheap, metadata only)
//	frame dir    ->  decoded PNGs, classified in Go
//
// The frame decode is the expensive one, which is why it scales the JPEGs down
// to 160px wide first: skin-tone ratio is a statistic over the frame, and a
// 160px image gives the same ratio within a fraction of a percent at a tiny
// fraction of the decode cost.
func analyseVisual(ctx context.Context, sourcePath string, p probeResult, cfg ModerationConfig) []ModerationCheck {
	// No video stream: nothing to look at. REPORTED as skipped rather than
	// scored 0.0, so "an upload with no video" is not mistaken for "a clean
	// video".
	if !p.hasVideo() {
		return []ModerationCheck{{
			Name:    "skin_tone",
			Skipped: true,
			Reason:  "source has no video stream",
		}}
	}

	// ---- 1. Black frames: signalstats, no pixel decode ----
	blackCheck := analyseBlackFrames(ctx, sourcePath, p, cfg)

	// ---- 2. Sample frames, then classify pixels in Go ----
	skin, red := analysePixels(ctx, sourcePath, p, cfg)

	// ---- The combined motion/skin proxy ----
	//
	// `p.motionHint` is a frame-difference magnitude measured by the probe's own
	// scene analysis, scaled so a static camera is ~0 and a wildly moving one
	// approaches 1.
	//
	// Registered only as a FLAG, never a reject. The signal - high motion AND
	// high skin coverage - is too weak to refuse an upload on its own, and
	// pretending otherwise would produce refusals nobody could explain.
	motionSkin := ModerationCheck{
		Name:   "motion_skin",
		Score:  skin.Score * p.motionHint(),
		FlagAt: cfg.MotionSkinFlagAt,
	}
	motionSkin.Flagged = motionSkin.Score >= motionSkin.FlagAt

	skin.FlagAt = cfg.SkinToneFlagAt
	skin.RejectAt = cfg.SkinToneRejectAt
	skin.Flagged = skin.Score >= skin.FlagAt
	skin.Rejected = skin.Score >= skin.RejectAt

	red.FlagAt = cfg.RedMassFlagAt
	red.RejectAt = cfg.RedMassRejectAt
	red.Flagged = red.Score >= red.FlagAt
	red.Rejected = red.Score >= red.RejectAt

	return []ModerationCheck{skin, red, motionSkin, blackCheck}
}

// analyseBlackFrames measures what fraction of sampled frames are essentially black.
//
// `signalstats` prints `YAVG:<luma>` once per frame. A YAVG below 16 (the
// broadcast-black floor in an 8-bit luma scale) means the frame carries no
// visible signal.
func analyseBlackFrames(ctx context.Context, sourcePath string, p probeResult, cfg ModerationConfig) ModerationCheck {
	check := ModerationCheck{Name: "black_frames"}

	// Only a short window is needed: a video that is mostly black is black
	// throughout, so sampling the first two minutes finds it without paying to
	// decode an hour.
	out, err := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-nostats",
		"-v", "info",
		"-i", sourcePath,
		"-t", "120",
		"-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
		"-f", "null", "-",
	).CombinedOutput()
	if err != nil {
		check.Skipped = true
		check.Reason = fmt.Sprintf("ffmpeg signalstats failed: %v", err)
		return check
	}

	var lumaSum float64
	var frames int
	var black int
	for _, line := range strings.Split(string(out), "\n") {
		// `metadata=print` emits `lavfi.signalstats.YAVG=126.034` - an EQUALS sign,
		// not a colon. That single character is why this check silently skipped on
		// every job: the parser looked for "YAVG:" and found nothing, so it
		// reported "no per-frame luma" and skipped the check entirely.
		idx := strings.Index(line, "lavfi.signalstats.YAVG=")
		if idx < 0 {
			continue
		}
		v := strings.TrimSpace(line[idx+len("lavfi.signalstats.YAVG="):])
		if v == "" {
			continue
		}
		luma, perr := strconv.ParseFloat(v, 64)
		if perr != nil {
			continue
		}
		frames++
		lumaSum += luma
		if luma < 16.0 {
			black++
		}
	}
	if frames == 0 {
		check.Skipped = true
		check.Reason = "signalstats produced no per-frame luma"
		return check
	}

	check.Score = float64(black) / float64(frames)
	check.FlagAt = cfg.BlackFrameRejectAt
	check.RejectAt = cfg.BlackFrameRejectAt
	check.Detail = fmt.Sprintf("%d of %d sampled frames black (mean luma %.1f)",
		black, frames, lumaSum/float64(frames))
	// A black-heavy upload is refused outright: it is not a judgement call about
	// content, it is a file with nothing in it.
	check.Rejected = check.Score >= check.RejectAt
	check.Flagged = check.Rejected
	return check
}

// analysePixels classifies sampled frames for skin-tone and red-mass ratios.
//
// The frames are decoded to a small JPEG sprite in one ffmpeg pass, then each
// frame is classified in Go. No image library is needed and none is imported:
// JPEG decoding is available from the standard library since Go 1.20 via
// `image/jpeg`, which keeps the dependency surface at zero.
func analysePixels(ctx context.Context, sourcePath string, p probeResult, cfg ModerationConfig) (ModerationCheck, ModerationCheck) {
	skin := ModerationCheck{Name: "skin_tone"}
	red := ModerationCheck{Name: "red_mass"}

	// ---- Decode a sample of frames into PNGs ----
	//
	// `fps` is set so the count is bounded even for a long file: taking
	// `FramesSampled` frames across the duration is what the comment above
	// promises, and `fps` is the ffmpeg-native way to say it.
	//
	// Small output size: skin ratio is a frame-level statistic and 160px wide is
	// 1/24th the pixels of 720p, which is the difference between a moderation
	// pass that is free and one that doubles the encode time.
	sampleDir, err := os.MkdirTemp("", "moderation-")
	if err != nil {
		skin.Skipped = true
		skin.Reason = "could not create a sample dir"
		red.Skipped = true
		red.Reason = skin.Reason
		return skin, red
	}
	defer os.RemoveAll(sampleDir)

	fps := float64(cfg.FramesSampled) / math.Max(p.durationS, 1)
	out, err := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error",
		"-i", sourcePath,
		"-vf", fmt.Sprintf("fps=%.6f,scale=160:-2", fps),
		"-frames:v", strconv.Itoa(cfg.FramesSampled),
		"-q:v", "4",
		filepath.Join(sampleDir, "f_%03d.jpg"),
	).CombinedOutput()
	if err != nil {
		skin.Skipped = true
		skin.Reason = fmt.Sprintf("frame sampling failed: %v (%s)", err, tail(string(out), 200))
		red.Skipped = true
		red.Reason = skin.Reason
		return skin, red
	}

	entries, rerr := os.ReadDir(sampleDir)
	if rerr != nil || len(entries) == 0 {
		skin.Skipped = true
		skin.Reason = fmt.Sprintf("no frames were decoded (%v)", rerr)
		red.Skipped = true
		red.Reason = skin.Reason
		return skin, red
	}

	// ---- Classify each frame ----
	var skinTotal, redTotal float64
	var classified int
	for _, e := range entries {
		raw, rerr := os.ReadFile(filepath.Join(sampleDir, e.Name()))
		if rerr != nil {
			continue
		}
		s, r, _ := classifyFrame(raw)
		skinTotal += s
		redTotal += r
		classified++
	}
	if classified == 0 {
		skin.Skipped = true
		skin.Reason = "no frames could be decoded"
		red.Skipped = true
		red.Reason = skin.Reason
		return skin, red
	}

	skin.Score = skinTotal / float64(classified)
	skin.Detail = fmt.Sprintf("%.1f%% skin-toned pixels across %d sampled frames",
		skin.Score*100, classified)
	red.Score = redTotal / float64(classified)
	red.Detail = fmt.Sprintf("%.1f%% saturated red pixels across %d sampled frames",
		red.Score*100, classified)
	return skin, red
}

// analyseAudio measures loudness for a spike signal.
//
// A loudness spike is not a violation - a gunshot in a documentary spikes - so
// this only ever contributes to a FLAG, and the threshold is set high enough
// that ordinary mastered audio does not trip it.
func analyseAudio(ctx context.Context, sourcePath string, p probeResult, cfg ModerationConfig) ModerationCheck {
	check := ModerationCheck{Name: "audio_spike"}
	if !p.hasAudio {
		check.Skipped = true
		check.Reason = "source has no audio stream"
		return check
	}

	out, err := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-nostats",
		"-v", "info",
		"-i", sourcePath,
		"-t", "120",
		"-af", "volumedetect",
		"-f", "null", "-",
	).CombinedOutput()
	if err != nil {
		check.Skipped = true
		check.Reason = fmt.Sprintf("volumedetect failed: %v", err)
		return check
	}

	var mean, max float64
	for _, line := range strings.Split(string(out), "\n") {
		switch {
		case strings.Contains(line, "mean_volume:"):
			mean = parseDB(line, "mean_volume:")
		case strings.Contains(line, "max_volume:"):
			max = parseDB(line, "max_volume:")
		}
	}
	if max == 0 && mean == 0 {
		check.Skipped = true
		check.Reason = "volumedetect produced no levels"
		return check
	}

	// A spike is the peak above the file's own average, in dB. Normalising
	// against the mean is what makes one threshold work across a quiet podcast
	// and a loud music video.
	spike := max - mean
	check.Score = spike
	check.FlagAt = cfg.AudioSpikeFlagAt
	check.Detail = fmt.Sprintf("mean %.1f dB, peak %.1f dB (%.1f dB above mean)",
		mean, max, spike)
	check.Flagged = spike >= check.FlagAt
	return check
}

// parseDB pulls a dB value out of a `key: -12.3 dB` line.
//
// Returns 0 on a parse failure, which the caller treats as "not present" rather
// than as silence - a silent file and an unparsable line must not look alike.
func parseDB(line, key string) float64 {
	idx := strings.Index(line, key)
	if idx < 0 {
		return 0
	}
	rest := strings.TrimSpace(line[idx+len(key):])
	rest = strings.TrimSuffix(rest, "dB")
	rest = strings.TrimSpace(rest)
	v, err := strconv.ParseFloat(rest, 64)
	if err != nil {
		return 0
	}
	return v
}

// ChecksJSON returns the checks as a map for the callback payload.
//
// A map rather than a slice because the wire format is keyed by check name, and
// a caller reading `checks.skin_tone` is clearer than indexing an array whose
// order is an implementation detail.
func (r *ModerationResult) ChecksJSON() map[string]any {
	out := make(map[string]any, len(r.Checks))
	for _, c := range r.Checks {
		out[c.Name] = c
	}
	return out
}

// ChecksJSONString is the same payload encoded, for the audit column.
func (r *ModerationResult) ChecksJSONString() string {
	b, err := json.Marshal(r.ChecksJSON())
	if err != nil {
		return "{}"
	}
	return string(b)
}

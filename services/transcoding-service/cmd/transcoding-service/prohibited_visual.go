package main

// ============================================================================
// PROHIBITED VISUAL ENGINE - the frame-by-frame half of the screening pipeline
// ============================================================================
//
// WHAT THIS DOES
//
// Decodes a bounded sample of frames and classifies each one, then rolls the
// per-frame results up into a score PER PROHIBITED CATEGORY. It is the visual
// counterpart of prohibited_text.go: that one answers "is this ABOUT something
// prohibited", this one answers "does this SHOW something prohibited".
//
// ============================================================================
// WHY IT REUSES THE SAME FRAMES
// ============================================================================
// The pixel checks in moderation.go already decode `FramesSampled` frames into
// JPEGs and throw them away. This file adds the CATEGORY map over the same
// frames - a separate ffmpeg pass would double the decode time of every upload to
// compute a statistic the pipeline already had in hand.
//
// So the caller does this:
//
//	frames := sampleModerationFrames(ctx, source, probe, cfg)
//	cats   := classifyVisualCategories(frames)
//
// and the whole engine is a map lookup per frame, not a second decode.
//
// ============================================================================
// WHAT A PIXEL CLASSIFIER CAN AND CANNOT SEE
// ============================================================================
//
// It cannot identify an object. There is no model here that knows what a bottle
// of whisky looks like, and a lexicon-like list of object templates would be both
// enormous and trivially evaded.
//
// What it CAN see is coarse, and coarse is enough for the categories that matter:
//
//	skin ratio over a large area  ->  adult/nudity signal (a body fills a frame in
//	                                 a way a face does not)
//	saturated red + high motion  ->  violence signal (blood, fire, a scuffle)
//	sustained near-black         ->  a deliberate black screen, which is how
//	                                 prohibited content is smuggled past a
//	                                 thumbnail check
//
// Every one of those is a SIGNAL and not a verdict, which is why the decision
// matrix requires corroboration - see prohibited_decision.go.
//
// ============================================================================
// WHY THIS IS BIASED TOWARD FLAGGING
// ============================================================================
// A false positive costs a human reviewer a minute of looking at a frame. A false
// negative puts prohibited content in front of every viewer on the platform. Those
// two costs are not comparable, so the thresholds here are set below the point
// where a human would say "clearly fine" - on purpose.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

// sampledFrame is one decoded frame.
type sampledFrame struct {
	// JPEG is the raw encoded bytes, already downscaled by ffmpeg.
	JPEG []byte
	// Index is the 1-based position in the sample set, matching ffmpeg's
	// `f_%03d.jpg` numbering. Used in the reason so a reviewer can be pointed at
	// "frame 47 of 120" rather than "somewhere in the middle".
	Index int
}

// sampleModerationFrames decodes a bounded sample of frames.
//
// Bounded by count rather than by interval: sampling every Nth second would give a
// 10-minute file twice the frames of a 5-minute one, and the cost would scale with
// length for no gain in signal. `FramesSampled` frames across the whole duration is
// the bound, and `fps` is ffmpeg's native way to express it.
//
// Downscaled to 160px wide before classification: a frame statistic does not need
// 1080p, and decoding 16x the pixels to compute the same ratio is pure waste.
//
// The caller MUST close the returned frames (each carries a readable byte slice).
func sampleModerationFrames(
	ctx context.Context,
	sourcePath string,
	p probeResult,
	cfg ModerationConfig,
) ([]sampledFrame, error) {
	if cfg.FramesSampled <= 0 {
		return nil, nil
	}

	dir, err := os.MkdirTemp("", "moderation-visual-")
	if err != nil {
		return nil, err
	}
	// Removed by the caller's own cleanup path; this is defensive, because a
	// moderation pass that leaks a temp dir per upload fills the disk.
	defer os.RemoveAll(dir)

	fps := float64(cfg.FramesSampled) / max(p.durationS, 1)
	if _, err := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error",
		"-i", sourcePath,
		"-vf", fmt.Sprintf("fps=%.6f,scale=160:-2", fps),
		"-frames:v", strconv.Itoa(cfg.FramesSampled),
		"-q:v", "4",
		filepath.Join(dir, "f_%03d.jpg"),
	).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("frame sampling failed: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	out := make([]sampledFrame, 0, len(entries))
	for _, e := range entries {
		raw, rerr := os.ReadFile(filepath.Join(dir, e.Name()))
		if rerr != nil {
			// One unreadable frame is not a reason to fail the whole pass; the
			// remaining frames still carry the signal.
			continue
		}
		out = append(out, sampledFrame{JPEG: raw, Index: len(out) + 1})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no frames could be decoded")
	}
	return out, nil
}

// visualCategoryScores is the per-category rollup of the frame sample.
//
// Each value is in 0..1 and is the WORST per-frame observation, not the mean.
// A mean is the wrong statistic for this job: 119 frames of a person's face and
// one frame of something prohibited average to "0.8% skin", which is a number that
// says "definitely fine". The worst frame is what a viewer would actually see.
type visualCategoryScores struct {
	// Adultery is the peak skin-tone fraction over the sampled frames.
	Adultery float64 `json:"adultery_and_sexually_explicit_content"`
	// Riots is the peak of (saturated red fraction combined with frame motion).
	Riots float64 `json:"riots_and_public_violence"`
	// Danger is the peak of (saturated red fraction) on its own, which catches
	// graphic injury and fire without needing motion to corroborate.
	Danger float64 `json:"dangerous_and_graphic_content"`
	// BlackFrames is the fraction of sampled frames that are essentially black -
	// how a prohibited clip is hidden behind a thumbnail.
	BlackFrames float64 `json:"black_frames"`
	// Frames is how many frames were classified.
	Frames int `json:"frames"`
	// PeakSkinFrame is which frame carried the peak skin ratio.
	PeakSkinFrame int `json:"peak_skin_frame"`
	// PeakRedFrame is which frame carried the peak red fraction.
	PeakRedFrame int `json:"peak_red_frame"`
}

// classifyVisualCategories runs the category map over sampled frames.
//
// Returns a zero-valued result if there are no frames, which the decision matrix
// treats as "not measured" rather than as "measured as zero" - an empty sample
// must never look like a clean one.
func classifyVisualCategories(frames []sampledFrame) visualCategoryScores {
	out := visualCategoryScores{Frames: len(frames)}
	if len(frames) == 0 {
		return out
	}

	var blackFrames int
	for _, f := range frames {
		// One decode gives all three statistics - skin ratio, red fraction and mean
		// luma. A separate decode for the black-frame check would triple the cost of
		// the pass to produce a number the same loop already computed.
		skin, red, luma := classifyFrame(f.JPEG)

		// Peak, not mean - see the note on the type.
		if skin > out.Adultery {
			out.Adultery = skin
			out.PeakSkinFrame = f.Index
		}
		if red > out.Danger {
			out.Danger = red
			out.PeakRedFrame = f.Index
		}
		if red*0.5 > out.Riots {
			out.Riots = red * 0.5
		}

		if luma < blackFrameLuma {
			blackFrames++
		}
	}

	out.BlackFrames = float64(blackFrames) / float64(len(frames))
	return out
}

// blackFrameLuma is the mean-luma floor below which a frame counts as black.
//
// 16/255, the broadcast-black floor the platform's existing `black_frames` check
// also uses - so the two checks answering the same question give the same answer,
// which is the only way a number in one place can be believed alongside the number
// in the other.
//
// It was 6.0 at first, which was wrong for a different reason: with the luma
// accumulation accidentally missing, `meanLuma` came back 0 for every frame and 0
// was below ANY threshold, so every video read as 100% black frames.
const blackFrameLuma = 16.0

// max is a tiny local helper so this file does not pull in a math import for one
// call. Go 1.21+ has builtin max, but the toolchain here is older and the builtin
// shadows a name easily, so it is spelled out.
func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

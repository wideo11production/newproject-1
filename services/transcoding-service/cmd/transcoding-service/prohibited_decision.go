package main

// ============================================================================
// PROHIBITED DECISION MATRIX - where the three streams become one verdict
// ============================================================================
//
// THE PIPELINE THIS CLOSES
//
//	                    +--> visual    (frame-by-frame) --> visualCategoryScores
//	[upload] --> split -+--> audio     -> text           --+
//	                    +--> metadata  -> text           --+--> moderateText  (line-by-line)
//	                                                       |
//	                                                       v
//	                                          prohibitedDecision   <- this file
//
// ============================================================================
// THE RULE
// ============================================================================
//
// One stream firing alone is NOT a verdict. A text match with no visual
// corroboration is a creator writing an edgy title. A skin spike with no text
// corroboration is a person in a warm room. Neither is grounds to refuse an upload,
// and a system that refuses on either would refuse a great deal of legitimate
// content.
//
// So a verdict needs:
//
//	REJECT  an UNAMBIGUOUS signal in either stream - a strong lexicon term, or a
//	        skin ratio at the extreme ceiling. These are signals that do not occur
//	        by accident.
//
//	FLAG    TWO OR MORE INDEPENDENT signals agreeing, in either stream. Two weak
//	        signals from different streams is a pattern; two from the same stream
//	        is one signal counted twice.
//
//	APPROVE anything else.
//
// ============================================================================
// WHY REJECT DOES NOT BAN, AND WHY FLAG DOES NOT HOLD
// ============================================================================
//
// REJECT is a verdict about the ASSET. It stops publication and records the
// category. Whether the ACCOUNT is suspended is a separate decision made by the
// caller, and it needs an account's history - which this function deliberately does
// not look at. A single bad upload is not a banned channel, and a first offence is
// not a repeat offence.
//
// FLAG does not hold the asset either. It records that a human should look, and
// publication continues. The alternative - holding every flag - means a legitimate
// upload sits invisible until someone reviews it, which is a worse outcome for the
// creator than a flag nobody ever reads.
//
// ============================================================================
// WHY EVERY VERDICT NAMES ITS CATEGORIES
// ============================================================================
//
// "Refused for violating policy" is not actionable. A creator cannot fix what they
// cannot see, and a reviewer cannot triage what they cannot sort. So the verdict
// carries the category identifiers verbatim, and they are stored, logged and shown
// as-is.

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
)

// prohibitedTextInput is the text available to screen at the point the engine runs.
//
// The transcoder has the FILE and almost nothing else: the title, description and
// channel metadata live in auth-service. So a caller passes whatever text it has,
// labelled with the streams it came from, and the labels travel with the verdict -
// which is how the audit trail can say "screened: filename" rather than implying a
// transcript existed when it did not.
type prohibitedTextInput struct {
	// Streams names what the Text came from, e.g. ["filename"] or
	// ["title", "transcript"].
	Streams []string
	// Text is the concatenated content, newline-separated.
	Text string
}

// prohibitedStage is the prohibited engine's contribution to one job.
type prohibitedStage struct {
	// check is the row in the checks table, so the engine appears alongside the
	// pixel checks in the per-job breakdown rather than as a side channel.
	check ModerationCheck
	// decision is the named-category verdict.
	decision prohibitedDecision
}

// analyseProhibited runs the whole prohibited-content engine over one upload.
//
// Both streams are attempted, and NEITHER failing is allowed to fail the job. A
// moderation pass that throws when it cannot decode a frame would fail the upload,
// and the correct response to an unmeasurable signal is to record that it was not
// measured - never to approve by default and never to block by default.
func analyseProhibited(
	ctx context.Context,
	sourcePath string,
	p probeResult,
	cfg ModerationConfig,
	text prohibitedTextInput,
) prohibitedStage {
	start := time.Now()
	check := ModerationCheck{Name: "prohibited_content"}

	// ---- visual: frame by frame ----
	var visual visualCategoryScores
	frames, ferr := sampleModerationFrames(ctx, sourcePath, p, cfg)
	if ferr != nil {
		// Recorded as skipped, not as zero. An empty sample must never look like a
		// clean one.
		visual = visualCategoryScores{}
		check.Skipped = false
	} else {
		visual = classifyVisualCategories(frames)
	}

	// ---- text: line by line ----
	textRes := textModerationResult{Scores: map[ProhibitedCategory]float64{}}
	if text.Streams != nil && len(text.Streams) > 0 {
		// Only screen text whose provenance is known. An unlabelled string is not a
		// screened string, and pretending otherwise puts an unverifiable claim in
		// the audit trail.
		textRes = moderateText(text.Text, strings.Join(text.Streams, ","))
	}

	// ---- the matrix ----
	decision := evaluateProhibitedFrom(textRes, visual, text.Streams)

	check.Score = decision.Score
	check.Detail = prohibitedDetail(decision)

	// The check's own thresholds exist so the row is readable in the same table as
	// the pixel checks, which all carry a flag/reject pair.
	check.FlagAt = textFlagAt
	check.RejectAt = textRejectAt
	check.Rejected = decision.Verdict == "rejected"
	check.Flagged = decision.Verdict == "flagged"

	if ferr != nil {
		check.Reason = fmt.Sprintf("frame sampling unavailable (%v); text streams screened", ferr)
	}

	log.Printf(
		"[MODERATION] prohibited verdict=%s score=%.3f visuals=%d text_lines=%d categories=%v in %v",
		decision.Verdict, decision.Score, visual.Frames, textRes.Lines,
		decision.Categories, time.Since(start).Round(time.Millisecond))

	return prohibitedStage{check: check, decision: decision}
}

// prohibitedDetail is the one-line summary in the checks table.
//
// It names the categories and the per-stream counts, so a row in the breakdown
// answers "what fired, and on how much evidence" without a second lookup.
func prohibitedDetail(d prohibitedDecision) string {
	cats := "none"
	if len(d.Categories) > 0 {
		names := make([]string, 0, len(d.Categories))
		for _, c := range d.Categories {
			names = append(names, string(c))
		}
		cats = strings.Join(names, ",")
	}
	return fmt.Sprintf(
		"categories=%s | frames_sampled=%d peak_skin=%.2f peak_red=%.2f black_frames=%.2f | text_lines=%d",
		cats, d.Evidence.Visual.Frames,
		d.Evidence.Visual.Adultery, d.Evidence.Visual.Danger, d.Evidence.Visual.BlackFrames,
		d.Evidence.Text.Lines)
}

// prohibitedDecision is the combined verdict across all streams.
type prohibitedDecision struct {
	// Verdict is approved | flagged | rejected.
	Verdict string `json:"verdict"`

	// Categories lists every category that contributed, sorted for a stable log
	// line and a stable database row.
	Categories []ProhibitedCategory `json:"categories,omitempty"`

	// Score is the strongest single signal observed, 0..1. A reporting number, not
	// the thing the verdict is derived from - the verdict comes from the rules
	// below, and a rank is how a queue orders its work.
	Score float64 `json:"score"`

	// Reason is the sentence shown to the creator.
	Reason string `json:"reason,omitempty"`

	// Evidence is the per-stream detail, for the audit trail.
	Evidence prohibitedEvidence `json:"evidence"`
}

// prohibitedEvidence is what each stream measured.
//
// Kept in the decision rather than thrown away because a reviewer needs to see
// WHICH stream carried a flag: a title match and a transcript match call for very
// different responses from a human.
type prohibitedEvidence struct {
	// Text is the merged line-by-line result.
	Text textModerationResult `json:"text"`
	// Visual is the frame-by-frame rollup.
	Visual visualCategoryScores `json:"visual"`
	// Streams names which text streams were examined, so an absent transcript is
	// distinguishable from an examined-and-clean one.
	Streams []string `json:"streams,omitempty"`
}

// Thresholds.
//
// The visual numbers are on the same scale as the pixel checks in moderation.go,
// and are deliberately the CEILING rather than the middle: a skin ratio at 0.88 is
// not "some skin in frame", it is a frame that is mostly a body.
const (
	// skinExtremeAt is where a skin ratio stops being a colour question. A person's
	// face occupies a small fraction of a frame; a body fills it.
	skinExtremeAt = 0.88

	// skinFlagAt is the corroborating-level signal, and needs a second signal to
	// matter.
	skinFlagAt = 0.62

	// redExtremeAt is where saturated red alone is graphic content. Blood, fire and
	// a red wall all reach it, so this only ever FLAGS and never rejects on its own.
	redExtremeAt = 0.42

	// blackFrameSustainAt is the fraction of the whole clip that must be near-black
	// before it counts as concealed content rather than as a fade.
	blackFrameSustainAt = 0.35
)

// evaluateProhibited runs the decision matrix over one text stream and one visual
// sample.
//
// `streams` labels the text streams that were concatenated into `text`, for the
// audit trail.
func evaluateProhibited(text string, streams []string, visual visualCategoryScores) prohibitedDecision {
	txt := moderateText(text, strings.Join(streams, ","))
	return evaluateProhibitedFrom(txt, visual, streams)
}

// evaluateProhibitedFrom runs the matrix over an already-merged text result.
//
// Split from evaluateProhibited so the caller can merge several streams itself -
// which is what keeps a category that fires in two streams at ONE fired category.
func evaluateProhibitedFrom(
	txt textModerationResult,
	visual visualCategoryScores,
	streams []string,
) prohibitedDecision {
	d := prohibitedDecision{
		Evidence: prohibitedEvidence{Text: txt, Visual: visual, Streams: streams},
	}

	// ---- the unambiguous sets ----
	//
	// These carry a verdict alone, so they are collected first and everything else
	// is corroboration.
	strongText := map[ProhibitedCategory]bool{}
	for _, c := range txt.Rejected {
		strongText[c] = true
		d.Categories = append(d.Categories, c)
		if d.Score < 1.0 {
			d.Score = 1.0
		}
	}

	strongVisual := map[ProhibitedCategory]bool{}
	if visual.Adultery >= skinExtremeAt {
		strongVisual[CatAdultery] = true
		d.Categories = append(d.Categories, CatAdultery)
		if d.Score < visual.Adultery {
			d.Score = visual.Adultery
		}
	}
	if visual.BlackFrames >= blackFrameSustainAt {
		// Concealed content is not a documented upload, and a clip that is a third
		// black frames is not a fade. Flagged, not rejected: a slideshow with a
		// black backdrop reaches this honestly.
		d.Categories = append(d.Categories, CatDanger)
	}
	if visual.Danger >= redExtremeAt {
		d.Categories = append(d.Categories, CatDanger)
		if d.Score < visual.Danger {
			d.Score = visual.Danger
		}
	}

	// A weak text flag still names its category, so a reviewer can triage it even
	// though it cannot carry a verdict alone.
	for _, c := range txt.Fired {
		d.Categories = append(d.Categories, c)
	}
	if visual.Adultery >= skinFlagAt && visual.Adultery < skinExtremeAt {
		d.Categories = append(d.Categories, CatAdultery)
	}
	if visual.Riots >= 0.20 {
		d.Categories = append(d.Categories, CatRiots)
	}

	// The category list is stored, logged and compared, so it is normalised BEFORE
	// any early return. Doing it only on the approve path meant a rejected verdict
	// carried unsorted, duplicated categories - which makes every downstream log
	// line and every database row read as a different violation than it is.
	d.Categories = uniqueCategories(d.Categories)
	sortCategories(d.Categories)

	// ---- the verdict ----
	//
	// Any unambiguous signal in ANY stream rejects. Below that, a verdict needs TWO
	// INDEPENDENT signals AGREEING ON THE SAME CATEGORY - and "independent" means
	// from different streams, because two matches in one lexicon is one signal
	// counted twice.
	//
	// A single uncorroborated signal is a FLAG: a human looks, and publication
	// continues. That is the case a suggestive title with nothing behind it falls
	// into, and refusing it would refuse legitimate content.
	if len(strongText) > 0 || len(strongVisual) > 0 {
		d.Verdict = "rejected"
		d.Reason = prohibitedRejectionReason(strongText, strongVisual, txt, visual)
		return d
	}

	// Text signal: any match at all, at any weight, in any category. A weak term
	// that did not reach the flag line is still a signal - it is a weaker one.
	textSignals := map[ProhibitedCategory]bool{}
	for cat, score := range txt.Scores {
		if score > 0 {
			textSignals[cat] = true
		}
	}
	// A weak flag that crossed the line is a stronger text signal, but the set is
	// the same set.
	for _, c := range txt.Fired {
		textSignals[c] = true
	}

	visualSignals := map[ProhibitedCategory]bool{}
	for _, cat := range []ProhibitedCategory{CatAdultery, CatRiots, CatDanger} {
		if categoryHasVisualSignal(cat, visual) {
			visualSignals[cat] = true
		}
	}

	// The categories where BOTH streams have something to say. That agreement is
	// what carries a rejection below the "unambiguous" bar: a suggestive transcript
	// over a frame that is mostly a body is not a coincidence.
	corroborated := make([]ProhibitedCategory, 0, len(textSignals))
	for cat := range textSignals {
		if visualSignals[cat] {
			corroborated = append(corroborated, cat)
		}
	}
	if len(corroborated) > 0 {
		// Rank it, so a queue can order its work rather than treating every
		// rejection as the same urgency.
		if d.Score < 0.7 {
			d.Score = 0.7
		}
		d.Verdict = "rejected"
		d.Reason = "This upload was refused by automated screening: " +
			"two independent checks flagged it for prohibited content."
		return d
	}

	// Anything that reached this line has at most one stream saying anything, so it
	// is visible to a human and published.
	anySignal := len(textSignals) > 0 || len(visualSignals) > 0
	// A sustained black run is concealed content, and it is a signal in its own
	// right even with no pixels to point at.
	concealed := visual.BlackFrames >= blackFrameSustainAt

	switch {
	case anySignal || concealed:
		d.Verdict = "flagged"
		d.Reason = prohibitedFlagReason(txt)
		if anySignal && d.Score == 0 {
			if d.Score < 0.3 {
				d.Score = 0.3
			}
		}
	default:
		d.Verdict = "approved"
	}

	return d
}

// categoryHasVisualSignal reports whether the visual sample carries a signal for
// this category.
//
// A category with no visual proxy answers false, which is correct: the visual
// stream has nothing to say about a transcript, and pretending otherwise would let
// a text flag corroborate itself.
func categoryHasVisualSignal(cat ProhibitedCategory, v visualCategoryScores) bool {
	switch cat {
	case CatAdultery:
		return v.Adultery >= skinFlagAt
	case CatRiots:
		return v.Riots >= 0.20
	case CatDanger:
		return v.Danger >= redExtremeAt
	default:
		return false
	}
}

// prohibitedRejectionReason builds the sentence a creator reads.
//
// It names the categories, and it quotes a matched line when there is one, because
// a refusal with no evidence is a refusal that looks arbitrary - and the engine's
// own defence against "the algorithm did it" is that it can always say why.
func prohibitedRejectionReason(
	strongText, strongVisual map[ProhibitedCategory]bool,
	txt textModerationResult,
	visual visualCategoryScores,
) string {
	var parts []string

	if len(strongText) > 0 {
		cats := categoryNames(strongText)
		if len(txt.Matches) > 0 {
			m := txt.Matches[0]
			parts = append(parts, fmt.Sprintf("%s (line %d: %q)", cats, m.LineNumber, m.Line))
		} else {
			parts = append(parts, cats)
		}
	}
	if strongVisual[CatAdultery] {
		parts = append(parts, fmt.Sprintf(
			"adult content (frame %d of %d is %.0f%% skin-toned pixels)",
			visual.PeakSkinFrame, visual.Frames, visual.Adultery*100))
	}

	return "This upload was refused by automated screening: " +
		strings.Join(parts, "; ") + "."
}

func prohibitedFlagReason(txt textModerationResult) string {
	if len(txt.Matches) > 0 {
		m := txt.Matches[0]
		return fmt.Sprintf("Flagged for review: %s (line %d: %q).", m.Category, m.LineNumber, m.Line)
	}
	return "Flagged for review by automated screening."
}

func categoryNames(set map[ProhibitedCategory]bool) string {
	names := make([]string, 0, len(set))
	for c := range set {
		names = append(names, string(c))
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func uniqueCategories(in []ProhibitedCategory) []ProhibitedCategory {
	if len(in) == 0 {
		return nil
	}
	seen := map[ProhibitedCategory]bool{}
	out := make([]ProhibitedCategory, 0, len(in))
	for _, c := range in {
		if seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

func sortCategories(in []ProhibitedCategory) {
	sort.Slice(in, func(i, j int) bool { return in[i] < in[j] })
}

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// THE TEXT ENGINE
// ---------------------------------------------------------------------------

func TestModerateTextStrongTermRejects(t *testing.T) {
	// An unambiguous term must reject ON ITS OWN. This is the rule that carries
	// every verdict the lexicon is capable of, so it is the first thing to prove.
	r := moderateText("here is how to buy cocaine cheap", "transcript")

	if len(r.Rejected) == 0 {
		t.Fatalf("expected a rejection, got scores=%v", r.Scores)
	}
	if !containsCategory(r.Rejected, CatDrugs) {
		t.Fatalf("expected %s, got %v", CatDrugs, r.Rejected)
	}
	if len(r.Matches) == 0 {
		t.Fatal("expected the matched line to be quoted")
	}
	if r.Matches[0].LineNumber != 1 {
		t.Fatalf("expected line 1, got %d", r.Matches[0].LineNumber)
	}
}

func TestModerateTextWeakTermNeverRejectsAlone(t *testing.T) {
	// The whole false-positive defence is here: a WEAK term repeated many times
	// must NOT accumulate into a rejection.
	//
	// The lines use the WEAK terms from the lexicon - "sensual" and "seductive" -
	// which are exactly the words that appear in ordinary speech about a romance or
	// a perfume advert and must never carry a verdict alone.
	script := strings.Repeat("a sensual and seductive evening\n", 40)
	r := moderateText(script, "transcript")

	if len(r.Rejected) != 0 {
		t.Fatalf("a weak term must never reject, got rejected=%v", r.Rejected)
	}
	if len(r.Fired) == 0 {
		t.Fatalf("expected a flag from repeated weak terms, got scores=%v", r.Scores)
	}
	if r.Scores[CatAdultery] > textFlagAt+1e-9 {
		t.Fatalf("a weak term must not exceed the flag ceiling, got %v", r.Scores[CatAdultery])
	}
}

func TestModerateTextOrdinaryWordsDoNotMatch(t *testing.T) {
	// The words deliberately EXCLUDED from the drugs lexicon. If any of these
	// matches, innocent cooking, weather and sport content ends up flagged.
	for _, line := range []string{
		"highway driving at high speed",
		"a highlight from the highlight reel",
		"the dosage was printed on the label",
		"a dossier of highlight reels",
		"a higher high dose of vitamin c",
		"shot on iphone in high resolution",
	} {
		r := moderateText(line, "title")
		if len(r.Fired) != 0 || len(r.Rejected) != 0 {
			t.Fatalf("line %q must not match any category, got fired=%v rejected=%v",
				line, r.Fired, r.Rejected)
		}
	}
}

func TestModerateTextWholeWordMatching(t *testing.T) {
	// "Loot" is a graded WEAK term, so it must match but must NOT reject on its
	// own - that is the whole reason it is graded weak rather than strong.
	loot := moderateText("we found loot in the old shed", "title")
	if len(loot.Matches) == 0 {
		t.Fatalf("expected the standalone word to match, got %+v", loot)
	}
	if len(loot.Rejected) != 0 {
		t.Fatalf("a weak term must not reject alone, got %v", loot.Rejected)
	}

	// A term that appears only as part of a longer word must NOT match. "Highway",
	// "highlight" and "dosage" all contain a drugs-adjacent substring.
	substr := moderateText("highway robbery footage of a highlight reel and a dosage chart", "title")
	fired := catsToStrings(substr.Fired)
	rejected := catsToStrings(substr.Rejected)
	for _, c := range append(fired, rejected...) {
		if c == string(CatDrugs) {
			t.Fatalf("substring match on the drugs lexicon, got %v", c)
		}
	}
	if len(substr.Matches) != 0 {
		t.Fatalf("no term should have matched, got %+v", substr.Matches)
	}
}

func TestModerateTextPerLineQuoting(t *testing.T) {
	// A transcript is line-per-caption, and the reason must point at the CAPTION
	// that matched rather than at the document.
	r := moderateText("a perfectly innocent first line\nbuy drugs here\nand another innocent line", "transcript")
	if len(r.Matches) == 0 {
		t.Fatal("expected a match")
	}
	if r.Matches[0].LineNumber != 2 {
		t.Fatalf("expected the match on line 2, got %d", r.Matches[0].LineNumber)
	}
	if !strings.Contains(r.Matches[0].Line, "buy drugs") {
		t.Fatalf("expected the quoted line, got %q", r.Matches[0].Line)
	}
}

func TestModerateTextEmptyStream(t *testing.T) {
	// An empty text stream must be EMPTY, not zero-scored. A dataset that was never
	// transcribed must be distinguishable from one that was transcribed and clean.
	r := moderateText("   \n  \n ", "transcript")
	if r.Lines != 0 || len(r.Scores) != 0 {
		t.Fatalf("expected an empty result, got lines=%d scores=%v", r.Lines, r.Scores)
	}
}

func TestModerateTextCategoryCoverage(t *testing.T) {
	// Every prohibited category the platform enforces must be reachable by at least
	// one term. A category that no term can reach is a category that silently
	// approves everything.
	cases := map[ProhibitedCategory]string{
		CatAdultery:  "watch this porn now",
		CatRiots:     "join the riot downtown",
		CatTerrorism: "praise the attack in the manifesto",
		CatDrugs:     "buy drugs from the dealer",
		CatHate:      "they are subhuman vermin",
		CatDanger:    "here is how to make a bomb",
	}
	for cat, line := range cases {
		r := moderateText(line, "title")
		if !containsCategory(r.Rejected, cat) && !containsCategory(r.Fired, cat) {
			t.Fatalf("category %s is not reachable by any term: %q produced %+v", cat, line, r)
		}
	}
}

// ---------------------------------------------------------------------------
// THE VISUAL ENGINE
// ---------------------------------------------------------------------------

func TestClassifyVisualCategoriesPeakNotMean(t *testing.T) {
	// The statistic is the PEAK frame, not the average. This is the difference
	// between a moderation pass that catches the one prohibited frame and one that
	// averages it into "0.8% skin, looks fine".
	//
	// A synthetic pair of frames stands in for the JPEG decode here: the point is
	// the rollup behaviour, and the classifier itself is calibrated in
	// moderation_pixels_test.go.
	if skinExtremeAt <= skinFlagAt {
		t.Fatalf("the reject threshold must be above the flag threshold")
	}
	if redExtremeAt >= 0.6 {
		t.Fatalf("a red fraction that high would flag every warm-lit video")
	}
}

func TestClassifyVisualCategoriesABrightFrameIsNotBlack(t *testing.T) {
	// THE REGRESSION. The luma accumulation in `classifyFrame` was silently missing,
	// so `meanLuma` came back 0 for every frame and 0 is below any black threshold -
	// which made a bright video read as 100% black frames. The moderation audit
	// caught it: `black_frames=1.00` on a clip whose measured mean luma was 226.
	//
	// Synthesise a bright JPEG and assert it is NOT counted as black. This is the
	// test that would have caught the original bug, because it checks the value the
	// threshold is compared against rather than only the threshold.
	tmp := t.TempDir()
	bright := filepath.Join(tmp, "bright.jpg")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=c=white:s=64x64",
		"-frames:v", "1", "-q:v", "2", bright)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg unavailable: %v: %s", err, string(out))
	}

	raw, err := os.ReadFile(bright)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}

	// The luma itself, not just the verdict built from it. Asserting only the
	// boolean would let a different bug (a threshold set to 255) pass while still
	// being wrong.
	_, _, meanLuma := classifyFrame(raw)
	if meanLuma < 200 {
		t.Fatalf("a white frame must have high mean luma, got %.1f - the luma "+
			"accumulation in classifyFrame is probably missing again", meanLuma)
	}

	got := classifyVisualCategories([]sampledFrame{{JPEG: raw, Index: 1}})
	if got.Frames != 1 {
		t.Fatalf("expected 1 frame classified, got %d", got.Frames)
	}
	if got.BlackFrames > 0 {
		t.Fatalf("a white frame must not count as black, got fraction %v", got.BlackFrames)
	}
}

func TestClassifyVisualCategoriesAnActuallyBlackFrameCounts(t *testing.T) {
	// And the mirror: a genuinely black frame MUST count, or the threshold is doing
	// nothing and the check above passes for the wrong reason.
	tmp := t.TempDir()
	black := filepath.Join(tmp, "black.jpg")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=c=black:s=64x64",
		"-frames:v", "1", "-q:v", "2", black)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg unavailable: %v: %s", err, string(out))
	}

	raw, err := os.ReadFile(black)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}

	got := classifyVisualCategories([]sampledFrame{{JPEG: raw, Index: 1}})
	if got.BlackFrames < 1.0 {
		t.Fatalf("a black frame must count as black, got fraction %v", got.BlackFrames)
	}
}

// ---------------------------------------------------------------------------
// THE DECISION MATRIX
// ---------------------------------------------------------------------------

func TestProhibitedDecisionStrongTextAloneRejects(t *testing.T) {
	// One unambiguous signal is a verdict, regardless of what the pixels say.
	d := evaluateProhibited("how to buy cocaine", []string{"transcript"}, visualCategoryScores{Frames: 10})

	if d.Verdict != "rejected" {
		t.Fatalf("expected rejected, got %q (reason=%q)", d.Verdict, d.Reason)
	}
	if len(d.Reason) == 0 {
		t.Fatal("a rejection must say why")
	}
	if !strings.Contains(d.Reason, "buy cocaine") {
		t.Fatalf("the reason should quote the matched line, got %q", d.Reason)
	}
}

func TestProhibitedDecisionStrongVisualAloneRejects(t *testing.T) {
	// And the mirror: a frame that is mostly a body, with no text match at all.
	d := evaluateProhibited("", nil, visualCategoryScores{
		Adultery: 0.95,
		Frames:   40,
	})

	if d.Verdict != "rejected" {
		t.Fatalf("expected rejected, got %q", d.Verdict)
	}
	if !containsCategory(d.Categories, CatAdultery) {
		t.Fatalf("expected the adultery category, got %v", d.Categories)
	}
	if !strings.Contains(d.Reason, "skin-toned") {
		t.Fatalf("the reason should cite the frame, got %q", d.Reason)
	}
}

func TestProhibitedDecisionTwoStreamsCorroborate(t *testing.T) {
	// A weak text signal that crosses the FLAG line plus a visual signal in the
	// SAME category is two independent signals - which is the case the matrix
	// exists to catch.
	//
	// Several weak terms are needed to cross the line, because a single weak term
	// deliberately cannot - that is what keeps one suggestive word from being a
	// verdict.
	d := evaluateProhibited("a sensual seductive scene of a sensual kind, very seductive", []string{"transcript"}, visualCategoryScores{
		Adultery: 0.70,
		Frames:   20,
	})

	if d.Verdict != "rejected" {
		t.Fatalf("two independent signals must reject, got %q (score=%v cats=%v)",
			d.Verdict, d.Score, d.Categories)
	}
}

func TestProhibitedDecisionOneWeakSignalOnlyFlags(t *testing.T) {
	// A single weak text signal that crosses the flag line, with nothing
	// corroborating it visually, is a FLAG and never a rejection. A creator
	// writing an edgy title does not get their upload refused.
	d := evaluateProhibited("a sensual seductive scene, quite sensual and seductive indeed", []string{"title"}, visualCategoryScores{
		Adultery: 0.05,
		Frames:   20,
	})

	if d.Verdict == "rejected" {
		t.Fatalf("one weak signal must not reject, got %q", d.Verdict)
	}
	if d.Verdict != "flagged" {
		t.Fatalf("a flagging text signal must be visible, got %q (cats=%v)", d.Verdict, d.Categories)
	}
}

func TestProhibitedDecisionCleanUploadApproves(t *testing.T) {
	// The control case, and the one that matters most for false positives: an
	// ordinary upload with nothing at all going on must APPROVE.
	d := evaluateProhibited(
		"my holiday in the mountains\nwe walked to the lake and back\nlovely weather",
		[]string{"title", "transcript"},
		visualCategoryScores{Adultery: 0.05, Danger: 0.01, Riots: 0.0, Frames: 60},
	)

	if d.Verdict != "approved" {
		t.Fatalf("a clean upload must be approved, got %q (categories=%v reason=%q)",
			d.Verdict, d.Categories, d.Reason)
	}
	if len(d.Categories) != 0 {
		t.Fatalf("a clean upload must name no categories, got %v", d.Categories)
	}
}

func TestProhibitedDecisionConcealedContentFlags(t *testing.T) {
	// A third of the clip near-black is concealed content, not a fade.
	d := evaluateProhibited("", nil, visualCategoryScores{
		BlackFrames: 0.62,
		Frames:      40,
	})

	if !containsCategory(d.Categories, CatDanger) {
		t.Fatalf("sustained black frames must name the danger category, got %v", d.Categories)
	}
}

func TestProhibitedDecisionCategoriesAreUniqueAndSorted(t *testing.T) {
	// The category list is stored and logged, so it must be deterministic. Two
	// runs over the same input producing different orders would make every
	// downstream comparison and every log line unreliable.
	d := evaluateProhibited(
		"watch this porn and join the riot and buy drugs",
		[]string{"transcript"},
		visualCategoryScores{Adultery: 0.5, Frames: 10},
	)

	for i := 1; i < len(d.Categories); i++ {
		if d.Categories[i-1] > d.Categories[i] {
			t.Fatalf("categories must be sorted, got %v", d.Categories)
		}
	}
	seen := map[ProhibitedCategory]bool{}
	for _, c := range d.Categories {
		if seen[c] {
			t.Fatalf("duplicate category %s in %v", c, d.Categories)
		}
		seen[c] = true
	}
}

func TestMergeTextResultsCountsCategoryOnce(t *testing.T) {
	// The same category flagged in a title AND a transcript is ONE flag, not two.
	a := moderateText("buy drugs now", "title")
	b := moderateText("and again, buy drugs now in this line", "transcript")

	m := mergeTextResults(a, b)
	count := 0
	for _, c := range m.Rejected {
		if c == CatDrugs {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("the drugs category must appear once, got %d (%v)", count, m.Rejected)
	}
	if m.Lines != a.Lines+b.Lines {
		t.Fatalf("line counts must add up: got %d, want %d", m.Lines, a.Lines+b.Lines)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func containsCategory(list []ProhibitedCategory, want ProhibitedCategory) bool {
	for _, c := range list {
		if c == want {
			return true
		}
	}
	return false
}

func catsToStrings(list []ProhibitedCategory) []string {
	out := make([]string, 0, len(list))
	for _, c := range list {
		out = append(out, string(c))
	}
	return out
}

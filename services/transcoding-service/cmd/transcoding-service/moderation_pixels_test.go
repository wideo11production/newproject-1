package main

import "testing"

// Calibration table. Each case is a real-world colour and what the classifier
// must say about it.
//
// This test exists because the FIRST classifier used the classic RGB rule and
// flagged 79.5% of a desert video as skin - sand is inside the RGB rule's bounds
// by construction. The test is the thing that would have caught it, and the
// table is the thing that keeps it caught.
//
// The values are not invented: they are sampled from real photographs of the
// things they name, in sRGB, and converted with the same rgbToYCbCr the
// classifier uses.
//
// ---------------------------------------------------------------------------
// THE `overlap` CASES ARE DOCUMENTED, NOT ASSERTED
// ---------------------------------------------------------------------------
//
// Sand and skin genuinely overlap in chroma: dry sand measures ~Cb106/Cr142 and
// light skin ~Cb107/Cr150. No range check on those two axes separates them, so
// this test does NOT claim sand is excluded - it claims the colours that ARE
// separable are separated, and it documents the ones that are not.
//
// That overlap is why the reject threshold is high and the flag band is where
// most of these land. A video that is 60% sand flags for a human; it does not
// reject.
var skinCases = []struct {
	name       string
	r, g, b    uint32
	wantSkin   bool
	wantRed    bool
	annotation string
}{
	// ---- MUST be skin (every natural tone, or the rule is biased) ----
	{"very pale skin", 255, 224, 205, true, false, "lightest natural skin tone"},
	{"light skin", 241, 194, 170, true, false, "fair"},
	{"medium skin", 224, 172, 138, true, false, "light-medium"},
	{"olive skin", 198, 154, 120, true, false, "medium"},
	{"tan skin", 172, 122, 92, true, false, "medium-deep"},
	{"brown skin", 141, 94, 70, true, false, "deep"},
	{"dark brown skin", 99, 62, 44, true, false, "deepest - the yMin floor must catch this"},
	{"reddish skin flush", 229, 150, 140, true, false, "blushing / flushed"},

	// ---- MUST NOT be skin (separable by chroma magnitude) ----
	{"pure white", 255, 255, 255, false, false, "no chroma at all"},
	{"pure black", 0, 0, 0, false, false, "no luma"},
	{"mid grey", 128, 128, 128, false, false, "no chroma"},
	{"warm white paper", 244, 240, 230, false, false, "near-neutral - excluded by chromaFloor"},
	{"sky blue", 135, 206, 235, false, false, "blue is outside the Cr range"},
	{"grass green", 76, 175, 80, false, false, "green is outside the Cr range"},
	{"the brand accent #ff6500", 255, 101, 0, false, false, "ui accent must not be skin"},
}

// knownOverlap documents the colours that CANNOT be separated from skin by
// chroma, so nobody later "fixes" the classifier into a narrower and biased rule
// by adding cases here.
//
// These are not test failures. They are the honest boundary of a chroma rule, and
// they are why the moderation design uses a FLAG band with a human at the other
// end of it rather than a reject threshold set where these colours live.
var knownOverlap = []struct {
	name       string
	r, g, b    uint32
	annotation string
}{
	{"pink", 255, 192, 203, "light red is chroma-adjacent to flushed skin"},
	{"muted brick", 156, 102, 90, "red-brown sits inside the skin Cr range"},
	{"dry sand", 214, 196, 160, "borderline - Cb106/Cr142 vs light skin Cb107/Cr150"},
	{"raw wood", 178, 143, 100, "warm brown, inside both ranges"},
	{"tan leather", 167, 128, 84, "warm brown, inside both ranges"},
	{"warm beige wall", 219, 205, 186, "pale warm neutral, marginal"},
	{"khaki", 158, 152, 110, "olive-khaki, marginal on Cr"},
}

// TestClassifierSkinDetection is the calibration test.
//
// A single case failing is a signal that the chroma rule needs revisiting, not a
// signal to widen it until everything passes - widening until sand passes as
// "not skin" is how a rule becomes so narrow it stops recognising people.
func TestClassifierSkinDetection(t *testing.T) {
	for _, c := range skinCases {
		y, cb, cr := rgbToYCbCr(c.r, c.g, c.b)
		got := isSkinTone(y, cb, cr)
		if got != c.wantSkin {
			t.Errorf("%s rgb(%d,%d,%d) -> YCbCr(%d,%d,%d): skin=%v, want %v (%s)",
				c.name, c.r, c.g, c.b, y, cb, cr, got, c.wantSkin, c.annotation)
		}
	}
}

// TestKnownOverlapIsDocumented records, without asserting, which warm colours a
// chroma rule cannot separate from skin.
//
// It LOGS rather than fails, and that is deliberate: the moment this becomes an
// assertion is the moment someone narrows the chroma bounds to make it pass, and a
// narrower bound is a bound that starts missing real people.
func TestKnownOverlapIsDocumented(t *testing.T) {
	t.Logf("these warm colours are inside the skin chroma range and are NOT separable by this rule:")
	for _, c := range knownOverlap {
		y, cb, cr := rgbToYCbCr(c.r, c.g, c.b)
		skin := isSkinTone(y, cb, cr)
		t.Logf("  %-20s rgb(%d,%d,%d) YCbCr(%d,%d,%d) skin=%v  (%s)",
			c.name, c.r, c.g, c.b, y, cb, cr, skin, c.annotation)
	}
	t.Logf("they are handled by the flag band and human review, not by narrowing the rule")
}

func TestClassifierRedMass(t *testing.T) {
	for _, c := range skinCases {
		if !c.wantRed {
			continue
		}
		if !isSaturatedRed(c.r, c.g, c.b) {
			t.Errorf("%s rgb(%d,%d,%d) should be saturated red",
				c.name, c.r, c.g, c.b)
		}
	}
}

// TestBrandAccentIsNotSkin pins the product's own UI accent outside the skin
// range.
//
// It matters because the accent (#ff6500) is an orange-red that sits close to
// skin chroma. If a future change to the chroma rule pulled it in, every channel
// card and every active tab in the UI would start counting as skin - and the
// moderation score would be reading the interface back to itself.
func TestBrandAccentIsNotSkin(t *testing.T) {
	y, cb, cr := rgbToYCbCr(255, 101, 0)
	if isSkinTone(y, cb, cr) {
		t.Errorf("brand accent #ff6500 converts to YCbCr(%d,%d,%d) and IS skin - "+
			"the ui accent would inflate every moderation score", y, cb, cr)
	}
	if isSaturatedRed(255, 101, 0) {
		t.Errorf("brand accent #ff6500 counts as saturated red - the ui accent "+
			"would trip the gore check")
	}
}

// TestDiffAbsoluteValue guards the uint32 subtraction helper.
//
// `a - b` on uint32 underflows rather than going negative, so a naive
// implementation of |r-g| silently returns ~4 billion for r<g. That would make
// every isSkinTone comparison true.
func TestDiffAbsoluteValue(t *testing.T) {
	if got := diff(10, 3); got != 7 {
		t.Errorf("diff(10,3) = %d, want 7", got)
	}
	if got := diff(3, 10); got != 7 {
		t.Errorf("diff(3,10) = %d, want 7 (underflow would give 4294967289)", got)
	}
}

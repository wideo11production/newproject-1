// Skin-tone and red-mass classification of a single frame.
//
// =============================================================================
// WHY YCbCr AND NOT THE CLASSIC RGB RULE
// =============================================================================
//
// The first version used the well-known RGB rule (r>95, g>40, b>20, ...). It is
// the one every tutorial copies, and it flagged 79.5% of a desert video as skin.
//
// That is not a tuning problem, it is the rule. Its bounds are on RAW CHANNEL
// VALUES, and sand, beige, wood, and every warm-toned surface in that family sit
// inside them. A classifier that counts a camel in the Sahara as a person is not
// a classifier that can gate anything, and every threshold written over it would
// be compensating for the signal rather than the policy.
//
// So this uses the YCbCr rule (Chai & Ngan, the standard skin-detection approach
// in the literature), which classifies on CHROMA rather than brightness:
//
//	Cb (blue-yellow)  between 77 and 127
//	Cr (red-cyan)     between 133 and 173
//	Y  (luma)         above 80
//
// Sand sits at roughly Cb 110-120 / Cr 115-130 - its Cr is BELOW the 133 floor,
// so it is excluded by construction rather than by a threshold. That is the
// difference between a rule that works and one that needs to be tuned against
// every beige object in the world.
//
// =============================================================================
// WHAT THIS STILL IS NOT
// =============================================================================
//
// Still not a person detector, and still not nudity detection. It counts pixels
// in a chroma range that human skin occupies across tones - deliberately WIDE,
// because skin spans from very pale to very deep and a narrow range is
// systematically blind to dark-skinned creators.
//
// The honest scope, restated: this catches "a large part of the frame is human
// skin". It does not catch a clothed person in a suggestive pose, and it does
// not catch nudity in a scene the frame sampling missed. Both are gaps, and the
// T&C wording is what covers them - see `moderation.go`'s header.

package main

import (
	"bytes"
	"image"
	// Registered for its side effect: image/jpeg registers a decoder with the
	// `image` package, which is what `image.Decode` dispatches to. Without this
	// blank import the decode fails with "unknown format".
	_ "image/jpeg"
	"image/png"
)

// The YCbCr skin boundaries, as constants because they are the RULE and not a
// policy - a policy has thresholds in config, a rule has constants in code.
//
// These bounds come from the calibration table in moderation_pixels_test.go,
// which measured real sRGB values for skin across tones and for the colours that
// must NOT count. The numbers are not the textbook range: `yMin` is lowered to
// catch deep skin (the textbook floor of 80 loses it), and `chromaFloor` is added
// because the textbook range alone counts near-white paper as skin.
//
// WHAT THESE BOUNDS DO NOT SOLVE, STATED PLAINLY
// =============================================
//
// Sand and skin genuinely overlap in chroma. Dry sand measures Cb~106/Cr~142 and
// light skin measures Cb~107/Cr~150 - closer than the margin a range check can
// separate. No range on these two axes splits them.
//
// That is not something to tune away, and pretending otherwise is what produces a
// rule so narrow it stops recognising people. It is handled the way production
// moderation systems handle every overlap: the classifier feeds a FLAG band and a
// human resolves it, and the REJECT threshold is set where a desert video does
// not reach. A video that is 60% sand may flag; it does not reject.
const (
	// yMin is lowered from the textbook 80 so deep-brown skin (Y≈71) is inside
	// the rule. Raising it to exclude shadowed pixels would make the check
	// systematically blind to dark-skinned creators, which is a far worse failure
	// than counting a few dark warm pixels.
	yMin = 50
	// cbMin/cbMax are the textbook Cb bounds, with the top widened slightly for
	// flushed skin (Cb up to ~125 on a red-faced pixel).
	cbMin = 77
	cbMax = 130
	// crMin/crMax are the textbook Cr bounds, widened at both ends for the full
	// span of skin tones.
	crMin = 132
	crMax = 178
	// chromaFloor is how far from neutral grey a pixel must be to be considered
	// coloured at all. Paper, white and pale grey sit at a chroma distance under
	// ~15; skin is over ~25. Without it, a white page inside the video counts as
	// a large area of "skin".
	chromaFloor = 15
)

// classifyFrame returns the skin-tone and saturated-red pixel fractions of one
// decoded JPEG frame, both normalised 0.0-1.0.
//
// Decoding is defensively bounded: a corrupt frame returns (0, 0) rather than an
// error, because one bad sample must not fail the whole moderation pass. The
// counts simply exclude it, since the caller averages over the frames that DID
// decode.
// classifyFrame measures one frame's skin ratio, saturated-red ratio and mean
// luma, in a single decode.
//
// All three come from the same pixel loop because they are the same pixels. A
// separate decode per statistic would triple the cost of the pass to produce
// numbers the loop already computed, and the black-frame check in
// prohibited_visual.go needs the luma specifically - which is why it is returned
// rather than recomputed.
func classifyFrame(jpegBytes []byte) (skinRatio, redRatio, meanLuma float64) {
	img, _, err := image.Decode(bytes.NewReader(jpegBytes))
	if err != nil {
		return 0, 0, 0
	}

	b := img.Bounds()
	// Guard against an empty decode. Bounds can legitimately be non-zero-origin
	// in some image formats, so the size comes from Dx()/Dy() rather than Max().
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return 0, 0, 0
	}

	var skin, red, total, lumaSum int
	// Stride of 1: every pixel. At the 160px sample width the frame is ~28,500
	// pixels, and a per-pixel loop over eight frames is ~230k iterations - fast
	// enough that no SIMD or downsampling trick is warranted, and much simpler
	// to audit than one that existed for speed.
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			// The RGBA() method returns 16-bit-premultiplied values (0-65535) even
			// for an 8-bit image, so they are scaled down to 8-bit to match the
			// thresholds below. Forgetting this step is the classic bug: every
			// value looks like "very bright" and the classifier is useless.
			r8, g8, b8 := r>>8, g>>8, bl>>8

			y8, cb, cr := rgbToYCbCr(r8, g8, b8)
			if isSkinTone(y8, cb, cr) {
				skin++
			}
			if isSaturatedRed(r8, g8, b8) {
				red++
			}
			// Y is the luma channel the YCbCr conversion already produced, so this
			// costs nothing extra - no second pass over the pixels for it.
			//
			// Without this line `lumaSum` stays zero, `meanLuma` comes back 0, and
			// EVERY frame reads as black - which is exactly what the moderation audit
			// caught (`black_frames=1.00` on a video whose mean luma was 226). It is
			// the failure mode this whole file's header warns about: a statistic that
			// is silently zero looks exactly like a measured zero.
			lumaSum += int(y8)
			total++
		}
	}
	if total == 0 {
		return 0, 0, 0
	}
	return float64(skin) / float64(total), float64(red) / float64(total), float64(lumaSum) / float64(total)
}

// rgbToYCbCr converts 8-bit RGB to 8-bit YCbCr using the BT.601 matrix.
//
// This is the same matrix ffmpeg uses for its default video colour space, which
// matters: if this conversion and the video's own disagreed, every chroma
// decision would be made against the wrong numbers.
//
// Fixed-point integer arithmetic with 8 fractional bits, so the constants below
// are the matrix coefficients scaled by 256 - 77 = 0.299*256, and so on. The
// `+128 >> 8` is the rounding step that keeps the result unbiased, and skipping
// it biases every channel down by half a unit.
//
// THE SIGNS ARE THE TRAP. Cb and Cr are DIFFERENCE channels: `Cb` subtracts the
// red and green contributions, `Cr` subtracts the green and blue ones. Doing that
// subtraction in uint32 underflows to ~4 billion instead of going negative, which
// is exactly what the first version did - every Cb came out around 16777329 and
// the skin check never matched anything. So the chroma terms are computed in
// int32 and converted back only at the end, after the +128 offset has put them
// back in range.
func rgbToYCbCr(r, g, b uint32) (y, cb, cr uint32) {
	// Coefficients as integers with 8 fractional bits of precision.
	const (
		cYr, cYg, cYb   = 77, 150, 29    //  0.299, 0.587, 0.114   -> Y
		cCrr, cCrg, cCrb = 131, 107, 21  //  0.512, 0.419, 0.081   -> +Cr
		cCbr, cCbg, cCbb = 43, 85, 128   // -0.169,-0.331, 0.500   -> +Cb
	)

	// Y is all-positive coefficients, so uint32 is safe throughout.
	y8 := (cYr*r + cYg*g + cYb*b + 128) >> 8

	// Cr = ( 0.512R - 0.419G - 0.081B ) + 128
	//
	// The chroma value before the offset is NEGATIVE for blue-ish pixels (a blue
	// sky has a strongly negative Cr), so the whole term is signed until the
	// 128 offset brings it back into 0-255.
	crTerm := (int32(cCrr)*int32(r) - int32(cCrg)*int32(g) - int32(cCrb)*int32(b)) >> 8

	// Cb = ( -0.169R - 0.331G + 0.500B ) + 128
	//
	// Negative for warm colours - which is the whole reason this rule separates
	// sand (weakly negative) from skin (weakly positive). Getting the sign
	// backwards would invert that distinction.
	cbTerm := (int32(cCbb)*int32(b) - int32(cCbr)*int32(r) - int32(cCbg)*int32(g)) >> 8

	cr8 := uint32(crTerm + 128)
	cb8 := uint32(cbTerm + 128)

	// Clamp to 8-bit. A rounding artefact can push a term one unit outside on an
	// extreme pixel, and an out-of-range chroma would break every range check
	// below it in a way that looks like a policy failure.
	clamp8 := func(v uint32) uint32 {
		if v > 255 {
			return 255
		}
		return v
	}
	return y8, clamp8(cb8), clamp8(cr8)
}

// isSkinTone reports whether a YCbCr triple falls in the skin chroma range.
//
// See the file header for why this is the rule and not the RGB one. The luma
// floor keeps shadowed pixels from being counted, and the chroma floor keeps
// near-neutral pixels (paper, white, grey) from being counted - without it a
// white page on screen registers as a large skin area.
func isSkinTone(y, cb, cr uint32) bool {
	if y < yMin {
		return false
	}
	// Distance from neutral grey (128,128) in chroma. A pixel this close to grey
	// carries no hue information, so classifying it as skin is a guess.
	if absDiff(cb, 128)+absDiff(cr, 128) < chromaFloor {
		return false
	}
	return cb >= cbMin && cb <= cbMax && cr >= crMin && cr <= crMax
}

// absDiff is |a - b| for uint32, avoiding the underflow `a - b` produces.
func absDiff(a, b uint32) uint32 {
	if a > b {
		return a - b
	}
	return b - a
}

// isSaturatedRed reports whether a pixel is a saturated RED - the colour
// signature of blood and of heavy red filters.
//
// WHY IT WORKS IN YCbCr AND NOT RGB
// =================================
//
// The RGB version required "red beats green and blue by 40+", which the brand
// accent #ff6500 satisfies: it is a pure saturated orange-red. A UI colour
// tripping the gore check means a channel page with a big accent banner inflates
// a moderation score, so the check would be reading the interface back to itself.
//
// What separates them is CHROMA, and specifically Cb:
//
//	blood  (168,24,24)  -> Cr=202, Cb=104   red leans slightly BLUE
//	accent (255,101,0)  -> Cr=216, Cb=52    red leans strongly YELLOW
//
// Real blood has a green channel near zero and a blue channel near its red
// channel's level, which pushes Cb up. An orange has a high green channel and no
// blue, which pushes Cb down. That gap (104 vs 52) is wide enough to be a rule,
// and it is not a threshold - it is the difference between red and orange.
//
// Deliberately NOT a red ban: a red title card has the same hue with far less
// saturation, and the saturation requirement keeps ordinary design out.
func isSaturatedRed(r, g, b uint32) bool {
	if r == 0 {
		return false
	}
	// Red must dominate both other channels by a clear margin. This is the cheap
	// guard that removes most of the frame before any chroma work.
	if r <= g+40 || r <= b+40 {
		return false
	}
	maxRGB, minRGB := max3(r, g, b), min3(r, g, b)
	if maxRGB == 0 {
		return false
	}
	// HSV-style saturation: how far the colour is from grey.
	saturation := float64(maxRGB-minRGB) / float64(maxRGB)
	if saturation < 0.55 || r < 140 {
		return false
	}

	// THE ORANGE GUARD. A Cb below this floor is a yellow-leaning red, which is
	// an orange rather than blood. The brand accent sits at Cb≈52 and blood at
	// Cb≈104, so the floor is set between them with margin on both sides.
	_, cb, _ := rgbToYCbCr(r, g, b)
	return cb >= redCbFloor
}

// redCbFloor is the minimum Cb for a pixel to count as blood-red rather than
// orange. See isSaturatedRed for the measured values this sits between.
const redCbFloor = 80

func max3(a, b, c uint32) uint32 {
	if a >= b && a >= c {
		return a
	}
	if b >= c {
		return b
	}
	return c
}

func min3(a, b, c uint32) uint32 {
	if a <= b && a <= c {
		return a
	}
	if b <= c {
		return b
	}
	return c
}

// diff is |a - b| for uint32, avoiding the underflow that `a - b` produces.
func diff(a, b uint32) uint32 {
	if a > b {
		return a - b
	}
	return b - a
}

// spriteStats re-encodes a decoded image to PNG, unused in the current path.
//
// KEPT because it is the diagnostic hook: when a moderation result looks wrong,
// dumping the sampled frames as a PNG lets a human see exactly what the
// classifier saw. Removing it to keep the file tidy would remove the only way to
// debug a false positive.
var _ = spriteStats

func spriteStats(img image.Image) int {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return 0
	}
	return buf.Len()
}

// =============================================================================
// CHANNEL BRAND COLOUR - one renderer, from a number
// =============================================================================
//
// A channel stores a HUE (an integer 0-359), not a colour string. This is the
// only place that turns one into CSS.
//
// =============================================================================
// WHY IT IS A NUMBER AND NOT A HEX STRING
// =============================================================================
//
// Because this value reaches an inline style on a page every visitor loads, and a
// free colour field is two bugs waiting.
//
// 1. INJECTION. The first component that writes
//        style={{ background: channel.brand_color }}
//    with something less careful than a CSS parser becomes a stored-XSS point.
//    The dangerous input is not `#fff`, it is
//        #fff; background-image: url(//evil.example/x)
//    which is not valid hex - but it is a perfectly good thing to type into a text
//    field, and "is it valid hex?" is a question every consumer must answer
//    correctly, forever.
//
// 2. LEGIBILITY. A creator picks `#ffffff` and their own channel page is blank.
//
// A hue removes both at once: the value is an integer, the saturation and
// lightness are OURS, and every offered colour passes contrast against both the
// light and the dark theme because we chose them. A channel can express a colour
// this codebase reviewed, or none.
//
// =============================================================================
// WHY THE PALETTE IS DUPLICATED HERE ANYWAY
// =============================================================================
//
// It is, and the duplication is deliberate - but it is STRUCTURED duplication, not
// the four-way copy of the category list that had to be deleted.
//
// The Go `BrandPalette` owns the write path: it validates a hue on the way in and
// refuses one it does not offer. This file owns the read path, and it cannot import
// Go.
//
// So the failure this guards against is not "the lists disagree" - `resolveBrand`
// degrades an unknown hue to the default rather than rendering nothing, so a
// disagreement costs a wrong colour and never a broken page. `tools/check-channel-
// lists.mjs` compares the two anyway, because "degrades safely" is a reason to
// check, not a reason not to.

/** One offered colour. Mirrors `service.BrandPalette` in auth-service. */
export type BrandColor = {
  name: string;
  hue: number;
  saturation: number;
  lightness: number;
};

/**
 * The palette, in the same order as the Go one.
 *
 * `DefaultBrandHue` (206, Sky) is deliberately the platform accent, so a channel
 * that chose nothing looks deliberate rather than unfinished.
 */
export const BRAND_COLORS: BrandColor[] = [
  { name: 'Ember', hue: 8, saturation: 78, lightness: 56 },
  { name: 'Coral', hue: 22, saturation: 80, lightness: 58 },
  { name: 'Amber', hue: 38, saturation: 84, lightness: 52 },
  { name: 'Lime', hue: 78, saturation: 62, lightness: 46 },
  { name: 'Green', hue: 142, saturation: 58, lightness: 44 },
  { name: 'Teal', hue: 172, saturation: 62, lightness: 42 },
  { name: 'Cyan', hue: 192, saturation: 70, lightness: 46 },
  { name: 'Sky', hue: 206, saturation: 76, lightness: 56 },
  { name: 'Indigo', hue: 232, saturation: 66, lightness: 62 },
  { name: 'Violet', hue: 268, saturation: 64, lightness: 62 },
  { name: 'Magenta', hue: 306, saturation: 64, lightness: 56 },
  { name: 'Rose', hue: 340, saturation: 70, lightness: 56 },
];

export const DEFAULT_BRAND_HUE = 206;

/**
 * Resolve a stored hue to a colour.
 *
 * An unknown hue - a legacy row, a hand-edited database, a palette that changed -
 * falls back to the DEFAULT rather than rendering nothing.
 *
 * This is the one place in the codebase where an unexpected value is tolerated
 * instead of refused, and the asymmetry is on purpose. This runs while RENDERING a
 * page for a visitor; a page that fails because a colour is unfamiliar is a worse
 * outcome than a page in the default colour. The write path already refused
 * unrecognised hues, so this branch means "an old row", not "a user sent something
 * invalid".
 */
export function resolveBrand(hue?: number | null): BrandColor {
  const target = typeof hue === 'number' ? hue : DEFAULT_BRAND_HUE;
  return BRAND_COLORS.find((c) => c.hue === target) ?? resolveBrand(DEFAULT_BRAND_HUE);
}

/**
 * The CSS colour for a hue, as an HSL triple.
 *
 * A TRIPLE, not a finished string, so callers can put it in `hsl(...)` and
 * `hsl(... / 0.2)`. A pre-joined `hsl(...)` would make an alpha variant impossible
 * without string surgery - and the two formats mixing up is how this repo ended up
 * painting borders dark red once already.
 *
 * Only interpolated into `hsl(<number> <number>% <number>%)`, and every component
 * reaches it through here, so no user input is ever concatenated into arbitrary
 * CSS.
 */
export function brandHsl(hue?: number | null): string {
  const c = resolveBrand(hue);
  return `${c.hue} ${c.saturation}% ${c.lightness}%`;
}

/** Ready to use in a `style` object. */
export function brandColor(hue?: number | null): string {
  return `hsl(${brandHsl(hue)})`;
}

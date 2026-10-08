// =============================================================================
// THE WideoCut Pro MARK
// =============================================================================
//
// A geometric 'W' with a scissor folded into its geometry.
//
// -----------------------------------------------------------------------------
// WHY THE SCISSOR IS THE BLADES AND NOT AN ICON ON TOP
// -----------------------------------------------------------------------------
//
// A scissor badge sitting on a W is two pictures in one square, and at 16 pixels —
// which is where this is actually seen, in a tab strip and a sidebar — it reads as
// noise. Folding the BLADES into the W's inner diagonals gives one mark instead of
// two, and the W stays a W.
//
// So: the outer diagonals are the W's legs, and the two inner strokes that would
// normally be the W's centre vertex are the scissor's blades. The pivot is a single
// ring at the centre, which is the only "extra" element and it is the part that
// makes it read as a scissor rather than as a W with a scratch.
//
// -----------------------------------------------------------------------------
// WHY NO BACKGROUND, NO CONTAINER, NO SHADING
// -----------------------------------------------------------------------------
//
// Because it has to sit on four different surfaces — the app chrome, a hover state, a
// selected row, and a dark timeline panel — and any box of its own becomes a visible
// seam on three of them.
//
// `currentColor` throughout, so the whole thing inherits whatever text colour it is
// placed in. That is what makes the active-state swap a single prop change instead of
// a second asset.
//
// -----------------------------------------------------------------------------
// THE GEOMETRY
// -----------------------------------------------------------------------------
//
// 24x24 viewBox, 2px stroke, round caps and joins, no fill.
//
// The 'W' is four strokes on a 3px to 21px horizontal span, apex at y=19 and
// troughs at y=6 — a 4:1.5 ratio, which is the proportion that reads as a W rather
// than as a wide M.
//
// The blades are the two inner strokes crossing at (12, 15), which is also where
// the W's centre vertex sits. Overlapping them is deliberate: the crossing IS the
// vertex, so the letterform and the tool share one point instead of competing for
// the same pixels.
//
// The pivot ring is 1.4px radius at (12, 5.5), sitting on the centre vertex —
// which is where a real scissor's screw is, and which keeps the silhouette
// scissor-shaped even at 16px where the blades have thinned to a couple of pixels.

import type { SVGProps } from 'react';

export interface WideoCutMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /**
   * Explicit colour override. Leave unset to inherit `currentColor`.
   *
   * Prefer the `active` prop: setting `color` directly gives the same pixels but
   * loses the semantics, and `active` is what a caller actually means by "this is
   * the selected one".
   */
  active?: boolean;
  /** Pixel size. Defaults to 24. */
  size?: number;
  /**
   * Accessible label. Omit for a purely decorative mark beside visible text — an
   * unlabelled icon next to a word is read twice by a screen reader, and a word
   * with no icon is read once, correctly.
   */
  title?: string;
}

/** The signature accent - MOVAVI orange-red (#ff6500) */
export const WIDECUT_ACTIVE = '#ff6500';

export function WideoCutMark({
  active = false,
  size = 24,
  title,
  className = '',
  ...rest
}: WideoCutMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      // `stroke` rather than `fill`: the mark is four open strokes. Filling it
      // would produce a solid blob at 16px.
      stroke={active ? WIDECUT_ACTIVE : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Neutral by default, accent when active. `currentColor` keeps it inheriting
      // whatever text colour the surface sets, which is what lets one asset sit on
      // chrome, a hover row and a selected row without a second file.
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}

      {/* ---- The W's outer legs: down, up, down, up ----
          Two paths rather than one, so the crossing with the blades below is
          unambiguous at any stroke width. */}
      <path d="M3 5 L7.5 19 L12 11" />
      <path d="M12 11 L16.5 19 L21 5" />

      {/* ---- The scissor blades: the two inner strokes, crossing at the vertex ----
          These would be the W's centre vertex in a plain W. Rendered as two
          separate strokes that pass through (12, 15) they become blades, and the
          vertex reads as the pivot. */}
      <path d="M9 15 L15 19" />
      <path d="M15 15 L9 19" />

      {/* ---- The pivot ----
          The only element that is neither a leg nor a blade, and the reason the
          silhouette reads as a tool rather than as a scratched letter. */}
      <circle cx="12" cy="15" r="1.4" fill={active ? WIDECUT_ACTIVE : 'currentColor'} stroke="none" />
    </svg>
  );
}

/**
 * The app's full lockup: mark plus wordmark.
 *
 * A separate component because the two are used together in the chrome and
 * separately in the sidebar, and hand-assembling the spacing is how a wordmark ends
 * up 2px off from the mark in one place and 4px off in another.
 */
export function WideoCutLogo({
  active = false,
  size = 24,
  showWordmark = true,
  className = '',
}: {
  active?: boolean;
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <WideoCutMark active={active} size={size} />
      {showWordmark ? (
        <span
          className="text-sm font-semibold tracking-tight"
          style={active ? { color: WIDECUT_ACTIVE } : undefined}
        >
          WideoCut <span className="font-normal opacity-70">Pro</span>
        </span>
      ) : null}
    </span>
  );
}
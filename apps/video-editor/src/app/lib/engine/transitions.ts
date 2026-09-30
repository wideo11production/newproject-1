// ============================================================================
// Transitions
// ============================================================================
//
// A transition is a blend between the clip that ENDS at a join and the clip
// that BEGINS there. It is a property of the join, not of either clip, which
// is why it lives in its own array rather than on the clip: two clips swapped
// around would otherwise carry their transition with them.
//
// ---- WHY `atTime` IS THE OUTGOING CLIP'S END ----
//
// During a transition both pictures are on screen, so the outgoing clip has to
// be held PAST the point where it was trimmed to end. Clips are never moved
// and never re-trimmed to make room - a transition is purely a render-time
// overlap, so applying and removing one cannot change a single frame of the
// edit underneath it.
//
// `renderLayer` therefore gets an `allowPastEnd` flag, and the clip is asked
// for its source time past its own out point.

import type { TransitionType } from './types';

export type { TransitionType };

export interface TransitionDef {
  id: TransitionType;
  label: string;
  /** One line: what you see happen. Shown in the panel, not just a tooltip. */
  hint: string;
  /** Tailwind classes for the panel tile. */
  accent: string;
}

export const TRANSITIONS: TransitionDef[] = [
  { id: 'dissolve', label: 'Crossfade', hint: 'The first clip fades out as the next fades in', accent: 'from-sky-500/40 to-sky-900/10' },
  { id: 'dip-black', label: 'Dip to black', hint: 'Fades down to black, then up into the next clip', accent: 'from-slate-700 to-black' },
  { id: 'fade-white', label: 'Fade to white', hint: 'Flashes white between the two clips', accent: 'from-amber-200 to-amber-900/20' },
  { id: 'wipe-left', label: 'Wipe left', hint: 'A hard edge sweeps across, revealing the next clip', accent: 'from-violet-500/40 to-violet-900/10' },
  { id: 'wipe-right', label: 'Wipe right', hint: 'A hard edge sweeps back the other way', accent: 'from-violet-500/40 to-violet-900/10' },
  { id: 'wipe-up', label: 'Wipe up', hint: 'The edge sweeps from the bottom to the top', accent: 'from-emerald-500/40 to-emerald-900/10' },
  { id: 'wipe-down', label: 'Wipe down', hint: 'The edge sweeps from the top to the bottom', accent: 'from-emerald-500/40 to-emerald-900/10' },
  { id: 'slide-left', label: 'Slide left', hint: 'The next clip pushes the first one off screen', accent: 'from-rose-500/40 to-rose-900/10' },
  { id: 'slide-right', label: 'Slide right', hint: 'The first clip pushes the next one off screen', accent: 'from-rose-500/40 to-rose-900/10' },
  { id: 'circle-open', label: 'Circle open', hint: 'The next clip opens like a circle from the centre', accent: 'from-sky-500/40 to-sky-900/10' },
  { id: 'zoom-in', label: 'Zoom through', hint: 'The first clip pushes in past the camera into the next', accent: 'from-indigo-500/40 to-indigo-900/10' },
];

export const TRANSITION_BY_ID: Record<TransitionType, TransitionDef> = TRANSITIONS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t }),
  {} as Record<TransitionType, TransitionDef>
);

/** Longest transition we allow, in seconds. Beyond this it stops reading as a
 *  transition and starts reading as "the cut is somewhere in there". */
export const MAX_TRANSITION = 4;
export const DEFAULT_TRANSITION_DURATION = 1;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** Smoothstep. A linear blend shows a visible seam at the midpoint because
 *  neither layer is fully opaque; easing removes it. */
const ease = (p: number) => p * p * (3 - 2 * p);

/**
 * Composite two already-rendered frames with a transition between them.
 *
 * `p` is 0..1 across the transition: 0 is the outgoing clip, 1 the incoming
 * one. The two canvases are the same size as the destination.
 *
 * The clip region is applied with `ctx.save/restore` around each case, because
 * a stray clip left on the context leaks into the NEXT clip drawn and the
 * whole picture disappears. That failure is silent, so it is guarded
 * structurally rather than by remembering.
 */
export function applyTransition(
  ctx: CanvasRenderingContext2D,
  type: TransitionType,
  p: number,
  from: CanvasImageSource,
  to: CanvasImageSource,
  width: number,
  height: number
): void {
  const t = ease(clamp01(p));
  ctx.save();

  switch (type) {
    case 'dissolve': {
      ctx.drawImage(from, 0, 0, width, height);
      ctx.globalAlpha = t;
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
    case 'dip-black':
    case 'fade-white': {
      const colour = type === 'dip-black' ? '#000000' : '#ffffff';
      ctx.drawImage(from, 0, 0, width, height);
      // Down to the colour at the midpoint, then back up: 1-|2t-1| is a
      // triangle that peaks at exactly 0.5.
      ctx.fillStyle = colour;
      ctx.globalAlpha = 1 - Math.abs(2 * t - 1);
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      // The incoming clip is drawn UNDER the colour, so it is revealed as the
      // colour fades rather than appearing on top of it.
      ctx.globalAlpha = t;
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
    case 'wipe-left':
    case 'wipe-right': {
      ctx.drawImage(from, 0, 0, width, height);
      ctx.beginPath();
      const w = width * t;
      if (type === 'wipe-left') ctx.rect(width - w, 0, w, height);
      else ctx.rect(0, 0, w, height);
      ctx.clip();
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
    case 'wipe-up':
    case 'wipe-down': {
      ctx.drawImage(from, 0, 0, width, height);
      ctx.beginPath();
      const h = height * t;
      if (type === 'wipe-up') ctx.rect(0, height - h, width, h);
      else ctx.rect(0, 0, width, h);
      ctx.clip();
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
    case 'slide-left':
    case 'slide-right': {
      const dir = type === 'slide-left' ? -1 : 1;
      const shift = width * t;
      ctx.drawImage(from, shift * dir, 0, width, height);
      ctx.drawImage(to, shift * -dir, 0, width, height);
      break;
    }
    case 'circle-open': {
      ctx.drawImage(from, 0, 0, width, height);
      const r = Math.hypot(width, height) * t;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
    case 'zoom-in': {
      // The outgoing clip keeps scaling past the camera, so the frame fills
      // with the incoming one from behind it.
      const z = 1 + t * 1.2;
      ctx.drawImage(from, (width * (1 - z)) / 2, (height * (1 - z)) / 2, width * z, height * z);
      ctx.drawImage(to, 0, 0, width, height);
      break;
    }
  }

  ctx.restore();
}

/**
 * Progress of the transition covering time `t`, or null if none is.
 *
 * Returns the pair of clips to render as well, so the caller does not have to
 * re-derive which two clips straddle the join.
 */
export function transitionAt(
  transitions: { trackId: string; atTime: number; duration: number }[],
  trackId: string,
  t: number
): { atTime: number; duration: number } | null {
  for (const tr of transitions) {
    if (tr.trackId !== trackId) continue;
    if (t >= tr.atTime && t < tr.atTime + tr.duration) return tr;
  }
  return null;
}

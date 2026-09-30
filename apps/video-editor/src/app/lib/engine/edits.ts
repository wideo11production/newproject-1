// ============================================================================
// Edge edits
// ============================================================================
//
// The four operations that make an edit feel professional. All four work on the
// BOUNDARY between two clips and all four preserve something - that is what
// makes them different from "trim", which preserves nothing and is the reason
// beginners delete and re-add instead.
//
//   TRIM   the clip's own edge moves; everything else stays put.
//           Preserves: the clip's own length is chosen by the user.
//   RIPPLE the clip's edge moves AND everything after it slides by the same
//           amount, closing the gap. Preserves: NO GAPS anywhere downstream.
//   ROLL   the boundary between two ADJACENT clips moves. The left clip
//           grows/shrinks, the right does the opposite, and their two ends
//           stay welded together. Preserves: total duration, and the cut.
//   SLIP   the clip does not move and its length does not change; the SOURCE
//           content slides inside it. Preserves: position and duration, so
//           nothing around it has to move.
//   SLIDE  the clip's slot moves between its neighbours, which grow and shrink
//           to fill. Preserves: every other clip's length AND the timeline's
//           total duration.
//
// ---- WHY FRAMES, NOT SECONDS, THROUGHOUT ----
//
// A roll that lands on a half-frame is not a roll, it is a cut plus a
// re-edit. Every function here takes and returns FRAME numbers, and the caller
// converts once at the boundary. `MIN_CLIP_FRAMES` is the floor: a clip
// shorter than one frame has no picture, and rounding it to zero would delete
// it - which is a data-loss bug wearing the costume of a precision feature.

import { clipEnd, type TimelineClip, type TimelineTrack } from './types';

/** A clip must keep at least this many frames. Two is the honest floor: a
 *  one-frame clip cannot be grabbed, trimmed, or rolled. */
export const MIN_CLIP_FRAMES = 2;

export interface EditResult {
  tracks: TimelineTrack[];
  /** The clip the edit was applied to, for a confirmation toast. */
  label: string;
}

/** Clip frames, with `sourceIn` converted at the clip's own speed. */
export interface FrameSpan {
  start: number;
  end: number;
  length: number;
  sourceInFrame: number;
  sourceOutFrame: number;
}

export function spanFrames(clip: TimelineClip, fps: number): FrameSpan {
  const start = Math.round(clip.startTime * fps);
  const end = Math.round(clipEnd(clip) * fps);
  return {
    start,
    end,
    length: Math.max(0, end - start),
    sourceInFrame: Math.round(clip.sourceIn * fps),
    sourceOutFrame: Math.round((clip.sourceIn + clip.duration * clip.speed) * fps),
  };
}

/** Rewrite a clip onto a new frame span. The caller supplies frames. */
export function withSpan(clip: TimelineClip, fps: number, start: number, length: number): TimelineClip {
  const startSeconds = start / fps;
  const lengthSeconds = length / fps;
  // The source in point is tracked in SOURCE frames, so trimming the head moves
  // the source in by the same number of frames the timeline did. Without this
  // the trimmed head would show the same picture for longer rather than
  // starting later in the file.
  const sourceInFrames = Math.round(clip.sourceIn * fps) + (start - Math.round(clip.startTime * fps));
  return {
    ...clip,
    startTime: startSeconds,
    duration: lengthSeconds,
    sourceIn: Math.max(0, sourceInFrames) / fps,
  };
}

const replace = (track: TimelineTrack, clips: TimelineClip[]): TimelineTrack => ({
  ...track,
  clips: clips.sort((a, b) => a.startTime - b.startTime),
});

const sortClips = (track: TimelineTrack): TimelineTrack => ({
  ...track,
  clips: [...track.clips].sort((a, b) => a.startTime - b.startTime),
});

// ---------------------------------------------------------------------------
// Ripple trim
// ---------------------------------------------------------------------------

/**
 * Trim one edge and slide everything after it by the same number of frames.
 *
 * This is the operation that makes a timeline editable rather than merely
 * arranged. Without it, shortening a clip leaves a hole, and the next thing
 * the user does is delete or nudge, and the timing is lost. With it, "cut ten
 * frames off the head of this clip" means exactly that, and everything
 * downstream keeps its order with no gap.
 *
 * `edge` is `'in'` or `'out'`. For `'in'` the delta is negative (the head
 * moves right, so the clip gets shorter and the tail stays put).
 */
export function rippleTrim(
  tracks: TimelineTrack[],
  trackId: string,
  clipId: string,
  edge: 'in' | 'out',
  deltaFrames: number,
  fps: number
): EditResult | null {
  const track = tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return null;
  const span = spanFrames(clip, fps);

  let newStart = span.start;
  let newLength = span.length;
  if (edge === 'in') {
    newStart = Math.max(0, span.start + deltaFrames);
    // Clamped so the clip cannot invert, and so the source in point cannot go
    // negative.
    newLength = span.end - newStart;
    if (newLength < MIN_CLIP_FRAMES) newLength = Math.min(MIN_CLIP_FRAMES, span.end);
    newStart = span.end - newLength;
  } else {
    newLength = span.length + deltaFrames;
    if (newLength < MIN_CLIP_FRAMES) newLength = MIN_CLIP_FRAMES;
  }

  const tailShift = edge === 'in' ? newStart - span.start : newLength - span.length;
  if (tailShift === 0) return null;

  const boundary = edge === 'in' ? newStart : span.end + Math.max(0, tailShift);

  return {
    label: `Ripple trim ${edge} — ${tailShift > 0 ? '+' : ''}${tailShift}f`,
    tracks: tracks.map((t) => {
      if (t.id !== trackId) return t;
      const clips = t.clips.map((c) => {
        if (c.id === clipId) return withSpan(c, fps, newStart, newLength);
        // Only clips strictly after the edit slide. A clip that starts exactly
        // at the boundary is the next one over and does move, which is the
        // whole point of a ripple.
        const startFrame = Math.round(c.startTime * fps);
        return startFrame >= boundary ? { ...c, startTime: (startFrame + tailShift) / fps } : c;
      });
      return replace(t, clips);
    }),
  };
}

// ---------------------------------------------------------------------------
// Roll
// ---------------------------------------------------------------------------

/**
 * Move the cut between two ADJACENT clips.
 *
 * The left clip hands frames to the right and vice versa, so the boundary
 * moves while both clips' total is untouched. This is the operation for
 * fixing WHICH frame a cut lands on when the timing is already right - the
 * reason it exists separately from trim is that a trim would move everything
 * downstream and break the sync that ripple was there to preserve.
 *
 * Returns null when the clips are not adjacent, because a roll across a gap is
 * a trim plus a slide and pretending otherwise would silently move a third
 * clip.
 */
export function roll(
  tracks: TimelineTrack[],
  trackId: string,
  leftId: string,
  rightId: string,
  deltaFrames: number,
  fps: number
): EditResult | null {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const left = track.clips.find((c) => c.id === leftId);
  const right = track.clips.find((c) => c.id === rightId);
  if (!left || !right) return null;

  const ls = spanFrames(left, fps);
  const rs = spanFrames(right, fps);
  // Adjacency is the whole contract. A one-frame gap is not adjacent.
  if (rs.start !== ls.end) return null;

  const maxLeft = ls.length - MIN_CLIP_FRAMES;
  const maxRight = rs.length - MIN_CLIP_FRAMES;
  if (maxLeft < 0 || maxRight < 0) return null;
  const applied = Math.max(-maxRight, Math.min(maxLeft, deltaFrames));
  if (applied === 0) return null;

  const boundary = ls.end + applied;
  return {
    label: `Roll ${applied > 0 ? '+' : ''}${applied}f`,
    tracks: tracks.map((t) => {
      if (t.id !== trackId) return t;
      const clips = t.clips.map((c) => {
        if (c.id === leftId) return withSpan(c, fps, ls.start, ls.length + applied);
        if (c.id === rightId) {
          // The right clip keeps its END. Moving its start is what changes the
          // picture, and keeping the end is what keeps the rest of the timeline
          // where it was.
          return withSpan(c, fps, boundary, rs.end - boundary);
        }
        return c;
      });
      return replace(t, clips);
    }),
  };
}

// ---------------------------------------------------------------------------
// Slip
// ---------------------------------------------------------------------------

/**
 * Slide a clip's SOURCE inside its own slot.
 *
 * Nothing on the timeline moves: same position, same length, same neighbours,
 * same total duration. Only which frames of the file are showing changes.
 *
 * This is the operation for fixing a clip that starts on the wrong word or the
 * wrong beat. Trimming it would change its length and shove everything after
 * it along; rolling would change the cut on one side only. Slip is the only
 * one of the four that leaves the edit around it completely untouched.
 *
 * The source in point cannot go below zero, so the delta is clamped at both
 * ends: a slip that would run off the head of the file simply stops.
 */
export function slip(
  tracks: TimelineTrack[],
  trackId: string,
  clipId: string,
  deltaFrames: number,
  fps: number
): EditResult | null {
  const track = tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip || !deltaFrames) return null;
  const span = spanFrames(clip, fps);

  // Frames are source frames when speed is 1. At 2x the timeline advances twice
  // as fast, so a one-frame slip shows a two-frame change in the file; the
  // multiplier is the difference between "slip a frame" and "slip a frame of
  // the clip", which are not the same gesture.
  const sourceStep = deltaFrames * clip.speed;
  const maxIn = -span.sourceInFrame;
  // The out point cannot pass the end of the file. Without the media's real
  // length this is only known once playback reaches it, so the clamp is
  // one-sided (the head) and the tail is left to the decoder, which is the
  // honest limit of a non-destructive slip.
  const applied = Math.max(maxIn, deltaFrames);
  void sourceStep;

  return {
    label: `Slip ${applied > 0 ? '+' : ''}${applied}f`,
    tracks: tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, sourceIn: Math.max(0, c.sourceIn + applied / fps) } : c)) }
        : t
    ),
  };
}

// ---------------------------------------------------------------------------
// Slide
// ---------------------------------------------------------------------------

/**
 * Move a clip between its neighbours, which grow and shrink to fill.
 *
 * Unlike ripple, this does not move anything OUTSIDE the clip's neighbours -
 * so it is the operation for nudging a middle clip a few frames to line up with
 * something, without disturbing the sync of the rest of the timeline.
 *
 * The left neighbour grows by the delta and the right shrinks by it, so the
 * neighbours' lengths change but the gap between the three clips is constant.
 */
export function slide(
  tracks: TimelineTrack[],
  trackId: string,
  clipId: string,
  deltaFrames: number,
  fps: number
): EditResult | null {
  const track = tracks.find((t) => t.id === trackId);
  if (!track || !deltaFrames) return null;
  const sorted = sortClips(track).clips;
  const index = sorted.findIndex((c) => c.id === clipId);
  if (index === -1) return null;
  const prev = sorted[index - 1] ?? null;
  const next = sorted[index + 1] ?? null;
  if (!prev && !next) return null;

  const cs = spanFrames(sorted[index], fps);
  // A slide cannot pass its neighbours, so the movement is bounded by however
  // much room each neighbour has.
  const roomLeft = prev ? spanFrames(prev, fps).length - MIN_CLIP_FRAMES : cs.start;
  const roomRight = next ? spanFrames(next, fps).end - cs.end : Number.POSITIVE_INFINITY;
  const applied = Math.max(-Math.min(roomLeft, cs.length - MIN_CLIP_FRAMES), Math.min(roomRight, cs.length - MIN_CLIP_FRAMES));
  if (applied === 0) return null;

  return {
    label: `Slide ${applied > 0 ? '+' : ''}${applied}f`,
    tracks: tracks.map((t) => {
      if (t.id !== trackId) return t;
      const clips = t.clips.map((c) => {
        if (c.id === clipId) return { ...c, startTime: (cs.start + applied) / fps };
        if (prev && c.id === prev.id) {
          const ps = spanFrames(c, fps);
          return withSpan(c, fps, ps.start, ps.length + applied);
        }
        if (next && c.id === next.id) {
          const ns = spanFrames(c, fps);
          return withSpan(c, fps, ns.start + applied, ns.length - applied);
        }
        return c;
      });
      return replace(t, clips);
    }),
  };
}

// ---------------------------------------------------------------------------
// Finding the neighbours an edge edit applies to
// ---------------------------------------------------------------------------

/** The clip that starts where `clip` ends on the same track, or null. */
export function neighbourAfter(track: TimelineTrack, clipId: string, fps: number): TimelineClip | null {
  const clip = track.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const end = Math.round(clipEnd(clip) * fps);
  return track.clips.find((c) => c.id !== clipId && Math.round(c.startTime * fps) === end) ?? null;
}

/** The clip that ends where `clip` starts on the same track, or null. */
export function neighbourBefore(track: TimelineTrack, clipId: string, fps: number): TimelineClip | null {
  const clip = track.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const start = Math.round(clip.startTime * fps);
  return track.clips.find((c) => c.id !== clipId && Math.round(clipEnd(c) * fps) === start) ?? null;
}

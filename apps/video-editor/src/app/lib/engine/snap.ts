// ============================================================================
// Snapping
// ============================================================================
//
// Snapping is the difference between a timeline you can line up by eye and one
// you can line up exactly. It has to do three things at once, and each has a
// failure mode:
//
//   1. FIND the candidates - the playhead, every clip edge on every track,
//      every marker, both ends of the timeline, and every transition join.
//   2. RANK them - the NEAREST candidate within a pixel threshold wins. Ranking
//      by priority instead (playhead first, then clips) makes a clip leap past
//      a playhead it happens to be nearer to, which feels broken.
//   3. TELL THE USER - the line that appears while dragging. A snap the user
//      cannot see is indistinguishable from the snap not happening.
//
// ---- WHY PIXELS, NOT SECONDS, FOR THE THRESHOLD ----
//
// The threshold is a distance the user's hand has to travel. It is in pixels
// because pixels are what a hand moves; a threshold expressed in seconds
// changes with the zoom, so "snapping" would be sticky when zoomed out and
// unusable when zoomed in.

import type { TimelineTrack, Transition } from './types';
import { clipEnd } from './types';
import type { Marker } from './markers';
import { transitionFrames } from './markers';

export type SnapKind = 'playhead' | 'clip' | 'marker' | 'range' | 'timeline-end';

export interface SnapTarget {
  frame: number;
  kind: SnapKind;
  label: string;
}

export interface SnapOptions {
  fps: number;
  enabled: boolean;
  toPlayhead: boolean;
  toClips: boolean;
  toMarkers: boolean;
  toTimelineEnds: boolean;
  /** Pixel radius within which a target is considered. */
  thresholdPx: number;
  /** Pixels per frame, to convert the threshold into frames. */
  pxPerFrame: number;
  playheadFrame: number;
  markers: Marker[];
  transitions: Transition[];
  /** The clip being dragged, so it is not snapped to its own edges. */
  excludeClipId?: string | null;
  durationFrames: number;
}

/**
 * Every frame a drag may snap to.
 *
 * Collected once per drag frame rather than per candidate test: the set is
 * O(clips + markers) and the test is O(1) against it, so the cost is one pass
 * instead of one pass per candidate.
 */
export function collectSnapTargets(o: SnapOptions): SnapTarget[] {
  const out: SnapTarget[] = [];
  const push = (frame: number, kind: SnapKind, label: string) => {
    const f = Math.round(frame);
    if (f < 0 || f > o.durationFrames) return;
    out.push({ frame: f, kind, label });
  };

  if (o.toPlayhead) push(o.playheadFrame, 'playhead', 'Playhead');
  if (o.toTimelineEnds) {
    push(0, 'range', 'Timeline start');
    push(o.durationFrames, 'timeline-end', 'Timeline end');
  }
  if (o.toMarkers) {
    for (const m of o.markers) push(m.frame, 'marker', `Marker “${m.label || 'Untitled'}”`);
  }
  if (o.toClips) {
    for (const track of tracksOf(o)) {
      for (const c of track.clips) {
        if (c.id === o.excludeClipId) continue;
        push(Math.round(c.startTime * o.fps), 'clip', `Start of “${c.mediaName}”`);
        push(Math.round(clipEnd(c) * o.fps), 'clip', `End of “${c.mediaName}”`);
      }
    }
  }
  for (const f of transitionFrames(o.transitions, o.fps as never)) {
    push(f, 'clip', 'Transition');
  }
  return out;
}

/**
 * The snap target nearest `frame`.
 *
 * `edges` are the candidate FRAMES of the thing being dragged - for a clip
 * that is its start and its end, for a trim it is the single edge being moved.
 * Snapping matches whichever of them lands closest to a target, because a user
 * lining up a clip's END against a marker means the end, and matching only the
 * start would be a different gesture than the one they made.
 */
export function findSnap(
  frame: number,
  edges: number[],
  targets: SnapTarget[],
  thresholdFrames: number
): { frame: number; target: SnapTarget | null; snappedEdges: number[] } {
  let best: { frame: number; target: SnapTarget | null; distance: number } | null = null;
  for (const t of targets) {
    for (const edge of edges) {
      const d = Math.abs(edge - t.frame);
      if (d > thresholdFrames) continue;
      // Strictly closer wins, so a tie keeps the FIRST candidate. Stable ties
      // matter: an editor that occasionally snaps to a marker and occasionally
      // to a clip at exactly the same distance is unpredictable, and
      // unpredictable snapping gets turned off by the user.
      if (!best || d < best.distance) best = { frame: t.frame - (edge - frame), target: t, distance: d };
    }
  }
  if (!best) return { frame, target: null, snappedEdges: edges };
  const snappedEdges = edges.map((e) => e + (best.frame - frame));
  return { frame: best.frame, target: best.target, snappedEdges };
}

/** Track list is threaded in so this module stays free of editor state. */
function tracksOf(o: SnapOptions): TimelineTrack[] {
  return (o as SnapOptions & { tracks?: TimelineTrack[] }).tracks ?? [];
}

/** Attach the tracks without widening the public options shape. */
export function withTracks(o: SnapOptions, tracks: TimelineTrack[]): SnapOptions {
  return Object.assign(o, { tracks });
}

/** Pixel threshold to frame threshold, with a one-frame floor. */
export function thresholdFrames(px: number, pxPerFrame: number): number {
  return Math.max(1, px / Math.max(pxPerFrame, 0.0001));
}

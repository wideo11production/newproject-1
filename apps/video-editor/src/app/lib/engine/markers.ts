// ============================================================================
// Markers
// ============================================================================
//
// A marker is a labelled point on the timeline. It is stored as a FRAME NUMBER
// for the same reason the playhead is: a marker that drifts by a third of a
// frame between a save and a reload is a marker that is no longer on the frame
// the user placed it on.
//
// Markers are three things at once, which is why they are worth having:
//   * a navigation target (`M` drops one at the playhead, `,`/`.` step between
//     them, which is how you get back to a note you made forty cuts ago)
//   * a SNAP target, so a dragged clip lands ON a marker rather than near it
//   * a region for the loop, by dragging between two of them

import type { Transition } from './types';
import type { Fps } from './frames';

export interface Marker {
  id: string;
  /** Timeline FRAME. Not seconds. */
  frame: number;
  label: string;
  colour: 'amber' | 'sky' | 'rose' | 'emerald' | 'violet';
  /** Loop in/out markers are a pair and cannot be deleted independently. */
  kind: 'point' | 'range-in' | 'range-out';
}

let counter = 0;
export function nextMarkerId(): string {
  return `mk-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export const MARKER_COLOURS: Record<Marker['colour'], string> = {
  amber: '#fbbf24',
  sky: '#38bdf8',
  rose: '#fb7185',
  emerald: '#34d399',
  violet: '#a78bfa',
};

export function markerFrame(m: Marker, fps: Fps): number {
  return m.frame;
}

export function markerTime(m: Marker, fps: Fps): number {
  return m.frame / fps;
}

/** Markers on a track-independent timeline, ordered by frame. */
export function sortMarkers(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.frame - b.frame);
}

/**
 * The next marker strictly after `frame`, or null.
 *
 * "Strictly" matters: stepping forward from a marker must go to the NEXT one.
 * A `>=` comparison means pressing `.` while parked on a marker does nothing
 * forever, and a user reads that as a broken key rather than as an off-by-one.
 */
export function nextMarker(markers: Marker[], frame: number): Marker | null {
  const sorted = sortMarkers(markers);
  for (const m of sorted) if (m.frame > frame) return m;
  return null;
}

/** The previous marker strictly before `frame`, or null. */
export function prevMarker(markers: Marker[], frame: number): Marker | null {
  const sorted = sortMarkers(markers);
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].frame < frame) return sorted[i];
  return null;
}

/** The markers bracketing `frame`, for the loop region read-out. */
export function bracketing(markers: Marker[], frame: number): { before: Marker | null; after: Marker | null } {
  return { before: prevMarker(markers, frame), after: nextMarker(markers, frame) };
}

/** Transitions double as snap targets: a join is as findable as a marker. */
export function transitionFrames(transitions: Transition[], fps: Fps): number[] {
  return transitions.map((t) => Math.round(t.atTime * fps));
}

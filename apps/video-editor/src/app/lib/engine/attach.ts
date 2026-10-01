// ============================================================================
// ATTACH / DETACH
// ============================================================================
//
// A video and its audio are two CLIPS that happen to be the same take. Movavi
// (and every other editor) calls the relationship between them an ATTACHMENT:
// attached clips move together, cut together, and fade together. Detaching
// splits them so they can be moved, trimmed and cut independently - which is
// what you need the moment one side drifts out of sync with the other.
//
// ---- WHY THIS IS NOT "LINK" ----
//
// The name matters because the behaviour does. A link says "these two are
// related". An attachment says "these two are the same take, keep them
// together", and it implies a right to DETACH that a link does not. The UI
// shows the attachment state on the clip, and Detach is a first-class action
// rather than the absence of a link.
//
// ---- WHY "BEST PARTNER" AND NOT "FIRST MATCH" ----
//
// The first implementation linked a clip to the first clip it could find with
// the same media id, which is wrong in the case that actually comes up: a take
// appears three times on the timeline because the user trimmed, split and
// re-trimmed it. Linking the new one to the OLD one silently welds a clip at
// frame 0 to a clip at frame 140, and every later drag teleports 140 frames of
// audio. So the partner is chosen by TIME: the candidate that overlaps this
// clip the most, and only failing that the one closest in time.

import { clipEnd, type TimelineClip, type TimelineTrack } from './types';

export interface Candidate {
  clip: TimelineClip;
  trackId: string;
  /** Overlapping seconds. 0 means "same moment", which is what we want. */
  overlap: number;
  /** Signed distance between the two starts, in seconds. */
  offset: number;
}

/** How much two clips overlap, in seconds. */
function overlapOf(a: TimelineClip, b: TimelineClip): number {
  const start = Math.max(a.startTime, b.startTime);
  const end = Math.min(clipEnd(a), clipEnd(b));
  return Math.max(0, end - start);
}

/**
 * Rank the clips this one could attach to.
 *
 * Ordered deliberately:
 *   1. same media (an attachment is only meaningful between two instances of
 *      the SAME take - binding two unrelated clips together is a lie the
 *      timeline would then enforce on every drag)
 *   2. a DIFFERENT track (a clip cannot be attached to itself)
 *   3. most time overlap first
 *   4. closest in start time
 */
export function candidatesFor(tracks: TimelineTrack[], clip: TimelineClip): Candidate[] {
  const out: Candidate[] = [];
  for (const track of tracks) {
    for (const other of track.clips) {
      if (other.id === clip.id) continue;
      if (other.mediaId !== clip.mediaId) continue;
      out.push({
        clip: other,
        trackId: track.id,
        overlap: overlapOf(clip, other),
        offset: other.startTime - clip.startTime,
      });
    }
  }
  return out.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return Math.abs(a.offset) - Math.abs(b.offset);
  });
}

/** The clip this one is attached to, or null. */
export function attachedPartner(tracks: TimelineTrack[], clip: TimelineClip): TimelineClip | null {
  if (!clip.linkedId) return null;
  for (const track of tracks) {
    for (const other of track.clips) if (other.id === clip.linkedId) return other;
  }
  // The partner is gone. Clearing the dangling id is not optional: a stale
  // `linkedId` makes "Detach" look broken and makes a later attach pick the
  // wrong clip.
  return null;
}

export interface AttachResult {
  tracks: TimelineTrack[];
  label: string;
  ok: boolean;
}

/** Attach a clip to its best partner. */
export function attach(tracks: TimelineTrack[], clipId: string): AttachResult {
  const all = tracks.flatMap((t) => t.clips);
  const clip = all.find((c) => c.id === clipId);
  if (!clip) return { tracks, label: 'That clip is gone', ok: false };

  if (clip.linkedId) return detach(tracks, clipId);

  const candidates = candidatesFor(tracks, clip);
  const partner = candidates[0];
  if (!partner) {
    return {
      tracks,
      label: 'Nothing to attach to — put the same file on another lane first',
      ok: false,
    };
  }

  return {
    ok: true,
    label:
      partner.overlap > 0
        ? `Attached to “${partner.clip.mediaName}” on ${trackName(tracks, partner.trackId)} — they now move, cut and fade together`
        : `Attached to “${partner.clip.mediaName}” on ${trackName(tracks, partner.trackId)} — note it is ${Math.abs(partner.offset).toFixed(1)}s away`,
    tracks: tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id === clipId) return { ...c, linkedId: partner.clip.id };
        if (c.id === partner.clip.id) return { ...c, linkedId: clipId };
        return c;
      }),
    })),
  };
}

/** Detach a clip from its partner. Both sides are cleared. */
export function detach(tracks: TimelineTrack[], clipId: string): AttachResult {
  const all = tracks.flatMap((t) => t.clips);
  const clip = all.find((c) => c.id === clipId);
  if (!clip) return { tracks, label: 'That clip is gone', ok: false };

  const partnerId = clip.linkedId ?? candidatesFor(tracks, clip)[0]?.clip.id ?? null;
  if (!partnerId && !clip.linkedId) {
    return { tracks, label: 'That clip is not attached to anything', ok: false };
  }

  return {
    ok: true,
    label: 'Detached — this clip and its partner move independently from now on',
    tracks: tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === clipId || c.id === partnerId ? { ...c, linkedId: null } : c)),
    })),
  };
}

function trackName(tracks: TimelineTrack[], id: string): string {
  return tracks.find((t) => t.id === id)?.name ?? 'another lane';
}

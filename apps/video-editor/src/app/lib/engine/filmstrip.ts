'use client';

// ============================================================================
// FILMSTRIP
// ============================================================================
//
// Every clip in a professional timeline is a row of small frames taken from the
// clip's own footage, not one poster stretched across it.
//
// ---- WHY ONE POSTER IS NOT ENOUGH ----
//
// A single frame stretched to the clip's width is a blurred lie: you cannot see
// where the cut should go, whether the shot is a talking head or a wide, or
// whether the clip starts on a closed eye. Movavi and Resolve both draw a
// strip precisely so you can find the cut by LOOKING instead of by scrubbing.
//
// ---- WHY THE DECODER IS THE COMPOSITOR'S ----
//
// The first version of this made its own hidden <video> per file. It never
// loaded: measured in a real browser the elements sat at `readyState 0`
// forever, extractions hung in flight, and the strip stayed empty - while the
// code read as though it should work. The preview, using ITS element, showed
// frames perfectly the whole time.
//
// The lesson is not "add a longer timeout". It is that a second decoder for the
// same file is a second thing that can fail, and nothing in the lane needed it.
// So the strip asks `Compositor.getLive()` for the element that is ALREADY
// decoding that clip - the one the preview proves works - and reads frames off
// it. One decoder per clip, not two.
//
// ---- FIXED WIDTH, AND THAT IS THE POINT ----
//
// Thumbnails are a FIXED width, not "one per N% of the clip". Sizing them to
// the clip's width means the strip never gets more detailed as you zoom - it
// just stretches, which is the same problem as the single poster again. A
// fixed strip means zooming IN reveals more real frames, the way a filmstrip
// under a loupe behaves.

import { useEffect, useState } from 'react';
import { Compositor } from './compositor';
import type { TimelineClip } from './types';

/** Thumbnail WIDTH in CSS pixels. */
export const THUMB_WIDTH = 56;

/**
 * Capture at 2x and display at 1x.
 *
 * This is the whole difference between a dull strip and a crisp one, and it is
 * not a detail: at 1x a 56px thumbnail is sampled at 56px and then scaled to
 * fit the lane height, so it is being UPSCALED on every modern display - which
 * is what "dull" actually is. Capturing at 112x and letting CSS halve it means
 * every device gets real pixels, and a Retina screen gets its full density.
 */
const CAPTURE_SCALE = 2;
const THUMB_WIDTH_PX = THUMB_WIDTH * CAPTURE_SCALE;
const THUMB_HEIGHT_PX = 34 * CAPTURE_SCALE;

/**
 * JPEG quality 0.82, not 0.5.
 *
 * Half quality was chosen when the strip was 40px of a busy timeline. Now that
 * the frames are the primary thing a user reads to find a cut, the artefacts
 * ARE the dullness - blocking on a 4:2:0 chroma subsample is exactly what
 * makes a frame look washed out next to the clean picture above it.
 */
const JPEG_QUALITY = 0.82;

/**
 * Frames per clip.
 *
 * One per 400ms, clamped to 2..24. Bounded at BOTH ends: a 40-minute clip at
 * 400ms wants 6000 frames, and a half-second clip wants one.
 */
function frameCount(durationSeconds: number): number {
  return Math.max(2, Math.min(24, Math.round(durationSeconds / 0.4)));
}

interface StripKey {
  clipId: string;
  sourceIn: number;
  duration: number;
  speed: number;
  count: number;
}

const keyOf = (k: StripKey) =>
  `${k.clipId}|${k.sourceIn.toFixed(2)}|${k.duration.toFixed(2)}|${k.speed.toFixed(2)}|${k.count}`;

/**
 * Session cache.
 *
 * Module-level rather than stored on the clip: these are base64 data URLs, and
 * putting 24 of them in the saved project would multiply the file size for no
 * benefit - they re-derive in a fraction of a second on open.
 */
const cache = new Map<string, string[]>();
const inFlight = new Map<string, Promise<string[]>>();

/** Pull frames off the compositor's element for this clip. */
export async function extractFilmstrip(clip: TimelineClip): Promise<string[]> {
  const count = frameCount(clip.duration);
  const key = keyOf({
    clipId: clip.id,
    sourceIn: clip.sourceIn,
    duration: clip.duration,
    speed: clip.speed,
    count,
  });

  const hit = cache.get(key);
  if (hit) return hit;
  const running = inFlight.get(key);
  if (running) return running;

  const job = (async () => {
    const compositor = Compositor.getLive();
    if (!compositor) {
      // The preview has not mounted yet. Not an error: the strip is requested
      // from a lane, and lanes render before the canvas exists on a cold load.
      return [];
    }
    try {
      const frames = await compositor.captureFilmstrip(clip.id, count);
      cache.set(key, frames);
      return frames;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

/**
 * Subscribe a clip to its strip.
 *
 * The cache key encodes everything that changes the strip, so a trim produces a
 * DIFFERENT strip - which is correct, because a trimmed clip shows different
 * footage.
 */
export function useFilmstrip(clip: TimelineClip): string[] {
  const count = frameCount(clip.duration);
  const key = keyOf({
    clipId: clip.id,
    sourceIn: clip.sourceIn,
    duration: clip.duration,
    speed: clip.speed,
    count,
  });
  const [frames, setFrames] = useState<string[]>(() => cache.get(key) ?? []);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setFrames(hit);
      return;
    }
    setFrames([]);
    let alive = true;
    void extractFilmstrip(clip).then((result) => {
      if (alive) setFrames(result);
    });
    return () => {
      alive = false;
    };
    // `key` already encodes everything that changes the strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return frames;
}

/**
 * Diagnostic for the harness: is a strip cached, and is there a live
 * compositor to read from?
 *
 * "The clip shows no frames" has three causes that look identical on screen -
 * no live compositor, the element is not decodable, or the file has no
 * picture. This makes the answer a fact instead of a guess.
 */
export function filmstripReport() {
  return {
    cached: cache.size,
    // How many of those caches actually HOLD frames. A cache of empty arrays
    // means the decode failed, and counting entries alone would call that a
    // success - which is exactly the sort of green light that hides a fault.
    withFrames: [...cache.values()].filter((v) => v.length > 0).length,
    totalFrames: [...cache.values()].reduce((n, v) => n + v.length, 0),
    inFlight: inFlight.size,
    hasLiveCompositor: Boolean(Compositor.getLive()),
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __veStrip?: () => unknown }).__veStrip = filmstripReport;
}

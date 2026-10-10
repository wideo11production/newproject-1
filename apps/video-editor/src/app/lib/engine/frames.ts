// ============================================================================
// Frames
// ============================================================================
//
// A professional timeline counts in FRAMES. Not seconds, not milliseconds -
// frames, because a frame is the smallest unit of picture that exists and the
// only unit a viewer can be right or wrong about.
//
// ---- WHY SECONDS ARE NOT THE MODEL ----
//
// "2.0 seconds" is ambiguous at 30fps: 60 frames, or 2.033? And every edit
// that is done in seconds and then snapped to frames has a rounding error
// somewhere - usually at a boundary, which is exactly where a cut is made and
// exactly where an off-by-one frame is visible.
//
// So: **every timeline value in this app is an integer number of frames**, and
// seconds only appear where a media element demands them (`currentTime`,
// `playbackRate`, `decodeAudioData`). `secondsToFrame` and
// `frameToSeconds` are the two funnels, and they are used deliberately rather
// than by accident.
//
// ---- WHY THE FRAME RATE IS A PROJECT SETTING ----
//
// 24/25/30/50/60 all produce the same duration in seconds and different
// durations in frames. A 2 second clip is 48 frames at 24 and 120 at 60. If
// the rate were inferred per clip from the container, two clips of the same
// length would not be interchangeable on the timeline. So the project declares
// one rate, and the timecode tells the truth about it.

/**
 * Every rate the editor offers. Anything not listed is not supported.
 *
 * Hinglish: 120 aur 240 ISI list me hain (user decision) — AURA Micro-Frame
 * Studio ka high-frame-rate use case (120fps * 3s = 360 frames, 240fps *
 * 3s = 720 frames) bina alag AURA-only setting ke chalta hai. Fps project
 * setting hai: ruler, timecode, zoom, export aur AURA ring sab isi ek value
 * se chalte hain — isliye yahan badalna = sab jagah badalna.
 *
 * NOTE: high rates ka export cost 4x-8x frames hai. Micro-frame clips (3s
 * max) ke liye theek hai; poore lambe projects ko 240fps par export karna
 * slow hoga — wahi purani sachchai, naya number.
 */
export const SUPPORTED_FPS = [24, 25, 30, 50, 60, 120, 240] as const;
export type Fps = (typeof SUPPORTED_FPS)[number];

export const DEFAULT_FPS: Fps = 30;

/**
 * Playback speed dropdown ka shared list (user: "speed ke options bhi add
 * kardo" + micro-steps). Hinglish: 0.0001x se 4x tak — 0.0001x/0.001x/0.01x
 * micro-steps micro-frame analysis ke liye (frame-by-frame dekhna), baaki
 * standard editing speeds. Yahi ek list teeno toolbars + AURA studio use
 * karte hain, taaki consistency rahe.
 */
export const PLAYBACK_SPEEDS = [
  0.0001, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 4,
] as const;

/**
 * Speed ko display string me badalna. `toFixed(2)` 0.0001 ko "0.00x" bana
 * deta hai (galat!), isliye raw number + 'x': 0.0001x, 0.001x, 0.01x, 1x,
 * 1.25x. Hinglish: chhote numbers ko poora dikhao — micro-step ka poora
 * point hi hai.
 */
export function formatSpeed(rate: number): string {
  return `${rate}x`;
}

export function isFps(n: number): n is Fps {
  return (SUPPORTED_FPS as readonly number[]).includes(n);
}

/** Nearest supported rate. Used when a saved project declares something else. */
export function coerceFps(n: number): Fps {
  let best: Fps = DEFAULT_FPS;
  for (const f of SUPPORTED_FPS) {
    if (Math.abs(f - n) < Math.abs(best - n)) best = f;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/** Seconds to an integer frame. Rounds, and never goes below 0. */
export function secondsToFrame(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds * fps));
}

/** An integer frame to seconds. */
export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/** Clamp to an integer frame. */
export function toFrame(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Seconds, snapped to a whole frame at `fps`. */
export function snapToFrame(seconds: number, fps: number): number {
  return frameToSeconds(secondsToFrame(seconds, fps), fps);
}

/** Seconds, snapped to `fps` frames away - the same thing, said in frames. */
export function snapToFrameGrid(seconds: number, fps: number): number {
  return frameToSeconds(toFrame(secondsToFrame(seconds, fps)), fps);
}

// ---------------------------------------------------------------------------
// Timecode
// ---------------------------------------------------------------------------

/**
 * `HH:MM:SS:FF` - the non-drop standard, and what Resolve and Premiere show.
 *
 * Hours are included even though a browser session rarely reaches one: a
 * timecode that silently grows a digit at the hour boundary is a timecode that
 * is no longer fixed-width, and fixed width is the entire point. A readout has
 * to occupy the same pixels before and after a cut or the edit appears to move.
 */
export function frameToTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const ff = f % fps;
  const totalSeconds = Math.floor(f / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Seconds to `HH:MM:SS:FF`. */
export function timecode(seconds: number, fps: number): string {
  return frameToTimecode(secondsToFrame(seconds, fps), fps);
}

/**
 * The compact form, for the ruler where every tick needs a label.
 *
 * Drops the hours ONLY when they are zero, so the width is stable for any
 * timeline that fits in a session and still correct for a long one.
 */
export function timecodeCompact(frame: number, fps: number): string {
  const full = frameToTimecode(frame, fps);
  return full.startsWith('00:') ? full.slice(3) : full;
}

/** Seconds to the compact form. */
export function timecodeShort(seconds: number, fps: number): string {
  return timecodeCompact(secondsToFrame(seconds, fps), fps);
}

/** `M:SS` - for durations, where frames are noise. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `H:MM:SS` - for media file lengths in the bin, which have no timeline rate. */
export function mediaClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * The timeline's zoom unit is PIXELS PER FRAME.
 *
 * Not a multiplier on seconds-per-pixel. A multiplier is a number whose
 * meaning drifts with the frame rate: "4x zoom" is 480px per second at 30fps
 * and 960 at 60, so switching a project from 30 to 60 silently doubles the
 * zoom, and the frame rate control would double as a zoom control.
 *
 * Pixels per frame has an absolute meaning: at the top of the range a single
 * frame is `MIN_FRAME_PX` wide and therefore plainly visible, which is the
 * requirement "at maximum zoom every frame should be visible" stated as an
 * invariant rather than as a hope.
 */

/** One second at 30fps, which is where this started. 3px per frame. */
export const DEFAULT_PX_PER_FRAME = 3;

/** Where a frame becomes clearly visible. The top of the zoom range sits above
 *  this, so "single frame view" is a real stop and not the limit itself. */
export const MIN_FRAME_PX = 24;

/** The widest zoom: a whole long timeline on screen. */
export const MIN_PX_PER_FRAME = 0.05;

export function clampPxPerFrame(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_PX_PER_FRAME;
  return Math.max(MIN_PX_PER_FRAME, Math.min(64, v));
}

/** Zoom as a whole-number percentage, for the readout and for persistence. */
export function zoomPercent(pxPerFrame: number): number {
  return Math.round((pxPerFrame / DEFAULT_PX_PER_FRAME) * 100);
}

/** Inverse of `zoomPercent`. */
export function percentToPxPerFrame(percent: number): number {
  return clampPxPerFrame((percent / 100) * DEFAULT_PX_PER_FRAME);
}

/**
 * Re-express a zoom after the frame rate changes.
 *
 * The user asked for the timeline to look the same, in seconds. A project
 * switched from 30 to 60 must not silently double its apparent zoom, so the
 * pixels-per-frame value is scaled by the rate ratio: the same number of
 * SECONDS occupies the same number of pixels.
 */
export function rescalePxPerFrame(pxPerFrame: number, from: number, to: number): number {
  if (!from || !to || from === to) return clampPxPerFrame(pxPerFrame);
  return clampPxPerFrame((pxPerFrame * to) / from);
}

// ---------------------------------------------------------------------------
// Micro-frame editing (AURA Micro-Frame Studio)
// ---------------------------------------------------------------------------

/**
 * The pixel-per-frame floor for micro-frame editing.
 *
 * At this density a single frame is ~160px wide - enough to read a frame number,
 * place a single-frame overlay, and distinguish adjacent frames by eye. Movavi
 * uses the same principle: once a frame fills a thumb you stop zooming to "more"
 * and start zooming to "precise".
 */
export const MIN_FRAME_PX_MICRO = 160;

/** The pixel-per-frame ceiling: one frame fills the available viewport width. */
export const MAX_PX_PER_FRAME_MICRO = 320;

/**
 * Micro-frame zoom steps, in frames-per-label.
 *
 * 1f — single-frame visibility (AURA Micro-Frame Studio's 3-frame buffer ring)
 * 2f — two frames side by side
 * 3f — the exact width of the buffer ring on one screen
 */
export const MICRO_FRAME_INTERVALS = [1, 2, 3] as const;

/**
 * Clamp a pixel-per-frame value into the micro-frame editing range.
 *
 * The standard `clampPxPerFrame` goes up to 64 — enough for "every frame is
 * visible" at thumbnail size. Micro-frame editing needs 160+ so a frame is
 * unmistakably readable and selectable.
 */
export function clampPxPerFrameMicro(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return MIN_FRAME_PX_MICRO;
  return Math.max(MIN_FRAME_PX_MICRO, Math.min(MAX_PX_PER_FRAME_MICRO, v));
}

/**
 * Convert a millisecond timestamp to `HH:MM:MMM` format.
 *
 * This is the format the AURA Micro-Frame Studio scrubber uses: hours, minutes,
 * seconds, and milliseconds — three digits, zero-padded. Unlike timecode (which
 * is frame-based and rate-dependent), milliseconds are absolute and unambiguous
 * at any playback speed including 0.01x.
 */
export function msToTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00:000';
  const total = Math.round(ms);
  const hh = Math.floor(total / 3_600_000);
  const mm = Math.floor((total % 3_600_000) / 60_000);
  const ss = Math.floor((total % 60_000) / 1000);
  const mmm = total % 1000;
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(hh, 2)}:${p(mm, 2)}:${p(ss, 2)}:${p(mmm, 3)}`;
}

/**
 * Convert an `HH:MM:MMM` timestamp back to milliseconds.
 * The inverse of `msToTimestamp`.
 */
export function timestampToMs(ts: string): number {
  const parts = ts.split(':');
  if (parts.length !== 4) return 0;
  const [hh, mm, ss, mmm] = parts.map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return hh * 3_600_000 + mm * 60_000 + ss * 1000 + mmm;
}

// ============================================================================
// Timecode
// ============================================================================
//
// The timeline shows FRAMES, not seconds. That is a precision problem, not a
// display one: at 30fps a clip you think is 2.0s long is 60 frames, and every
// one of them is a real frame of picture you either keep or throw away.
//
// A seconds readout (`0:02`) is ambiguous - 2.000 or 2.033? Which is a
// quarter-frame out. Every NLE therefore shows `HH:MM:SS:FF` or
// `HH:MM:SS;FF` (the semicolon is the broadcast convention for drop-frame,
// the colon is non-drop). We use the colon form, which is what Premiere and
// Resolve show by default for non-broadcast work.
//
// ---- WHY FPS IS FIXED AT 30 HERE ----
//
// It is a constant, not a guess. Clip frame rates are per-source, and reading
// them properly means decoding the container. Until that exists, a single
// declared rate is honest; a rate that silently varies per clip would make the
// timecode lie.

/** Frames per second. Single source of truth for all frame maths. */
export const FPS = 30;

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

export function framesToSeconds(frames: number): number {
  return frames / FPS;
}

/**
 * Snap a time to the nearest frame boundary.
 *
 * Called on every seek, every trim and every clip placement. Without it the
 * playhead sits on fractional frames, and a cut made there produces a clip
 * that is 1 frame longer than the picture it was cut from.
 */
export function snapToFrame(seconds: number): number {
  return framesToSeconds(secondsToFrames(seconds));
}

/** `HH:MM:SS:FF` — the standard non-drop timecode. */
export function formatTimecode(seconds: number, fps = FPS): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalFrames = Math.round(seconds * fps);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/** `MM:SS:FF` — the compact form, for the footer where space is tight. */
export function formatTimecodeShort(seconds: number, fps = FPS): string {
  const full = formatTimecode(seconds, fps);
  return full.startsWith('00:') ? full.slice(3) : full;
}

/** `M:SS` — for durations, where sub-second precision is noise. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

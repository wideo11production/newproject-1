// ============================================================================
// Audio waveforms
// ============================================================================
//
// Decodes an audio or video file once and reduces it to a few hundred peak
// values, which is all a timeline lane can actually show. Decoding the whole
// file per repaint would be absurd, and drawing a decorative sine wave would
// be a lie - the shape on screen has to be the shape of the file.
//
// ---- WHY PEAKS AND NOT AN RMS CURVE ----
//
// A clip 400px wide can only show 400 vertical spans. One value per span, taken
// as the maximum absolute sample in that span, is what every DAW draws, and
// it is the only shape where a transient is visible at all. An RMS average
// smooths transients into invisibility, which is exactly the information you
// use a waveform to find.
//
// ---- WHY DECODING IS LAZY, DEDUPED AND TIME-BOXED ----
//
// * Lazy: nothing is decoded until an audio clip is on the timeline, so
//   importing twenty video files does not decode twenty of them.
// * Deduped by media id with a shared in-flight promise, so the same file used
//   on three clips decodes once.
// * Time-boxed: `decodeAudioData` on a file it cannot parse never resolves in
//   some browsers, and a lane that shows a spinner forever is worse than one
//   that shows a flat line.

const cache = new Map<string, number[] | null>();
const inFlight = new Map<string, Promise<number[] | null>>();

/** Buckets a clip is drawn into. A lane is never wider than ~2000px. */
export const PEAK_BUCKETS = 900;

let sharedCtx: AudioContext | null = null;

function context(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * Peak values for a media file, or null if it cannot be decoded.
 *
 * A null is a legitimate answer, not a failure: a browser cannot decode every
 * container it can play, and a video recorded by `MediaRecorder` is the common
 * case. Callers draw a flat line for null rather than pretending.
 */
export function extractPeaks(url: string, buckets = PEAK_BUCKETS): Promise<number[] | null> {
  const existing = cache.get(url);
  if (existing !== undefined) return Promise.resolve(existing);
  const running = inFlight.get(url);
  if (running) return running;

  const job = (async (): Promise<number[] | null> => {
    const ctx = context();
    if (!ctx) return null;
    try {
      const res = await fetch(url);
      const bytes = await res.arrayBuffer();
      const decoded = await Promise.race([
        ctx.decodeAudioData(bytes),
        new Promise<null>((r) => setTimeout(() => r(null), 12000)),
      ]);
      if (!decoded) return null;
      return reduce(decoded, buckets);
    } catch {
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, job);
  job.then((v) => cache.set(url, v));
  return job;
}

function reduce(buffer: AudioBuffer, buckets: number): number[] {
  // Downmix to mono first. Per-channel peaks would read the same amplitude for
  // the same signal spread over two channels and a stereo pad would look
  // quieter than it sounds.
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    const inv = 1 / buffer.numberOfChannels;
    for (let i = 0; i < len; i++) mono[i] *= inv;
  }

  const out = new Array<number>(buckets).fill(0);
  const per = len / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(len, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = mono[i] < 0 ? -mono[i] : mono[i];
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }

  // Normalise to the loudest bucket, so a quiet recording still shows a
  // readable shape. Clamped at 0.98 because a file that is only noise would
  // otherwise be drawn as a solid block.
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) {
    const g = Math.min(1 / max, 1 / 0.98);
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] * g);
  }
  return out;
}

// ============================================================================
// Silence removal  (local, free, no service)
// ============================================================================
//
// ---- WHY THIS IS NOT "AI", AND WHY THAT IS BETTER ----
//
// Silence removal does not need a model. It is a signal-processing problem with
// a well-known answer: measure short-window RMS, threshold it, find the runs
// below it, and drop them. Doing that in Web Audio is a few hundred lines of
// arithmetic and costs nothing.
//
// Every "AI silence removal" product that exists does one of two things: runs
// exactly this DSP, or runs a model server-side and bills you per minute. The
// first is what is implemented here. That is a deliberate choice given the
// constraint that this project pays nothing to anyone for it - and it means
// the feature works offline, with no key, no quota and no upload of the user's
// audio to a third party.
//
// Where a real model WOULD help is content-aware speech detection (telling a
// pause from a whispered word), and that is a later decision, not a silent
// dependency.
//
// ---- WHY THIS IS IN A SEPARATE MODULE ----
//
// It is pure maths over Float32Array with no React in it, so it can be tested
// directly and reasoned about without a DOM. The component that calls it only
// has to deal with progress and results.

export interface SilenceChunk {
  /** Seconds from the start of the source. */
  start: number;
  /** Seconds from the start of the source. */
  end: number;
}

export interface SilenceResult {
  /** Segments to KEEP, in order, covering [0, duration). */
  keep: SilenceChunk[];
  /** Seconds removed. */
  removedSeconds: number;
  /** Original duration. */
  originalSeconds: number;
  /** Peak sample value seen, useful for sanity checks. */
  peak: number;
}

export interface SilenceOptions {
  /**
   * RMS below which audio counts as silence, 0..1.
   *
   * -45 dBFS ≈ 0.0056. That is roughly where a decent mic's noise floor sits
   * in a quiet room, so anything under it is not speech. Raising it starts
   * eating quiet consonants; lowering it keeps room tone and achieves nothing.
   */
  threshold?: number;
  /**
   * Shortest run treated as silence, in seconds.
   *
   * 0.35s. Below that it is almost always the gap between words, and cutting
   * it makes speech sound clipped and unnaturally fast. Breath pauses are
   * usually 0.4-0.8s, so this keeps a little air in the sentence.
   */
  minSilence?: number;
  /** How long each analysis window is, in seconds. 0.02 = 20ms. */
  window?: number;
  /**
   * Keep this much silence at the very start and end.
   *
   * 0.08s. Trimming hard to the first sample sounds like a click and loses
   * the natural onset of the first word.
   */
  edgePad?: number;
}

const DEFAULTS: Required<SilenceOptions> = {
  threshold: 0.0056,
  minSilence: 0.35,
  window: 0.02,
  edgePad: 0.08,
};

export function findSilences(
  samples: Float32Array,
  sampleRate: number,
  opts: SilenceOptions = {}
): SilenceResult {
  const { threshold, minSilence, window, edgePad } = { ...DEFAULTS, ...opts };
  const totalSeconds = samples.length / sampleRate;

  if (totalSeconds === 0) {
    return { keep: [], removedSeconds: 0, originalSeconds: 0, peak: 0 };
  }

  const winSize = Math.max(1, Math.floor(sampleRate * window));
  const winCount = Math.floor(samples.length / winSize);

  // ---- Peak, for reporting and for a sanity check on the input ----
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }

  // ---- Per-window RMS ----
  // RMS rather than peak-per-window on purpose: a single transient (a lip
  // smack, a keyboard click) should not mark a whole 20ms window as speech.
  const loud = new Uint8Array(winCount);
  for (let w = 0; w < winCount; w++) {
    let sum = 0;
    const off = w * winSize;
    for (let i = 0; i < winSize; i++) {
      const v = samples[off + i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / winSize);
    loud[w] = rms >= threshold ? 1 : 0;
  }

  // ---- Runs of quiet windows ----
  const silences: SilenceChunk[] = [];
  let runStart = -1;
  for (let w = 0; w < winCount; w++) {
    if (!loud[w] && runStart === -1) runStart = w;
    if ((loud[w] || w === winCount - 1) && runStart !== -1) {
      const endW = loud[w] ? w : w + 1;
      const startSec = runStart * window;
      const endSec = endW * window;
      if (endSec - startSec >= minSilence) silences.push({ start: startSec, end: endSec });
      runStart = -1;
    }
  }

  // ---- Invert: silences -> keeps ----
  const keep: SilenceChunk[] = [];
  let cursor = 0;
  for (const s of silences) {
    const start = Math.max(cursor, s.start + (s.start === 0 ? edgePad : 0));
    const end = Math.min(s.end, totalSeconds);
    if (start > cursor + 0.01) keep.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < totalSeconds - 0.01) keep.push({ start: cursor, end: totalSeconds });

  const removed = totalSeconds - keep.reduce((n, k) => n + (k.end - k.start), 0);
  return { keep, removedSeconds: removed, originalSeconds: totalSeconds, peak };
}

/**
 * Decode an audio/video file to mono samples, entirely in the browser.
 *
 * `decodeAudioData` already handles every container the browser can play, and
 * mixing to mono via `OfflineAudioContext` is what the threshold maths expects
 * - a stereo file's per-channel RMS would read half the amplitude and make
 * everything look quiet.
 */
export async function decodeToMono(
  file: File | Blob,
  targetRate = 44100
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio is not available in this browser.');

  const arrayBuf = await file.arrayBuffer();

  // A throwaway context just to decode - no output device is ever opened.
  const decodeCtx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf);
  } finally {
    void decodeCtx.close();
  }

  if (decoded.sampleRate !== targetRate) {
    // Resample so the window maths and the reported times are in real seconds
    // regardless of the source's native rate (44.1k vs 48k is common and
    // would otherwise make every cut 9% early or late).
    const off = new OfflineAudioContext(1, Math.ceil((decoded.duration * targetRate)), targetRate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return { samples: rendered.getChannelData(0), sampleRate: targetRate };
  }

  // Downmix by averaging channels.
  if (decoded.numberOfChannels === 1) {
    return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
  }
  const ch0 = decoded.getChannelData(0);
  const ch1 = decoded.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  return { samples: mono, sampleRate: decoded.sampleRate };
}

/**
 * Slice a WAV blob to the kept regions and concatenate them.
 *
 * WAV rather than any codec: it is the only container you can write with
// zero dependencies and zero cost, and every browser can play it back. A
 * re-encode through the WebAudio encoder would need ffmpeg, which is a
 * server-side dependency this editor does not have.
 */
export function encodeWavFromRanges(
  samples: Float32Array,
  sampleRate: number,
  ranges: SilenceChunk[]
): Blob {
  const total = ranges.reduce((n, r) => n + Math.floor((r.end - r.start) * sampleRate), 0);
  const out = new Float32Array(Math.max(total, 1));

  let cursor = 0;
  for (const r of ranges) {
    const from = Math.floor(r.start * sampleRate);
    const to = Math.min(samples.length, Math.floor(r.end * sampleRate));
    const n = Math.max(0, to - from);
    out.set(samples.subarray(from, to), cursor);
    cursor += n;
  }

  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + out.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + out.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, out.length * bytesPerSample, true);

  let off = 44;
  for (let i = 0; i < out.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * One-shot helper: audio in, trimmed audio out.
 *
 * Returns the result metrics as well, because a user who asks "remove
 * silence" deserves to be told how much came out - 0% removed means the
 * threshold is wrong for this recording, and silence is a legitimate answer.
 */
export async function removeSilence(
  blob: Blob,
  opts: SilenceOptions = {}
): Promise<{ blob: Blob; result: SilenceResult }> {
  const { samples, sampleRate } = await decodeToMono(blob);
  const result = findSilences(samples, sampleRate, opts);
  if (result.keep.length === 0) {
    return { blob, result };
  }
  return { blob: encodeWavFromRanges(samples, sampleRate, result.keep), result };
}

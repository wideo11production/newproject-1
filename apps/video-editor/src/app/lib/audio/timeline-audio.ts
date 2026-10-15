// ============================================================================
// TIMELINE AUDIO — the whole project's audio, mixed, at one sample rate
// ============================================================================
//
// Auto-subtitles ka pehla step. Transcription ke liye hume ek continuous audio
// buffer chahiye jo TIMELINE ka exact audio ho — na sirf pehla clip, na sirf
// selected clip. Warna cues timeline pe galat jagah baithte.
//
// ---- KYUN "TIMELINE ACCURATE" ZAROORI HAI ----
//
// Ek project me 5 clips hain: 0-10s, 12-20s, 25-40s. Agar hum sirf pehle clip
// ko transcribe karein, to cues 12s aur 25s ke dialogue ke liye kabhi nahi
// banenge. Aur agar har clip ko alag transcribe karke uske apne timestamps
// copy kar dein, to `startTime` offset galat hoga.
//
// Isliye: SAB audio-bearing clips ko ek hi 16kHz buffer me MIX karte hain, unke
// timeline positions pe. Whisper ko ek hi continuous stream milta hai, aur uske
// returned timestamps seedha timeline seconds hain — koi remapping nahi.
//
// ---- WHY 16kHz ----
//
// Whisper ka input 16kHz mono f32 hai. Speech ki saari information 8kHz tak hai,
// to 16kHz se zyada lena sirf memory double karta hai bina kuch faayda diye.
//
// ---- REUSE, NOT REINVENT ----
//
// Decode + resample already `lib/audio/silence.ts` ke `decodeToMono()` me hai —
// wo `OfflineAudioContext` se kisi bhi rate pe mono mix kar deta hai. Yahan
// dobara decode logic nahi likhi, bas clips ko usme feed karte hain.

import { decodeToMono } from './silence';

/** Whisper ka native input rate. 16kHz mono f32. */
export const WHISPER_SAMPLE_RATE = 16000;

/**
 * Ek audio-bearing clip ka wo minimum jo mixing ke liye chahiye.
 *
 * Yeh `TimelineClip` ka subset hai — mixing ko baaki fields se koi lena-dena
 * nahi, isliye yeh alag rakha taaki yeh function clips store se independent
 * rahe aur test karna aasan ho.
 */
export interface TimelineAudioSource {
  /** Blob URL of the media. Same one the player uses. */
  url: string;
  /** Timeline seconds: clip kahan shuru hota hai. */
  startTime: number;
  /** Timeline seconds: clip ki lambai (already divided by speed). */
  duration: number;
  /** Seconds into the SOURCE media ki jahan se yeh clip padhta hai. */
  sourceIn: number;
  /** Playback rate. 1 = real time. */
  speed: number;
  /** 0..1 gain. */
  volume: number;
  muted: boolean;
}

export interface TimelineAudioResult {
  samples: Float32Array;
  sampleRate: number;
  /** Real seconds, = samples.length / sampleRate. */
  duration: number;
  /** Kitne clips actually mix hue. 0 = kahin audio nahi. */
  mixedClipCount: number;
  /** Kitne clips mix nahi ho paye (bad URL, decode fail). */
  failedClipCount: number;
}

export interface TimelineAudioOptions {
  sampleRate?: number;
  /**
   * Hard cap on the mixed length, in seconds.
   *
   * 20 minutes. 16kHz mono f32 = 64KB per second, to 20 min = 77MB. Usse zyada
   * ek browser tab ko RAM me le lena aur inference ko bhi slow karna, isliye
   * cap. Cap se pehle ka audio silently mix hota hai aur `truncated` batata hai.
   */
  maxSeconds?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

const DEFAULT_MAX_SECONDS = 20 * 60;

/**
 * Mix every audible clip into one continuous buffer at a single sample rate.
 *
 * Hinglish: overlapping clips ADDITIVE hain (sum, phir clamp) — bilkul jaise
 * Web Audio me do sources ek hi destination pe jate hain. Ye "last one wins"
 * se sahi hai: agar user ne music ko dialogue ke upar overlay kiya, to
 * transcribe ko dono sunne chahiye.
 */
export async function extractTimelineAudio(
  clips: TimelineAudioSource[],
  projectDuration: number,
  opts: TimelineAudioOptions = {}
): Promise<TimelineAudioResult & { truncated: boolean }> {
  const sampleRate = opts.sampleRate ?? WHISPER_SAMPLE_RATE;
  const maxSeconds = opts.maxSeconds ?? DEFAULT_MAX_SECONDS;

  // Sirf woh clips jo sach me sunai dete hain.
  const audible = clips
    .filter((c) => !c.muted && c.volume > 0 && c.url && c.duration > 0)
    .slice()
    // Pehle jaldi shuru hone wale, taaki progress predictable rahe.
    .sort((a, b) => a.startTime - b.startTime);

  const wantedSeconds = Math.max(0, projectDuration);
  const truncated = wantedSeconds > maxSeconds;
  const totalSeconds = Math.min(wantedSeconds, maxSeconds);
  const totalSamples = Math.ceil(totalSeconds * sampleRate);

  // Empty project: ek valid-but-silent buffer. Caller ko `mixedClipCount === 0`
  // se pata chal jayega ki kuch nahi mila.
  const out = new Float32Array(Math.max(1, totalSamples));

  let mixed = 0;
  let failed = 0;
  let done = 0;

  for (const clip of audible) {
    done += 1;
    opts.onProgress?.(done, audible.length, clip.url);

    // Timeline pe kitna hissa is clip ka andar aata hai (clip bhi truncate ho
    // sakta hai agar wo maxSeconds ke baad chala gaya).
    const tlStart = Math.max(0, clip.startTime);
    const tlEnd = Math.min(totalSeconds, clip.startTime + clip.duration);
    if (tlEnd <= tlStart) continue;

    let samples: Float32Array;
    let gotRate: number;
    try {
      const res = await fetch(clip.url);
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const decoded = await decodeToMono(await res.blob(), sampleRate);
      samples = decoded.samples;
      gotRate = decoded.sampleRate;
    } catch {
      // Ek kharab clip poori transcription ko nahi rokna chahiye. Baaki clips
      // se cues banenge, aur result me failed count se user ko pata chalega.
      failed += 1;
      continue;
    }

    // Rate mismatch hona nahi chahiye (decodeToMono ko humne target diya tha),
    // lekin agar ho to timestamps galat ho jayenge — isliye guard karke skip.
    if (gotRate !== sampleRate) {
      failed += 1;
      continue;
    }

    // Source window: clip ki timeline length = source length / speed.
    const srcSeconds = (tlEnd - tlStart) * clip.speed;
    let from = Math.floor(clip.sourceIn * sampleRate);
    let to = Math.floor((clip.sourceIn + srcSeconds) * sampleRate);
    from = Math.max(0, Math.min(from, samples.length));
    to = Math.max(from, Math.min(to, samples.length));

    const dstStart = Math.floor(tlStart * sampleRate);
    const dstEnd = Math.floor(tlEnd * sampleRate);
    const n = Math.min(to - from, dstEnd - dstStart);

    for (let i = 0; i < n; i++) {
      const dst = dstStart + i;
      if (dst >= out.length) break;
      out[dst] += samples[from + i] * clip.volume;
    }
    mixed += 1;
  }

  return {
    samples: out,
    sampleRate,
    duration: totalSeconds,
    mixedClipCount: mixed,
    failedClipCount: failed,
    truncated,
  };
}

/** Peak sample value, 0..1. Sanity check + "is there any audio at all" ke liye. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

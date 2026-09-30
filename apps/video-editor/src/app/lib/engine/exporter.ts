'use client';

// ============================================================================
// Export
// ============================================================================
//
// Renders the timeline to a video file by driving the SAME compositor the
// preview uses and recording its canvas.
//
// ---- WHY `MediaRecorder` AND NOT A SERVER ----
//
// The project's own notes call this out correctly: an encoder is a service,
// and half of one is worse than none. `MediaRecorder` on a canvas capture
// stream plus the Web Audio graph is a real encoder that ships in the
// browser, needs no upload, costs nothing, and produces a file that plays
// everywhere. The honest cost is that it is WEBM (VP8/VP9 + Opus) in
// Chromium, and that it is real-time: a 60 second timeline takes 60 seconds.
// The UI says both rather than hiding them behind a progress bar.
//
// ---- WHY IT IS REAL-TIME AND NOT FASTER ----
//
// A faster render would mean decoding every frame off-clock and seeking
// between them, which for these codecs is slower than playing, not faster,
// and desynchronises against the audio graph. Real-time is both simpler and,
// in this case, closer to the truth.
//
// ---- WHY THE AUDIO COMES FROM THE GRAPH AND NOT THE ELEMENTS ----
//
// `canvas.captureStream()` has no audio track. The graph's
// `MediaStreamAudioDestinationNode` is the only place the mix exists as a
// stream, which is the same reason the graph exists in the first place.

import { Compositor, type CompositorState } from './compositor';
import { allContexts, masterStream } from './audio-graph';
import type { ProjectSettings } from './types';

export interface ExportPreset {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate in kbps for the recorder. */
  videoKbps: number;
  audioKbps: number;
}

/** Presets every phone and platform actually wants. Sized, not guessed. */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube-1080p', label: 'YouTube 1080p', hint: '1920×1080 landscape, 30fps', width: 1920, height: 1080, fps: 30, videoKbps: 12000, audioKbps: 192 },
  { id: 'youtube-4k', label: 'YouTube 4K', hint: '3840×2160 landscape, 30fps', width: 3840, height: 2160, fps: 30, videoKbps: 45000, audioKbps: 192 },
  { id: 'youtube-720p', label: 'YouTube 720p', hint: '1280×720 landscape, 30fps', width: 1280, height: 720, fps: 30, videoKbps: 5000, audioKbps: 128 },
  { id: 'reels', label: 'Instagram Reels', hint: '1080×1920 vertical, 30fps', width: 1080, height: 1920, fps: 30, videoKbps: 9000, audioKbps: 192 },
  { id: 'tiktok', label: 'TikTok', hint: '1080×1920 vertical, 30fps', width: 1080, height: 1920, fps: 30, videoKbps: 9000, audioKbps: 192 },
  { id: 'shorts', label: 'YouTube Shorts', hint: '1080×1920 vertical, 30fps', width: 1080, height: 1920, fps: 30, videoKbps: 9000, audioKbps: 192 },
  { id: 'instagram-square', label: 'Instagram Post', hint: '1080×1080 square, 30fps', width: 1080, height: 1080, fps: 30, videoKbps: 8000, audioKbps: 128 },
  { id: 'facebook-landscape', label: 'Facebook', hint: '1280×720 landscape, 30fps', width: 1280, height: 720, fps: 30, videoKbps: 6000, audioKbps: 128 },
  { id: 'whatsapp-status', label: 'WhatsApp Status', hint: '720×1280 vertical, 24fps', width: 720, height: 1280, fps: 24, videoKbps: 4000, audioKbps: 128 },
  { id: 'twitter', label: 'X / Twitter', hint: '1280×720 landscape, 30fps', width: 1280, height: 720, fps: 30, videoKbps: 5000, audioKbps: 128 },
  { id: 'draft-540', label: 'Draft (fast)', hint: '960×540, encodes roughly twice as fast', width: 960, height: 540, fps: 30, videoKbps: 2500, audioKbps: 96 },
  { id: 'project', label: 'Match project', hint: 'Use the resolution and frame rate set in project settings', width: 0, height: 0, fps: 0, videoKbps: 8000, audioKbps: 128 },
];

/** Every container this browser will actually produce, not a wish list. */
export function supportedMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
    'video/mp4',
  ];
  return candidates.filter((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

export function bestMimeType(): string | null {
  return supportedMimeTypes()[0] ?? null;
}

export interface ExportOptions {
  state: CompositorState;
  settings: ProjectSettings;
  preset: ExportPreset;
  startTime: number;
  endTime: number;
  /** 0..15, the recorder's quality dial. */
  quality: number;
  onProgress?: (fraction: number, phase: string) => void;
  signal?: { aborted: boolean };
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  seconds: number;
  /** True when the browser produced no audio track (no clips with sound). */
  silent: boolean;
}

/**
 * Render `state` from `startTime` to `endTime` and return the encoded file.
 *
 * The compositor here is a SECOND instance with its own canvas, deliberately:
 * recording must not fight the preview for the same backing store, and the
 * preview has to keep playing while a render runs.
 */
export async function renderToFile(opts: ExportOptions): Promise<ExportResult> {
  const { state, preset, startTime, endTime, quality, onProgress, signal } = opts;
  const width = preset.width || opts.settings.width;
  const height = preset.height || opts.settings.height;
  const fps = preset.fps || opts.settings.fps;
  const seconds = Math.max(0.1, endTime - startTime);

  onProgress?.(0, 'Preparing');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const compositor = new Compositor(canvas);
  compositor.resize(width, height);
  compositor.update(state);

  // Seed the graph before recording, so a clip that is already "playing" when
  // the recorder attaches is routed into the stream rather than started
  // afterwards. The graph is per-compositor's elements, so a short warm-up
  // render at t0 gets the decoders going.
  compositor.renderFrame(startTime, false);
  await waitFor(120);

  const stream = canvas.captureStream(fps);

  // Audio: the same Web Audio graph the preview mixes through. `allContexts`
  // is the module's own list of contexts it created - the compositor's warm-up
  // render above has already made at least one, so the mix that the preview is
  // already hearing is the mix that gets recorded.
  let silent = true;
  for (const track of state.tracks) {
    if (track.type === 'text') continue;
    for (const clip of track.clips) {
      if (state.sources.get(clip.mediaId)?.url) {
        silent = false;
        break;
      }
    }
    if (!silent) break;
  }
  if (!silent) {
    const ctx = allContexts()[allContexts().length - 1];
    const audio = ctx ? masterStream(ctx) : null;
    if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track);
  }

  const mime = bestMimeType();
  if (!mime) {
    compositor.dispose();
    throw new Error('This browser has no MediaRecorder support, so there is no encoder to render with');
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: preset.videoKbps * 1000,
    audioBitsPerSecond: preset.audioKbps * 1000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  recorder.start(200);
  onProgress?.(0.02, 'Rendering');

  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const elapsed = (performance.now() - t0) / 1000;
      const t = startTime + Math.min(elapsed, seconds);
      compositor.renderFrame(t, true);
      onProgress?.(0.02 + Math.min(elapsed / seconds, 1) * 0.96, `Rendering ${elapsed.toFixed(1)}s / ${seconds.toFixed(1)}s`);
      if (elapsed >= seconds) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Hold the last frame for one tick so the encoder flushes it. A recorder
  // stopped on the same tick as the final draw drops that frame, and a render
  // that is short by one frame looks like a bad export rather than a race.
  await waitFor(120);
  recorder.stop();
  const blob = await done;
  onProgress?.(1, 'Done');

  for (const track of stream.getTracks()) track.stop();
  compositor.dispose();

  return { blob, mimeType: mime, width, height, seconds, silent: silent || stream.getAudioTracks().length === 0 };
}

const waitFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.webm') ? filename : `${filename}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not immediately: Safari cancels the download
  // if the URL disappears in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

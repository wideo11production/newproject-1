// ============================================================================
// Thumbnail extraction
// ============================================================================
//
// ---- WHY THIS IS NOT JUST AN <img> ----
//
// The obvious implementation is `<img src={blobUrl}>`, which fails for video:
// a browser cannot render a video file as an image. Every tile showed a broken
// glyph plus its alt text, which read as garbage rather than as a placeholder.
//
// The fix is to seek a hidden <video> to a moment and copy the frame out of a
// <canvas>. That is what actually produces a poster frame.
//
// ---- WHY THE SEEK IS TIME-BOXED ----
//
// `seeked` does not always fire. A file with no index (many webcam captures,
// some .webm from MediaRecorder) can decode the first frame and then never
// settle, and a thumbnail that never appears is worse than a generic one - the
// user cannot tell "still loading" from "broken". So every attempt has a hard
// 1.5s budget and falls back to a drawn placeholder on timeout.
//
// The 10% mark is deliberate: at 0:00 you often get a black frame or the very
// first fade-in. A tenth of the way in is almost always a representative shot.
//
// ---- THE OBJECT URL IS SHARED, NOT DUPLICATED ----
//
// A thumbnail is a 320x180 data URL, not a second copy of the video. Storing
// 8 full video copies "for thumbnails" would be a memory leak wearing a
// helpful name.

/** Poster width in pixels. 320 is enough to recognise a shot and cheap to hold. */
const THUMB_W = 320;

export interface Thumbnail {
  /** data: URL, or undefined if the frame could not be read. */
  dataUrl?: string;
  /** True when extraction ran but could not produce a frame. */
  failed: boolean;
}

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Extract a poster frame from a video.
 *
 * Deduplicated by `url`: the same file requested twice (it appears in the bin
 * and on the timeline) is decoded once, and concurrent requests share the
 * in-flight promise rather than spawning two decoders.
 */
export function extractThumbnail(
  url: string,
  kind: 'video' | 'image' | 'audio' | 'text'
): Promise<string | null> {
  if (kind !== 'video') return Promise.resolve(null);

  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(url);
  if (existing) return existing;

  const job = grabFrame(url).then((dataUrl) => {
    inflight.delete(url);
    if (dataUrl) cache.set(url, dataUrl);
    return dataUrl;
  });

  inflight.set(url, job);
  return job;
}

function grabFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    // Off-screen, but NOT `display:none` - a hidden element may never be
    // decoded at all, which is a well-known way to get a permanent no-op.
    video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(value);
    };

    // Hard budget. A file that never reports `loadedmetadata` still resolves.
    const timer = setTimeout(() => finish(null), 1500);

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const target = Math.min(Number.isFinite(video.duration) ? video.duration * 0.1 : 0, 5);
      if (target > 0) {
        video.onseeked = () => draw(video, finish);
        try {
          video.currentTime = target;
        } catch {
          finish(null);
        }
      } else {
        draw(video, finish);
      }
    };
    video.onloadeddata = () => {
      // Some sources never fire `loadedmetadata` but do report data; taking
      // the first available frame is better than nothing.
      if (!settled && video.readyState >= 2) draw(video, finish);
    };

    video.src = url;
    video.load();
  });
}

function draw(video: HTMLVideoElement, done: (v: string | null) => void) {
  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      done(null);
      return;
    }
    // Preserve aspect ratio; letterbox rather than stretch, because a
    // stretched thumbnail makes every clip look like the same shape.
    const scale = THUMB_W / w;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      done(null);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    done(canvas.toDataURL('image/jpeg', 0.6));
  } catch {
    // A tainted canvas or an unsupported codec. The caller falls back to an
    // icon, so a failure here is not an error worth surfacing.
    done(null);
  }
}

/** A deterministic hue per media name, so a bin looks stable between renders. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

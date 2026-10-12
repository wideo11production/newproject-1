'use client';

/**
 * PREVIEW VIDEO - plays an HLS playlist inside a thumbnail, cheaply.
 *
 * =============================================================================
 * WHY THIS IS NOT JUST A <video src>
 * =============================================================================
 *
 * The platform encodes to HLS and writes NO progressive MP4. A `<video>` element
 * can play an `.m3u8` in Safari and on iOS, and in nothing else - so a preview
 * built on a plain `<video src>` works on one browser and shows a black frame
 * everywhere else, which is exactly the kind of bug that ships because it looked
 * fine on the machine it was written on.
 *
 * So this uses hls.js when the browser has no native HLS, and falls back to the
 * native path when it does. The caller does not have to know which.
 *
 * =============================================================================
 * WHY THE INSTANCE IS OWNED BY LIFETIME
 * =============================================================================
 *
 * hls.js holds a MediaSource, a buffer, and (optionally) a worker. A grid that
 * mounts one of these per card and never destroys them leaks all three, and 20
 * hovered thumbnails is 20 live decoders - the browser's own limits throttle it
 * long before the memory does.
 *
 * So the instance is created in an effect keyed on the src and destroyed in its
 * cleanup. "Unmount" and "stop" are the same event, which is the only shape that
 * cannot leak.
 *
 * =============================================================================
 * WHY IT IS CONFIGURED FOR CHEAP
 * =============================================================================
 *
 * This is a silent, muted, looping, thumbnail-sized preview. Nothing about it
 * wants a long buffer or a worker:
 *
 *   enableWorker: false  - a worker per hover is a thread per thumbnail, and
 *                          parsing one m3u8 plus three segments does not need
 *                          one.
 *   maxBufferLength: 4   - seconds, not the default 30. A preview that lags 30
 *                          seconds behind the pointer is a preview nobody sees.
 *   lowLatencyMode: true - fewer round trips before the first frame, which is
 *                          what makes a hover feel immediate.
 */

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

interface PreviewVideoProps {
  /** The resolved playlist URL (or any URL the browser can play natively). */
  src: string;
  /** Called when the preview cannot be played at all. */
  onError?: () => void;
  className?: string;
}

export function PreviewVideo({ src, onError, className = '' }: PreviewVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;

    let hls: Hls | null = null;
    let disposed = false;

    // Native HLS (Safari, iOS). No instance to build or destroy.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      video.play().catch(() => {
        // A refusal to autoplay is not an error worth surfacing on a thumbnail.
      });
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        maxBufferLength: 4,
        lowLatencyMode: true,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed) return;
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (disposed || !data.fatal) return;
        // A preview that cannot load is silently abandoned: the poster is
        // already on screen and is the correct state.
        onError?.();
      });
    } else {
      onError?.();
    }

    return () => {
      disposed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      // Dropped as well as destroyed: a detached element with a live src keeps
      // its MediaSource alive in some engines.
      video.removeAttribute('src');
      video.load();
    };
  }, [src, onError]);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="auto"
      autoPlay
      aria-hidden="true"
      className={className}
    />
  );
}

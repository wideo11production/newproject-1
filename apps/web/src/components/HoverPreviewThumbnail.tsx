'use client';

/**
 * HOVER PREVIEW THUMBNAIL - a thumbnail that plays a silent preview on hover.
 *
 * =============================================================================
 * THE BEHAVIOUR, EXACTLY
 * =============================================================================
 *
 * Hover  -> a muted <video> fades in over the poster and starts playing.
 * Leave  -> playback stops, the video layer is hidden, the poster returns.
 *
 * "Immediately" matters. The naive implementation leaves the video element
 * mounted and just changes opacity, which means a preview that was mid-play
 * keeps buffering and keeps its audio element alive after the pointer is gone.
 * This component pauses, resets `currentTime` to 0, and toggles a `previewing`
 * flag - so leaving a card costs nothing and returning to it restarts from the
 * beginning, which is what a preview is for.
 *
 * =============================================================================
 * WHY A <video> AND NOT A CANVAS / GIF SPRITE
 * =============================================================================
 *
 * The asset already has encoded renditions in the bucket. Re-encoding them into
 * a sprite sheet would be a second transcode per asset for a hover effect.
 * A muted looping <video> plays the existing 480p rendition, which costs one
 * extra request on hover and nothing at rest.
 *
 * =============================================================================
 * THE ONE HONEST LIMITATION
 * =============================================================================
 *
 * A browser allows a bounded number of concurrent MEDIA SESSIONS, and a grid that
 * held one per card would hit that ceiling and stall. So the preview element is
 * mounted ONLY while a card is being hovered - an idle card holds no <video>, no
 * hls.js instance and no MediaSource at all. One hover, one session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Music, Film, Video as VideoIcon } from 'lucide-react';
import { PreviewVideo } from './PreviewVideo';
import { formatDuration } from '@/lib/media-upload';

type MediaKind = 'video' | 'reel' | 'audio';

interface HoverPreviewThumbnailProps {
  id: string;
  kind: MediaKind;
  filename: string;
  posterUrl?: string | null;
  /** Playable preview URL. The LOWEST-quality rendition, resolved by the caller. */
  previewUrl?: string | null;
  durationSeconds?: number;
  /** Fallback shown when there is no poster at all. */
  aspect?: '16:9' | '9:16' | '1:1' | 'short-reel' | 'long-reel' | 'fill';
  className?: string;
  /** Starts the preview immediately. Set by the parent for touch devices. */
  previewOnMount?: boolean;
  onPlayClick?: () => void;
  onOpen?: () => void;
  onHoverChange?: (hovering: boolean) => void;
  badge?: React.ReactNode;
  /**
   * Whether to render this component's own caption under the frame.
   *
   * True by default, because a bare thumbnail with no title is useless. Some
   * callers embed this inside a card that already has a caption of its own, and
   * rendering both shows the filename twice - so they pass `false`.
   */
  showCaption?: boolean;
}

const ASPECT_CLASS: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
  // A SHORT reel is compact, ~1.6:1. Neither a normal video's 16:9 nor a
  // portrait reel's 9:16 - it sits between, which is the whole point: a 15-second
  // clip stretched to 16:9 looks like a cropped video, and at 9:16 like a phone
  // recording.
  'short-reel': 'aspect-[8/5]',
  // A LONG reel is an extreme letterbox, ~4:1. The schematic diagram draws it
  // 23.2 x 4.5, which is nearly five times wider than tall. Rendering it at
  // 16:9 puts black bars top and bottom over a third of the card.
  'long-reel': 'aspect-[4/1]',
  // 'fill' deliberately has NO class. A caller that sizes its own box passes this
  // so the inner frame does not compute a height of its own and fight the
  // container's.
  //
  // That fight is what broke the list view: the row gave the thumbnail a fixed
  // `h-11 w-[72px]`, and the frame inside still derived `height = width * 9/16`,
  // so the two disagreed, the frame overflowed, and `overflow-hidden` clipped it.
  // The visible result was a thumbnail that looked wrong and a row whose height came
  // from a number nobody had chosen.
  fill: '',
};

function kindIcon(kind: MediaKind) {
  if (kind === 'reel') return <Film className="h-4 w-4" />;
  if (kind === 'audio') return <Music className="h-4 w-4" />;
  return <VideoIcon className="h-4 w-4" />;
}

export function HoverPreviewThumbnail({
  id,
  kind,
  filename,
  posterUrl,
  previewUrl,
  durationSeconds = 0,
  aspect,
  className = '',
  previewOnMount = false,
  onPlayClick,
  onOpen,
  onHoverChange,
  badge,
  showCaption = true,
}: HoverPreviewThumbnailProps) {
  const [hovering, setHovering] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  // The poster's own failure, tracked separately from the preview's.
  //
  // A poster that 404s must not leave a broken-image icon: the component falls back
  // to the kind icon, which is what an unplayable row should look like. Without
  // this, one missing file produces a grey tile with a torn image in it, which
  // looks like a bug rather than like an absent thumbnail.
  const [posterFailed, setPosterFailed] = useState(false);
  // A narrowed local, so the `src` below is `string` rather than
  // `string | null | undefined`.
  //
  // Deriving the flag with `Boolean(posterUrl)` does NOT narrow it - TypeScript
  // does not track a boolean back to the expression that produced it, so the img
  // would still need `string | null | undefined` and the build fails on it.
  const poster = posterFailed ? null : posterUrl ?? null;
  const showPoster = poster !== null;

  const aspectClass = ASPECT_CLASS[aspect ?? (kind === 'reel' ? '9:16' : kind === 'audio' ? '1:1' : '16:9')];

  const canPreview = Boolean(previewUrl) && !previewFailed;

  // ---- stop ----
  //
  // The preview element is UNMOUNTED rather than paused. `PreviewVideo` destroys
  // its hls.js instance and drops `src` in its own cleanup, so "stop" and
  // "unmount" are the same event - and that is the only shape that cannot leak a
  // MediaSource per hovered thumbnail.
  const stopPreview = useCallback(() => {
    setPreviewing(false);
  }, []);

  // ---- start ----
  const startPreview = useCallback(() => {
    if (!canPreview) return;
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovering(true);
    onHoverChange?.(true);
    setPreviewing(true);
  }, [canPreview, onHoverChange]);

  // ---- pointer handlers ----
  //
  // The enter delay is 120ms: fast sweeps across a grid should not each fire a
  // network request, and 120ms is short enough to feel immediate.
  const handleEnter = () => {
    if (!canPreview) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(startPreview, 120);
  };

  const handleLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovering(false);
    onHoverChange?.(false);
    stopPreview();
  };

  // Unmount cleanup - a card removed mid-preview must release its timer, or a
  // phantom timeout fires against a component that no longer exists.
  //
  // The preview element itself needs nothing: `PreviewVideo` destroys its hls.js
  // instance and drops `src` in its own cleanup, and unmounting the card
  // unmounts it.
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    []
  );

  // Touch / click-to-preview for devices with no hover.
  useEffect(() => {
    if (!previewOnMount) return;
    const t = window.setTimeout(startPreview, 60);
    return () => window.clearTimeout(t);
  }, [previewOnMount, startPreview]);

  const handleClick = (e: React.MouseEvent) => {
    // The play button is the inline player, everything else opens the page.
    if ((e.target as HTMLElement).closest('[data-hover-play]')) {
      e.stopPropagation();
      onPlayClick?.();
      return;
    }
    onOpen?.();
  };

  const handlePreviewError = () => {
    setPreviewFailed(true);
    stopPreview();
  };

  return (
    <article
      className={`group relative cursor-pointer overflow-hidden rounded-md bg-[#16181d] transition-colors hover:bg-[#1f2227] ${className}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      data-asset-id={id}
      aria-label={filename}
    >
      {/* The frame. `aspect-video` sets its height from its width; `fill` holds
          none, so the parent's box wins and the frame is absolutely positioned to
          it instead. */}
      <div className={aspectClass ? `relative w-full ${aspectClass}` : 'absolute inset-0'}>
        {/* poster */}
        {showPoster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster ?? ''}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPosterFailed(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-all duration-300 ${
              previewing ? 'scale-105 opacity-0' : 'scale-100 opacity-100'
            }`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f11] text-[#4a5055]">
            {kindIcon(kind)}
          </div>
        )}

        {/* preview layer - only mounted while previewing, so an idle card holds
            no <video> element and no media resource at all

            `PreviewVideo` rather than a plain `<video src>`: the platform encodes
            to HLS only, and an `.m3u8` plays natively in Safari and nowhere else.
            A preview built the naive way works on one browser and shows a black
            frame everywhere else. */}
        {previewing && previewUrl ? (
          <PreviewVideo
            src={previewUrl}
            onError={handlePreviewError}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              previewing ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : null}

        {/* duration */}
        {durationSeconds > 0 ? (
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[10px] text-white">
            {formatDuration(durationSeconds)}
          </span>
        ) : null}

        {badge ? <div className="absolute left-2 top-2 z-10">{badge}</div> : null}

        {/* hover overlay */}
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-opacity duration-200 ${
            hovering ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            type="button"
            data-hover-play=""
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#0d0f11] shadow-lg transition-transform duration-150 hover:scale-110"
            aria-label={`Play ${filename}`}
            title="Play here"
          >
            <Play className="ml-0.5 h-4 w-4" />
          </button>
        </div>

        {/* kind chip - hidden while previewing so the frame is clean video */}
        <span
          className={`pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] capitalize text-gray-300 transition-opacity ${
            previewing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {kind}
        </span>
      </div>

      {/* caption */}
      {showCaption ? (
        <div className="p-2">
          <p className="truncate text-xs font-medium text-white" title={filename}>
            {filename}
          </p>
        </div>
      ) : null}
    </article>
  );
}

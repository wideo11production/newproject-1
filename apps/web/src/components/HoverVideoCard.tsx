'use client';

/**
 * HOVER VIDEO CARD - Borderless, hover-to-play media player card.
 *
 * =============================================================================
 * YE KYA HAI
 * =============================================================================
 *
 * Ek borderless card jo hover karne par video play karta hai. Hover hatane par
 * pause ho jata hai. Borderless design: koi border nahi, sirf background color
 * se separation. Colors: existing dark theme (#0d0f11, #16181d, #2c3235) +
 * orange-red accent (#ff6500).
 *
 * =============================================================================
 * MEDIA PLAYER
 * =============================================================================
 *
 * hls.js se HLS stream play karta hai. Poster image dikhta hai jab paused.
 * Hover karne par video play hota hai, hover hatane par pause + seek to 0.
 * Har card ka apna independent <video> element + hls.js instance.
 *
 * =============================================================================
 * USAGE
 * =============================================================================
 *
 * <HoverVideoCard
 *   src={asset.hls_url}
 *   poster={asset.poster_public_url}
 *   title={asset.filename}
 *   duration={asset.duration_seconds}
 *   aspect="16:9"  // ya "9:16" reels ke liye
 *   onClick={() => router.push(`/watch/${asset.id}`)}
 * />
 */

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface HoverVideoCardProps {
  /** HLS playlist URL (m3u8) */
  src: string;
  /** Poster image URL */
  poster?: string;
  /** Title shown below card */
  title?: string;
  /** Duration in seconds */
  duration?: number;
  /** Aspect ratio: '16:9' | '9:16' | '1:1' */
  aspect?: '16:9' | '9:16' | '1:1';
  /** Click handler (opens video page) */
  onClick?: () => void;
  /** Optional edit link (Wideocut Pro) */
  editHref?: string;
  /** Optional delete handler */
  onDelete?: () => void;
  /** Show delete button (only on upload page) */
  showDelete?: boolean;
  /** Is this a Reel (9:16) */
  isReel?: boolean;
  /** Unique key for the card */
  key?: string;
}

const ASPECT_RATIOS = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
};

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export { formatDuration };

export function HoverVideoCard({
  src,
  poster,
  title,
  duration,
  aspect = '16:9',
  onClick,
  editHref,
  onDelete,
  showDelete = false,
  isReel = false,
}: HoverVideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize HLS on mount
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || Hls.isSupported() === false) return;

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Video ready, but we wait for hover to play
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        setError('Video load failed');
        hls.destroy();
      }
    });

    hlsRef.current = hls;

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  const play = () => {
    const video = videoRef.current;
    if (video) {
      video.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const pause = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
      setIsPlaying(false);
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    setShowControls(true);
    play();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    pause();
    // Hide controls after a short delay
    setTimeout(() => setShowControls(false), 300);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking delete or edit buttons
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a')) {
      return;
    }
    onClick?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm('Delete this upload? This cannot be undone.')) {
      onDelete?.();
    }
  };

  const aspectClass = ASPECT_RATIOS[aspect] || ASPECT_RATIOS['16:9'];

  return (
    <article
      className={`relative group cursor-pointer rounded-md overflow-hidden bg-[#16181d] transition-colors hover:bg-[#1f2227] ${aspectClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Video Player */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        preload="metadata"
        poster={poster}
      />

      {/* Poster fallback */}
      {poster && !isPlaying && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#16181d] p-4">
          <p className="text-xs text-red-400 text-center">{error}</p>
        </div>
      )}

      {/* Hover overlay with play/pause */}
      <div
        className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
          isHovered || isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            isPlaying ? pause() : play();
          }}
          className="rounded-full bg-white/90 p-3 text-[#0d0f11] transition-transform hover:scale-110"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-1" />
          )}
        </button>
      </div>

      {/* Controls on hover */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-300">
              {title && <span className="truncate max-w-[120px]">{title}</span>}
              {duration && <span className="text-gray-500">{formatDuration(duration)}</span>}
            </div>
            <div className="flex items-center gap-1">
              {editHref && (
                <a
                  href={editHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#ff6500]/90 text-white text-[11px] font-medium hover:bg-[#ff6500] transition-colors"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Edit in Wideocut Pro
                </a>
              )}
              {showDelete && (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-red-600/90 text-white text-[11px] font-medium hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
'use client';

/**
 * INLINE MEDIA PLAYER - an in-flow player that splits a media section 50/50.
 *
 * =============================================================================
 * SHAPE, AND WHY IT IS NOT A DRAWER
 * =============================================================================
 *
 * An earlier version of this was a fixed panel docked to the right edge. It
 * covered the page it was meant to play inside of, which made sense only when the
 * page had nothing else worth seeing.
 *
 * So this is an ordinary BLOCK element. A page that has media to browse puts the
 * grid on one side and this on the other, and the split is the page's layout
 * doing what layout does - no overlay, no z-index, nothing to click away.
 *
 * The consequences that matter:
 *
 *   - The grid is never covered, so the viewer keeps their scroll position and
 *     can click the next card without dismissing anything first.
 *   - Closing the player RESTORES the grid to full width, rather than revealing
 *     what was behind a panel all along.
 *   - It inherits the page's own container, so it cannot end up wider than its
 *     surroundings.
 *
 * =============================================================================
 * PLAYBACK SOURCE
 * =============================================================================
 *
 * hls.js when the browser lacks native HLS (everything but Safari), native
 * `<video src>` when it has it. The URL is resolved by the caller, which owns the
 * policy of who may watch what - this component plays what it is given and does
 * not decide that.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  X,
  Loader2,
  Music,
  AlertCircle,
  Check,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Download,
} from 'lucide-react';
import { formatDuration } from '@/lib/media-upload';

import {
  grafanaPrimary,
  productAccent,
  productAccentBg,
  productAccentControl,
  productPanel,
  productPanelHover,
  productSeparation,
  productSeparationStrong,
  productSunken,
  productTextMuted,
} from '@wideo11/ui/design-system';

export interface InlinePlayerAsset {
  id: string;
  filename: string;
  kind: 'video' | 'reel' | 'audio';
  duration_seconds?: number;
  width?: number;
  height?: number;
  /** Resolved, playable HLS playlist URL. Empty for non-playable assets. */
  hls_url?: string | null;
  /** Resolved poster URL for the poster layer. */
  poster_url?: string | null;
  /** Secondary line under the title - channel name, size, etc. */
  subtitle?: string | null;
  /** Deep link, for the "open full page" affordance. */
  watch_href?: string;
}

interface InlinePlayerProps {
  asset: InlinePlayerAsset | null;
  onClose: () => void;
  /** Walks the ordered playlist the page handed the provider. */
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

type QualityOption = { label: string; level: number };

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function InlinePlayer({
  asset,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
}: InlinePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playError, setPlayError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState('auto');
  const [levels, setLevels] = useState<QualityOption[]>([]);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const isAudio = asset?.kind === 'audio';
  const src = asset?.hls_url ?? '';

  // ---- per-asset reset ----
  //
  // Everything that belongs to a clip is cleared when the asset changes, so
  // swapping to the next card does not carry the previous clip's position,
  // quality choice or volume into it. Deliberately keyed on the IDENTITY of the
  // asset rather than on the object: a parent re-render that rebuilds the same
  // asset must not restart playback.
  useEffect(() => {
    if (!asset) return;
    setLoading(true);
    setPlayError(null);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setIsPlaying(false);
    setQuality('auto');
    setLevels([]);
    setShowSpeedMenu(false);
    setShowQualityMenu(false);
    // Autoplay is only ever attempted muted; a browser that refuses still leaves
    // a usable player with a poster and a play button.
    setIsMuted(true);
  }, [asset?.id]);

  // ---- hls.js attach ----
  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video || !asset) return;

    let cancelled = false;

    const onError = (msg: string) => {
      if (cancelled) return;
      setPlayError(msg);
      setLoading(false);
    };

    video.addEventListener('timeupdate', () => setCurrentTime(video.currentTime));
    video.addEventListener('durationchange', () => setDuration(video.duration || 0));
    video.addEventListener('progress', () => {
      try {
        if (video.buffered.length > 0) {
          setBuffered(video.buffered.end(video.buffered.length - 1));
        }
      } catch {
        /* buffered ranges can be empty mid-seek; not worth surfacing */
      }
    });

    // Native HLS (Safari, iOS). No hls.js instance to build or destroy.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      setLoading(false);
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setLevels(
          hls.levels.map((lvl, idx) => ({
            label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}kbps`,
            level: idx,
          }))
        );
        setLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const lvl = hls.levels[data.level];
        if (lvl?.height) setQuality(`${lvl.height}p`);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        // One recovery attempt, then give up: a second failure of the same
        // category means the playlist really is unavailable, and retrying
        // forever would spin the CPU while the UI shows a spinner.
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
            hls.startLoad();
          } else {
            hls.loadSource(src);
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          onError('This video could not be played.');
          hls.destroy();
        }
      });
    } else {
      onError('This browser cannot play HLS video.');
    }

    // Fullscreen fires on the element and the browser owns it, so it is tracked
    // from the document rather than from the click handler.
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === video || document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);

    return () => {
      cancelled = true;
      video.removeEventListener('timeupdate', () => {});
      document.removeEventListener('fullscreenchange', onFs);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [asset, src]);

  // Escape closes, so the keyboard and the button agree.
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset, onClose]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    // Unmuting on a viewer who has deliberately muted is jarring, so restoring
    // volume goes to a sane level rather than forcing zero.
    if (!video.muted && video.volume === 0) {
      video.volume = 0.5;
      setVolume(0.5);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current.requestFullscreen();
    } catch {
      /* fullscreen can be refused by permissions policy; the button stays useful */
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  }, []);

  const toggleLike = useCallback(() => {
    if (liked) {
      setLikes((l) => Math.max(0, l - 1));
      setLiked(false);
    } else {
      setLikes((l) => l + 1);
      setLiked(true);
      setDisliked(false);
    }
  }, [liked, disliked]);

  const toggleDislike = useCallback(() => {
    if (disliked) {
      setDisliked(false);
    } else {
      setDisliked(true);
      if (liked) {
        setLikes((l) => Math.max(0, l - 1));
        setLiked(false);
      }
    }
  }, [liked, disliked]);

  const handleShare = useCallback(() => {
    const url = asset?.watch_href ?? window.location.href;
    if (navigator.share) {
      navigator.share({ title: asset?.filename, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        /* copied silently - UI could show a toast, but a silent copy is fine */
      });
    }
  }, [asset]);

  const handleDownload = useCallback(() => {
    const url = asset?.watch_href ?? asset?.hls_url;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset?.filename ?? 'video';
    a.click();
  }, [asset]);

  if (!asset) return null;

  const atBottom = duration > 0 && currentTime >= duration - 0.35;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <section
      ref={rootRef}
      aria-label={`Inline player: ${asset.filename}`}
      data-inline-player=""
      className={`flex h-full flex-col overflow-hidden rounded-md ${productPanel}`}
    >
      {/* ---- header ---- */}
      <header className={`flex items-start gap-2 border-b ${productSeparation} px-3 py-2.5`}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-white" title={asset.filename}>
            {asset.filename}
          </h2>
          {asset.subtitle ? (
            <p className={`truncate text-[11px] ${productTextMuted}`}>{asset.subtitle}</p>
          ) : null}
        </div>

        {onNavigate ? (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onNavigate('prev')}
              disabled={!hasPrev}
              className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white disabled:opacity-30 disabled:hover:bg-transparent`}
              aria-label="Previous video"
              title="Previous"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M6 5h2v14H6zM20 5v14l-11-7z" />
              </svg>
            </button>
            <button
              onClick={() => onNavigate('next')}
              disabled={!hasNext}
              className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white disabled:opacity-30 disabled:hover:bg-transparent`}
              aria-label="Next video"
              title="Next"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M16 5h2v14h-2zM4 5l11 7-11 7z" />
              </svg>
            </button>
          </div>
        ) : null}

        <button
          onClick={onClose}
          className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
          aria-label="Close player"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* ---- stage ---- */}
      <div className="relative shrink-0 bg-black">
        {isAudio ? (
          <div className="flex aspect-video items-center justify-center">
            <div className="text-center p-6">
              <Music className={`mx-auto mb-3 h-12 w-12 ${productAccent}`} />
              <p className={`text-[11px] ${productTextMuted}`}>Audio track</p>
            </div>
          </div>
        ) : (
          <div className="relative aspect-video">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {asset.poster_url ? (
              <img
                src={asset.poster_url}
                alt=""
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                  isPlaying || loading ? 'opacity-0' : 'opacity-100'
                }`}
                // The poster is what stops a black rectangle flashing between
                // hls.js attaching and the first frame arriving.
              />
            ) : null}

            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              className="relative h-full w-full"
              playsInline
              muted={isMuted}
              autoPlay
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onWaiting={() => setLoading(true)}
              onPlaying={() => {
                setLoading(false);
                setIsPlaying(true);
              }}
            />

            {loading && !playError ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 className={`h-8 w-8 animate-spin ${grafanaPrimary}`} />
              </div>
            ) : null}

            {playError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center">
                <AlertCircle className="h-8 w-8 text-red-400" />
                <p className="px-4 text-xs text-red-200">{playError}</p>
                <button
                  onClick={() => {
                    setRetryCount((c) => c + 1);
                    setPlayError(null);
                    setLoading(true);
                    // Trigger hls.js reload by toggling src - the effect will re-run
                    videoRef.current?.removeAttribute('src');
                    videoRef.current?.load();
                  }}
                  className="rounded bg-[#ff6500]/20 border border-[#ff6500]/50 px-3 py-1 text-[11px] text-[#ff6500] hover:bg-[#ff6500]/40 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : null}

            {!isPlaying && !loading && !playError ? (
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors hover:bg-black/30"
                aria-label="Play"
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-full ${productAccentBg} text-white transition-transform hover:scale-105`}>
                  <Play className="ml-0.5 h-7 w-7" />
                </span>
              </button>
            ) : null}
          </div>
        )}

        {/* audio needs the same <video> element to make sound, so it is hosted
            here rather than hidden in the poster branch */}
        {isAudio ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            className="hidden"
            playsInline
            muted={isMuted}
            autoPlay
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
        ) : null}

        {/* ---- controls ---- */}
        <div className={`${productSunken} px-3 pb-3 pt-2`}>
          {/* Seekbar */}
          <div className={`group relative h-1.5 w-full cursor-pointer rounded-full ${productSeparation}`}>
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${productSeparationStrong}`}
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${productAccentBg}`}
              style={{ width: `${progressPct}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setCurrentTime(v);
                if (videoRef.current) videoRef.current.currentTime = v;
              }}
              aria-label="Seek"
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
            />
            <div
              className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${productAccentBg} opacity-0 transition-opacity group-hover:opacity-100`}
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={togglePlay}
              className={`rounded p-1.5 text-white transition-colors ${productPanelHover}`}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px]" />}
            </button>

            {/* Skip ±10s - the single most used control on any player */}
            <button
              onClick={() => seekBy(-10)}
              className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
              aria-label="Back 10 seconds"
              title="Back 10s"
            >
              <span className="block text-[10px] font-semibold leading-none">10</span>
            </button>
            <button
              onClick={() => seekBy(10)}
              className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
              aria-label="Forward 10 seconds"
              title="Forward 10s"
            >
              <span className="block text-[10px] font-semibold leading-none">10</span>
            </button>

            <div className="group/vol flex items-center">
              <button
                onClick={toggleMute}
                className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-[18px] w-[18px]" />
                ) : (
                  <Volume2 className="h-[18px] w-[18px]" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  setIsMuted(v === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = v;
                    videoRef.current.muted = v === 0;
                  }
                }}
                aria-label="Volume"
                className={`ml-1 h-1 w-0 cursor-pointer appearance-none rounded-full ${productSeparationStrong} opacity-0 transition-all duration-200 ${productAccentControl} focus:w-16 focus:opacity-100 group-hover/vol:w-16 group-hover/vol:opacity-100`}
              />
            </div>

            <span className={`ml-1 select-none whitespace-nowrap font-mono text-[11px] ${productTextMuted}`}>
              {formatDuration(currentTime)} / {formatDuration(duration || asset.duration_seconds || 0)}
            </span>

            <div className="flex-1" />

            {/* Playback speed */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu((v) => !v);
                  setShowQualityMenu(false);
                }}
                className={`rounded px-2 py-1 text-[11px] font-medium ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                aria-label="Playback speed"
                title="Playback speed"
              >
                {playbackRate}x
              </button>
              {showSpeedMenu ? (
                <div className={`absolute bottom-full right-0 z-10 mb-2 min-w-[92px] overflow-hidden rounded-md ${productPanel} py-1 shadow-xl`}>
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                        setPlaybackRate(rate);
                        setShowSpeedMenu(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-white transition-colors ${productPanelHover}`}
                    >
                      {rate}x
                      {playbackRate === rate ? <Check className={`h-3 w-3 ${productAccent}`} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Quality */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQualityMenu((v) => !v);
                  setShowSpeedMenu(false);
                }}
                className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                aria-label="Quality"
                title="Quality"
              >
                <Settings className="h-[18px] w-[18px]" />
              </button>
              {showQualityMenu ? (
                <div className={`absolute bottom-full right-0 z-10 mb-2 min-w-[104px] overflow-hidden rounded-md ${productPanel} py-1 shadow-xl`}>
                  <button
                    onClick={() => {
                      const hls = hlsRef.current;
                      if (hls) hls.currentLevel = -1;
                      setQuality('auto');
                      setShowQualityMenu(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-white transition-colors ${productPanelHover}`}
                  >
                    Auto
                    {quality === 'auto' ? <Check className={`h-3 w-3 ${productAccent}`} /> : null}
                  </button>
                  {levels.map((opt) => (
                    <button
                      key={opt.level}
                      onClick={() => {
                        const hls = hlsRef.current;
                        if (hls) hls.currentLevel = opt.level;
                        setQuality(opt.label);
                        setShowQualityMenu(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-white transition-colors ${productPanelHover}`}
                    >
                      {opt.label}
                      {quality === opt.label ? <Check className={`h-3 w-3 ${productAccent}`} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              onClick={toggleFullscreen}
              className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
            </button>

            {/* ---- YouTube-style engagement actions ---- */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleLike}
                className={`rounded p-1.5 transition-colors ${liked ? `${productAccentBg} text-[#ff6500]` : `${productTextMuted} ${productPanelHover} hover:text-white`}`}
                aria-label={liked ? 'Liked' : 'Like'}
                title={liked ? 'Liked' : 'Like'}
              >
                <ThumbsUp className="h-[18px] w-[18px]" />
              </button>
              <span className={`ml-0.5 text-[11px] font-medium ${liked ? 'text-[#ff6500]' : productTextMuted}`}>
                {likes}
              </span>
              <button
                onClick={toggleDislike}
                className={`rounded p-1.5 transition-colors ${disliked ? 'text-red-500' : `${productTextMuted} ${productPanelHover} hover:text-white`}`}
                aria-label={disliked ? 'Disliked' : 'Dislike'}
                title={disliked ? 'Disliked' : 'Dislike'}
              >
                <ThumbsDown className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={handleShare}
                className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                aria-label="Share"
                title="Share"
              >
                <Share2 className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={handleDownload}
                className={`rounded p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                aria-label="Download"
                title="Download"
              >
                <Download className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          {/* end-of-video affordance */}
          {atBottom && !loading ? (
            <button
              onClick={togglePlay}
              className={`mt-2 w-full rounded ${productPanel} py-2 text-[12px] font-medium text-white transition-colors ${productPanelHover}`}
            >
              Replay
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- footer ---- */}
      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
        <div className={`flex flex-wrap items-center gap-1.5 text-[10px] ${productTextMuted}`}>
          {asset.kind ? (
            <span className={`rounded ${productSunken} px-1.5 py-0.5 capitalize`}>{asset.kind}</span>
          ) : null}
          {asset.width && asset.height ? <span>
              {asset.width}x{asset.height}
            </span> : null}
        </div>
        {asset.watch_href ? (
          <a
            href={asset.watch_href}
            className={`mt-3 inline-block text-[12px] ${grafanaPrimary} transition-colors hover:${productAccent}`}
          >
            Open full page
          </a>
        ) : null}
      </div>
    </section>
  );
}

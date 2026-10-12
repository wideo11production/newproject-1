'use client';

/**
 * WATCH PAGE - Individual video page for all users.
 *
 * =============================================================================
 * STRUCTURE
 * =============================================================================
 *
 * /watch/[id] page with:
 * - Video player (HLS) with full controls
 * - Video metadata (title, description, channel, stats)
 * - Channel info sidebar with subscribe button
 * - Related videos / Up next sidebar
 * - Comments section (future)
 * - Borderless design with dark theme
 * - Responsive: mobile-first, works on all devices
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Share2,
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  UserPlus,
  Bell,
  ChevronDown,
  ChevronUp,
  Clock,
  Users,
  User,
  ExternalLink,
  Film,
  Music,
  Video as VideoIcon,
  Loader2,
} from 'lucide-react';
import type { MediaAsset } from '@/lib/media-upload';
import { formatDuration, formatBytes } from '@/lib/media-upload';
import { DeleteConfirmDialog } from '@/components/ConfirmDialog';

interface WatchPageProps {
  params: { id: string };
}

export default function WatchPage({ params }: WatchPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id } = params;

  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [channel, setChannel] = useState<{
    id: string;
    handle: string;
    display_name: string;
    avatar_url?: string;
    subscriber_count: number;
    is_subscribed: boolean;
    is_own: boolean;
  } | null>(null);
  const [relatedVideos, setRelatedVideos] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState<string>('auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Initialize HLS player
  const initializePlayer = useCallback(() => {
    const video = videoRef.current;
    const src = asset?.hls_url;
    if (!video || !src || Hls.isSupported() === false) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Auto-play if allowed
      video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const level = hls.levels[data.level];
      if (level) setQuality(`${level.height}p`);
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        setError('Video playback failed');
        hls.destroy();
      }
    });

    hlsRef.current = hls;

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [asset?.hls_url]);

  useEffect(() => {
    const cleanup = initializePlayer();
    return cleanup;
  }, [initializePlayer]);

  // Fetch video data
  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const [assetRes, relatedRes] = await Promise.all([
          fetch(`/api/media/${encodeURIComponent(id)}`, { cache: 'no-store' }),
          fetch(`/api/public/media?limit=20&exclude=${encodeURIComponent(id)}`, { cache: 'no-store' }),
        ]);

        if (!alive) return;

        if (!assetRes.ok) {
          if (assetRes.status === 404) {
            setError('Video not found');
          } else {
            setError('Failed to load video');
          }
          setLoading(false);
          return;
        }

        const assetData = await assetRes.json();
        setAsset(assetData.asset);

        // Fetch channel info if asset has channel_id
        if (assetData.asset?.channel_id) {
          const channelRes = await fetch(`/api/channels/${assetData.asset.channel_id}`, { cache: 'no-store' });
          if (channelRes.ok) {
            const channelData = await channelRes.json();
            setChannel(channelData.channel);
          }
        }

        // Fetch related videos
        if (relatedRes.ok) {
          const relatedData = await relatedRes.json();
          setRelatedVideos(relatedData.media || []);
        }

        setLoading(false);
      } catch {
        if (alive) {
          setError('Failed to load video');
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => { alive = false; };
  }, [id]);

  const handleDeleteConfirm = () => {
    if (asset) {
      router.push('/videos');
    }
    setShowDeleteDialog(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0f11] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-64 h-36 bg-[#16181d] rounded-lg animate-pulse" />
          <Loader2 className="h-8 w-8 animate-spin text-[#5794f2]" />
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="min-h-screen bg-[#0d0f11] text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Video not found</h1>
          <p className="text-[#8b949e] mb-4">{error || 'This video does not exist or has been removed.'}</p>
          <Link href="/videos" className="text-[#ff6500] hover:underline">
            Browse videos
          </Link>
        </div>
      </div>
    );
  }

  const isReel = asset.kind === 'reel';
  const isAudio = asset.kind === 'audio';

  return (
    <div className="min-h-screen bg-[#0d0f11] text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Main Video Area - 8 columns */}
          <div className="lg:col-span-8 space-y-6">
            {/* Video Player */}
            <div className="relative bg-black rounded-lg overflow-hidden">
              {isAudio ? (
                <div className="aspect-video flex items-center justify-center">
                  <div className="text-center p-8">
                    <Music className="h-20 w-20 text-[#ff6500] mx-auto mb-4" />
                    <h3 className="text-xl font-medium">{asset.filename}</h3>
                    <p className="text-[#8b949e] mt-2">Audio track - {formatDuration(asset.duration_seconds || 0)}</p>
                  </div>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="w-full h-auto"
                    playsInline
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onVolumeChange={(e) => {
                      setIsMuted(e.currentTarget.muted);
                      setVolume(e.currentTarget.volume);
                    }}
                  />
                  {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <button
                        onClick={() => videoRef.current?.play()}
                        className="w-20 h-20 rounded-full bg-[#ff6500] flex items-center justify-center hover:bg-[#e05500] transition-colors"
                        aria-label="Play"
                      >
                        <Play className="h-10 w-10 text-white ml-1" />
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Custom Controls Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <div className="space-2">
                  {/* Progress Bar */}
                  <div className="relative h-1 mb-3">
                    <input
                      type="range"
                      min="0"
                      max={duration || 100}
                      value={currentTime}
                      onChange={(e) => videoRef.current && (videoRef.current.currentTime = parseFloat(e.target.value))}
                      className="w-full h-1 appearance-none bg-transparent cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #ff6500 ${(currentTime / (duration || 1)) * 100}%, #3a4045 ${(currentTime / (duration || 1)) * 100}%)`,
                      }}
                    />
                    <div className="absolute bottom-full left-0 right-0 h-2 invisible group-hover:visible" />
                  </div>

                  {/* Control Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => videoRef.current && (isPlaying ? videoRef.current.pause() : videoRef.current.play())}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                      </button>

                      <button
                        onClick={() => videoRef.current && setIsMuted(!isMuted)}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                      </button>

                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={isMuted ? 0 : volume}
                        onChange={(e) => videoRef.current && (videoRef.current.volume = parseFloat(e.target.value))}
                        className="w-24 h-1 appearance-none bg-[#3a4045] rounded accent-[#ff6500]"
                      />

                      <span className="text-sm text-[#8b949e] font-mono w-20 text-right">
                        {formatDuration(currentTime)} / {formatDuration(duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Playback Speed */}
                      <div className="relative">
                        <button
                          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                          className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-sm"
                        >
                          {playbackRate}x
                        </button>
                        {showSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 bg-[#16181d] rounded-lg border border-[#2c3235] py-1 shadow-lg">
                            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                              <button
                                key={rate}
                                onClick={() => {
                                  if (videoRef.current) videoRef.current.playbackRate = rate;
                                  setPlaybackRate(rate);
                                  setShowSpeedMenu(false);
                                }}
                                className={`block w-full px-4 py-2 text-left text-sm ${playbackRate === rate ? 'text-[#ff6500]' : 'text-white'}`}
                              >
                                {rate}x
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Quality */}
                      <div className="relative">
                        <button
                          onClick={() => setShowQualityMenu(!showQualityMenu)}
                          className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-sm"
                        >
                          {quality}
                        </button>
                        {showQualityMenu && hlsRef.current && (
                          <div className="absolute bottom-full right-0 mb-2 bg-[#16181d] rounded-lg border border-[#2c3235] py-1 shadow-lg">
                            <button
                              onClick={() => {
                                const hls = hlsRef.current;
                                if (hls) hls.currentLevel = -1;
                                setQuality('auto');
                                setShowQualityMenu(false);
                              }}
                              className={`block w-full px-4 py-2 text-left text-sm ${quality === 'auto' ? 'text-[#ff6500]' : 'text-white'}`}
                            >
                              Auto
                            </button>
                            {hlsRef.current.levels.map((level, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  const hls = hlsRef.current;
                                  if (hls) hls.currentLevel = idx;
                                  setQuality(`${level.height}p`);
                                  setShowQualityMenu(false);
                                }}
                                className={`block w-full px-4 py-2 text-left text-sm ${quality === `${level.height}p` ? 'text-[#ff6500]' : 'text-white'}`}
                              >
                                {level.height}p
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Fullscreen */}
                      <button
                        onClick={() => {
                          const video = videoRef.current;
                          if (!video) return;
                          if (!isFullscreen) {
                            video.requestFullscreen().catch(() => {});
                          } else {
                            document.exitFullscreen().catch(() => {});
                          }
                        }}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      >
                        {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                      </button>

                      {/* Settings */}
                      <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label="Settings"
                      >
                        <Settings className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Info */}
            <div className="space-y-4">
              <h1 className="text-xl font-semibold">{asset.filename}</h1>

              <div className="flex flex-wrap items-center gap-4 text-sm text-[#8b949e]">
                <span>{formatBytes(asset.bytes || 0)}</span>
                <span>·</span>
                <span>{formatDuration(asset.duration_seconds || 0)}</span>
                <span>·</span>
                <span>{asset.width}x{asset.height}</span>
                <span>·</span>
                <span className="capitalize">{asset.kind}</span>
                <span>·</span>
                <span>{new Date(asset.created_at).toLocaleDateString()}</span>
              </div>

              {/* Channel Info */}
              {channel && (
                <div className="flex items-center gap-4 p-4 rounded-lg bg-[#16181d] border border-[#2c3235]">
                  <Link
                    href={`/channel/@${channel.handle}`}
                    className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-[#0d0f11] bg-[#2c3235] flex-shrink-0"
                  >
                    {channel.avatar_url ? (
                      <img src={channel.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="h-6 w-6 text-[#8b949e]" />
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/channel/@${channel.handle}`}
                      className="font-medium text-white hover:text-[#ff6500] transition-colors truncate block"
                    >
                      {channel.display_name}
                    </Link>
                    <p className="text-sm text-[#8b949e] truncate">@{channel.handle} · {channel.subscriber_count.toLocaleString()} subscribers</p>
                  </div>
                  {!channel.is_own && (
                    <button className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${channel.is_subscribed ? 'bg-transparent border border-[#3a4045] text-[#8b949e] hover:border-[#ff6500] hover:text-[#ff6500]' : 'bg-[#ff6500] text-white hover:bg-[#e05500]'}`}
                    >
                      {channel.is_subscribed ? (
                        <>
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            Subscribed
                          </span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-1" />
                          Subscribe
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[#2c3235]">
                <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#2c3235] hover:bg-[#3a4045] transition-colors text-sm font-medium">
                  <ThumbsUp className="h-5 w-5" />
                  Like
                </button>
                <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#2c3235] hover:bg-[#3a4045] transition-colors text-sm font-medium">
                  <ThumbsDown className="h-5 w-5" />
                  Dislike
                </button>
                <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#2c3235] hover:bg-[#3a4045] transition-colors text-sm font-medium">
                  <Share2 className="h-5 w-5" />
                  Share
                </button>
                <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#2c3235] hover:bg-[#3a4045] transition-colors text-sm font-medium">
                  <MessageSquare className="h-5 w-5" />
                  Comments
                </button>
                {channel?.is_own && (
                  <button
                    onClick={() => setShowDeleteDialog(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600/10 hover:bg-red-600/20 text-red-400 transition-colors text-sm font-medium"
                  >
                    <ExternalLink className="h-5 w-5" />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Delete Confirm Dialog */}
            {showDeleteDialog && (
              <DeleteConfirmDialog
                isOpen={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={handleDeleteConfirm}
                itemName={asset.filename}
                itemType={isReel ? 'reel' : isAudio ? 'audio' : 'video'}
              />
            )}
          </div>

          {/* Sidebar - 4 columns */}
          <aside className="lg:col-span-4 space-y-6">
            {/* Up Next / Related Videos */}
            <div className="bg-[#16181d] rounded-lg border border-[#2c3235] p-4">
              <h2 className="font-semibold mb-4">Up Next</h2>
              {relatedVideos.length === 0 ? (
                <p className="text-[#8b949e] text-sm">No related videos</p>
              ) : (
                <div className="space-y-3">
                  {relatedVideos.map((video) => (
                    <Link
                      key={video.id}
                      href={`/watch/${video.id}`}
                      className="block group"
                    >
                      <div className="flex gap-3">
                        <div className="relative w-40 h-22 flex-shrink-0 rounded bg-[#2c3235] overflow-hidden">
                          {(video as any).poster_url ? (
                            <img
                              src={(video as any).poster_url}
                              alt=""
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <VideoIcon className="h-6 w-6 text-[#8b949e]" />
                            </div>
                          )}
                          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 rounded">
                            {formatDuration((video as any).duration_seconds || 0)}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm truncate group-hover:text-[#ff6500] transition-colors">
                            {(video as any).filename}
                          </h3>
                          <p className="text-xs text-[#8b949e] truncate">
                            {(video as any).channel_name || 'Unknown Channel'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { Play, Pause, Volume2, VolumeX, Settings, Maximize, SkipBack, SkipForward, Subtitles, PiP, Download } from 'lucide-react';

export type VideoSource = {
  src: string;
  type: 'hls' | 'dash' | 'mp4' | 'webm';
  label?: string;
};

export type SubtitleTrack = {
  src: string;
  kind: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';
  srclang: string;
  label: string;
  default?: boolean;
};

export type VideoQuality = {
  label: string;
  bitrate: number;
  url: string;
};

export interface VideoPlayerProps extends React.HTMLAttributes<HTMLVideoElement> {
  sources: VideoSource[];
  subtitles?: SubtitleTrack[];
  qualities?: VideoQuality[];
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  poster?: string;
  loop?: boolean;
  playsInline?: boolean;
  crossOrigin?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onProgress?: (progress: number) => void;
  onBufferStart?: () => void;
  onBufferEnd?: () => void;
  onError?: (error: string) => void;
}

interface VideoPlayerContextValue {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffered: TimeRanges | null;
  volume: number;
  muted: boolean;
  playbackRate: number;
  quality: VideoQuality | null;
  isFullscreen: boolean;
  isPictureInPicture: boolean;
  isBuffering: boolean;
  error: string | null;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setQuality: (quality: VideoQuality) => void;
  toggleFullscreen: () => void;
  togglePictureInPicture: () => void;
  toggleCaptions: () => void;
  enableCaptions: (track?: SubtitleTrack) => void;
  disableCaptions: () => void;
}

const VideoPlayerContext = createContext<VideoPlayerContextValue | undefined>(undefined);

export const useVideoPlayer = () => {
  const context = useContext(VideoPlayerContext);
  if (!context) {
    throw new Error('useVideoPlayer must be used within VideoPlayerProvider');
  }
  return context;
};

export const VideoPlayerProvider: React.FC<{
  children: ReactNode;
  value: VideoPlayerContextValue;
}> = ({ children, value }) => {
  return (
    <VideoPlayerContext.Provider value={value}>
      {children}
    </VideoPlayerContext.Provider>
  );
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  sources,
  subtitles = [],
  qualities = [],
  autoPlay = false,
  muted = false,
  controls = true,
  poster,
  loop = false,
  playsInline = true,
  crossOrigin = 'anonymous',
  onPlay,
  onPause,
  onProgress,
  onError,
  className,
  ...props
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState({
    isPlaying: autoPlay,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted,
    playbackRate: 1,
    isFullscreen: false,
    isPictureInPicture: false,
    isBuffering: false,
    error: null as string | null,
    selectedQuality: null as VideoQuality | null,
    selectedSubtitle: null as SubtitleTrack | null,
  });

  const contextValue: VideoPlayerContextValue = {
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    buffered: null,
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
    quality: state.selectedQuality,
    isFullscreen: state.isFullscreen,
    isPictureInPicture: state.isPictureInPicture,
    isBuffering: state.isBuffering,
    error: state.error,
    togglePlay: () => videoRef.current?.paused ? play() : pause(),
    seek: (time: number) => { if (videoRef.current) videoRef.current.currentTime = time; },
    setVolume: (vol: number) => { if (videoRef.current) videoRef.current.volume = vol; setState(s => ({ ...s, volume: vol })); },
    toggleMute: () => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; setState(s => ({ ...s, muted: !s.muted })); },
    setPlaybackRate: (rate: number) => { if (videoRef.current) videoRef.current.playbackRate = rate; setState(s => ({ ...s, playbackRate: rate })); },
    setQuality: (quality: VideoQuality) => setState(s => ({ ...s, selectedQuality: quality })),
    toggleFullscreen: () => requestFullscreen(),
    togglePictureInPicture: () => togglePiP(),
    toggleCaptions: () => {},
    enableCaptions: (track?: SubtitleTrack) => setState(s => ({ ...s, selectedSubtitle: track || state.selectedSubtitle })),
    disableCaptions: () => setState(s => ({ ...s, selectedSubtitle: null })),
  };

  const play = useCallback(async () => {
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        setState(s => ({ ...s, isPlaying: true }));
        onPlay?.();
      } catch (err) {
        setState(s => ({ ...s, error: (err as Error).message }));
        onError?.((err as Error).message);
      }
    }
  }, [onPlay, onError]);

  const pause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      setState(s => ({ ...s, isPlaying: false }));
      onPause?.();
    }
  }, [onPause]);

  const requestFullscreen = useCallback(() => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        setState(s => ({ ...s, isFullscreen: false }));
      } else {
        videoRef.current.requestFullscreen();
        setState(s => ({ ...s, isFullscreen: true }));
      }
    }
  }, []);

  const togglePiP = useCallback(async () => {
    if (videoRef.current) {
      try {
        if (state.isPictureInPicture) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
        setState(s => ({ ...s, isPictureInPicture: !s.isPictureInPicture }));
      } catch (err) {
        console.error('PiP toggle failed:', err);
      }
    }
  }, [state.isPictureInPicture]);

  const handleSourceChange = useCallback((source: VideoSource) => {
    if (videoRef.current) {
      const wasPlaying = !videoRef.current.paused;
      videoRef.current.pause();
      const currentTime = videoRef.current.currentTime;
      
      if (source.type === 'hls' && (window as any).Hls) {
        const hls = new (window as any).Hls();
        hls.loadSource(source.src);
        hls.attachMedia(videoRef.current);
      } else if (source.type === 'dash' && (window as any).dashjs) {
        const player = (window as any).dashjs.MediaPlayer().create();
        player.initialize(videoRef.current, source.src, wasPlaying);
      } else {
        videoRef.current.src = source.src;
        videoRef.current.load();
        videoRef.current.currentTime = currentTime;
        if (wasPlaying) {
          videoRef.current.play();
        }
      }
    }
  }, []);

  const bestSource = sources.find(s => s.type === 'hls') || sources.find(s => s.type === 'dash') || sources[0];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      onProgress?.(video.currentTime / video.duration);
      setState(s => ({ ...s, currentTime: video.currentTime }));
    };

    const handleDurationChange = () => {
      setState(s => ({ ...s, duration: video.duration }));
    };

    const handlePlay = () => setState(s => ({ ...s, isPlaying: true }));
    const handlePause = () => setState(s => ({ ...s, isPlaying: false }));

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', () => setState(s => ({ ...s, isBuffering: true })));
    video.addEventListener('canplay', () => setState(s => ({ ...s, isBuffering: false })));

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [onProgress, onPlay, onPause]);

  useEffect(() => {
    if (videoRef.current) {
      if (autoPlay) {
        videoRef.current.play().catch(console.error);
      }
    }
  }, []);

  return (
    <VideoPlayerProvider value={contextValue}>
      <div className={`relative w-full bg-black rounded-lg overflow-hidden ${className || ''}`}>
        <video
          ref={videoRef}
          src={bestSource?.src}
          crossOrigin={crossOrigin}
          autoPlay={autoPlay}
          muted={muted}
          controls={controls}
          poster={poster}
          loop={loop}
          playsInline={playsInline}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          {...props}
        />

        {subtitles.length > 0 && (
          <>
            {subtitles.map((track, i) => (
              <track
                key={i}
                kind={track.kind}
                src={track.src}
                srcLang={track.srclang}
                label={track.label}
                default={track.default}
              />
            ))}
          </>
        )}

        {qualities.length > 0 && state.selectedQuality && (
          <QualitySelector 
            qualities={qualities} 
            current={state.selectedQuality}
            onChange={setSourceForQuality}
          />
        )}

        {controls && (
          <VideoControls />
        )}

        {state.error && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-300 text-sm">Error: {state.error}</p>
          </div>
        )}
      </div>
    </VideoPlayerProvider>
  );
};

const setSourceForQuality = (quality: VideoQuality, videoRef: React.RefObject<HTMLVideoElement>) => {
  if (videoRef.current) {
    videoRef.current.src = quality.url;
  }
};

const QualitySelector: React.FC<{
  qualities: VideoQuality[];
  current: VideoQuality;
  onChange: (quality: VideoQuality) => void;
}> = ({ qualities, current, onChange }) => {
  return (
    <div className="absolute top-2 right-2 z-10">
      <select
        value={current.label}
        onChange={(e) => onChange(qualities.find(q => q.label === e.target.value)!)}
        className="bg-gray-800/80 text-white border border-gray-700 rounded px-2 py-1 text-sm"
      >
        {qualities.map((q) => (
          <option key={q.label} value={q.label}>
            {q.label} ({Math.round(q.bitrate / 1000)}kbps)
          </option>
        ))}
      </select>
    </div>
  );
};

const VideoControls: React.FC = () => {
  const { 
    isPlaying, currentTime, duration, volume, muted, playbackRate, quality,
    togglePlay, seek, setVolume, toggleMute, setPlaybackRate, toggleFullscreen
  } = useVideoPlayer();

  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seek(percent * duration);
  };

  return (
    <div 
      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 transition-opacity duration-300"
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <div className="w-full bg-gray-600/30 rounded-full h-1 cursor-pointer mb-3" onClick={handleSeek}>
        <div 
          className="bg-blue-500 rounded-full h-1 transition-all" 
          style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
        />
      </div>

      <div className="flex items-center justify-between text-white">
        <div className="flex items-center space-x-2">
          <button onClick={togglePlay} className="p-1 hover:text-blue-400 transition-colors">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button className="p-1 hover:text-blue-400 transition-colors">
            <SkipBack className="h-4 w-4" />
          </button>
          <button className="p-1 hover:text-blue-400 transition-colors">
            <SkipForward className="h-4 w-4" />
          </button>
          <div className="flex items-center space-x-1">
            <button onClick={toggleMute} className="p-1 hover:text-blue-400 transition-colors">
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20"
            />
          </div>
          <span className="text-xs text-gray-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button className="p-1 hover:text-blue-400 transition-colors">
            <Subtitles className="h-4 w-4" />
          </button>
          <div className="relative">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 hover:text-blue-400 transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            {showSettings && (
              <div className="absolute bottom-full right-0 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-48 py-2">
                <div className="px-3 py-2 text-xs text-gray-400">Quality: {quality?.label || 'Auto'}</div>
                <div className="px-3 py-2 text-xs text-gray-400">Speed: {playbackRate}x</div>
                <div className="px-3 py-2 text-xs text-gray-400">Captions: Off</div>
              </div>
            )}
          </div>
          <button onClick={toggleFullscreen} className="p-1 hover:text-blue-400 transition-colors">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export { useVideoPlayer, VideoPlayerProvider };
export type { VideoSource, SubtitleTrack, VideoQuality, VideoPlayerProps };
export default VideoPlayer;

// Import ReactNode at top
import { ReactNode } from 'react';

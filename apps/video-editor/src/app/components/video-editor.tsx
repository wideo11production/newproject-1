"use client"

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Separator } from '@wideo11/ui/separator';
import { TimelineEngine } from '@wideo11/editor-core';
import { VideoPlayerProvider, useVideoPlayer, type VideoPlayerContextValue } from '@wideo11/video-player';
import { TimelineRuler } from './timeline/timeline-ruler';
import { TimelineTracks } from './timeline/timeline-tracks';
import { PreviewCanvas } from './preview/preview-canvas';
import { Toolbar } from './toolbar/toolbar';
import { Sidebar } from './sidebar/sidebar';
// Script Engine - purane standalone apps/editor ka content yahan migrate hua hai.
// Real interactive controls (scenes, text layout, transform, compile/export).
import ScriptEngine from './script-engine';
import { FileText } from 'lucide-react';

// --- Serialization-safe interfaces ---
// Ye interfaces plain objects ke liye hain jo server-client boundary cross kar sakte hain
interface TimelineEngineApi {
  seek: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: boolean;
}

// --- Custom Video Player Context Provider ---
// Ye provider VideoPlayerContextValue deta hai jo plain objects hi use karta hai
function VideoPlayerContextProvider({ 
  children, 
  videoRef: externalVideoRef 
}: { 
  children: React.ReactNode; 
  videoRef?: React.RefObject<HTMLVideoElement>; 
}) {
  const videoRef = externalVideoRef || useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);

  // Plain functions jo class instance capture nahi karte
  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setVolumeState(vol);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setMuted(prev => !prev);
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRateState(rate);
    }
  }, []);

  // Attach event listeners to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVolumeChange = () => {
      setVolumeState(video.volume);
      setMuted(video.muted);
    };
    const handleRateChange = () => setPlaybackRateState(video.playbackRate);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('ratechange', handleRateChange);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('ratechange', handleRateChange);
    };
  }, []);

  // Context value mein sirf plain objects aur plain functions hain
  const contextValue: VideoPlayerContextValue = {
    isPlaying,
    currentTime,
    duration,
    buffered: videoRef.current?.buffered || null,
    volume,
    muted,
    playbackRate,
    quality: null,
    isFullscreen: false,
    isPictureInPicture: false,
    isBuffering: false,
    error: null,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    setQuality: () => {},
    toggleFullscreen: () => {},
    togglePictureInPicture: () => {},
    toggleCaptions: () => {},
    enableCaptions: () => {},
    disableCaptions: () => {},
  };

  return (
    <VideoPlayerProvider value={contextValue}>
      <video ref={videoRef} style={{ display: 'none' }} muted />
      {children}
    </VideoPlayerProvider>
  );
}

export function VideoEditor() {
  // useRef use karo TimelineEngine instance store karne ke liye
  // ye React state mein nahi jata, isliye serialization issue nahi hoga
  const timelineEngineRef = useRef<TimelineEngine | null>(null);
  
  // Engine API functions (plain objects safe for passing to children)
  // Ye plain object hai jo serialization-safe hai
  const [engineApi, setEngineApi] = useState<TimelineEngineApi>({
    seek: () => {},
    getCurrentTime: () => 0,
    getDuration: () => 0,
    isPlaying: false
  });

  // videoRef preview canvas ke liye
  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize timeline engine
  useEffect(() => {
    // Create a mock store for timeline engine (in real app, this would come from Zustand)
    const mockStore = {
      getState: () => ({
        tracks: [],
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        zoom: 1,
        selectedClip: null,
        selectedTrack: null,
        markers: [],
        addTrack: () => {},
        addClip: () => {},
        updateClip: () => {},
        removeClip: () => {},
        setTime: () => {},
        togglePlay: () => {},
        setZoom: () => {},
        selectClip: () => {},
        selectTrack: () => {},
        addMarker: () => {},
        removeMarker: () => {},
      }),
      subscribe: () => ({ unsubscribe: () => {} }),
    };
    
    // TimelineEngine instance ko ref mein store karo - state mein nahi
    const engine = new TimelineEngine(mockStore as any);
    timelineEngineRef.current = engine;
    
    // Engine API functions ko plain object mein wrap karo
    // Yahan class instance capture nahi ho raha, sirf plain functions hain
    setEngineApi({
      seek: (time: number) => {
        if (timelineEngineRef.current) timelineEngineRef.current.seek(time);
      },
      getCurrentTime: () => {
        return timelineEngineRef.current ? timelineEngineRef.current.getCurrentTime() : 0;
      },
      getDuration: () => {
        return timelineEngineRef.current ? timelineEngineRef.current.getDuration() : 0;
      },
      isPlaying: timelineEngineRef.current ? timelineEngineRef.current.getIsPlaying() : false
    });
    
    return () => {
      if (timelineEngineRef.current) {
        timelineEngineRef.current.stop();
      }
    };
  }, []);

  // Sync engine API ref when engine state changes
  useEffect(() => {
    if (timelineEngineRef.current) {
      setEngineApi({
        seek: (time: number) => {
          if (timelineEngineRef.current) timelineEngineRef.current.seek(time);
        },
        getCurrentTime: () => {
          return timelineEngineRef.current ? timelineEngineRef.current.getCurrentTime() : 0;
        },
        getDuration: () => {
          return timelineEngineRef.current ? timelineEngineRef.current.getDuration() : 0;
        },
        isPlaying: timelineEngineRef.current ? timelineEngineRef.current.getIsPlaying() : false
      });
    }
  }, [timelineEngineRef.current]);

  // Script engine visibility state (migrated editor panel)
  const [showScriptEngine, setShowScriptEngine] = useState(true);

  return (
    <VideoPlayerContextProvider videoRef={videoRef}>
      {/* Main editor + script engine split view.
          Script engine LEFT side par hai (purane apps/editor ka migrated
          content), video editor RIGHT side par - dono SIDE-BY-SIDE chalti hain.
          Toggler se script engine collapse/show hota hai taaki full-screen
          editing bhi possible rahe. */}
      <div className="flex h-[calc(100vh-4.5rem)] bg-background">
        {/* Script Engine (migrated from apps/editor)
            VIEWPORT PROTECTION: chhote screens par fixed 420px panel media
            library/timeline ko squeeze kar deta tha. Ab ye responsive hai:
              - lg+ (1024px+): 420px, dono saath dikhte hain
              - md  (768px+) : 340px, thoda saka hua
              - <md          : POORA CHHUP jata hai (toggle button se khulta hai),
                                jisse timeline ko koi space nahi chhin
            Isse media timeline kabhi distort/crowd nahi hoga. */}
        {showScriptEngine && (
          <div
            className="hidden shrink-0 border-r border-border lg:block lg:w-[420px] md:w-[340px]"
            // Chhote viewport par jab user toggle kare to overlay ki tarah
            // full-height dikhe, taaki kuch bhi na toota
            data-script-engine-open={showScriptEngine}
          >
            <ScriptEngine />
          </div>
        )}

        {/* Sidebar - Media Library, Templates, Filters, etc. */}
        <Sidebar />
        
        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center">
            <div className="flex-1">
              <Toolbar onPlayPause={() => {}} />
            </div>
            {/* Script engine toggle - panel ko collapse/show karne ke liye.
                Migrated editor ke kuch tools (Cut/Split/Crop/Rotate) yahan
                operate karte hain, isliye toggle dena zaroori hai. */}
            <button
              onClick={() => setShowScriptEngine((v) => !v)}
              aria-pressed={showScriptEngine}
              title={showScriptEngine ? 'Hide script engine' : 'Show script engine'}
              className="flex h-9 items-center gap-1.5 border-l border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
              Script
            </button>
          </div>
          <Separator className="h-0.5 bg-border" />
          
          {/* Preview and Timeline */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Video Preview */}
            <PreviewCanvas />
            <Separator className="h-0.5 bg-border" />
            
            {/* Timeline */}
            <div className="flex-1 overflow-hidden">
              <TimelineRuler 
                seek={engineApi.seek}
                getCurrentTime={engineApi.getCurrentTime}
                getDuration={engineApi.getDuration}
                isPlaying={engineApi.isPlaying}
                videoRef={videoRef}
                onSeek={engineApi.seek}
                onSetTime={(time) => {
                  if (timelineEngineRef.current) timelineEngineRef.current.seek(time);
                }}
              />
              <TimelineTracks 
                seek={engineApi.seek}
                getCurrentTime={engineApi.getCurrentTime}
                getDuration={engineApi.getDuration}
                isPlaying={engineApi.isPlaying}
                videoRef={videoRef}
                onSeek={engineApi.seek}
                onAddClip={() => {}}
                onRemoveClip={() => {}}
                onUpdateClip={() => {}}
                onSetTime={(time) => {
                  if (timelineEngineRef.current) timelineEngineRef.current.seek(time);
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </VideoPlayerContextProvider>
  );
}
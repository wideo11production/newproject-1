import { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Separator } from '@wideo11/ui/separator';
import { TimelineEngine } from '@wideo11/editor-core';
import { VideoPlayer, useVideoPlayer } from '@wideo11/video-player';
import { TimelineRuler } from '@/components/timeline/timeline-ruler';
import { TimelineTracks } from '@/components/timeline/timeline-tracks';
import { MediaLibrary } from '@/components/media/media-library';
import { PreviewCanvas } from '@/components/preview/preview-canvas';
import { Toolbar } from '@/components/toolbar/toolbar';
import { Sidebar } from '@/components/sidebar/sidebar';

export function VideoEditor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [timelineEngine, setTimelineEngine] = useState<TimelineEngine | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

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
    
    const engine = new TimelineEngine(mockStore as any);
    setTimelineEngine(engine);
    
    return () => {
      engine.stop();
    };
  }, []);

  // Handle video playback
  const {
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
  } = useVideoPlayer();

  // Sync timeline with video playback
  useEffect(() => {
    if (timelineEngine && !isPlaying && currentTime > 0) {
      timelineEngine.seek(currentTime);
    }
  }, [timelineEngine, isPlaying, currentTime]);

  // Handle play/pause from timeline
  const handleTimelinePlayPause = () => {
    if (isPlaying) {
      togglePause();
    } else {
      togglePlay();
    }
  };

  const togglePause = () => {
    // This would pause the video - in real implementation, we'd call video player pause
    console.log('Toggle pause');
  };

  return (
    <div className="flex h-[calc(100vh-4.5rem)] bg-background">
      {/* Sidebar - Media Library, Templates, Filters, etc. */}
      <Sidebar />
      
      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar onPlayPause={handleTimelinePlayPause} />
        <Separator className="h-0.5 bg-border" />
        
        {/* Preview and Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Video Preview */}
          <PreviewCanvas 
            ref={previewRef}
            videoRef={videoRef}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
            onTogglePlay={togglePlay}
            onSetVolume={setVolume}
            onToggleMute={toggleMute}
            onSetPlaybackRate={setPlaybackRate}
          />
          <Separator className="h-0.5 bg-border" />
          
          {/* Timeline */}
          <div className="flex-1 overflow-hidden">
            <TimelineRuler 
              timelineEngine={timelineEngine} 
              videoRef={videoRef} 
              isPlaying={isPlaying} 
              currentTime={currentTime} 
              duration={duration}
              onSeek={seek}
              onSetTime={(time) => {
                if (timelineEngine) timelineEngine.seek(time);
                // In real app, we'd also seek the video
              }}
            />
            <TimelineTracks 
              timelineEngine={timelineEngine} 
              videoRef={videoRef} 
              isPlaying={isPlaying} 
              currentTime={currentTime} 
              duration={duration}
              onSeek={seek}
              onSetTime={(time) => {
                if (timelineEngine) timelineEngine.seek(time);
                // In real app, we'd also seek the video
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
import { useRef, useEffect } from 'react';
import { 
  Card, 
  CardHeader, 
  CardTitle,
  CardContent
} from '@wideo11/ui/card';
import { 
  Button 
} from '@wideo11/ui/button';
import { 
  Separator 
} from '@wideo11/ui/separator';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Settings, 
  Maximize2, 
  SkipBack, 
  SkipForward,
  Subtitles
} from 'lucide-react';
import { useVideoPlayer } from '@wideo11/video-player';

export function PreviewCanvas() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  
  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  } = useVideoPlayer();

  // Format time helper
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [minutes, secs];
    if (hours > 0) parts.unshift(hours);
    return parts.map(part => String(part).padStart(2, '0')).join(':');
  };

  // Handle seek on click
  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekTime = percent * duration;
    seek(seekTime);
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-200 flex items-center justify-between">
          Preview
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-gray-400">{formatTime(currentTime)}</span>
            <span>/</span>
            <span className="text-gray-400">{formatTime(duration)}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden relative" onClick={handleSeekClick}>
        <div 
          className="absolute inset-0 flex items-center justify-center bg-gray-900"
          ref={previewContainerRef}
        >
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            muted
          />
          {/* Playback overlay controls */}
          <div className="absolute bottom-4 left-4 flex items-center space-x-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => togglePlay()}
              className="bg-black/50 rounded-full p-1"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => toggleMute()} 
              className="bg-black/50 rounded-full p-1"
            >
              {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            </Button>
          </div>
          
          {/* Timeline scrubber */}
          <div 
            className="absolute bottom-0 left-0 right-0 h-2 bg-gray-800/50"
            onClick={(e) => {
              if (!previewContainerRef.current) return;
              const rect = previewContainerRef.current.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              seek(percent * duration);
            }}
          >
            <div 
              className="bg-blue-500 h-full" 
              style={{ width: duration > 0 ? (currentTime / duration) * 100 : 0 }}
            ></div>
          </div>
        </div>
        
        {/* Fullscreen and settings buttons */}
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => {/* Open settings */}}
            className="bg-black/50 rounded-full p-1"
          >
            <Settings className="h-3 w-3" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => {/* Toggle fullscreen */}}
            className="bg-black/50 rounded-full p-1"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
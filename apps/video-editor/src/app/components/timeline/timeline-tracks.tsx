import { useState, useRef, useEffect } from 'react';
import { 
  Separator 
} from '@wideo11/ui/separator';
import { 
  Draggable 
} from '@wideo11/dnd-dashboard';
import { 
  Film, 
  Music, 
  Type, 
  Image,
  Trash2,
  Settings as SettingsIcon
} from 'lucide-react';

interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'text' | 'image';
  clips: TimelineClip[];
  volume: number;
  muted: boolean;
  visible: boolean;
  locked: boolean;
}

interface TimelineClip {
  id: string;
  mediaId: string;
  mediaName: string;
  startTime: number;
  endTime: number;
  duration: number;
  type: 'video' | 'audio' | 'text' | 'image';
  thumbnail?: string;
  effects: string[];
}

interface TimelineTracksProps {
  timelineEngine: any; // TimelineEngine from editor-core
  videoRef: React.RefObject<HTMLVideoElement>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onSetTime: (time: number) => void;
  onAddClip: (trackId: string, clip: Omit<TimelineClip, 'id'>) => void;
  onRemoveClip: (clipId: string) => void;
  onUpdateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
}

export function TimelineTracks({ 
  timelineEngine, 
  videoRef, 
  isPlaying, 
  currentTime, 
  duration, 
  onSeek, 
  onSetTime,
  onAddClip,
  onRemoveClip,
  onUpdateClip 
}: TimelineTracksProps) {
  const tracksRef = useRef<HTMLDivElement>(null);
  const [tracks, setTracks] = useState<TimelineTrack[]>([
    {
      id: 'track-1',
      name: 'Video 1',
      type: 'video',
      clips: [],
      volume: 1,
      muted: false,
      visible: true,
      locked: false,
    },
    {
      id: 'track-2',
      name: 'Audio 1',
      type: 'audio',
      clips: [],
      volume: 1,
      muted: false,
      visible: true,
      locked: false,
    },
    {
      id: 'track-3',
      name: 'Text 1',
      type: 'text',
      clips: [],
      volume: 1,
      muted: false,
      visible: true,
      locked: false,
    }
  ]);

  // Sync with timeline engine (simplified)
  useEffect(() => {
    // In real app, we'd sync with the actual timeline engine state
  }, [timelineEngine, currentTime]);

  // Handle dropping media onto timeline
  const handleDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const mediaType = e.dataTransfer.getData('media-type');
    const mediaId = e.dataTransfer.getData('media-id');
    const mediaName = e.dataTransfer.getData('media-name');
    const mediaThumbnail = e.dataTransfer.getData('media-thumbnail');
    
    if (!tracksRef.current) return;
    const rect = tracksRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const startTime = percent * duration;
    
    // Default clip duration based on media type
    let clipDuration = 5; // 5 seconds default
    if (mediaType === 'audio') clipDuration = 10; // 10 seconds for audio
    if (mediaType === 'image') clipDuration = 3; // 3 seconds for images
    
    const newClip: Omit<TimelineClip, 'id'> = {
      mediaId,
      mediaName,
      startTime,
      endTime: startTime + clipDuration,
      duration: clipDuration,
      type: mediaType as 'video' | 'audio' | 'text' | 'image',
      thumbnail: mediaThumbnail,
      effects: [],
    };
    
    onAddClip(trackId, newClip);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div className="flex-1 overflow-hidden">
      <div 
        className="relative w-full"
        ref={tracksRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Tracks container */}
        <div className="relative">
          {/* Time ruler background */}
          <div className="absolute left-0 top-0 bottom-0 w-80 bg-[hsl(223_47%_11.2%)/50] border-r border-[hsl(217.2_32.6%_17.5%)]">
            {tracks.map((track, index) => (
              <div 
                key={track.id} 
                className="flex items-center px-2 py-[60px]"
              >
                <div className="w-4 h-4 mr-2">
                  {track.type === 'video' && <Film className="h-4 w-4" />}
                  {track.type === 'audio' && <Music className="h-4 w-4" />}
                  {track.type === 'text' && <Type className="h-4 w-4" />}
                  {track.type === 'image' && <Image className="h-4 w-4" />}
                </div>
                <span className="text-xs text-gray-400">{track.name}</span>
              </div>
            ))}
          </div>
          
          {/* Tracks content */}
          <div className="absolute left-80 right-0 top-0 bottom-0 overflow-x-auto overflow-y-hidden">
            <div 
              className="flex flex-col"
              style={{ minWidth: `${Math.max(1000, duration * 20)}px` }}
            >
              {tracks.map((track) => (
                <div 
                  key={track.id} 
                  className="relative flex-shrink-0 w-[60px] border-r border-[hsl(217.2_32.6%_17.5%)] bg-[hsl(223_47%_11.2%)/50] min-h-[60px]"
                >
                  {/* Track header */}
                  <div className="flex items-center justify-center h-10 bg-[hsl(223_47%_11.2%)/30] border-b border-[hsl(217.2_32.6%_17.5%)]">
                    <div className="text-xs text-gray-400">{track.name}</div>
                    {!track.locked && (
                      <div className="ml-2">
                        {track.muted ? <VolumeX className="h-3 w-3 text-gray-400" /> : <Volume2 className="h-3 w-3 text-gray-400" />}
                        <SettingsIcon className="ml-2 h-3 w-3 text-gray-400" />
                      </div>
                    )}
                  </div>
                  
                  {/* Clips container */}
                  <div 
                    className="flex-1 overflow-hidden relative"
                    style={{ position: 'relative' }}
                  >
                    {/* Playhead */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{ left: duration > 0 ? (currentTime / duration) * 100 : 0 }}
                    ></div>
                    
                    {/* Clips */}
                    <div className="absolute left-0 top-0 bottom-0">
                      {track.clips.map((clip) => {
                        const leftPercent = clip.startTime / duration;
                        const widthPercent = (clip.endTime - clip.startTime) / duration;
                        
                        return (
                          <Draggable
                            key={clip.id}
                            data={{
                              clipId: clip.id,
                              trackId: track.id,
                              type: 'clip'
                            }}
                          >
                            <div
                              className=`absolute left-[${leftPercent * 100}%] top-0 h-full w-[${widthPercent * 100}%] bg-blue-500/50 border border-blue-500/70 rounded-lg cursor-grab active:cursor-grabbing hover:bg-blue-500/60 transition-all flex items-center justify-center overflow-hidden`
                              style={{ zIndex: 10 }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                // Show context menu for clip
                                console.log('Right click on clip', clip);
                              }}
                            >
                              {clip.thumbnail ? (
                                <img 
                                  src={clip.thumbnail} 
                                  alt={clip.mediaName} 
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="flex items-center justify-center text-white text-xs">
                                  {clip.mediaName.substring(0, 8)}...
                                </div>
                              )}
                              {/* Clip handles for trimming */}
                              <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-blue-500/30" />
                              <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-blue-500/30" />
                              
                              {/* Clip menu */}
                              <div className="absolute bottom-2 right-2 bg-black/50 text-xs text-white px-1 rounded">
                                {clip.duration.toFixed(1)}s
                              </div>
                            </div>
                          </Draggable>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Add track button */}
              <div className="flex-shrink-0 w-[60px] border-r border-[hsl(217.2_32.6%_17.5%)] bg-[hsl(223_47%_11.2%)/30]">
                <div className="flex items-center justify-center h-10 text-gray-400 hover:text-gray-200 cursor-pointer">
                  <Plus className="h-3 w-3" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
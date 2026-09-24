import { useState, useRef, useEffect } from 'react';
import { 
   Separator 
} from '@wideo11/ui/separator';

interface TimelineRulerProps {
   // Instead of passing the TimelineEngine class instance, we'll pass plain object functions
   seek: (time: number) => void;
   getCurrentTime: () => number;
   getDuration: () => number;
   isPlaying: boolean;
   videoRef: React.RefObject<HTMLVideoElement>;
   onSeek: (time: number) => void;
   onSetTime: (time: number) => void;
}

export function TimelineRuler({ 
   seek,
   getCurrentTime,
   getDuration,
   isPlaying,
   videoRef, 
   onSeek, 
   onSetTime 
}: TimelineRulerProps) {
   const rulerRef = useRef<HTMLDivElement>(null);
   const [timeFormat, setTimeFormat] = useState<'frames' | 'seconds'>('seconds');

   // Update time display
   useEffect(() => {
      // In real app, we'd get this from the timeline engine
      // For now, we just need to know if we have a valid duration
      if (getDuration() > 0) {
         setTimeFormat('seconds');
      }
   }, [getDuration]);

   const formatTime = (seconds: number): string => {
      if (isNaN(seconds)) return '00:00';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const frames = Math.round((seconds % 1) * 30); // Assuming 30fps
      const parts = [minutes, secs];
      if (hours > 0) parts.unshift(hours);
      return timeFormat === 'frames' 
         ? `${parts.map(p => String(p).padStart(2, '0')).join(':')}.${String(frames).padStart(2, '0')}`
         : `${parts.map(p => String(p).padStart(2, '0')).join(':')}`;
   };

   // Handle click on ruler to seek
   const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seekTime = percent * getDuration();
      seek(seekTime); // Use our plain function instead of timelineEngine.seek
      onSetTime(seekTime);
      // In real app, we'd also seek the video
      if (videoRef.current) {
         videoRef.current.currentTime = seekTime;
      }
   };

   // Generate time markers
   const generateTimeMarkers = (duration: number, width: number) => {
      const markers = [];
      const interval = Math.max(1, Math.floor(duration / 20)); // ~20 markers
      
      for (let t = 0; t <= duration; t += interval) {
         const percent = t / duration;
         const px = percent * width;
         markers.push({ time: t, px });
      }
      
      return markers;
   };

   return (
      <div className="flex items-center px-4 py-2 bg-[hsl(223_47%_11.2%)/50] border-b border-[hsl(217.2_32.6%_17.5%)]">
         {/* Time display */}
         <div className="mr-4 text-xs text-gray-400 min-w-[80px]">
            <span id="current-time">{formatTime(getCurrentTime())}</span>
            <span>/</span>
            <span id="duration">{formatTime(getDuration())}</span>
         </div>
         
         {/* Ruler */}
         <div 
            className="flex-1 relative cursor-pointer"
            ref={rulerRef}
            onClick={handleRulerClick}
            onMouseDown={(e) => {
               // Enable dragging for scrubbing
               e.preventDefault();
               const handleMouseMove = (moveE: MouseEvent) => {
                  if (!rulerRef.current) return;
                  const rect = rulerRef.current.getBoundingClientRect();
                  let percent = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
                  percent = Math.max(0, Math.min(1, percent));
                  const seekTime = percent * getDuration();
                  seek(seekTime); // Use our plain function
                  onSetTime(seekTime);
                  if (videoRef.current) {
                     videoRef.current.currentTime = seekTime;
                  }
               };
               
               const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
               };
               
               document.addEventListener('mousemove', handleMouseMove);
               document.addEventListener('mouseup', handleMouseUp);
            }}
         >
            <div 
               className="absolute inset-0 flex items-center"
               style={{ pointerEvents: 'none' }}
            >
               {/* Time markers */}
               {generateTimeMarkers(getDuration(), 1000).map((marker, index) => (
                  <div 
                     key={index} 
                     className="flex items-center"
                     style={{ left: `${marker.px}px` }}
                  >
                     <div className="w-0.5 bg-gray-600" />
                     {index % 4 === 0 && (
                        <div className="text-xs text-gray-500 mt-1 w-20 text-center">
                           {formatTime(marker.time)}
                        </div>
                     )}
                  </div>
               ))}
               
               {/* Playhead */}
               <div 
                  className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500"
                  style={{ left: getDuration() > 0 ? (getCurrentTime() / getDuration()) * 100 : 0 }}
               ></div>
            </div>
         </div>
         
         {/* Format toggle */}
         <div className="ml-4 flex items-center space-x-2 text-xs">
            <label className="cursor-pointer text-gray-400">
               <input
                  type="checkbox"
                  checked={timeFormat === 'frames'}
                  onChange={() => setTimeFormat(timeFormat === 'frames' ? 'seconds' : 'frames')}
                  className="mr-1 h-3 w-3"
               />
               Frames
            </label>
         </div>
      </div>
   );
}
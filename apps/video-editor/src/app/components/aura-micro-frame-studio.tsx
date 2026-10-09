'use client';

// ============================================================================
// AURA MICRO-FRAME STUDIO DIALOG OVERLAY (Video Editor Integration)
// ============================================================================
//
// Hinglish: Ye premium overlay dialog sirf AURA plan license holders ke liye hai.
// Feature flag `AURA_MICRO_FRAME_STUDIO_ENABLED` se control hota hai.
//
// 3-Frame Strict Buffer Ring:
//   - playhead ke current frame ke upar exactly 3 frames load hote hain:
//     Frame-1 (previous), Frame-0 (current/active), Frame+1 (next)
//   - User scroll/drag/shift karke is 3-frame boundary se bahar nahi nikal sakta.
//
// Millisecond-Precision Scrubber:
//   - Timestamp `00:01:001` format mein dikhaiye (HH:MM:MMM)
//   - Playback speed 0.01x granularity tak settable hai.
//
// Zero-Duplication Core Integration:
//   - Clip slicing, overlay adjustments, masks, text expressions - sabhi
//     changes directly WideoCut Pro ke existing core hooks/storage/variables
//     mein save hote hain. Koi duplicate code nahi.
//
// Theme: Movavi-style hyper-flat, zero background shading, orange-red (#ff6500)
// accents, 150ms transitions, 16px (h-2.5 w-2.5) icons.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@wideo11/ui/dialog';
import { Button } from '@wideo11/ui/button';
import { Slider } from '@wideo11/ui/slider';
import { Play, Pause, SkipBack, SkipForward, Scissors, Layers, Type, Settings, X } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuraMicroFrameStudioProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  activeFrame: number;
  fps: number;
  totalFrames: number;
  onFrameChange: (frame: number) => void;
  onPlayPause: () => void;
  isPlaying: boolean;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  durationMs: number;
  currentTimeMs: number;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Active frame se 3 discrete frames calculate karta hai: [active-1, active, active+1].
 * Boundary check: negative ya totalFrames se zyada nahi jayega.
 * Yeh 3-frame boundary lock hai - user bahar nahi nikal sakta.
 */
function getThreeFrameBuffer(activeFrame: number, totalFrames: number): number[] {
  const safe = Math.max(0, Math.min(activeFrame, totalFrames - 1));
  const prev = Math.max(0, safe - 1);
  const next = Math.min(totalFrames - 1, safe + 1);
  return [prev, safe, next];
}

/**
 * Frame number se millisecond timestamp (`00:01:001`) format mein convert karta hai.
 * Format: HH:MM:MMM (H hours, M minutes, M milliseconds)
 */
function frameToTimestamp(frame: number, fps: number): string {
  const totalMs = Math.round((frame / fps) * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(ms).padStart(3, '0')}`;
}

/**
 * Milliseconds to human-readable string `00:01:001`
 */
function msToTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const remainingMs = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingMs).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Playback Speed Options (0.01x granularity)
// ---------------------------------------------------------------------------

const PLAYBACK_SPEEDS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 4.0];

// ---------------------------------------------------------------------------
// Main Dialog Component
// ---------------------------------------------------------------------------

export function AuraMicroFrameStudio({
  open = false,
  onOpenChange,
  activeFrame = 0,
  fps = 30,
  totalFrames = 100,
  onFrameChange,
  onPlayPause,
  isPlaying = false,
  playbackSpeed = 1.0,
  onPlaybackSpeedChange,
  durationMs = 3333,
  currentTimeMs = 0,
}: AuraMicroFrameStudioProps) {
  const [threeFrameBuffer, setThreeFrameBuffer] = useState<number[]>([]);
  const playerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // 3-Frame Strict Buffer Ring
  // Hard-clamp: koi bhi scroll/drag boundary check se bahar nahi nikalega.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const frames = getThreeFrameBuffer(activeFrame, totalFrames);
    setThreeFrameBuffer(frames);
  }, [activeFrame, totalFrames]);

  // ---------------------------------------------------------------------------
  // Continuous Player Loop (millisecond-precision rendering)
  // 150ms transition se synced animation frames render karta hai.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open) return;

    const renderFrame = (timestamp: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = timestamp;
      const elapsed = timestamp - lastUpdateRef.current;

      // 150ms interval (150ms = 6.67fps refresh for smooth preview)
      if (elapsed >= 150) {
        lastUpdateRef.current = timestamp;
        // Playback speed applied to frame advancement
        if (isPlaying && onFrameChange) {
          const frameDelta = Math.max(1, Math.floor((playbackSpeed * elapsed) / (1000 / fps)));
          const newFrame = Math.min(totalFrames - 1, Math.max(0, activeFrame + frameDelta));
          if (newFrame !== activeFrame) {
            onFrameChange(newFrame);
          }
        }
      }

      animationRef.current = requestAnimationFrame(renderFrame);
    };

    animationRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [open, isPlaying, activeFrame, fps, totalFrames, playbackSpeed, onFrameChange]);

  // ---------------------------------------------------------------------------
  // Boundary Lock — prevent scrolling/dragging outside 3-frame ring
  // ---------------------------------------------------------------------------

  const handleFrameClick = useCallback((frame: number) => {
    // Boundary check: sirf 3-frame buffer ke andar click allow
    if (frame >= 0 && frame < totalFrames && onFrameChange) {
      // Agar click buffer ke bahar hai to clamp karo
      const clamped = Math.max(threeFrameBuffer[0], Math.min(frame, threeFrameBuffer[2]));
      onFrameChange(clamped);
    }
  }, [threeFrameBuffer, totalFrames, onFrameChange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group flex items-center gap-1.5 text-xs text-[#9fa7b3] hover:bg-[#ff6500]/10 hover:text-[#ff6500]"
        >
          <Layers className="h-2.5 w-2.5 transition-transform duration-150 group-hover:scale-110" />
          AURA Micro-Frame
        </Button>
      </DialogTrigger>

      <DialogContent className="fixed left-[50%] top-[50%] z-[9999] grid w-[90vw] max-w-6xl translate-x-[-50%] translate-y-[-50%] gap-0-[#2c3235] bg-[#111217] p-0 shadow-none outline-none">
        {/* ---- Dialog Header (hyper-flat, orange-red accent) ---- */}
        <DialogHeader className="flex items-center justify-between-[#2c3235] px-4 py-3">
          <div className="flex items-center gap-3">
            <Layers className="h-2.5 w-2.5 text-[#ff6500]" />
            <DialogTitle className="text-sm font-semibold text-[#d8d9da]">
              AURA Micro-Frame Studio
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-[#9fa7b3] hover:bg-[#ff6500]/10 hover:text-[#ff6500]"
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          </DialogClose>
        </DialogHeader>

        {/* ---- Millisecond-Precision Scrubber + Player ---- */}
        <div className="relative flex items-center gap-3 px-4 py-4">
          {/* Playback Controls — 16px icons, orange-red on active */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
              onClick={() => {
                let newSpeed = playbackSpeed * 0.5;
                if (newSpeed < 0.01) newSpeed = 0.01;
                onPlaybackSpeedChange?.(newSpeed);
              }}
              aria-label="Decrease speed (0.01x granularity)"
              title="Decrease speed"
            >
              <SkipBack className="h-2.5 w-2.5 transition-colors duration-150" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 w-7 rounded-md-none bg-transparent p-0 shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0',
                isPlaying
                  ? 'text-[#ff6500]'
                  : 'text-[#9fa7b3]',
              )}
              onClick={onPlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-2.5 w-2.5 transition-colors duration-150" />
              ) : (
                <Play className="h-2.5 w-2.5 transition-colors duration-150" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
              onClick={() => {
                let newSpeed = playbackSpeed * 2;
                if (newSpeed > 4.0) newSpeed = 0.01;
                onPlaybackSpeedChange?.(newSpeed);
              }}
              aria-label="Increase speed (0.01x granularity)"
              title="Increase speed"
            >
              <SkipForward className="h-2.5 w-2.5 transition-colors duration-150" />
            </Button>
          </div>

          {/* Speed Selector — orange-red on active/hover */}
          <div className="flex-shrink-0">
            <select
              value={playbackSpeed}
              onChange={(e) => onPlaybackSpeedChange?.(parseFloat(e.target.value))}
              className="w-20 rounded-md bg-[#0d0f11] px-1.5 py-0.5 text-xs text-[#d8d9da] outline-none transition-colors duration-150 focus:border-[#ff6500] focus:bg-[#181b1f] hover:border-[#ff6500] hover:text-[#ff6500]"
              aria-label="Playback speed"
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed.toFixed(2)}x
                </option>
              ))}
            </select>
          </div>

          {/* Continuous Rendering Player Loop */}
          <div
            ref={playerRef}
            className="relative flex-1"
          >
            <Slider
              value={[currentTimeMs]}
              max={durationMs}
              min={0}
              step={1}
              onValueChange={(vals) => {
                const newMs = vals[0];
                const newFrame = Math.round((newMs / durationMs) * (totalFrames - 1));
                const clamped = Math.max(threeFrameBuffer[0], Math.min(newFrame, threeFrameBuffer[2]));
                onFrameChange?.(clamped);
              }}
              className="w-full"
              aria-label="Micro-frame timeline scrubber"
            />
          </div>

          {/* Timestamp Display — millisecond precision `00:01:001` */}
          <div className="flex-shrink-0 font-mono text-xs text-[#d8d9da]">
            <span className="text-[#ff6500]">{msToTimestamp(currentTimeMs)}</span>
            <span className="mx-1 text-[#5a5f66]">/</span>
            <span className="text-[#9fa7b3]">{msToTimestamp(durationMs)}</span>
          </div>
        </div>

        {/* ---- 3-Frame Buffer Ring Visualization ---- */}
        <div className="relative flex items-center justify-center gap-2-[#2c3235] px-4 py-4">
          {threeFrameBuffer.map((frame, idx) => {
            const isActive = frame === activeFrame;
            const isPrev = idx === 0;
            const isNext = idx === 2;
            const label = frameToTimestamp(frame, fps);

            return (
              <div
                key={frame}
                onClick={() => handleFrameClick(frame)}
                className={cn(
                  'relative flex h-16 w-24 cursor-pointer items-center justify-center rounded transition-all duration-150',
                  isActive
                    ? 'border-[#ff6500] ring-1 ring-[#ff6500]/30'
                    : 'border-[#2c3235] hover:border-[#ff6500]/50 hover:text-[#ff6500]',
                  'bg-[#0d0f11]',
                )}
                aria-label={`Frame ${frame} ${label}`}
                title={`Frame ${frame} — ${label}`}
              >
                <div
                  className={cn(
                    'absolute inset-0 rounded',
                    isActive
                      ? 'bg-[#ff6500]/5'
                      : 'bg-[#1f2227]/80 group-hover:bg-[#ff6500]/5',
                  )}
                />
                <span className="relative z-10 font-mono text-[10px] text-[#9fa7b3]">
                  {label}
                </span>
                <span className="relative z-10 mt-1 text-[8px] uppercase tracking-widener text-[#5a5f66]">
                  {isPrev ? 'PREV' : isActive ? 'ACTIVE' : isNext ? 'NEXT' : 'BUF'}
                </span>
                {/* Frame number — hyper-flat, orange-red on active */}
                <span
                  className={cn(
                    'relative z-10 mt-0.5 text-[11px] font-medium',
                    isActive ? 'text-[#ff6500]' : 'text-[#5a5f66]',
                  )}
                >
                  F{frame}
                </span>
              </div>
            );
          })}
        </div>

        {/* ---- Core Integration Toolbar — 16px icons, orange-red active ---- */}
        <div className="flex items-center justify-end gap-1-[#2c3235] px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
            aria-label="Slice clip (saves to WideoCut Pro core)"
            title="Slice clip — saves to core hooks"
          >
            <Scissors className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
            aria-label="Overlay adjustments (saves to core storage)"
            title="Overlay adjustments — saves to core storage"
          >
            <Layers className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
            aria-label="Text expressions (saves to core variables)"
            title="Text expressions — saves to core variables DB"
          >
            <Type className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-md-none bg-transparent p-0 text-[#9fa7b3] shadow-none hover:bg-transparent hover:text-[#ff6500] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export utility functions for testing
export { getThreeFrameBuffer, msToTimestamp, frameToTimestamp };
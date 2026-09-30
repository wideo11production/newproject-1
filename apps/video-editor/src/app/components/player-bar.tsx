'use client';

// ============================================================================
// Player controls
// ============================================================================
//
// Frame stepping, the loop toggle, and the master level.
//
// The timecode is the centre of the strip, not a small readout at the edge,
// because it is the one number the user reads continuously while cutting. It is
// `HH:MM:SS:FF` and the FRAME is shown separately, so a cut can be described
// unambiguously in either terms.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Minimize2, Volume2, VolumeX, Repeat } from 'lucide-react';
import { frameToTimecode } from '../lib/engine/frames';

export function PlayerBar({
  currentFrame,
  durationFrames,
  fps,
  isPlaying,
  volume,
  muted,
  loopOn,
  onToggleLoop,
  onVolume,
  onTogglePlay,
  onSeek,
  onFullscreenChange,
}: {
  /** Playhead, as a FRAME. */
  currentFrame: number;
  durationFrames: number;
  fps: number;
  isPlaying?: boolean;
  volume?: number;
  muted?: boolean;
  loopOn?: boolean;
  onToggleLoop?: () => void;
  onVolume?: (v: number) => void;
  onTogglePlay: () => void;
  onSeek: (frame: number) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  // `change` (not just `click`) so the browser's own Esc key updates the icon.
  useEffect(() => {
    const onChange = () => {
      const on = Boolean(document.fullscreenElement);
      setFullscreen(on);
      onFullscreenChange?.(on);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onFullscreenChange]);

  const btn = 'flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg';

  // Clicking the timecode copies it. A timecode you cannot paste into a note
  // or a report is only half a feature.
  const copyTimecode = useCallback(() => {
    const tc = frameToTimecode(currentFrame, fps);
    void navigator.clipboard?.writeText(`${tc} (frame ${currentFrame})`).catch(() => {});
  }, [currentFrame, fps]);

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-edge bg-surface px-3">
      <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} title={`${isPlaying ? 'Pause' : 'Play'} (Space)`} className="flex h-7 w-7 items-center justify-center rounded bg-sky-600 text-white hover:bg-sky-500">
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => onSeek(Math.max(0, currentFrame - 1))} className={btn} aria-label="Previous frame" title="Previous frame ( ← )">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onSeek(Math.min(durationFrames, currentFrame + 1))} className={btn} aria-label="Next frame" title="Next frame ( → )">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={copyTimecode}
        aria-label="Copy the timecode"
        title={`${frameToTimecode(currentFrame, fps)}\nFrame ${currentFrame} of ${durationFrames} at ${fps}fps.\nClick to copy.`}
        className="rounded px-2 py-0.5 font-mono text-sm tabular-nums text-fg transition-colors hover:bg-surface-overlay"
      >
        {frameToTimecode(currentFrame, fps)}
      </button>
      <span className="font-mono text-[10px] text-fg-muted">
        f{currentFrame} / {durationFrames}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleLoop}
          disabled={!onToggleLoop}
          className={[btn, loopOn ? 'bg-emerald-600/20 text-emerald-300' : ''].join(' ')}
          title={loopOn ? 'Loop off — playback stops at the end' : 'Loop the region marked on the ruler'}
          aria-label="Loop playback"
          aria-pressed={loopOn}
        >
          <Repeat className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onVolume?.(muted || volume === 0 ? 1 : 0)}
            className={btn}
            title={muted || volume === 0 ? 'Unmute' : 'Mute'}
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => onVolume?.(Number(e.target.value))}
            aria-label="Master volume"
            title="Master volume — after every clip, fade and track fader"
            className="h-1 w-20 cursor-pointer accent-sky-500"
          />
        </div>

        {fullscreen ? <Minimize2 className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />}
      </div>
    </div>
  );
}

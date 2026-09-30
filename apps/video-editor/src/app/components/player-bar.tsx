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
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Repeat,
  Columns2,
  PictureInPicture2,
  Square,
  Tag,
} from 'lucide-react';
import { frameToTimecode, clampPxPerFrame } from '../lib/engine/frames';
import type { TimelineClip } from '../lib/engine/types';
import { sourceTimeAt } from '../lib/engine/types';

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
  viewerZoom,
  viewerLayout,
  onViewerZoom,
  onViewerLayout,
  badge,
  onToggleBadge,
  /** The clip under the playhead, for the source-frame read-out. */
  clipUnderPlayhead,
}: {
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
  /** Picture zoom. 1 = fit. */
  viewerZoom?: number;
  viewerLayout?: 'single' | 'side-by-side' | 'picture-in-picture';
  onViewerZoom?: (z: number) => void;
  onViewerLayout?: (l: 'single' | 'side-by-side' | 'picture-in-picture') => void;
  badge?: boolean;
  onToggleBadge?: () => void;
  clipUnderPlayhead?: TimelineClip | null;
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

  // ---- Frame data.
  //
  // Three numbers, because they answer three different questions and none of
  // them implies the others:
  //   timeline frame - where the playhead is in the edit
  //   source frame   - which frame of WHICH FILE is on screen right now
  //   timecode       - the same position in a form a human reads aloud
  //
  // At 2x speed the timeline and source frames diverge by design, and a
  // cut list that mixes them up is how a sync error survives review.
  const sourceFrame = clipUnderPlayhead
    ? Math.max(0, Math.round(sourceTimeAt(clipUnderPlayhead, currentFrame / fps) * fps))
    : null;

  const layouts = [
    { id: 'single', Icon: Square, label: 'Single viewer', hint: 'One picture, as large as it fits' },
    { id: 'side-by-side', Icon: Columns2, label: 'Side by side', hint: 'Half width, so two clips can be compared against each other' },
    { id: 'picture-in-picture', Icon: PictureInPicture2, label: 'Picture in picture', hint: 'Corner inset over the timeline picture - the layout the Overlays panel sets up' },
  ] as const;

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-edge bg-surface px-3">
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

      <div className="flex items-center gap-2 font-mono text-[10px] text-fg-muted" title="Frame data: where the playhead is, which frame of the source file is on screen, and the same position as a readable timecode">
        <span className="text-fg-secondary">TL {currentFrame}</span>
        <span className="text-fg-muted/40">/</span>
        <span className="text-fg-secondary">SRC {sourceFrame ?? '—'}</span>
        <span className="text-fg-muted/40">/</span>
        <span>{durationFrames}f</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
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

        {/* Viewer layout and zoom. Persisted, because "which layout I like" is
            a preference and re-choosing it after every refresh is the kind of
            small friction that makes an editor feel amateur. */}
        <div className="flex items-center gap-0.5" role="group" aria-label="Viewer layout">
          {layouts.map(({ id, Icon, label, hint }) => (
            <button
              key={id}
              type="button"
              onClick={() => onViewerLayout?.(id)}
              aria-pressed={viewerLayout === id}
              aria-label={label}
              title={hint}
              className={[btn, viewerLayout === id ? 'bg-sky-600 text-white' : ''].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <input
          type="range"
          min={100}
          max={300}
          step={5}
          value={Math.round((viewerZoom ?? 1) * 100)}
          onChange={(e) => onViewerZoom?.(clampPxPerFrame(Number(e.target.value) / 100))}
          aria-label="Viewer zoom"
          title={`Viewer zoom: ${Math.round((viewerZoom ?? 1) * 100)}%`}
          className="h-1 w-16 cursor-pointer accent-sky-500"
        />

        <button
          type="button"
          onClick={onToggleBadge}
          aria-pressed={badge}
          aria-label="Toggle the frame data badge"
          title="Show the resolution, frame rate and frame number over the picture"
          className={[btn, badge ? 'bg-sky-600 text-white' : ''].join(' ')}
        >
          <Tag className="h-3.5 w-3.5" />
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
            className="h-1 w-16 cursor-pointer accent-sky-500"
          />
        </div>

        {fullscreen ? <Minimize2 className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />}
      </div>
    </div>
  );
}

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
import { levelBands } from '../lib/engine/audio-graph';
import type { TimelineClip } from '../lib/engine/types';
import { sourceTimeAt } from '../lib/engine/types';

/**
 * The voice meter.
 *
 * Twelve bars that light up with what is ACTUALLY coming out of the master bus,
 * read from the same AnalyserNode the sound passes through.
 *
 * ---- WHY IT IS NOT A CSS ANIMATION ----
 *
 * A meter that animates on a timer is a lie: it moves when nothing is playing
 * and sits still when something is. This one reads `levelBands()` from the
 * graph in a rAF loop, so it is a MEASUREMENT. If the audio is broken it goes
 * flat, which is the most useful thing a meter can tell you.
 *
 * The colour is the level: green under -12dB, amber to -3, red above. That is
 * a gain-stage convention rather than a personal preference, so "amber" means
 * "getting hot" to anyone who has mixed anything.
 */
function LevelMeter({ playing }: { playing: boolean }) {
  const [bands, setBands] = useState<number[]>(() => new Array(12).fill(0));

  useEffect(() => {
    if (!playing) {
      // Decay to rest rather than freezing mid-bar, which would leave a meter
      // showing a level the moment it stopped producing one.
      let raf = 0;
      const settle = () => {
        setBands((b) => {
          const next = b.map((v) => v * 0.8);
          return next.some((v) => v > 0.01) ? next : new Array(12).fill(0);
        });
        raf = requestAnimationFrame(settle);
      };
      raf = requestAnimationFrame(settle);
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const tick = () => {
      setBands(levelBands(12));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div
      role="meter"
      aria-label="Output level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, ...bands) * 100)}
      title="Live output level, measured at the master bus"
      className="flex h-4 items-end gap-px"
    >
      {bands.map((v, i) => {
        const lit = v > 0.02;
        const colour = v > 0.89 ? '#f87171' : v > 0.62 ? '#fbbf24' : '#34d399';
        return (
          <span
            key={i}
            className="w-0.5 rounded-sm transition-[height,background-color] duration-75"
            style={{
              // A floor of 1px, so the meter reads as a row of bars at rest
              // instead of vanishing and leaving a mystery gap in the toolbar.
              height: `${Math.max(1, Math.round(v * 16))}px`,
              background: lit ? colour : 'rgb(var(--ve-edge))',
              opacity: lit ? 1 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}

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

  const btn = 'flex h-7 w-7 items-center justify-center text-fg-muted transition-colors duration-150 hover:text-[#ff6500]';

  /**
   * The ACTIVE state, and why it is not a filled button.
   *
   * These controls used to be `bg-[#ff6500] text-white`, and three filled blue
   * squares in a 40px strip out-shouted the play button next to them. An active
   * control only needs to read as active; a saturated fill at this size does not
   * read as active, it reads as three more primary actions.
   *
    * A 12% tint plus the orange-red text colour says the same thing in a third of the
    * ink, and it leaves the play button the only solid thing in the strip.
    */
  const on = 'bg-[#ff6500]/12 text-[#ff6500] hover:bg-[#ff6500]/20';

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
       <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} title={`${isPlaying ? 'Pause' : 'Play'} (Space)`} className="flex h-7 w-7 items-center justify-center rounded bg-[#ff6500] text-white hover:bg-[#e55800]">
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => onSeek(Math.max(0, currentFrame - 1))} className={btn} aria-label="Previous frame" title="Previous frame ( ← )">
          <SkipBack className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onSeek(Math.min(durationFrames, currentFrame + 1))} className={btn} aria-label="Next frame" title="Next frame ( → )">
          <SkipForward className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={copyTimecode}
        aria-label="Copy the timecode"
        title={`${frameToTimecode(currentFrame, fps)}\nFrame ${currentFrame} of ${durationFrames} at ${fps}fps.\nClick to copy.`}
        className="rounded px-2 py-0.5 font-mono text-[8px] tabular-nums text-fg transition-colors hover:bg-surface-overlay"
      >
        {frameToTimecode(currentFrame, fps)}
      </button>

      <div className="flex items-center gap-2 font-mono text-[8px] text-fg-muted" title="Frame data: where the playhead is, which frame of the source file is on screen, and the same position as a readable timecode">
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
          <Repeat className="h-4 w-4" />
        </button>

        {/* Viewer layout and zoom. Persisted, because "which layout I like" is
            a preference and re-choosing it after every refresh is the kind of
            small friction that makes an editor feel amateur. */}
        {/* The viewer layout switcher. Three small ghost buttons, not three
            primary ones - it is a preference, and preferences do not get the
            loudest treatment on the screen. */}
        <div className="flex items-center gap-0.5" role="group" aria-label="Viewer layout">
          {layouts.map(({ id, Icon, label, hint }) => (
            <button
              key={id}
              type="button"
              onClick={() => onViewerLayout?.(id)}
              aria-pressed={viewerLayout === id}
              aria-label={label}
              title={hint}
              className={[btn, viewerLayout === id ? on : ''].join(' ')}
            >
              <Icon className="h-4 w-4" />
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
          className="ve-fader h-1 w-12 cursor-pointer"
        />

        <button
          type="button"
          onClick={onToggleBadge}
          aria-pressed={badge}
          aria-label="Toggle the frame data badge"
          title="Show the resolution, frame rate and frame number over the picture"
          className={[btn, badge ? on : ''].join(' ')}
        >
          <Tag className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onVolume?.(muted || volume === 0 ? 1 : 0)}
            className={btn}
            title={muted || volume === 0 ? 'Unmute' : 'Mute'}
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
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
            // `ve-fader`, NOT a bare range input. A default range in a 40px strip
            // draws a big round thumb, and that thumb was the single loudest
            // thing next to the play button.
            className="ve-fader h-1 w-20 cursor-pointer"
          />
        </div>


        {fullscreen ? <Minimize2 className="h-4 w-4 text-fg-muted" aria-hidden="true" /> : <Maximize2 className="h-4 w-4 text-fg-muted" aria-hidden="true" />}
      </div>
    </div>
  );
}

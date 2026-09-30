'use client';

// ============================================================================
// Timeline ruler
// ============================================================================
//
// The ruler and the lanes live inside ONE horizontally scrolled strip, so they
// share a coordinate system by construction and cannot describe different
// timelines. (They used to be separate strips, which put the ruler's zero
// 178px left of the clips' zero: the timecode under the pointer was always
// about two seconds from the time it named.)
//
// ---- ZOOM IS PIXELS PER FRAME ----
//
// `pxPerFrame` rather than a multiplier on seconds-per-pixel, because a
// multiplier's meaning drifts with the frame rate: "4x" is 480px/s at 30fps and
// 960 at 60, so changing a project's frame rate would silently double its
// zoom. Pixels per frame is absolute, and it makes the requirement "at maximum
// zoom every frame is visible" a property of the number rather than a hope.
//
// ---- ALT + WHEEL ZOOMS ----
//
// Wheel alone scrolls, which is what every other application on earth does and
// what a trackpad expects. Alt+wheel zooms, because the two gestures want
// opposite things and only one of them is "move along the timeline". Zoom is
// anchored on the POINTER, not the viewport: zooming under the cursor keeps the
// frame you were looking at under the cursor, which is the only anchoring that
// feels like the timeline is being pulled rather than pushed.

import { useCallback, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, Minus, Magnet } from 'lucide-react';
import {
  frameToTimecode,
  timecodeCompact,
  clampPxPerFrame,
  zoomPercent,
  DEFAULT_PX_PER_FRAME,
} from '../../lib/engine/frames';
import { MARKER_COLOURS, type Marker } from '../../lib/engine/markers';

/**
 * Label spacing, in pixels.
 *
 * Chosen by measuring the widest possible label rather than counting ticks: at
 * 60fps a label is 5 characters and at 24fps it is 5 too, but the STEP between
 * them changes, so a fixed tick count collides at some zoom on some rate. The
 * ruler measures one and walks until the next one clears it.
 */
const MIN_LABEL_GAP = 46;

/** Steps offered by the label chooser, in seconds. */
const STEPS = [1 / 30, 1 / 15, 1 / 6, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** The smallest label step that still leaves `MIN_LABEL_GAP` between labels. */
function chooseStep(pxPerFrame: number, fps: number): { step: number; frames: number } {
  for (const s of STEPS) {
    if (s * fps * pxPerFrame >= MIN_LABEL_GAP) {
      return { step: s, frames: Math.max(1, Math.round(s * fps)) };
    }
  }
  const last = STEPS[STEPS.length - 1];
  return { step: last, frames: Math.round(last * fps) };
}

export function TimelineRuler({
  duration,
  currentTime,
  currentFrame,
  pxPerFrame,
  fps,
  laneWidth,
  onSeek,
  onZoomAt,
  loop,
  onSetLoop,
  markers,
  gridVisible,
  snapEnabled,
}: {
  duration: number;
  currentTime: number;
  currentFrame: number;
  pxPerFrame: number;
  fps: number;
  laneWidth: number;
  onSeek: (t: number) => void;
  /** `factor` is a multiplier: 1.2 zooms IN by 20%. */
  onZoomAt: (factor: number, anchorClientX: number | null) => void;
  loop: { on: boolean; start: number; end: number };
  onSetLoop: (start: number, end: number) => void;
  markers: Marker[];
  gridVisible: boolean;
  snapEnabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  /**
   * Time under a viewport x.
   *
   * The element's own rect already accounts for the shared strip's scroll, so
   * there is no `scrollLeft` term to add - and adding one would double-count
   * it, which is exactly the bug that put the ruler out of step in the first
   * place.
   */
  const frameAt = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return 0;
      const box = el.getBoundingClientRect();
      return Math.max(0, Math.min(Math.round((clientX - box.left) / pxPerFrame), totalFrames));
    },
    [pxPerFrame, totalFrames]
  );

  const beginScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(frameAt(e.clientX) / fps);
    const move = (ev: PointerEvent) => onSeek(frameAt(ev.clientX) / fps);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, currentFrame - (e.shiftKey ? 10 : 1)) / fps);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(totalFrames, currentFrame + (e.shiftKey ? 10 : 1)) / fps);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(duration);
    }
  };

  /**
   * Wheel: scroll by default, zoom with Alt.
   *
   * `passive: false` is required - a passive listener cannot preventDefault,
   * and without preventDefault the page scrolls the strip horizontally while
   * the zoom also runs.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      onZoomAt(factor, e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoomAt]);

  const { frames: stepFrames, step } = chooseStep(pxPerFrame, fps);
  const markerList: Marker[] = [...markers].sort((a, b) => a.frame - b.frame);
  const showFrames = pxPerFrame >= 12;
  const showTenths = pxPerFrame >= 4 && pxPerFrame < 12;

  const labelAt = (frame: number) => {
    if (showFrames) return frameToTimecode(frame, fps);
    if (showTenths) return (frame / fps).toFixed(2);
    return timecodeCompact(frame, fps);
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Timeline playhead"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={totalFrames}
      aria-valuenow={currentFrame}
      aria-valuetext={`${frameToTimecode(currentFrame, fps)}, frame ${currentFrame} of ${totalFrames}`}
      onPointerDown={beginScrub}
      onKeyDown={onKey}
      style={{ width: laneWidth }}
      className="relative h-8 shrink-0 cursor-ew-resize select-none border-b border-edge bg-surface-raised focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-500"
    >
      {/* Loop region. Drawn on the ruler because the ruler is the only strip
          that represents the whole timeline at a known scale; a region drawn
          inside a lane would imply it belongs to that track. */}
      {loop.on && (
        <>
          <div
            className="pointer-events-none absolute bottom-0 top-0 border-x-2 border-emerald-400/70 bg-emerald-400/10"
            style={{ left: loop.start * pxPerFrame, width: Math.max(0, (loop.end - loop.start) * pxPerFrame) }}
          />
          {(['start', 'end'] as const).map((edge) => {
            const x = (edge === 'start' ? loop.start : loop.end) * pxPerFrame;
            return (
              <div
                key={edge}
                role="separator"
                aria-label={edge === 'start' ? 'Loop in point' : 'Loop out point'}
                aria-orientation="vertical"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const startX = e.clientX;
                  const startFrame = Math.round(edge === 'start' ? loop.start : loop.end);
                  const move = (ev: PointerEvent) => {
                    const next = Math.max(0, Math.min(totalFrames, startFrame + (ev.clientX - startX) / pxPerFrame));
                    if (edge === 'start') onSetLoop(Math.min(next, loop.end - 1), loop.end);
                    else onSetLoop(loop.start, Math.max(next, loop.start + 1));
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
                title={edge === 'start' ? 'Loop in point — drag to move' : 'Loop out point — drag to move'}
                className="absolute bottom-0 top-0 z-10 w-2 cursor-ew-resize"
                style={{ left: x - 4 }}
              >
                <span className="mx-auto block h-full w-0.5 bg-emerald-400" />
              </div>
            );
          })}
        </>
      )}

      {/* Half-step ticks. At high zoom these are the frame grid made visible;
          at low zoom they give the ruler texture without extra DOM nodes. */}
      {Array.from({ length: Math.floor(totalFrames / stepFrames) + 1 }, (_, i) => {
        const frame = i * stepFrames;
        return (
          <span
            key={`t${frame}`}
            className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-fg-muted/50"
            style={{ left: frame * pxPerFrame }}
          />
        );
      })}
      {Array.from({ length: Math.floor(totalFrames / (stepFrames / 2)) + 1 }, (_, i) => {
        const frame = i * (stepFrames / 2);
        if (frame % stepFrames === 0) return null;
        return (
          <span
            key={`h${frame}`}
            className="pointer-events-none absolute bottom-0 h-1 w-px bg-fg-muted/25"
            style={{ left: frame * pxPerFrame }}
          />
        );
      })}

      {Array.from({ length: Math.floor(totalFrames / stepFrames) + 1 }, (_, i) => {
        const frame = i * stepFrames;
        return (
          <span
            key={`l${frame}`}
            className="pointer-events-none absolute left-0 top-0.5 select-none font-mono text-[9px] text-fg-muted"
            style={{ left: frame * pxPerFrame + 3 }}
          >
            {labelAt(frame)}
          </span>
        );
      })}

      {/* Markers. Clicking one moves the playhead to it, which is the whole
          reason markers exist: they are how you go back. */}
      {markerList.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-label={`Marker: ${m.label || 'Untitled'} at frame ${m.frame}`}
          title={`${m.label || 'Untitled'} — ${frameToTimecode(m.frame, fps)} (frame ${m.frame})\nClick to move the playhead here`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSeek(m.frame / fps);
          }}
          className="absolute top-0 z-20 -translate-x-1/2 cursor-pointer p-0"
          style={{ left: m.frame * pxPerFrame }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1 L9 1 L5 9 Z" fill={MARKER_COLOURS[m.colour]} />
          </svg>
        </button>
      ))}

      {/* Playhead. Two elements - a line and a head - because one cannot be
          both 1px wide and a triangle without either the line or the triangle
          being wrong. */}
      <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-rose-500" style={{ left: currentFrame * pxPerFrame }} />
      <div
        className="pointer-events-none absolute top-0 z-30 -ml-[5px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-rose-500"
        style={{ left: currentFrame * pxPerFrame }}
      />
      <div className="pointer-events-none absolute right-1 top-0.5 flex items-center gap-1 font-mono text-[9px] text-fg-muted">
        {snapEnabled && <Magnet className="h-2.5 w-2.5" aria-hidden="true" />}
        {pxPerFrame.toFixed(2)}px/f
      </div>
    </div>
  );
}

/**
 * The zoom control, in the timeline's own header column.
 *
 * A slider as well as the buttons: dragging a handle gives the fine control
 * that clicking + and - cannot, and it shows the value as it changes rather
 * than only after the click.
 */
export function TimelineZoom({
  pxPerFrame,
  onZoom,
  onFit,
}: {
  pxPerFrame: number;
  onZoom: (next: number) => void;
  onFit: () => void;
}) {
  const btn = 'flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg';
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Timeline zoom">
      <button type="button" onClick={() => onZoom(clampPxPerFrame(pxPerFrame / 1.4))} aria-label="Zoom out" title="Show more of the timeline ( - )" className={btn}>
        <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        type="range"
        min={1}
        max={640}
        step={1}
        value={Math.round(pxPerFrame * 100)}
        onChange={(e) => onZoom(clampPxPerFrame(Number(e.target.value) / 100))}
        aria-label="Timeline zoom"
        title={`Timeline zoom: ${zoomPercent(pxPerFrame)}% — ${pxPerFrame.toFixed(2)} pixels per frame\nDrag to zoom, or Alt+scroll anywhere on the ruler.`}
        className="h-1 w-14 cursor-pointer accent-sky-500"
      />
      <span className="w-8 text-center font-mono text-[10px] text-fg-secondary" aria-label="Zoom percentage">
        {zoomPercent(pxPerFrame)}%
      </span>
      <button type="button" onClick={() => onZoom(clampPxPerFrame(pxPerFrame * 1.4))} aria-label="Zoom in" title="Zoom in, until a single frame is clearly visible ( + )" className={btn}>
        <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onFit} aria-label="Reset zoom" title={`Back to 100% — ${DEFAULT_PX_PER_FRAME} pixels per frame ( 0 )`} className={btn}>
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

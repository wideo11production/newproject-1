'use client';

// ============================================================================
// Timeline ruler
// ============================================================================
//
// A MEASURING TAPE, not a clock face. Movavi's ruler is a ruler first and a
// readout second: ticks of graded weight along a hard baseline, labels that
// change format with the zoom, and a cursor that reports the frame under the
// pointer even when you are not scrubbing. This is that.
//
// ---- TWO BANDS, NO MODE FLAG ----
//
//   top band     scrub - click or drag to move the playhead
//   bottom band  measure - drag out a selection and read its length
//
// A mode flag would need a toggle, a visible state and a way to forget it. Two
// bands need neither, and the hover cursor tells you which is which before you
// press. Every NLE eventually did this; the ones that did not kept a "tool" row
// for it.
//
// ---- THE TICK LADDER IS IN FRAMES ----
//
// Steps are chosen from a ladder of FRAME counts, not seconds. At 30fps a
// "2 second" step is 60 frames and at 60fps it is 120, so a second-based ladder
// changes which numbers appear on the ruler every time the frame rate changes -
// and the ruler is the one thing the user reads while deciding where to cut.
// In frames, a 60-frame step stays a 60-frame step.
//
// ---- ZOOM IS PIXELS PER FRAME ----
//
// `pxPerFrame` rather than a multiplier on seconds-per-pixel, because a
// multiplier's meaning drifts with the frame rate: "4x" is 480px/s at 30fps and
// 960 at 60, so changing a project's frame rate would silently double its
// zoom. Pixels per frame is absolute, and it makes "at maximum zoom every frame
// is visible" a property of the number rather than a hope.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Minus, Magnet, Ruler as RulerIcon } from 'lucide-react';
import { clampPxPerFrame, frameToTimecode, zoomPercent, DEFAULT_PX_PER_FRAME } from '../../lib/engine/frames';
import { MARKER_COLOURS, type Marker } from '../../lib/engine/markers';

/**
 * Ruler height, in px.
 *
 * Exported because the track header's column-header row has to be EXACTLY this
 * tall, or every lane sits 8px above its own header row. Measured, not
 * eyeballed: with the ruler at 40 and the header at 32, all three lanes were
 * off by exactly 8 - so clicking a lane's controls landed on the neighbour.
 *
 * One constant, so the two cannot drift apart again.
 */
export const RULER_HEIGHT = 40;

/**
 * Label spacing, in pixels. A label is about 5 characters at every zoom, so the
 * rule is: pick the smallest step from the ladder whose rendered gap clears
 * this. Measuring the gap instead of counting ticks is what stops the labels
 * colliding at 60fps, where a "2 second" step is twice as many frames.
 */
const MIN_LABEL_GAP = 46;

/**
 * The tick ladder, in FRAMES.
 *
 * Each entry also carries how tall its tick is, so the ruler reads as a scale
 * with weight rather than as a row of identical dashes.
 */
const LADDER: Array<{ frames: number; major: boolean }> = [
  { frames: 1, major: true },
  { frames: 2, major: false },
  { frames: 5, major: false },
  { frames: 10, major: true },
  { frames: 15, major: false },
  { frames: 30, major: true },
  { frames: 60, major: true },
  { frames: 120, major: false },
  { frames: 300, major: true },
  { frames: 600, major: true },
  { frames: 1800, major: false },
  { frames: 3600, major: true },
  { frames: 10800, major: false },
  { frames: 21600, major: true },
];

/** The finest step from the ladder that still leaves `MIN_LABEL_GAP` between labels. */
function chooseStep(pxPerFrame: number) {
  for (const rung of LADDER) {
    if (rung.frames * pxPerFrame >= MIN_LABEL_GAP) return rung;
  }
  return LADDER[LADDER.length - 1];
}

/**
 * Label format, by zoom.
 *
 * Frames first, because once a frame is wide enough to see it is the only
 * number that matters. Fractional seconds in the middle, where they are easier
 * to compare than a colon-separated timecode. `MM:SS` last, for the zoomed-out
 * case where a frame is a fraction of a pixel and naming it would be noise.
 */
function labelFor(frame: number, fps: number, pxPerFrame: number): string {
  if (pxPerFrame >= 14) return String(frame);
  if (pxPerFrame >= 8) return (frame / fps).toFixed(3);
  if (pxPerFrame >= 3) return frameToTimecode(frame, fps).slice(3);
  return frameToTimecode(frame, fps).slice(3, 8);
}

export /**
 * Pointer travel, in pixels, before a ruler drag becomes a PAN rather than a
 * SCRUB.
 *
 * Four pixels. Not one, and not ten.
 *
 * One would make every click a pan, because a mouse click always emits at least one
 * `pointermove` with sub-pixel travel — and on a trackpad that "click" is the
 * entire gesture.
 *
 * Ten would be noticeable. Scrubbing across a short region is a fast gesture, and
 * ten pixels of dead zone at the start of it feels like the ruler ignoring you.
 *
 * Four is roughly the threshold at which intent is unambiguous and still below the
 * distance a person covers in the first frame of a deliberate drag.
 */
const PAN_THRESHOLD_PX = 4;

/**
 * Which half of the ruler does a PRESS mean?
 *
 * Top 55% scrubs; below it measures.
 *
 * Fixed at PRESS time and re-read only on the next gesture: deciding it again
 * inside the move handler would let a drag that wanders vertically change what it
 * means halfway through, which is the worst possible moment for a gesture to change
 * its meaning.
 */
export function TimelineRuler({
  duration,
  currentFrame,
  pxPerFrame,
  fps,
  laneWidth,
  onSeek,
  onZoomAt,
  loop,
  onSetLoop,
  markers,
  measure,
  onSetMeasure,
  gridVisible,
  snapEnabled,
}: {
  duration: number;
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
  /** The measurement selection, in frames. -1 when nothing is measured. */
  measure: { start: number; end: number };
  onSetMeasure: (start: number, end: number) => void;
  gridVisible: boolean;
  snapEnabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  /**
   * Frame under a viewport x.
   *
   * The element's own rect already accounts for the shared strip's scroll, so
   * there is no `scrollLeft` term here - and adding one would double-count it,
   * which is exactly the bug that put the ruler 178px out of step with the
   * clips before they shared one scroll container.
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

  /**
   * Which half of the ruler is the pointer in? Measured, never guessed.
   *
   * The split sits at 55% and SCRUB owns it. The reason is not symmetry: a
   * click exactly on the midpoint has to do the more common thing. When the
   * boundary was at 50%, a click at the vertical centre of the ruler measured
   * instead of scrubbing, which meant the single most obvious thing to do to a
   * ruler did nothing visible.
   */
  const bandAt = useCallback((clientY: number): 'scrub' | 'measure' => {
    const el = ref.current;
    if (!el) return 'scrub';
    const box = el.getBoundingClientRect();
    return clientY - box.top <= box.height * 0.55 ? 'scrub' : 'measure';
  }, []);

  // =============================================================================
  // SCRUB vs PAN
  // =============================================================================
  //
  // THE BUG THIS FIXES, AS REPORTED: "ruler fix karo, clips audio aur title scroll
  // upar-neche ho, matlab ruler fixed rehta hai — use se pata nahi chalta."
  //
  // The ruler is NOT fixed, and that was worth checking first. It has no
  // `overflow-x` of its own, so it lives inside the shared scroll strip and
  // scrolls natively with the tracks. The marks are positioned by
  // `frame * pxPerFrame` inside a `width: laneWidth` wrapper, so they move with
  // the content by construction.
  //
  // What actually happens is worse than being fixed: **you cannot scroll the
  // timeline by dragging the ruler.** `beginScrub` calls `preventDefault()` and
  // then, on every `pointermove`, calls `onSeek()`. So a horizontal drag across
  // the ruler does not scroll — it drags the PLAYHEAD. Every attempt to scroll by
  // the most natural gesture, the one every NLE supports, moves the cursor
  // thousands of frames sideways instead.
  //
  // THE FIX: distinguish the two by INTENT, using distance rather than direction.
  //
  // A threshold, not a direction test. Direction alone is ambiguous here: a
  // diagonal drag is both a scrub and a pan, and a rule that treats it as one or
  // the other is wrong half the time. Distance is unambiguous — under 4px the
  // pointer has not moved far enough for the user to have meant anything, so it is
  // a click; over 4px they have.
  //
  // `pointerId` is tracked rather than `buttons`, because on a drag the buttons
  // may already be released by the time the last move arrives, and a drag that
  // stops being a drag mid-gesture is a gesture whose meaning changes under the
  // user's hand — the same failure `beginScrub`'s own comment warns about for the
  // band decision.
  //
  // WHY THE SHARED STRIP IS FOUND BY WALKING UP, NOT PASSED IN
  //
  // Because the ruler is rendered INSIDE that strip by `video-editor.tsx`, and the
  // strip is `position: relative` above it. Walking to the nearest ancestor with
  // horizontal overflow is self-contained, needs no signature change, and keeps
  // working if the ruler is reused elsewhere. The alternative — threading a ref
  // through two components to pass one element — is more code for less clarity.
  const scrollHost = useCallback((): HTMLElement | null => {
    let node: HTMLElement | null = ref.current?.parentElement ?? null;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowX)) return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  const beginScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pid = e.pointerId;
    // The band is fixed at PRESS time and re-read only on the next gesture.
    // Deciding it again inside the move handler would let a drag that wanders
    // vertically change what it means halfway through, which is the worst
    // possible moment for a gesture to change its meaning.
    const startBand = bandAt(e.clientY);
    // The anchor stays where the press landed, so a measurement can grow in
    // EITHER direction instead of always extending to the right.
    const anchor = frameAt(e.clientX);

    // ---- Pan bookkeeping. See the note above for why this is distance and not
    // direction, and why `pointerId` and not `buttons`. ----
    const startX = e.clientX;
    const host = scrollHost();
    const scrollAtStart = host?.scrollLeft ?? 0;
    let panning = false;

    // Apply the threshold to the first move too, so a click that jitters two
    // pixels does not turn into a pan. Without it, the very first `pointermove`
    // after a press decides, and trackpads emit one for a plain click.
    const maybeStartPan = (clientX: number) => {
      if (panning || Math.abs(clientX - startX) < PAN_THRESHOLD_PX) return false;
      panning = true;
      // The seek that `beginScrub` already performed is undone by scrolling back to
      // where the strip was, so a pan never leaves the playhead somewhere the user
      // did not put it.
      if (host) host.scrollLeft = scrollAtStart;
      return true;
    };

    if (startBand === 'scrub') onSeek(anchor / fps);
    else onSetMeasure(anchor, anchor);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;

      if (startBand === 'scrub') {
        if (maybeStartPan(ev.clientX)) {
          // PAN. Move the shared strip by the pointer delta, negated because
          // dragging content right scrolls it left - the same relationship as
          // dragging a physical strip of film.
          if (host) host.scrollLeft = scrollAtStart - (ev.clientX - startX);
          return;
        }
        onSeek(frameAt(ev.clientX) / fps);
      } else {
        const head = frameAt(ev.clientX);
        onSetMeasure(Math.min(anchor, head), Math.max(anchor, head));
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
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
   * and without preventDefault the strip scrolls horizontally while the zoom
   * also runs.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      onZoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoomAt]);

  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => setHoverFrame(frameAt(e.clientX));
    const onLeave = () => setHoverFrame(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [frameAt]);

  const rung = useMemo(() => chooseStep(pxPerFrame), [pxPerFrame]);
  const labelList = useMemo(() => {
    const out: number[] = [];
    for (let f = 0; f <= totalFrames; f += rung.frames) out.push(f);
    return out;
  }, [rung.frames, totalFrames]);

  const markerList = useMemo(() => [...markers].sort((a, b) => a.frame - b.frame), [markers]);
  const hasMeasure = measure.start >= 0 && measure.end > measure.start;
  const measureLen = hasMeasure ? measure.end - measure.start : 0;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Timeline ruler"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={totalFrames}
      aria-valuenow={currentFrame}
      aria-valuetext={`${frameToTimecode(currentFrame, fps)}, frame ${currentFrame} of ${totalFrames}`}
      onPointerDown={beginScrub}
      onKeyDown={onKey}
      style={{ width: laneWidth, height: RULER_HEIGHT }}
      // `cursor-ew-resize` on the WHOLE ruler was half the problem: it advertised
      // "drag me to resize", so the cursor confirmed the wrong expectation and the
      // drag confirmed it too.
      //
      // The ruler is now BOTH: a short drag scrubs, a long drag pans. There is no
      // single cursor that can say both honestly, so it says the safer one —
      // `grab` — and the behaviour is discoverable by doing rather than by looking.
      className="group relative shrink-0 cursor-grab select-none border-b border-edge bg-surface-raised focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#ff6500] active:cursor-grabbing"
    >
      {/* ---- The baseline. A hard edge along the bottom is what makes a strip
           of dashes read as a ruler rather than as a broken border. ---- */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-fg-muted/50" aria-hidden="true" />

      {/* ---- Measurement selection. Drawn above the ticks so it reads as a
           region ON the scale rather than as part of it. ---- */}
      {hasMeasure && (
        <>
          <div
            className="pointer-events-none absolute top-0 h-full border-x border-[#ff6500]/80 bg-[#ff6500]/15"
            style={{ left: measure.start * pxPerFrame, width: Math.max(1, measureLen * pxPerFrame) }}
          />
          {/*
            The measurement read-out.

            It lives in the BOTTOM band, not the top one, because the top band
            is where the tick labels are. Printed over them it produced
            `00:00:02:0060f · 2.000s` - two labels occupying the same pixels,
            neither readable.
          */}
          <div
            className="pointer-events-none absolute bottom-0 left-1 rounded bg-surface-overlay px-1 font-mono text-[8px] whitespace-nowrap text-fg-secondary"
            style={{ left: (measure.start + measureLen / 2) * pxPerFrame }}
          >
            {measureLen}f · {(measureLen / fps).toFixed(3)}s · {frameToTimecode(measureLen, fps)}
          </div>
          {(['start', 'end'] as const).map((edge) => {
            const x = (edge === 'start' ? measure.start : measure.end) * pxPerFrame;
            return (
              <div
                key={edge}
                role="separator"
                aria-label={`Move the ${edge} of the measurement`}
                aria-orientation="vertical"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const startX = e.clientX;
                  const base = edge === 'start' ? measure.start : measure.end;
                  const move = (ev: PointerEvent) => {
                    const next = Math.max(0, Math.min(totalFrames, base + (ev.clientX - startX) / pxPerFrame));
                    if (edge === 'start') onSetMeasure(Math.round(Math.min(next, measure.end - 1)), measure.end);
                    else onSetMeasure(measure.start, Math.round(Math.max(next, measure.start + 1)));
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
                title={edge === 'start' ? 'Measurement in point — drag' : 'Measurement out point — drag'}
                className="absolute top-0 z-30 h-full w-2 cursor-ew-resize"
                style={{ left: x - 4 }}
              >
                <span className="mx-auto block h-full w-0.5 bg-sky-300" />
              </div>
            );
          })}
        </>
      )}

      {/* ---- Loop region ---- */}
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

      {/* ---- Ticks.
           Three weights, so the ruler has a readable rhythm instead of a row of
           identical dashes. The intermediate rung is what turns a strip into a
           scale: it is the reason you can count five frames without counting
           them one at a time. ---- */}
      {pxPerFrame >= 4 &&
        labelList.map((f) => {
          const sub = f % (rung.frames * 5) === 0 ? 2 : f % rung.frames === 0 ? (rung.major ? 6 : 4) : 0;
          if (!sub) return null;
          return (
            <span
              key={`s${f}`}
              className="pointer-events-none absolute bottom-0 w-px bg-fg-muted/25"
              style={{ left: f * pxPerFrame, height: sub }}
            />
          );
        })}
      {labelList.map((f) => (
        <span
          key={`m${f}`}
          className={[
            'pointer-events-none absolute bottom-0 w-px',
            rung.major ? 'bg-fg-muted/70' : 'bg-fg-muted/40',
          ].join(' ')}
          style={{ left: f * pxPerFrame, height: rung.major ? 9 : 6 }}
        />
      ))}

      {/* ---- Labels ---- */}
      {labelList.map((f) => (
        <span
          key={`l${f}`}
          className="pointer-events-none absolute left-0 top-0.5 select-none whitespace-nowrap font-mono text-[8px] text-fg-muted"
          style={{ left: f * pxPerFrame + 3 }}
        >
          {labelFor(f, fps, pxPerFrame)}
        </span>
      ))}

      {/* ---- Markers ---- */}
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
          className="absolute left-0 top-0 z-20 -translate-x-1/2 cursor-pointer p-0"
          style={{ top: 14 }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1 L9 1 L5 9 Z" fill={MARKER_COLOURS[m.colour]} />
          </svg>
        </button>
      ))}

      {/* ---- Cursor readout.
           The number under the pointer, whenever the pointer is over the ruler.
           This is what makes it a measuring instrument rather than a clock: you
           can read a position without committing to it. ---- */}
      {hoverFrame !== null && (
        <div
          className="pointer-events-none absolute bottom-1 top-1 z-30 w-px bg-white/25"
          style={{ left: hoverFrame * pxPerFrame }}
          aria-hidden="true"
        >
          <span className="absolute -top-px left-1 whitespace-nowrap rounded bg-slate-950/90 px-1 font-mono text-[8px] text-slate-200">
            f{hoverFrame} · {frameToTimecode(hoverFrame, fps)}
          </span>
        </div>
      )}

      {/* ---- Playhead: a line and a head, because one element cannot be both
           1px wide and a triangle without one of the two being wrong. ---- */}
      <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-rose-500" style={{ left: currentFrame * pxPerFrame }} />
      <div
        className="pointer-events-none absolute top-0 z-30 -ml-[5px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-rose-500"
        style={{ left: currentFrame * pxPerFrame }}
      />

      {/*
        The zoom / tick read-out.

        It lives in the BOTTOM band, not the top one, and that is a fix rather
        than a preference: the top band is where the tick labels are, and a
        read-out printed over them makes both unreadable - the screenshot showed
        `00:08:00px/f` where two labels and the read-out were fighting.

        The bottom band is the measure band, and this element is
        `pointer-events-none`, so it cannot steal a measurement drag.
      */}
      {/*
        NO zoom read-out on the ruler.

        It carried a "3.00px/f - tick 30f" chip in its corner, which was in
        the wrong place twice over: it is a ZOOM control, and zoom already
        lives in the toolbar with a slider and a live percentage. On the ruler
        it was a second, smaller copy of a number visible on every glance, and
        it sat on top of the tick labels. Gone from here, still in the toolbar.
      */}
    </div>
  );
}

/**
 * The zoom control, in the timeline's own header column.
 *
 * A slider as well as the buttons: dragging a handle gives the fine control
 * that clicking + and - cannot, and it shows the value as it changes rather than
 * only after the click.
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
        <ZoomOut className="h-2 w-2" aria-hidden="true" />
      </button>
      <input
        type="range"
        min={1}
        /* 6400 = 64 pixels per frame, the top of `clampPxPerFrame`. The range
           has to REACH the clamp rather than stop near it: "zoom to single
           frame" is a requirement, and a slider whose maximum is 20px per frame
           cannot deliver a frame you can work with. */
        max={6400}
        step={1}
        value={Math.round(pxPerFrame * 100)}
        onChange={(e) => onZoom(clampPxPerFrame(Number(e.target.value) / 100))}
        aria-label="Timeline zoom"
        title={`Timeline zoom: ${zoomPercent(pxPerFrame)}% — ${pxPerFrame.toFixed(2)} pixels per frame\nDrag to zoom, or Alt+scroll anywhere on the ruler.`}
        className="h-1 w-12 cursor-pointer accent-[#ff6500]"
      />
      <span className="w-8 text-center font-mono text-[8px] text-fg-secondary" aria-label="Zoom percentage">
        {zoomPercent(pxPerFrame)}%
      </span>
      <button type="button" onClick={() => onZoom(clampPxPerFrame(pxPerFrame * 1.4))} aria-label="Zoom in" title="Zoom in, until a single frame is clearly visible ( + )" className={btn}>
        <ZoomIn className="h-2 w-2" aria-hidden="true" />
      </button>
      <button type="button" onClick={onFit} aria-label="Reset zoom" title={`Back to 100% — ${DEFAULT_PX_PER_FRAME} pixels per frame ( 0 )`} className={btn}>
        <Minus className="h-2 w-2" aria-hidden="true" />
      </button>
    </div>
  );
}

'use client';

// ============================================================================
// TIMELINE RIGHT RAIL
// ============================================================================
//
// A narrow strip on the right of the timeline, the full height of the lanes. It
// holds two things:
//
//   * the VOICE METER - vertical, filling the lane height, reading the master
//     bus. It was in the player bar, where it was one small thing among thirty
//     controls and impossible to read at a glance. Here it is the full height of
//     the timeline, so a peak is visible from across the room, which is the whole
//     point of a meter.
//   * the RULER ZOOM - in, out and fit. This was on the ruler, then moved to the
//     toolbar when the ruler shrank, and has been missing from both since. It
//     belongs with the thing it zooms.
//
// ---- WHY A RAIL AND NOT MORE BUTTONS ----
//
// The toolbar is a horizontal strip forty controls wide. A vertical meter needs
// vertical space, and putting it in the toolbar meant a 16px-tall stub that read
// as a decoration. The lanes are already tall; the rail uses that height instead
// of taking any of it away.

import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Minus, AudioWaveform } from 'lucide-react';
import { levelBands } from '../../lib/engine/audio-graph';
import { clampPxPerFrame, zoomPercent } from '../../lib/engine/frames';

export function TimelineRail({
  playing,
  pxPerFrame,
  onZoomTo,
  onFit,
}: {
  playing: boolean;
  /** Pixels per frame - the same unit the ruler is drawn in. */
  pxPerFrame: number;
  onZoomTo: (pxPerFrame: number) => void;
  onFit: () => void;
}) {
  const [bands, setBands] = useState<number[]>(() => new Array(14).fill(0));

  useEffect(() => {
    if (!playing) {
      // Settle to rest rather than freezing mid-bar: a frozen meter would still
      // be claiming a level the moment the audio stopped.
      let raf = 0;
      const settle = () => {
        setBands((b) => {
          const next = b.map((v) => v * 0.82);
          return next.some((v) => v > 0.01) ? next : new Array(14).fill(0);
        });
        raf = requestAnimationFrame(settle);
      };
      raf = requestAnimationFrame(settle);
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const tick = () => {
      setBands(levelBands(14));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const btn =
    'flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg disabled:opacity-40';

  return (
    <div
      className="flex w-7 shrink-0 flex-col items-center gap-1 border-l border-edge bg-surface"
      title="Output level and timeline zoom"
    >
      <div className="flex h-7 items-center justify-center border-b border-edge">
        <AudioWaveform className="h-2 w-2 text-fg-muted" aria-hidden="true" />
      </div>

      {/* The meter: 14 bars growing UPWARD, the full height of the lanes.
          Green under -12dB, amber to -3, red above - a gain-stage convention,
          not a personal preference. */}
      <div
        role="meter"
        aria-label="Output level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(0, ...bands) * 100)}
        className="flex min-h-0 flex-1 flex-col-reverse items-center gap-px px-1 py-2"
      >
        {bands.map((v, i) => {
          const lit = v > 0.02;
          const colour = v > 0.89 ? '#f87171' : v > 0.62 ? '#fbbf24' : '#34d399';
          return (
            <span
              key={i}
              className="w-1.5 rounded-sm transition-[height,background-color] duration-75"
              style={{
                // A 1px floor so the meter reads as a column at rest instead of
                // vanishing and leaving a mystery gap in the rail.
                height: `${Math.max(1, Math.round(v * 100))}%`,
                background: lit ? colour : 'rgb(var(--ve-edge))',
                opacity: lit ? 1 : 0.5,
              }}
            />
          );
        })}
      </div>

      {/* Ruler zoom. Back where it started, because a control that is not next
          to the thing it changes is a control people stop finding. */}
      <div className="flex flex-col items-center gap-0.5 border-t border-edge py-1">
        <button
          type="button"
          onClick={() => onZoomTo(clampPxPerFrame(pxPerFrame * 1.4))}
          aria-label="Zoom the timeline in"
          title="Zoom in — until a single frame is plainly visible ( + )"
          className={btn}
        >
          <ZoomIn className="h-2 w-2" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onZoomTo(clampPxPerFrame(pxPerFrame / 1.4))}
          aria-label="Zoom the timeline out"
          title="Zoom out — see more of the timeline ( - )"
          className={btn}
        >
          <ZoomOut className="h-2 w-2" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onFit}
          aria-label="Reset the timeline zoom"
          title={`Reset to 100% — ${zoomPercent(pxPerFrame)}% now ( 0 )`}
          className={btn}
        >
          <Minus className="h-2 w-2" aria-hidden="true" />
        </button>
        {/* The live scale. It was on the ruler, then in the toolbar, and is here
            now with the buttons it describes - a number that moves when the
            control above it is used, rather than a copy somewhere else. */}
        <span
          className="font-mono text-[8px] text-fg-muted"
          aria-label="Timeline zoom scale"
          title={`${pxPerFrame.toFixed(2)} pixels per frame`}
        >
          {pxPerFrame.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
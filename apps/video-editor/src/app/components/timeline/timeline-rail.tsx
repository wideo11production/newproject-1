'use client';

// ============================================================================
// BORDERLESS TIMELINE DESIGN — Hinglish architecture note
// ============================================================================
//
// Rail pehle se borderless thi — koi bhi `border-edge` nahi, aur saare
// interactive buttons pehle se `rounded-md` hain. Ye file sirf confirmation
// hai. Rail ek `#1a1a1a` Rich Charcoal sidebar hai (voice meter + zoom
// controls), aur uske buttons `duration-150` transition ke saath
// `hover:text-[#ff6500]` orange-red accent use karte hain — default quiet,
// interaction par accent.
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

import { useEffect, useRef, useState } from 'react';
import { AudioWaveform, Speaker, Volume2 } from 'lucide-react';
import { stereoLevels } from '../../lib/engine/audio-graph';

/** Rail width: EXACTLY 25px (user spec — narrow professional meter strip). */
const RAIL_W = 25;

/**
 * dB scale marks, top to bottom. `dB -> fraction of meter height`, with
 * -60dBFS as the floor. The numbers printed beside the bars are the same ones
 * every gain stage uses, so a peak at -6 reads instantly.
 */
const DB_TICKS: Array<{ db: number; label: string }> = [
  { db: 0, label: '0' },
  { db: -6, label: '-6' },
  { db: -18, label: '-18' },
  { db: -42, label: '-42' },
];

/** RMS (0..1) -> dBFS. -70 floor keeps silence off the scale. */
function toDb(rms: number): number {
  if (rms <= 0.0005) return -70;
  return Math.max(-70, 20 * Math.log10(rms));
}

/** dBFS -> 0..1 meter height (floor -60dB). */
function dbToFill(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function TimelineRail({
  playing,
}: {
  playing: boolean;
}) {
  // Twin bars: per-channel RMS from the master bus, plus a peak-hold marker
  // per channel that decays at 12dB/s - the pro-meter convention.
  const [levels, setLevels] = useState({ l: 0, r: 0 });
  const peaksRef = useRef({ l: 0, r: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { l, r } = stereoLevels();
      setLevels({ l, r });
      const peaks = peaksRef.current;
      // Peak-hold: rise instantly, fall slowly (12dB per second).
      for (const key of ['l', 'r'] as const) {
        if (levels[key] > peaks[key]) peaks[key] = levels[key];
        else peaks[key] = Math.max(levels[key], peaks[key] * Math.pow(10, -12 * dt / 20));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ldB = toDb(levels.l);
  const rdB = toDb(levels.r);
  const lFill = dbToFill(ldB);
  const rFill = dbToFill(rdB);
  const lPeak = dbToFill(toDb(peaksRef.current.l));
  const rPeak = dbToFill(toDb(peaksRef.current.r));
  const active = playing && (levels.l > 0 || levels.r > 0);

  // One bar: gradient track (green -> amber -> orange-red -> red bottom-up),
  // a dark mask covering the unlit part, and a peak-hold hairline.
  const bar = (fill: number, peak: number, label: string, live: boolean, Icon: typeof Speaker) => (
    <div className="relative h-full w-[8px] shrink-0 overflow-hidden rounded-md bg-[#0d0f11]">
      {/* Lit portion: the bar up to `fill`, gradient green -> amber -> orange-red -> red. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: `${fill * 100}%`,
          background: 'linear-gradient(to top, #22c55e 0%, #22c55e 42%, #fbbf24 62%, #ff6500 84%, #ef4444 100%)',
        }}
        aria-hidden="true"
      />
      {/* Dark mask from `fill` up: the unlit remainder of the track. */}
      {fill < 1 && (
        <div
          className="absolute inset-x-0 top-0 bg-[#0d0f11]/85"
          style={{ height: `${(1 - fill) * 100}%` }}
          aria-hidden="true"
        />
      )}
      {/* Peak-hold hairline, 1px, white so it reads on any colour. */}
      {peak > 0.01 && (
        <div
          className="absolute inset-x-0 h-px bg-white/90"
          style={{ bottom: `${peak * 100}%` }}
          aria-hidden="true"
        />
      )}
      <span className="absolute bottom-0 left-0 right-0 text-center text-[6px] leading-none text-fg-muted/70">
        {label}
      </span>
      <Icon
        className={`absolute left-1/2 top-0.5 h-2 w-2 -translate-x-1/2 ${live ? 'text-[#ff6500]' : 'text-fg-muted/40'}`}
        aria-hidden="true"
      />
    </div>
  );

  return (
    <div
      style={{ width: RAIL_W }}
      className="flex shrink-0 flex-col items-center gap-1 bg-[#1a1a1a]"
      title="Output level (L/R)"
    >
      <div className="flex h-7 items-center justify-center">
        <AudioWaveform className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
      </div>

      {/* The meter: EXACTLY 25px strip, twin L/R bars full height, dB scale. */}
      <div className="relative flex min-h-0 flex-1 items-stretch gap-0.5 px-0.5 py-2">
        {/* dB scale numbers, right of the bars (gain-stage convention). */}
        <div className="relative w-[14px] shrink-0">
          {DB_TICKS.map((t) => (
            <span
              key={t.db}
              className="absolute right-0 font-mono text-[6px] leading-none text-fg-muted/60"
              style={{ bottom: `calc(${dbToFill(t.db) * 100}% - 3px)` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        {bar(lFill, lPeak, 'L', active && levels.l > 0, Speaker)}
        {bar(rFill, rPeak, 'R', active && levels.r > 0, Volume2)}
      </div>
    </div>
  );
}
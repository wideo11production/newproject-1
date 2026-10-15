// ============================================================================
// AURA Micro-Frame Studio — INLINE WORKSPACE PANEL (editor twin)
// ============================================================================
//
// Hinglish architecture (is refactor me kya badla):
//
// PEHLE: ye ek DIALOG tha — `position: fixed` portal me timeline ke right half
// ke upar baithti thi. Kaam kar rahi thi, par wo OVERLAY thi: lanes ke neeche
// wahi clips physically rehte the (sirf dikhte nahi the), aur panel ka apna
// scroll/position fixed-viewport se calculate hota tha.
//
// AB (user spec): timeline ka layout HI adaptive hai —
//   * `showAuraStudio === false` -> ye component `null` return karta hai
//     (cleanly unmount). Timeline row me sirf lane-scroll `flex-1` hota hai =
//     multi-track rails 100% full width stretch.
//   * `showAuraStudio === true`  -> timeline row ke andar, lanes ke bagal me,
//     ye panel INLINE render hota hai: lanes `w-1/2`, 1px separator, panel
//     `w-1/2` — symmetric 50/50 division. Koi overlay nahi, koi fixed nahi:
//     panel timeline ka real flex child hai, isliie resize/scroll layout ke
//     saath perfectly move karta hai.
//
// DESIGN TOKENS (port 3000/editor design system ke mutabik):
//   * Panel canvas : #161616 deep matte charcoal, rounded-md
//   * Lanes backdrop: #1e1e1e grayish-black slate (video-editor.tsx me)
//   * ZERO wireframe borders kahin bhi; separation sirf color depth se
//   * Accent #ff6500, 150ms transitions
//   * Ghost scrollbar: panel ka overflow-y-auto editor ke GLOBAL
//     `*::-webkit-scrollbar` rules use karta hai — 0px dikhega nahi, hover par
//     1px #ff6500 thumb aayega (globals.css already enforce karta hai)
//
// ICON PARITY SWEEP: saare tool buttons 16px block (h-4 w-4) + 10px glyph
// (h-2.5 w-2.5), zero outer framing (border-0, ring-0). Pehle h-7 w-7 the.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layers,
  X,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Scissors,
  Type,
  Settings,
  Film,
  Grid3x3,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Slider } from '@wideo11/ui/slider';
import { cn } from '@wideo11/ui/lib/utils';
// Hinglish: shared playback speed list + formatter (0.0001x micro-step se 4x).
import { PLAYBACK_SPEEDS, formatSpeed } from '../lib/engine/frames';
// Hinglish: AURA ka apna pixel editor — full-screen overlay, editor ke sabse
// ooper. Ye AURA ME HI banta hai, kahin aur nahi.
import { AuraPixelEditor } from './aura/pixel-editor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuraFrameEdit {
  frame: number;
  bounds: { x: number; y: number; w: number; h: number };
  prompt: string;
  createdAt: number;
}

// Hinglish: Zero-Duplication sync payload — NAYA storage nahi banata, sirf
// EXISTING timeline storage hook (onTimelineSync) ko call karta hai.
export interface AuraTimelineSyncPayload {
  frames: number[];
  edits: AuraFrameEdit[];
  source: 'aura-micro-frame-studio';
}

export interface AuraMicroFrameStudioProps {
  /** Panel ka open state. false = component poori tarah unmount (collapse). */
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
  // ---- Superadmin + env security gate ----
  userEmail?: string;
  isSuperadmin?: boolean;
  // ---- Zero-Duplication sync hook (existing timeline storage) ----
  onTimelineSync?: (payload: AuraTimelineSyncPayload) => void;
  // ---- Pixel editor ka source frame (clip poster) ----
  // Hinglish: pixel editor open hone par yahi image grid me load hoti hai.
  // Naya data flow nahi — `clipUnderPlayhead` ka existing poster, pass-through.
  sourceImageUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hinglish: Superadmin gate ka email — strictly sirf ye account (verified
// superadmin token state ke saath) hi AURA studio access kar sakta hai.
// RBAC Enforcer: yahi param layout flags ko toggle karta hai —
// 'advchashampalup@gmail.com' + isSuperadmin + env flag = panel dikhega.
const AURA_SUPERADMIN_EMAIL = 'advchashampalup@gmail.com';

// Hinglish: Player range spec — 1 microsecond se shuru, maximum 3 seconds.
const MAX_DURATION_MS = 3000;

// Hinglish: 3 seconds = 120fps * 3 = 360 frames maximum (user spec).
const MAX_SECONDS = 3;

// Hinglish: Industry-grade sizing. Movavi/Premiere/DaVinci sab 16px icons aur
// 11-13px labels pe chalte hain — 10px glyph "desi" lagta hai aur Retina pe
// blurry. Glyph = 16px (industry standard), click target = 32px (TOOL_BUTTON_CLASS).
const GLYPH_16 = 'h-4 w-4';

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function getThreeFrameBuffer(activeFrame: number, totalFrames: number): number[] {
  // STRICT 3-FRAME BUFFER RING — never more, never less.
  // If at the start, buffer is frames 0,1,2. If at the end, it's the last 3.
  const start = Math.max(0, Math.min(activeFrame - 1, totalFrames - 3));
  return [start, start + 1, start + 2].filter((f) => f < totalFrames);
}

export function frameToTimestamp(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor(frame % fps);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

function msToTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const remainingMs = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingMs).padStart(3, '0')}`;
}

/**
 * MICROSECOND timestamp — `HH:MM:SS.mmmuuu`.
 *
 * Hinglish: 1 microsecond = 1/1,000,000 second. Player ke scrubber ka step
 * 0.001ms (= 1μs) hai, isliye display bhi μs tak jani chahiye warna
 * 1μs ki precision dikhti hi nahi. Example: `00:00:01.001500` = 1 second
 * + 1.5 millisecond + 500 microsecond.
 */
function usToTimestamp(totalUs: number): string {
  const us = Math.max(0, Math.round(totalUs));
  const hours = Math.floor(us / 3_600_000_000);
  const minutes = Math.floor((us % 3_600_000_000) / 60_000_000);
  const seconds = Math.floor((us % 60_000_000) / 1_000_000);
  const millis = Math.floor((us % 1_000_000) / 1000);
  const micros = us % 1000;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `${p2(hours)}:${p2(minutes)}:${p2(seconds)}.${p3(millis)}${p3(micros)}`;
}

// ---------------------------------------------------------------------------
// Playback Speed Options — SHARED list (frames.ts): 0.0001x micro-step se 4x.
// Hinglish: micro-steps (0.0001x/0.001x/0.01x) micro-frame analysis ke liye;
// toolbar ke identical set — consistency.
// ---------------------------------------------------------------------------

// Hinglish: shared tool-button — tactile 32px target, 16px glyph, borderless.
// Hover pe faint white wash + accent color (industry editors plain color
// change se zyada ek subtle surface dena pasand karte hain — button "pakda"
// ja sakta hai). Focus-visible pe soft accent ring (keyboard a11y ke liye).
const TOOL_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#9fa7b3] shadow-none outline-none transition-colors duration-150 hover:bg-white/[0.06] hover:text-[#ff6500] focus-visible:ring-1 focus-visible:ring-[#ff6500]/40 focus-visible:ring-offset-0';

// ---------------------------------------------------------------------------
// Main Inline Panel Component
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
  userEmail,
  isSuperadmin,
  onTimelineSync,
  sourceImageUrl,
}: AuraMicroFrameStudioProps) {
  // -------------------------------------------------------------------------
  // SUPERADMIN + ENV SECURITY GATE (RBAC Enforcer)
  // Hinglish: env flag + session email + superadmin token state — teeno
  // milne par hi panel render hota hai. 'advchashampalup@gmail.com' ke
  // superadmin sessions ko premium AURA module instantly dikhta hai.
  // -------------------------------------------------------------------------
  const isSuperAdminEnvEnabled =
    process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';
  const normalizedEmail = (userEmail ?? '').toLowerCase().trim();
  const isAuthorized =
    isSuperAdminEnvEnabled &&
    isSuperadmin === true &&
    normalizedEmail === AURA_SUPERADMIN_EMAIL;

  // Duration + frame caps (user spec: 1μs start, max 3 seconds = 360 frames
  // at 120fps). Hinglish: durationMs 3000 se zyada clamp, frames fps*3 clamp.
  const effectiveDurationMs = Math.min(durationMs, MAX_DURATION_MS);
  const maxFramesForDuration = Math.round(fps * MAX_SECONDS);
  const effectiveTotalFrames = Math.min(totalFrames, maxFramesForDuration);

  const [threeFrameBuffer, setThreeFrameBuffer] = useState<number[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  // Hinglish: pixel editor overlay ka state. Ye AURA me hi rehta hai — band
  // hone par poora unmount, panel apna 50/50 layout wapas le leta hai.
  const [pixelEditorOpen, setPixelEditorOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // 3-Frame Strict Buffer Ring — hard-clamped, koi drift nahi.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const frames = getThreeFrameBuffer(activeFrame, effectiveTotalFrames);
    setThreeFrameBuffer(frames);
  }, [activeFrame, effectiveTotalFrames]);

  // ---------------------------------------------------------------------------
  // Continuous Player Loop (millisecond-precision rendering, 150ms transition).
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open) return;

    const renderFrame = (timestamp: number) => {
      if (!lastUpdateRef.current) lastUpdateRef.current = timestamp;
      const elapsed = timestamp - lastUpdateRef.current;

      if (elapsed >= 150) {
        lastUpdateRef.current = timestamp;
        if (isPlaying && onFrameChange) {
          const frameDelta = Math.max(1, Math.floor((playbackSpeed * elapsed) / (1000 / fps)));
          const newFrame = Math.min(effectiveTotalFrames - 1, Math.max(0, activeFrame + frameDelta));
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
  }, [open, isPlaying, activeFrame, fps, effectiveTotalFrames, playbackSpeed, onFrameChange]);

  // ---------------------------------------------------------------------------
  // Boundary Lock — frame clicks 3-frame buffer ke andar clamp hote hain.
  // ---------------------------------------------------------------------------

  const handleFrameClick = useCallback((frame: number) => {
    if (frame >= 0 && frame < effectiveTotalFrames && onFrameChange) {
      const clamped = Math.max(threeFrameBuffer[0], Math.min(frame, threeFrameBuffer[2]));
      onFrameChange(clamped);
    }
  }, [threeFrameBuffer, effectiveTotalFrames, onFrameChange]);

  // -------------------------------------------------------------------------
  // CLEAN UNMOUNT — jab AURA band ho, component poori tarah null return karta
  // hai. Isse timeline row me panel ka slot khaali ho jata hai aur lanes
  // `flex-1` se 100% width le lete hain (full-width expansion loop).
  // -------------------------------------------------------------------------
  if (!isAuthorized || !open) return null;

  // ---------------------------------------------------------------------------
  // Render — INLINE PANEL (timeline row ka flex child, koi portal/fixed nahi)
  // ---------------------------------------------------------------------------

  return (
    // Hinglish: Panel ka root — #161616 deep matte charcoal (AURA rail canvas),
    // rounded-md, h-full/w-full (parent ka 50% slot bharta hai), border-0,
    // outline-none. overflow-y-auto + editor ke global ghost-scrollbar rules
    // (0px track, hover par 1px #ff6500 thumb).
    <div
      data-aura-panel=""
      className="flex h-full w-full flex-col overflow-y-auto rounded-md border-0 bg-[#161616] shadow-none outline-none ring-0"
    >
      {/* ---- Header — identity + minimize ---- */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#ff6500]/12">
            <Layers className="h-4 w-4 text-[#ff6500]" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-[#e8e9ea]">AURA Micro-Frame Studio</span>
          {/* RBAC badge — sirf authorized session ko hi ye panel dikhta hai */}
          <span className="rounded-md bg-[#ff6500]/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#ff6500]">
            SUPERADMIN
          </span>
        </div>
        {/* Minimize toggle: panel ko band karke lanes ko full width deta hai */}
        <button
          type="button"
          onClick={() => onOpenChange?.(false)}
          aria-label="Minimize AURA studio"
          title="Minimize — timeline full width"
          className={TOOL_BUTTON_CLASS}
        >
          <X className={GLYPH_16} />
        </button>
      </div>
      {/* Structural divider — borderless design: solid bg line, wireframe border nahi */}
      <div className="h-px w-full shrink-0 bg-white/[0.06]" />

      {/* ---- Transport: prev/play/next · speed · scrubber · microsecond timecode ---- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 px-4 py-3">
        {/* Playback Controls — 32px targets, 16px glyphs */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            onClick={() => {
              let newSpeed = playbackSpeed * 0.5;
              if (newSpeed < 0.01) newSpeed = 0.01;
              onPlaybackSpeedChange?.(newSpeed);
            }}
            aria-label="Decrease speed (0.01x granularity)"
            title="Decrease speed"
          >
            <SkipBack className={GLYPH_16} />
          </button>

          <button
            type="button"
            className={cn(TOOL_BUTTON_CLASS, isPlaying ? 'text-[#ff6500]' : 'text-[#9fa7b3]')}
            onClick={onPlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className={GLYPH_16} /> : <Play className={GLYPH_16} />}
          </button>

          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            onClick={() => {
              let newSpeed = playbackSpeed * 2;
              if (newSpeed > 4.0) newSpeed = 0.01;
              onPlaybackSpeedChange?.(newSpeed);
            }}
            aria-label="Increase speed (0.01x granularity)"
            title="Increase speed"
          >
            <SkipForward className={GLYPH_16} />
          </button>
        </div>

        {/* Speed Selector — flat sunken block, borderless, readable 11px mono */}
        <select
          value={playbackSpeed}
          onChange={(e) => onPlaybackSpeedChange?.(parseFloat(e.target.value))}
          className="h-8 w-[78px] shrink-0 rounded-md border-0 bg-[#0d0d0f] px-2 text-[11px] font-mono text-[#e8e9ea] outline-none transition-colors duration-150 hover:text-[#ff6500] focus:text-[#ff6500]"
          aria-label="Playback speed"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {formatSpeed(speed)}
            </option>
          ))}
        </select>

        {/* Scrubber — step 0.001ms = 1 microsecond granularity */}
        <div className="relative min-w-[90px] flex-1">
          <Slider
            value={[Math.min(currentTimeMs, effectiveDurationMs)]}
            max={effectiveDurationMs}
            min={0}
            step={0.001}
            onValueChange={(vals) => {
              const newMs = vals[0];
              const newFrame = Math.round((newMs / effectiveDurationMs) * (effectiveTotalFrames - 1));
              const clamped = Math.max(threeFrameBuffer[0], Math.min(newFrame, threeFrameBuffer[2]));
              onFrameChange?.(clamped);
            }}
            className="w-full"
            aria-label="Micro-frame timeline scrubber"
          />
        </div>

        {/* Timestamp Display — MICROSECOND precision `HH:MM:SS.mmmuuu`, tabular */}
        <div className="shrink-0 font-mono text-[11px] tabular-nums text-[#d8d9da]">
          <span className="text-[#ff6500]">{usToTimestamp(currentTimeMs * 1000)}</span>
          <span className="mx-1 text-[#5f6771]">/</span>
          <span className="text-[#9fa7b3]">{usToTimestamp(effectiveDurationMs * 1000)}</span>
        </div>
      </div>

      {/* ---- 3-Frame Buffer Ring — frame-precise preview cards ----
          Hinglish: har tile ek real PREVIEW CARD hai (Movavi-style) — gradient
          depth se flat-slab feel nahi, rounded-md, frame timecode center me saksham.
          ACTIVE tile top accent bar + accent ring se instantly focal hota hai —
          "kaunsa frame chal raha hai" turant dikh jata hai. PREV/NEXT muted. */}
      <div className="grid shrink-0 grid-cols-3 gap-2 px-4 py-2">
        {threeFrameBuffer.map((frame, idx) => {
          const isActive = frame === activeFrame;
          const isPrev = idx === 0;
          const isNext = idx === 2;
          const label = frameToTimestamp(frame, fps);

          return (
            <button
              type="button"
              key={frame}
              onClick={() => handleFrameClick(frame)}
              className={cn(
                'group relative flex h-24 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border-0 shadow-none outline-none ring-0 transition-colors duration-150',
                isActive
                  ? 'bg-gradient-to-b from-[#1c1e22] to-[#0a0b0c] ring-1 ring-inset ring-[#ff6500]/60'
                  : 'bg-gradient-to-b from-[#16171b] to-[#0a0b0c] hover:ring-1 hover:ring-inset hover:ring-[#ff6500]/40',
              )}
              aria-label={`Frame ${frame} ${label}`}
              title={`Frame ${frame} — ${label}`}
            >
              {/* Active focal cue — 2px accent bar top pe */}
              <span
                className={cn(
                  'absolute inset-x-0 top-0 h-0.5 transition-colors duration-150',
                  isActive ? 'bg-[#ff6500]' : 'bg-transparent group-hover:bg-[#ff6500]/40',
                )}
              />
              {/* Film water-mark — tile ko "real frame" jaisa read karaata hai */}
              <Film
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute -bottom-2 -right-2 h-12 w-12',
                  isActive ? 'text-[#ff6500]/10' : 'text-white/[0.03]',
                )}
              />
              <span
                className={cn(
                  'font-mono text-[12px] tabular-nums',
                  isActive ? 'text-[#ff6500]' : 'text-[#c3c7cd] group-hover:text-[#ff6500]',
                )}
              >
                {label}
              </span>
              <span
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wider',
                  isActive ? 'text-[#ff6500]/80' : 'text-[#5f6771]',
                )}
              >
                {isPrev ? 'Prev' : isActive ? 'Active' : isNext ? 'Next' : 'Buf'}
              </span>
              <span
                className={cn(
                  'rounded-md px-1 font-mono text-[10px] tabular-nums',
                  isActive ? 'bg-[#ff6500]/12 text-[#e8e9ea]' : 'text-[#5f6771]',
                )}
              >
                F{frame}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- Core Integration Toolbar — tactile 32px tools, 16px glyphs ---- */}
      <div className="mt-auto flex shrink-0 flex-col">
        <div className="h-px w-full bg-white/[0.06]" />
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5f6771]">
            Core Integration
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              onClick={() => setPixelEditorOpen(true)}
              aria-label="Open pixel editor"
              title="Pixel Editor — har ek pixel badlo (editor ke sabse upar)"
            >
              <Grid3x3 className={GLYPH_16} />
            </button>
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              aria-label="Slice clip (saves to WideoCut Pro core)"
              title="Slice clip — saves to core hooks"
            >
              <Scissors className={GLYPH_16} />
            </button>
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              aria-label="Overlay adjustments (saves to core storage)"
              title="Overlay adjustments — saves to core storage"
            >
              <Layers className={GLYPH_16} />
            </button>
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              aria-label="Text expressions (saves to core variables)"
              title="Text expressions — saves to core variables DB"
            >
              <Type className={GLYPH_16} />
            </button>
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              aria-label="Settings"
              title="Settings"
            >
              <Settings className={GLYPH_16} />
            </button>
          </div>
        </div>
      </div>

      {/* ---- AURA Pixel Editor overlay ----
          Hinglish: Ye khud document.body me portal hota hai (z-[10000]), isliye
          yahan render karna bhi safe hai — kahin bhi ho, sabse upar baithta hai.
          Portal ke andar seedha rehta hai taaki Escape/close state sahi rahe. */}
      <AuraPixelEditor
        open={pixelEditorOpen}
        onOpenChange={setPixelEditorOpen}
        sourceImageUrl={sourceImageUrl}
      />
    </div>
  );
}

// Re-export utility functions for testing
export { getThreeFrameBuffer, msToTimestamp };

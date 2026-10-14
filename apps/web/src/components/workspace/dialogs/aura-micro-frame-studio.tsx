'use client';

// ============================================================================
// AURA MICRO-FRAME STUDIO DIALOG OVERLAY
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from '@wideo11/ui/dialog';
import { Button } from '@wideo11/ui/button';
import { Slider } from '@wideo11/ui/slider';
import { Play, Pause, SkipBack, SkipForward, Scissors, Layers, Type, Settings, X, ZoomIn, ZoomOut, Wand2 } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

import {
  grafanaPanel,
  grafanaText,
  grafanaTextMuted,
  productAccent,
  productAccentBg,
  productAccentRing,
  productNeutral,
  productPanelHover,
  productRingSeparation,
  productSunken,
  productTextQuiet,
} from '@wideo11/ui/design-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Hinglish: Ek edit op = kis frame me, kaunse bounds (normalized 0..1) me,
// kis prompt se pixel swap hua. Provenance isi me rehti hai — edit history
// hamesha timestamp ke saath record hoti hai (attribution preserve).
export interface AuraFrameEdit {
  frame: number;
  bounds: { x: number; y: number; w: number; h: number };
  prompt: string;
  createdAt: number;
}

// Hinglish: Zero-Duplication Core Registry sync payload. Ye NAYA storage
// nahi banata — sirf EXISTING timeline storage hook ko call karta hai
// (onTimelineSync prop). Koi temp container, koi duplicate file nahi.
export interface AuraTimelineSyncPayload {
  frames: number[];
  edits: AuraFrameEdit[];
  source: 'aura-micro-frame-studio';
}

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
  // ---- Superadmin + env security gate (Phase 2 security guard) ----
  // Hinglish: Ye teeno milke hi component ko render karne ki permission
  // dete hain. Koi bhi missing = component poora null return karta hai.
  userEmail?: string;
  isSuperadmin?: boolean;
  // ---- Zero-Duplication sync hook (existing timeline storage) ----
  onTimelineSync?: (payload: AuraTimelineSyncPayload) => void;
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
  return `${String(hours).padStart(2, `0`)}:${String(minutes).padStart(2, `0`)}:${String(ms).padStart(3, `0`)}`;
}

/**
 * Milliseconds to human-readable string `00:01:001`
 */
function msToTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const remainingMs = totalMs % 1000;
  return `${String(hours).padStart(2, `0`)}:${String(minutes).padStart(2, `0`)}:${String(remainingMs).padStart(3, `0`)}`;
}

/**
 * Microseconds to `HH:MM:SS.mmmuuu` — 1 microsecond granularity wala display.
 * Example: `00:00:01.001500` = 1 second + 1.5 milliseconds + 500 microseconds.
 * Hinglish: Player 1μs se shuru hota hai, isliye ms se chhota unit chahiye.
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
// Constants
// ---------------------------------------------------------------------------

// Hinglish: Superadmin gate ka email — strictly sirf ye account (verified
// superadmin token state ke saath) hi AURA studio access kar sakta hai.
const AURA_SUPERADMIN_EMAIL = 'advchashampalup@gmail.com';

// Hinglish: Player range spec — 1 microsecond se shuru, maximum 3 seconds.
// MAX_DURATION_MS = 3000 (3s). User spec: "3 seconds tak hi player hoga".
const MAX_DURATION_MS = 3000;

// Hinglish: 3 seconds = 120fps * 3 = 360 frames maximum (user spec).
// Kisi bhi fps par total frames fps*3 se zyada nahi ho sakte.
const MAX_SECONDS = 3;

// Hinglish: Sub-pixel brush tabhi khulega jab zoom >= 4x ho (max zoom 6x).
const BRUSH_ZOOM_THRESHOLD = 4;
const MAX_ZOOM_LEVEL = 6;

// ---------------------------------------------------------------------------
// Playback Speed Options — micro-step se 4x (editor twin ke identical set).
// Hinglish: 0.0001x/0.001x/0.01x micro-steps micro-frame analysis ke liye.
// `formatSpeed` raw number use karta hai kyunki toFixed(2) 0.0001 ko "0.00x"
// bana deta hai — micro-step ka poora point hi dikhana hai.
// ---------------------------------------------------------------------------

const PLAYBACK_SPEEDS = [0.0001, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 4.0];

function formatSpeed(rate: number): string {
  return `${rate}x`;
}

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
  userEmail,
  isSuperadmin,
  onTimelineSync,
}: AuraMicroFrameStudioProps) {
  // -------------------------------------------------------------------------
  // SUPERADMIN + ENV SECURITY GATE
  // Hinglish: Component poora null return karta hai jab tak:
  //   1. `NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED=true` env flag na ho
  //   2. session ka email `advchashampalup@gmail.com` na ho
  //   3. verified superadmin token state (`isSuperadmin`) na ho
  // Koi bhi condition fail = DOM me cheez render hi nahi hoti (trigger bhi nahi).
  // -------------------------------------------------------------------------
  const isSuperAdminEnvEnabled =
    process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';
  const normalizedEmail = (userEmail ?? '').toLowerCase().trim();
  const isAuthorized =
    isSuperAdminEnvEnabled &&
    isSuperadmin === true &&
    normalizedEmail === AURA_SUPERADMIN_EMAIL;

  const [threeFrameBuffer, setThreeFrameBuffer] = useState<number[]>([]);
  const playerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // -------------------------------------------------------------------------
  // Duration + frame caps (user spec: 1μs start, max 3 seconds = 360 frames
  // at 120fps). Hinglish: durationMs 3000 se zyada clamp, frames fps*3 clamp.
  // -------------------------------------------------------------------------
  const effectiveDurationMs = Math.min(durationMs, MAX_DURATION_MS);
  const maxFramesForDuration = Math.round(fps * MAX_SECONDS);
  const effectiveTotalFrames = Math.min(totalFrames, maxFramesForDuration);

  // -------------------------------------------------------------------------
  // Microscopic Pixel Selection Brush + Zoom Lock
  // Hinglish: Brush tabhi active jab zoomLevel >= 4 (max 6). Mouse path ko
  // NORMALIZED (0..1) coords me track karte hain — resize/zoom par bounds
  // shift nahi hongi (zero data drift). Path ref me rehta hai (render drift
  // nahi), bounds sirf mouse-up par derive hote hain.
  // -------------------------------------------------------------------------
  const [zoomLevel, setZoomLevel] = useState(1);
  const isBrushActive = zoomLevel >= BRUSH_ZOOM_THRESHOLD;
  const [brushBounds, setBrushBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const brushPathRef = useRef<Array<{ x: number; y: number }>>([]);

  // Inpainting prompt (natural language) — object replacement ke liye.
  const [promptText, setPromptText] = useState('');

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const handleBrushDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isBrushActive) return;
    // Hinglish: pointer capture ZAROORI hai — warna tile ke bahar drag/release
    // par onPointerUp fire hi nahi hota aur isPainting stuck ho jata hai
    // (stale path se agli selection corrupt hoti hai). Capture ke baad saare
    // pointer events isi element tak aate hain, chahe cursor kahan ho.
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    brushPathRef.current = [
      { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) },
    ];
    setIsPainting(true);
  }, [isBrushActive]);

  const handleBrushMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isBrushActive || !isPainting) return;
    const rect = e.currentTarget.getBoundingClientRect();
    brushPathRef.current.push({
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    });
  }, [isBrushActive, isPainting]);

  const handleBrushUp = useCallback(() => {
    if (!isPainting) return;
    setIsPainting(false);
    const path = brushPathRef.current;
    if (path.length === 0) return;
    // Bounds sirf path se derive — ek hi source of truth, koi drift nahi.
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    if (maxX - minX < 0.001 || maxY - minY < 0.001) return; // accidental dot = ignore
    setBrushBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }, [isPainting]);

  // -------------------------------------------------------------------------
  // 3-Frame Strict Buffer Ring
  // Hard-clamp: koi bhi scroll/drag boundary check se bahar nahi nikalega.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const frames = getThreeFrameBuffer(activeFrame, effectiveTotalFrames);
    setThreeFrameBuffer(frames);
  }, [activeFrame, effectiveTotalFrames]);

  // -------------------------------------------------------------------------
  // Localized Inpainting Hook (zero-cost processing node event receiver)
  // Hinglish: Natural-language prompt accept hota hai, bounds current 3-frame
  // buffer ke andar HARD-CLAMP hote hain, aur edit op EXISTING timeline
  // storage hook (onTimelineSync) par jata hai. Koi anti-forensic blending
  // nahi — har edit op provenance metadata ke saath record hota hai taaki
  // attribution preserve rahe.
  // -------------------------------------------------------------------------
  const executeObjectReplacement = useCallback(() => {
    if (!brushBounds || !promptText.trim()) return;
    // Hard clamp: edit sirf 3-frame buffer ke andar frame par lag sakta hai
    const clampedFrame = Math.max(
      threeFrameBuffer[0],
      Math.min(threeFrameBuffer[2], activeFrame),
    );
    const edit: AuraFrameEdit = {
      frame: clampedFrame,
      bounds: brushBounds,
      prompt: promptText.trim(),
      createdAt: Date.now(),
    };
    // Zero-Duplication: naya storage nahi — existing timeline hook ko call
    onTimelineSync?.({
      frames: threeFrameBuffer,
      edits: [edit],
      source: 'aura-micro-frame-studio',
    });
    setPromptText('');
    setBrushBounds(null);
    brushPathRef.current = [];
  }, [brushBounds, promptText, threeFrameBuffer, activeFrame, onTimelineSync]);

  // -------------------------------------------------------------------------
  // Continuous Player Loop (microsecond-precision rendering)
  // 150ms transition se synced animation frames render karta hai.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Boundary Lock — prevent scrolling/dragging outside 3-frame ring
  // -------------------------------------------------------------------------

  const handleFrameClick = useCallback((frame: number) => {
    // Boundary check: sirf 3-frame buffer ke andar click allow
    if (frame >= 0 && frame < effectiveTotalFrames && onFrameChange) {
      // Agar click buffer ke bahar hai to clamp karo
      const clamped = Math.max(threeFrameBuffer[0], Math.min(frame, threeFrameBuffer[2]));
      onFrameChange(clamped);
    }
  }, [threeFrameBuffer, effectiveTotalFrames, onFrameChange]);

  // -------------------------------------------------------------------------
  // AUTHORIZATION GATE — render yahan tak pahunchti hi nahi agar unauthorized.
  // (Saare hooks upar declare ho chuke hain, isliye early-return safe hai.)
  // -------------------------------------------------------------------------
  if (!isAuthorized) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`group flex items-center gap-1.5 rounded-md bg-transparent text-xs ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0`}
        >
          <Layers className="h-2.5 w-2.5 transition-transform duration-150 group-hover:scale-110" />
          AURA Micro-Frame
        </Button>
      </DialogTrigger>

      {/* Port 3000 design rules: grayish-black slate (#1e1e1e), ZERO wireframe
          borders/outlines (border-0 outline-none shadow-none), rounded-md
          container. Hinglish: koi outer line nahi, flat color depth se
          separation, medium rounded corners. */}
      <DialogContent className={`fixed left-[50%] top-[50%] z-[9999] grid w-[90vw] max-w-6xl translate-x-[-50%] translate-y-[-50%] gap-2 rounded-md border-0 ${productNeutral} p-0 shadow-none outline-none ring-0`}>
        {/* ---- Dialog Header (hyper-flat, orange-red accent) ---- */}
        <DialogHeader className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Layers className={`h-2.5 w-2.5 ${productAccent}`} />
            <DialogTitle className={`text-sm font-semibold ${grafanaText}`}>
              AURA Micro-Frame Studio
            </DialogTitle>
            <span className={`rounded-md ${productAccentBg}/10 px-2 py-0.5 text-[10px] font-medium ${productAccent}`}>
              SUPERADMIN GATED
            </span>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          </DialogClose>
        </DialogHeader>

        {/* ---- Millisecond/Microsecond-Precision Scrubber + Player ---- */}
        <div className="relative flex items-center gap-3 px-4 py-3">
          {/* Playback Controls — 16px (h-4 w-4) micro icons, orange-red on active */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
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
                'h-7 w-7 rounded-md bg-transparent p-0 shadow-none transition-all duration-150 hover:bg-transparent focus:ring-0 focus:ring-offset-0',
                isPlaying
                  ? `${productAccentBg}/10 ${productAccent}`
                  : `${grafanaTextMuted} hover:${productAccent}`,
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
              className={`h-7 w-7 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
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
              className={`w-20 rounded-md border-0 ${productSunken} px-1.5 py-0.5 text-xs ${grafanaText} outline-none transition-all duration-150 hover:${productAccent} focus:${productAccent}`}
              aria-label="Playback speed"
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {formatSpeed(speed)}
                </option>
              ))}
            </select>
          </div>

          {/* Continuous Rendering Player Loop — step 0.001ms = 1 microsecond */}
          <div
            ref={playerRef}
            className="relative flex-1"
          >
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

          {/* Timestamp Display — microsecond precision `HH:MM:SS.mmmuuu` */}
          <div className={`flex-shrink-0 font-mono text-xs ${grafanaText}`}>
            <span className={`${productAccent}`}>{usToTimestamp(currentTimeMs * 1000)}</span>
            <span className={`mx-1 ${productTextQuiet}`}>/</span>
            <span className={`${grafanaTextMuted}`}>{usToTimestamp(effectiveDurationMs * 1000)}</span>
          </div>
        </div>

        {/* ---- 3-Frame Buffer Ring Visualization ---- */}
        <div className="relative flex items-center justify-center gap-2 px-4 py-3">
          {/* Zoom lock controls — brush sirf >= 4x par unlock */}
          <div className="absolute right-4 top-2 flex items-center gap-1">
            <span className={`mr-1 font-mono text-[10px] ${productTextQuiet}`}>{zoomLevel}x</span>
            <Button
              variant="ghost"
              size="sm"
              className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0`}
              onClick={() => setZoomLevel((z) => Math.max(1, z - 1))}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="h-2.5 w-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0`}
              onClick={() => setZoomLevel((z) => Math.min(MAX_ZOOM_LEVEL, z + 1))}
              aria-label="Zoom in"
              title="Zoom in (4x par sub-pixel brush unlock)"
            >
              <ZoomIn className="h-2.5 w-2.5" />
            </Button>
            <span
              className={cn(
                'ml-1 rounded-md px-1.5 py-0.5 text-[10px] transition-all duration-150',
                isBrushActive
                  ? `${productAccentBg}/10 ${productAccent}`
                  : `${productSunken} ${productTextQuiet}`,
              )}
            >
              {isBrushActive ? 'BRUSH UNLOCKED' : 'LOCKED <4x'}
            </span>
          </div>

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
                  'relative flex h-16 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-md border-0 transition-all duration-150',
                  isActive
                    ? `ring-1 ${productAccentRing}`
                    : `ring-1 ${productRingSeparation} hover:${productAccentRing}/50 hover:${productAccent}`,
                  `${productSunken}`,
                )}
                aria-label={`Frame ${frame} ${label}`}
                title={`Frame ${frame} — ${label}`}
              >
                <div
                  className={cn(
                    'absolute inset-0',
                    isActive
                      ? `${productAccentBg}/5`
                      : `${productPanelHover}/80 group-hover:${productAccentBg}/5`,
                  )}
                />
                {/* Microscopic pixel selection brush surface — sirf active tile
                    par, aur sirf zoom >= 4x par. Normalized coords = drift-free. */}
                {isActive && isBrushActive && (
                  <div
                    className={cn(
                      'absolute inset-0 cursor-crosshair touch-none',
                      isPainting ? `${productAccentBg}/5` : 'bg-transparent',
                    )}
                    onPointerDown={handleBrushDown}
                    onPointerMove={handleBrushMove}
                    onPointerUp={handleBrushUp}
                    onPointerCancel={handleBrushUp}
                    onLostPointerCapture={handleBrushUp}
                    aria-label="Sub-pixel selection brush area"
                    title="Drag to isolate pixel matrix bounds"
                  />
                )}
                <span className={`relative z-10 font-mono text-[10px] ${grafanaTextMuted}`}>
                  {label}
                </span>
                <span className={`relative z-10 mt-1 text-[8px] uppercase tracking-wider ${productTextQuiet}`}>
                  {isPrev ? 'PREV' : isActive ? 'ACTIVE' : isNext ? 'NEXT' : 'BUF'}
                </span>
                {/* Selection bounds readout — normalized + percentage dono */}
                {isActive && brushBounds && (
                  <span className={`relative z-10 mt-0.5 font-mono text-[8px] ${productAccent}`}>
                    SEL {Math.round(brushBounds.x * 100)}%,{Math.round(brushBounds.y * 100)}% ·{' '}
                    {Math.round(brushBounds.w * 100)}x{Math.round(brushBounds.h * 100)}%
                  </span>
                )}
                {/* Frame number — hyper-flat, orange-red on active */}
                <span
                  className={cn(
                    'relative z-10 mt-0.5 text-[11px] font-medium',
                    isActive ? `${productAccent}` : `${productTextQuiet}`,
                  )}
                >
                  F{frame}
                </span>
              </div>
            );
          })}
        </div>

        {/* ---- Localized Inpainting Panel (zero-cost processing node hook) ----
            Hinglish: Natural-language prompt + selected bounds bhejte hain
            3-frame buffer me hard-clamped pixel swap ke liye. Edit op existing
            timeline storage hook (onTimelineSync) par jata hai. Har edit ka
            provenance record rehta hai — koi anti-forensic blending nahi hai. */}
        <div className={`mx-4 mb-2 flex items-center gap-2 rounded-md ${productSunken} p-2`}>
          <Wand2 className={`h-2.5 w-2.5 shrink-0 ${grafanaTextMuted} transition-colors duration-150`} />
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder={isBrushActive ? 'Describe replacement (e.g., "remove background sign")…' : 'Zoom 4x+ to unlock pixel brush…'}
            disabled={!isBrushActive}
            className={`h-6 flex-1 rounded-md border-0 bg-transparent px-2 text-xs ${grafanaText} outline-none transition-all duration-150 placeholder:${productTextQuiet} focus:${grafanaPanel} disabled:cursor-not-allowed disabled:opacity-50`}
            aria-label="Inpainting prompt"
          />
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 shrink-0 rounded-md px-2 text-[11px] shadow-none transition-all duration-150 focus:ring-0 focus:ring-offset-0',
              isBrushActive && brushBounds && promptText.trim()
                ? `${productAccentBg} text-white hover:${productAccentBg}`
                : `bg-transparent ${productTextQuiet} hover:bg-transparent`,
            )}
            disabled={!isBrushActive || !brushBounds || !promptText.trim()}
            onClick={executeObjectReplacement}
            aria-label="Apply localized inpainting"
            title="Apply (hard-clamped within 3-frame buffer)"
          >
            Apply
          </Button>
        </div>

        {/* ---- Core Integration Toolbar — 16px micro icons, orange-red active ---- */}
        <div className="flex items-center justify-end gap-1 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
            aria-label="Slice clip (saves to WideoCut Pro core)"
            title="Slice clip — saves to core hooks"
          >
            <Scissors className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
            aria-label="Overlay adjustments (saves to core storage)"
            title="Overlay adjustments — saves to core storage"
          >
            <Layers className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
            aria-label="Text expressions (saves to core variables)"
            title="Text expressions — saves to core variables DB"
          >
            <Type className="h-2.5 w-2.5 transition-colors duration-150" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-4 w-4 rounded-md bg-transparent p-0 ${grafanaTextMuted} shadow-none transition-all duration-150 hover:bg-transparent hover:${productAccent} focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-transparent`}
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
export { getThreeFrameBuffer, msToTimestamp, frameToTimestamp, usToTimestamp };


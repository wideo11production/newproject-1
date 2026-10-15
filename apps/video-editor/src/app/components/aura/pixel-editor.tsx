'use client';

// ============================================================================
// AURA PIXEL EDITOR — har ek pixel, tere haath mein
// ============================================================================
//
// Hinglish: Ye AURA ka apna micro pixel-editor hai. Ye EDITOR KE SABSE UPAR
// chalta hai (`z-[10000]` — AURA panel, context-menu, toolbar, sabse ooper),
// kyunki pixel ka kaam poore dhyan ki baat hai: user ko sirf pixels dikhne
// chahiye, baaki kuch nahi.
//
// ---- ASLI FEATURE KA HAI (decoration nahi) ----
// Har cell = asli ek pixel. Pointer se click/drag = us pixel ka colour badal
// jata hai — 1:1 mapping, koi approximation nahi. Grid 8x8 se 96x96 tak.
//
// Tools:
//   * Pencil     — draw karo (mouse/pointer drag se seedhi line bhi banti hai)
//   * Eraser     — pixel transparent (checkerboard se dikhega)
//   * Fill       — same-colour wale jude hue poore area ko bhar do (flood fill)
//   * Eyedropper — kisi bhi pixel ka colour uthao
//   * Undo/Redo  — poore swatch ke snapshots (stroke-level, 40 deep)
//   * Zoom       — cell 2px se 32px (chhote pixels badi screen pe bhi kaam karein)
//   * Import     — koi bhi PNG/JPG load karo, wahi grid me downsample ho jayega
//   * Export     — 1x se 16x PNG (transparency preserve hoti hai)
//
// ---- KYUN CANVAS, DOM CELLS NAHI ----
// 96x96 = 9,216 divs. Har stroke pe React 9,216 elements reconcile karta —
// dood khaane ke barabar frame-drop. Ek <canvas> do draw call se poora ho jata
// hai, isliye 240fps pe bhi paint smooth rehta hai. DOM nahi, canvas hai.
//
// ---- DESIGN ----
// Movavi-style hyper-flat: ZERO wireframe borders, separation sirf colour depth
// se. Accent #ff6500, rounded-md, 150ms transitions, borderless buttons
// (32px target / 16px glyph), ghost scrollbar (shared scrollbar.css).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Undo2,
  Redo2,
  Upload,
  Download,
  ZoomIn,
  ZoomOut,
  Grid3x3,
  Check,
  Palette,
} from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type PixelTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

/** Grid resolutions. 8 se 96 — chhota = chunky art, bada = photo-level. */
const GRID_PRESETS = [8, 16, 24, 32, 48, 64, 96] as const;

/** Curated palette — accent se shuru, phir value ramp, phir hues. */
const PALETTE = [
  '#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080',
  '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff',
  '#ff6500', '#cc5200', '#ff8f3f', '#ffb27a',
  '#a855f7', '#7c3aed', '#c084fc', '#5b21b6',
  '#ec4899', '#be185d', '#f9a8d4',
  '#fbbf24', '#d4a41a', '#fde68a',
  '#10b981', '#059669', '#6ee7b7',
  '#3b82f6', '#1d4ed8', '#93c5fd',
  '#f43f5e', '#b91c1c', '#fca5a5',
];

const UNDO_LIMIT = 40;

// ---------------------------------------------------------------------------
// Colour helpers (RGBA <-> hex, alpha-aware)
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
    alpha,
  ];
}

function rgbaToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------
// Module-scope tool button (component ke BAHAR)
// ---------------------------------------------------------------------------
// Hinglish: Ye pehle component ke BODY me tha — matlab har render pe naya
// function identity, aur `React.memo` bhi bekaar. Bahar nikaalne se rail buttons
// memoize ho sakte hain, aur pixel paint pe sirf canvas repaint hota hai,
// poora React tree nahi. 32px target / 16px glyph, borderless, 150ms.
interface IconBtnProps {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function IconBtn({ label, title, active, disabled, onClick, children }: IconBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent p-0 outline-none transition-colors duration-150',
        active
          ? 'bg-[#ff6500]/12 text-[#ff6500]'
          : 'text-[#9fa7b3] hover:bg-white/[0.06] hover:text-[#ff6500]',
        'focus-visible:ring-1 focus-visible:ring-[#ff6500]/40 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#9fa7b3]',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface AuraPixelEditorProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Clip ka poster — agar diya ho to open par grid me load ho jata hai. */
  sourceImageUrl?: string;
}

export function AuraPixelEditor({ open = false, onOpenChange, sourceImageUrl }: AuraPixelEditorProps) {
  // ---- Grid size ----
  const [gridSize, setGridSize] = useState(32);
  // ---- Tool + colour ----
  const [tool, setTool] = useState<PixelTool>('pencil');
  const [color, setColor] = useState('#ff6500');
  // ---- View ----
  const [cell, setCell] = useState(12); // pixels per grid cell, on screen
  const [showGrid, setShowGrid] = useState(true);
  const [ready, setReady] = useState(false);
  // Portal sirf client pe. `ready` ko hi mounted flag maan rahe hain — dono ek
  // hi mount-effect set hote hain, alag state rakhne ka koi fayda nahi.
  const [mounted, setMounted] = useState(false);

  // ---- Pixel store: RGBA bytes, length = gridSize*gridSize*4 ----
  const pxRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(32 * 32 * 4));
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement | null>(null);

  const undoRef = useRef<Uint8ClampedArray[]>([]);
  const redoRef = useRef<Uint8ClampedArray[]>([]);
  const drawingRef = useRef(false);
  const lastRef = useRef<[number, number] | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const w = gridSize;
  const h = gridSize;

  // ---- LIVE refs ----
  // Hinglish: ye do ref ASYNC callbacks ke andar use hote hain. `img.onload`
  // kabhi bhi fire ho sakta hai — grid tab tak badal chuka ho sakta hai. Agar
  // effect ke closure se `w`/`h` padhe, to STALE size se buffer banega aur
  // `pxRef.current` galat length ka ho jayega (findings #1). Ref se live value
  // padhne se ye race khatam ho jati hai.
  const gridSizeRef = useRef(gridSize);
  gridSizeRef.current = gridSize;

  // User ne kuch paint kiya ya nahi. Source (poster) load sirf tabhi apply hota
  // hai jab buffer abhi khaali ho — warna user ka kaam overwrite ho jataega
  // (finding #2: stroke draw kiya, phir image load hote hi gayab).
  const dirtyRef = useRef(false);

  // -------------------------------------------------------------------------
  // Init + source image load
  // -------------------------------------------------------------------------
  useEffect(() => {
    setReady(true);
    setMounted(true);
  }, []);

  // -------------------------------------------------------------------------
  // paint() — IMPERATIVE canvas repaint
  // -------------------------------------------------------------------------
  // Hinglish: pehle har mutation `setTick` karta tha, matlab har pointermove
  // pe poora React tree re-render (header + ~20 rail buttons + 36 palette) AUR
  // full canvas re-upload. 96×96 @ 32px zoom pe view canvas 3072² ≈ 9.4M px hai
  // — per mouse event. Mouse 60-120 events/sec deta hai, matlab frame-drop
  // THEEN painting ke waqt. Ab: pixel badla → seedha `paint()` call, React
  // re-render bilkul nahi. Sirf view-related state (cell/size/grid) effect se.
  //
  // Ye `commitImage` SE PEHLE declare hota hai kyunki wo isko call karta hai
  // (const TDZ — baad me declare karne pe TS2448).
  const paint = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    // Offscreen: asli pixel data
    const off = offRef.current ?? document.createElement('canvas');
    offRef.current = off;
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    if (!octx) return;
    const img = octx.createImageData(w, h);
    img.data.set(pxRef.current);
    octx.putImageData(img, 0, 0);

    // Display: scaled up, blocky (imageSmoothingEnabled = false)
    const vw = cell * w;
    const vh = cell * h;
    if (view.width !== vw) view.width = vw;
    if (view.height !== vh) view.height = vh;
    const vctx = view.getContext('2d');
    if (!vctx) return;
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, vw, vh);
    vctx.drawImage(off, 0, 0, vw, vh);

    // Grid overlay — sirf tab jab cell itna bada ho ki line padhne layak ho
    if (showGrid && cell >= 5) {
      vctx.strokeStyle = 'rgba(255,255,255,0.10)';
      vctx.lineWidth = 1;
      vctx.beginPath();
      for (let x = 1; x < w; x++) {
        const px = Math.round(x * cell) + 0.5;
        vctx.moveTo(px, 0);
        vctx.lineTo(px, vh);
      }
      for (let y = 1; y < h; y++) {
        const py = Math.round(y * cell) + 0.5;
        vctx.moveTo(0, py);
        vctx.lineTo(vw, py);
      }
      vctx.stroke();
    }
  }, [w, h, cell, showGrid]);

  // Grid size badla to pixel buffer resize karo — content RESAMPLE hota hai
  // (pura data dobara draw hota hai, isliye "32 se 64" pe art blurry nahi hota).
  useEffect(() => {
    const prev = pxRef.current;
    const prevWidth = Math.round(Math.sqrt(prev.length / 4)) || 32;
    if (prev.length === w * h * 4) return;

    const prevCanvas = document.createElement('canvas');
    prevCanvas.width = prevWidth;
    prevCanvas.height = prev.length / 4 / prevWidth;
    const pctx = prevCanvas.getContext('2d');
    if (pctx) {
      const img = pctx.createImageData(prevCanvas.width, prevCanvas.height);
      img.data.set(prev);
      pctx.putImageData(img, 0, 0);
    }

    const scaled = document.createElement('canvas');
    scaled.width = w;
    scaled.height = h;
    const sctx = scaled.getContext('2d');
    if (sctx) {
      sctx.imageSmoothingEnabled = true;
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(prevCanvas, 0, 0, w, h);
      const out = sctx.getImageData(0, 0, w, h);
      pxRef.current = new Uint8ClampedArray(out.data);
    } else {
      pxRef.current = new Uint8ClampedArray(w * h * 4);
    }
    paint();
    // prevCanvas ke raw pixels ko smoothed-ish scale kar rahe hain (chhote art
    // ke liye bilkul theek), aur undo stack ab stale hai — dono reset.
    undoRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);

  // -------------------------------------------------------------------------
  // commitImage(img) — image ko LIVE grid me sample karo, validate karke apply
  // -------------------------------------------------------------------------
  // Hinglish: ye dono async load paths (poster + import) ka shared core hai.
  // Do race the yahan, dono silently data corrupt karte the:
  //
  //   #2 STROKE-OVERWRITE: guard effect ke TIME pe chala tha, `onload` baad me
  //      fire hota hai. User ne stroke kiya, image load hote hi ud gaya — aur
  //      Undo se bhi nahi aaya (snapshot pre-stroke tha). Fix: `onload` ke
  //      andar dobara check. `force=true` (import button) ke liye skip.
  //
  //   #1 STALE-GRID: effect ke closure se `w`/`h` = load ke waqt ki grid. Grid
  //      badal ke 96 kiya, phir load aaya 32-size ka → `pxRef` 4096 bytes ka,
  //      `img.data.set()` short source pe throw NAHI karta (bas copy karta hai),
  //      aur index >= 4096 wale setPixel writes silently ignore ho jate hain
  //      (TypedArray OOB) = grid ka ~89% unwritable. Fix: `gridSizeRef` se LIVE
  //      size, aur length check jo mismatch pe poora load discard kar de.
  const commitImage = useCallback(
    (img: HTMLImageElement, force: boolean) => {
      // #2: user ka kaam already ho chuka — auto-load chup-chaap chhod do.
      if (!force && dirtyRef.current) return;
      const cw = gridSizeRef.current;
      const chh = gridSizeRef.current;
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = chh;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      // Cover-fit: aspect bigadne pe crop, distort nahi.
      const scale = Math.max(cw / img.width, chh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
      let next: Uint8ClampedArray;
      try {
        next = new Uint8ClampedArray(ctx.getImageData(0, 0, cw, chh).data);
      } catch {
        return; // tainted canvas — data untouched
      }
      // #1: defensive — kabhi bhi galat length ka buffer na jaane paye.
      if (next.length !== cw * chh * 4) return;
      pxRef.current = next;
      paint();
    },
    [paint]
  );

  // Source image (clip poster) ko ek hi baar load karo — buffer khaali hone par.
  useEffect(() => {
    if (!open || !ready || !sourceImageUrl) return;
    if (dirtyRef.current) return; // already edited
    if (pxRef.current.some((v) => v !== 0)) return; // already has content
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      commitImage(img, false);
    };
    img.src = sourceImageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, sourceImageUrl, commitImage]);

  // View-related state badla to repaint (size, zoom, grid lines).
  useEffect(() => {
    if (!open || !ready) return;
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, open, ready]);

  // Esc se band
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange?.(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onOpenChange]);

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------
  const pushUndo = useCallback(() => {
    // Hinglish: `dirtyRef` yahan set hota hai kyunki SAARE user edits (pencil,
    // eraser, fill, clear, import) isi ko call karte hain. Iske baad auto
    // poster-load chup-chaap chhod diya jata hai — user ka kaam safe.
    dirtyRef.current = true;
    undoRef.current.push(new Uint8ClampedArray(pxRef.current));
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(new Uint8ClampedArray(pxRef.current));
    pxRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    paint();
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(new Uint8ClampedArray(pxRef.current));
    pxRef.current = next;
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    paint();
  }, []);

  // -------------------------------------------------------------------------
  // Paint operations
  // -------------------------------------------------------------------------
  const setPixel = useCallback((x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * w + x) * 4;
    pxRef.current[i] = r;
    pxRef.current[i + 1] = g;
    pxRef.current[i + 2] = b;
    pxRef.current[i + 3] = a;
  }, [w]);

  const readU32 = useCallback((i: number) => {
    const p = pxRef.current;
    return ((p[i * 4 + 3] << 24) | (p[i * 4 + 2] << 16) | (p[i * 4 + 1] << 8) | p[i * 4]) >>> 0;
  }, []);

  /** Bresenham — pointer tez move hone par gaps na rahein. */
  const drawLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number) => {
      let x = x0;
      let y = y0;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      // Safety cap — pathological input pe infinite loop se bachao.
      for (let guard = 0; guard < w * h + 8; guard++) {
        if (x >= 0 && x < w && y >= 0 && y < h) setPixel(x, y, r, g, b, a);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
    },
    [w, h, setPixel]
  );

  const floodFill = useCallback(
    (sx: number, sy: number) => {
      const u32 = pxRef.current;
      const target = readU32(sy * w + sx);
      const [r, g, b, a] = tool === 'eraser' ? [0, 0, 0, 0] : hexToRgba(color);
      const replacement = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
      if (target === replacement) return;

      const stack: number[] = [sy * w + sx];
      while (stack.length) {
        const i = stack.pop() as number;
        if (readU32(i) !== target) continue;
        const p = i * 4;
        u32[p] = r;
        u32[p + 1] = g;
        u32[p + 2] = b;
        u32[p + 3] = a;
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0) stack.push(i - 1);
        if (x < w - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - w);
        if (y < h - 1) stack.push(i + w);
      }
    },
    [w, h, color, tool, readU32]
  );

  const pixelFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
      const view = viewRef.current;
      if (!view) return null;
      const rect = view.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const fx = ((e.clientX - rect.left) / rect.width) * view.width;
      const fy = ((e.clientY - rect.top) / rect.height) * view.height;
      const x = Math.floor(fx / cell);
      const y = Math.floor(fy / cell);
      if (x < 0 || x >= w || y < 0 || y >= h) return null;
      return [x, y];
    },
    [cell, w, h]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = pixelFromEvent(e);
      if (!hit) return;
      const [x, y] = hit;
      e.currentTarget.setPointerCapture(e.pointerId);

      if (tool === 'eyedropper') {
        const idx = y * w + x;
        const p = idx * 4;
        setColor(rgbaToHex(pxRef.current[p], pxRef.current[p + 1], pxRef.current[p + 2]));
        setTool('pencil');
        return;
      }

      pushUndo();

      if (tool === 'fill') {
        floodFill(x, y);
        paint();
        return;
      }

      drawingRef.current = true;
      lastRef.current = [x, y];
      const [r, g, b, a] = tool === 'eraser' ? [0, 0, 0, 0] : hexToRgba(color);
      setPixel(x, y, r, g, b, a);
      paint();
    },
    [tool, color, w, pixelFromEvent, pushUndo, floodFill, setPixel]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const hit = pixelFromEvent(e);
      if (!hit) return;
      const last = lastRef.current;
      if (!last) return;
      const [r, g, b, a] = tool === 'eraser' ? [0, 0, 0, 0] : hexToRgba(color);
      drawLine(last[0], last[1], hit[0], hit[1], r, g, b, a);
      lastRef.current = hit;
      paint();
    },
    [tool, color, pixelFromEvent, drawLine]
  );

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    lastRef.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Clear / import / export
  // -------------------------------------------------------------------------
  const clearAll = useCallback(() => {
    pushUndo();
    pxRef.current = new Uint8ClampedArray(w * h * 4);
    paint();
  }, [pushUndo, w, h]);

  const importImage = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        pushUndo();
        // `force = true` — user ne EXACTLY is button ko dabaya, to `dirtyRef`
        // check bypass. Import hamesha apply hota hai.
        commitImage(img, true);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    },
    [pushUndo, commitImage]
  );

  const exportPng = useCallback(
    (scale: number) => {
      const off = offRef.current;
      if (!off) return;
      const out = document.createElement('canvas');
      out.width = w * scale;
      out.height = h * scale;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, w * scale, h * scale);
      out.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aura-pixel-${w}x${h}@${scale}x.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    },
    [w, h]
  );

  // -------------------------------------------------------------------------
  // Render — EDITOR SABSE UPAR
  // -------------------------------------------------------------------------
  // Hinglish: `createPortal` se hum ye overlay ko document.body me mount karte
  // hain. Kyun? Editor ke andar kai ancestors pe `transform` / `filter` /
  // `will-change` / `contain` lage hote hain — unme `position: fixed` apna
  // containing block badal leta hai aur overlay tenant ke andar phans jata hai.
  // Portal + `z-[10000]` = pakka sabse ooper, "On top of all".
  // `IconBtn` ab module scope pe hai (neeche nahi) — memoize ho sakta hai.

  // Portal ko mount ke baad hi karo (server pe `document.body` nahi hota).
  if (!open || !mounted) return null;

  return createPortal(
    // z-[10000] — AURA panel (9999) ke bhi ooper. "On top of all".
    <div
      data-aura-pixel-editor=""
      role="dialog"
      aria-modal="true"
      aria-label="AURA pixel editor"
      className="fixed inset-0 z-[10000] flex flex-col bg-[#0a0a0a]/95 backdrop-blur-sm"
    >
      {/* ---- Header ---- */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#ff6500]/12">
            <Grid3x3 className="h-4 w-4 text-[#ff6500]" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-[#e8e9ea]">AURA Pixel Editor</span>
          <span className="rounded-md bg-[#ff6500]/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#ff6500]">
            AURA
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Grid resolution */}
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5f6771]">Grid</span>
            <select
              value={gridSize}
              onChange={(e) => setGridSize(Number(e.target.value))}
              aria-label="Grid resolution"
              className="h-8 rounded-md border-0 bg-[#0d0d0f] px-2 text-[11px] font-mono text-[#e8e9ea] outline-none transition-colors duration-150 hover:text-[#ff6500] focus:text-[#ff6500]"
            >
              {GRID_PRESETS.map((n) => (
                <option key={n} value={n}>{`${n}×${n}`}</option>
              ))}
            </select>
          </label>
          <IconBtn label="Close pixel editor" title="Close (Esc)" onClick={() => onOpenChange?.(false)}>
            <X className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {/* ---- Body ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Left: tool rail */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] py-3">
          <IconBtn label="Pencil" title="Pencil (draw)" active={tool === 'pencil'} onClick={() => setTool('pencil')}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Eraser" title="Eraser (transparent)" active={tool === 'eraser'} onClick={() => setTool('eraser')}>
            <Eraser className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Fill" title="Fill (flood fill one colour region)" active={tool === 'fill'} onClick={() => setTool('fill')}>
            <PaintBucket className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Eyedropper" title="Eyedropper (pick a pixel colour)" active={tool === 'eyedropper'} onClick={() => setTool('eyedropper')}>
            <Pipette className="h-4 w-4" />
          </IconBtn>

          <div className="my-1.5 h-px w-6 bg-white/[0.06]" />

          <IconBtn label="Undo" title="Undo (one stroke)" disabled={!canUndo} onClick={undo}>
            <Undo2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Redo" title="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 className="h-4 w-4" />
          </IconBtn>

          <div className="my-1.5 h-px w-6 bg-white/[0.06]" />

          <IconBtn label="Zoom in" title="Zoom in" onClick={() => setCell((c) => Math.min(32, c * 1.5))}>
            <ZoomIn className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Zoom out" title="Zoom out" onClick={() => setCell((c) => Math.max(2, Math.floor(c / 1.5)))}>
            <ZoomOut className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Toggle grid overlay" title="Show / hide pixel grid lines" active={showGrid} onClick={() => setShowGrid((s) => !s)}>
            <Grid3x3 className={cn('h-4 w-4', !showGrid && 'opacity-40')} />
          </IconBtn>
        </div>

        {/* Center: canvas stage */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto bg-[#0a0a0a] p-6">
          {/* Checkerboard — transparency dikhayi de */}
          <div
            className="rounded-md p-0 shadow-none ring-0"
            style={{
              backgroundImage:
                'linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
            }}
          >
            <canvas
              ref={viewRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onLostPointerCapture={endStroke}
              className={cn(
                'block touch-none rounded-md',
                tool === 'eyedropper' ? 'cursor-copy' : tool === 'fill' ? 'cursor-pointer' : 'cursor-crosshair',
              )}
              // Hinglish: `aspect-ratio: 1/1` + dono taraf se bound — canvas
              // kabhi squash/stretch nahi hoga (grid hamesha square hai kyunki
              // w === h). Bina iske sirf width + maxHeight se non-square
              // distortion hota aur pixels gol ho jate.
              style={{
                width: 'min(100%, calc(100vw - 320px), calc(100vh - 220px))',
                aspectRatio: '1 / 1',
                imageRendering: 'pixelated',
              }}
            />
          </div>

          <div className="mt-3 flex items-center gap-3 font-mono text-[10px] tabular-nums text-[#5f6771]">
            <span>{w}×{h} px</span>
            <span className="text-[#3f444a]">·</span>
            <span>{(w * h).toLocaleString('en-US')} cells</span>
            <span className="text-[#3f444a]">·</span>
            <span>{cell % 1 === 0 ? `${cell}px/cell` : `${cell.toFixed(1)}px/cell`}</span>
          </div>
        </div>

        {/* Right: colour + file */}
        <div className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/[0.06] p-3">
          {/* Current colour */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5f6771]">Colour</p>
            <div className="flex items-center gap-2">
              <span
                className="h-9 w-9 shrink-0 rounded-md"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Custom colour"
                  className="h-8 w-full cursor-pointer rounded-md border-0 bg-[#0d0d0f] p-0 outline-none"
                />
                <p className="mt-1 truncate font-mono text-[10px] uppercase text-[#9fa7b3]">{color}</p>
              </div>
            </div>
          </div>

          {/* Palette */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5f6771]">
              <Palette className="h-2.5 w-2.5" />
              Palette
            </p>
            <div className="grid grid-cols-6 gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  title={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'relative h-6 w-6 rounded-md border-0 transition-transform duration-150 hover:scale-110',
                    color.toLowerCase() === c.toLowerCase() && 'ring-1 ring-inset ring-[#ff6500]',
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color.toLowerCase() === c.toLowerCase() && (
                    <Check className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px w-full bg-white/[0.06]" />

          {/* File ops */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5f6771]">File</p>
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md bg-white/[0.06] px-2.5 text-[11px] text-[#e8e9ea] transition-colors duration-150 hover:bg-[#ff6500]/12 hover:text-[#ff6500]">
              <Upload className="h-3.5 w-3.5" />
              Import image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importImage(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={clearAll}
              className="flex h-8 items-center gap-2 rounded-md bg-white/[0.06] px-2.5 text-[11px] text-[#e8e9ea] transition-colors duration-150 hover:bg-[#ff6500]/12 hover:text-[#ff6500]"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear all
            </button>
            <p className="mt-1 text-[10px] text-[#5f6771]">Export PNG (transparency rakho)</p>
            <div className="flex gap-1.5">
              {[1, 8, 16].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => exportPng(s)}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-white/[0.06] text-[10px] text-[#e8e9ea] transition-colors duration-150 hover:bg-[#ff6500]/12 hover:text-[#ff6500]"
                >
                  <Download className="h-3 w-3" />
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}


"use client";

// ============================================================================
// BORDERLESS LAYOUT DESIGN — Hinglish architecture note
// ============================================================================
//
// Resize handle ek borderless divider hai — uski identity `bg-[#ff6500]`
// (dragging) aur `hover:bg-[#ff6500]/40` se bani hai, koi `border-edge`
// line nahi. Ye principle hai: divider ko define karna hai uski STATE se,
// nahi ek permanent line se — isliye dragging par wo solid orange-red
// hota hai, hover par 40% tint, default me transparent (invisible until
// needed). Saare states `duration-150` transition hain.
//
// `rounded-full` grip dot KEEP hai — wo ek decorative affordance hai
// (pointer-events-none), interactive element nahi, isliye `rounded-md`
// ki zaroorat nahi. Divider khud interactive hai aur uske saare states
// transition hain.
// ============================================================================
// Resizable panels
// ============================================================================
//
// Drag-to-resize dividers for the editor's docked regions, with hard min/max
// bounds. This is what separates "three divs side by side" from an actual
// NLE: in CapCut, Premiere and Movavi you can drag any region and it stops at
// sensible limits instead of collapsing to nothing or swallowing the screen.
//
// ---- WHY MIN/MAX ARE ENFORCED IN CODE, NOT JUST IN CSS ----
//
// `min-width` on a flex child stops it shrinking on its own, but during a
// DRAG nothing constrains you. Without a clamp here you can drag a panel to
// zero, lose the resize handle along with it, and the only way back is a page
// reload. The clamp runs on every pointer move, so the handle is always
// reachable because it is never dragged outside the reachable range.
//
// ---- POINTER EVENTS, NOT MOUSE EVENTS ----
//
// `pointerdown/move/up` are used instead of `mousedown/mousemove/mouseup`
// because they also fire for touch and pen, so panels resize on a tablet, and
// because one code path beats three.
//
// ---- WHY CAPTURE IS AN OPTIMISATION, NOT A REQUIREMENT ----
//
// `setPointerCapture` is what keeps a drag alive when the cursor leaves the
// handle. But it THROWS if the pointer id is not a live pointer, which
// happens with synthetic events and can happen if a browser refuses capture.
// An uncaught throw inside `pointerdown` aborts the handler BEFORE the drag
// starts, so the handle renders, is focusable, reports the right ARIA - and
// silently does nothing. That failure is invisible in a screenshot and in any
// assertion that only checks the handle exists.
//
// So capture is attempted, and a window-level listener covers both the
// no-capture case and dragging past the window edge.
//
// ---- KEYBOARD ACCESSIBILITY ----
//
// The handle is a real `role="separator"` with `aria-valuenow/min/max` and
// responds to Arrow keys (shift = coarse), Home/End, and double-click to
// toggle. A resize control you can only reach with a mouse is inaccessible,
// and `aria-valuenow` is what makes the current size announceable rather than
// merely visible.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type ResizeAxis = 'x' | 'y';

export interface ResizableHandleProps {
  axis: ResizeAxis;
  /** Current size of the region being resized, in px. */
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Set when growing the region means moving the pointer in -direction. */
  invert?: boolean;
  label: string;
  /** Snap to 0 when dragged below this. 0 disables collapsing. */
  collapseAt?: number;
  /** The region is currently collapsed; reported as 0 and toggled on dbl-click. */
  collapsed?: boolean;
}

export function ResizableHandle({
  axis,
  value,
  min,
  max,
  onChange,
  invert = false,
  label,
  collapseAt = 0,
  collapsed = false,
}: ResizableHandleProps) {
  const startRef = useRef<{ pointer: number; value: number } | null>(null);
  const capturedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (n: number) => {
      // Collapse is checked BEFORE the min clamp. The other way round, a drag
      // past zero gets caught by `min` and collapsing becomes unreachable.
      if (collapseAt > 0 && n < collapseAt) return 0;
      return Math.min(max, Math.max(min, n));
    },
    [min, max, collapseAt]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startRef.current = {
      pointer: axis === 'x' ? e.clientX : e.clientY,
      value,
    };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      capturedRef.current = true;
    } catch {
      // Synthetic pointer, or capture refused. The window listeners cover it.
      capturedRef.current = false;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const current = axis === 'x' ? e.clientX : e.clientY;
    onChange(clamp(start.value + (current - start.pointer) * (invert ? -1 : 1)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (capturedRef.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    startRef.current = null;
    capturedRef.current = false;
    setDragging(false);
  };

  // Window-level drag, mounted only while a drag is in progress. This is the
  // path that runs when pointer capture was unavailable, and it also keeps the
  // drag alive when the cursor leaves the window entirely.
  useEffect(() => {
    if (!dragging) return;

    const move = (e: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const current = axis === 'x' ? e.clientX : e.clientY;
      onChange(clamp(start.value + (current - start.pointer) * (invert ? -1 : 1)));
    };
    const up = () => {
      startRef.current = null;
      capturedRef.current = false;
      setDragging(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, axis, invert, onChange, clamp]);

  // Arrow keys: 12px, shift 48px. Keyboard resize needs finer control than a
  // drag, and a coarse-only step makes it unusable.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 12;
    const growKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const shrinkKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const sign = invert ? -1 : 1;

    let next: number | null = null;
    if (e.key === growKey) next = clamp(value + step * sign);
    else if (e.key === shrinkKey) next = clamp(value - step * sign);
    else if (e.key === 'Home') next = clamp(min);
    else if (e.key === 'End') next = clamp(max);

    if (next !== null) {
      e.preventDefault();
      onChange(next);
    }
  };

  const vertical = axis === 'x';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={collapsed ? 0 : Math.round(value)}
      // NOTE: aria-valuemin is NOT hardcoded to 0. The announced range must
      // match what the clamp enforces: announcing "0 to 460" for a bin whose
      // real floor is 180 means the stated range and the actual behaviour
      // disagree. 0 is only reachable when collapsing is enabled.
      aria-valuemin={collapseAt > 0 ? 0 : min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(collapsed ? min : 0)}
      title={`${label} - drag to resize, arrow keys, double-click to toggle`}
      className={[
        'group relative z-30 shrink-0 outline-none',
        vertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        dragging ? 'bg-[#ff6500]' : 'bg-transparent hover:bg-[#ff6500]/40',
        'focus-visible:bg-[#ff6500]',
        'transition-colors duration-150',
      ].join(' ')}
    >
      {/* A wider INVISIBLE hit area. The visible rule is 1-2px, but a 1px-wide
          drag target is close to unusable with a mouse. This widens the hit
          box without widening the visual. */}
      <div
        className={[
          'absolute',
          vertical
            ? '-inset-y-0 -left-1 -right-1'
            : '-inset-x-0 -top-1 -bottom-1',
        ].join(' ')}
      />
      {/* Grip dot, the affordance that says "this is draggable". Without a
          visible cue a 1px line reads as a rendering seam. */}
      {!dragging && (
        <div
          className={[
            'pointer-events-none absolute rounded-full bg-slate-500 opacity-0 transition-opacity',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
            vertical ? 'inset-y-1 left-0.5 w-0.5' : 'inset-x-1 top-0.5 h-0.5',
          ].join(' ')}
        />
      )}
    </div>
  );
}

/**
 * A resizable, collapsible region.
 *
 * `size` is controlled by the PARENT, not here, because the handles sit
 * between two regions: whichever region owned its own size would be claiming
 * space that actually belongs to its neighbour. One owner, one truth.
 */
export function ResizablePanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`min-h-0 min-w-0 overflow-hidden ${className}`}>{children}</div>;
}

/**
 * Clamps a px size against the viewport so the row cannot overflow.
 *
 * A panel sized in px keeps its px size while the window shrinks, so without
 * this the layout eventually spills horizontally. This reacts to the WINDOW
 * only - it deliberately does not depend on `size`, because re-running on
 * every size change would fight the user mid-drag.
 */
export function useClampToViewport(
  size: number,
  setSize: (n: number) => void,
  min: number,
  maxFraction = 0.5
) {
  useEffect(() => {
    const onResize = () => {
      const cap = Math.max(min, window.innerWidth * maxFraction);
      if (size > cap) setSize(cap);
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
    // `size` intentionally omitted: this effect exists to react to the
    // WINDOW, not to the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSize, min, maxFraction]);
}

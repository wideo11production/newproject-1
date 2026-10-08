'use client';

// ============================================================================
// Timeline context menu
// ============================================================================
//
// Right-click anywhere in the timeline workspace for the five actions that
// actually get used, and nothing else.
//
// ---- WHY A CONTEXT MENU AND NOT "MORE BUTTONS" ----
//
// A toolbar that offers everything has to offer everything. A context menu
// offers what is MEANINGFUL HERE, which is a much shorter list: cutting a clip
// that was not selected is the exact thing a context menu is for, and it is
// impossible to express as a toolbar button.
//
// ---- WHY THE ITEMS DISABLE INSTEAD OF HIDING ----
//
// An item that vanishes when it does not apply makes the menu feel broken -
// the user moves the mouse, the list changes, and they cannot tell whether
// they mis-clicked or whether the app lost track. A disabled item that is
// STILL THERE says "not now, and here is why" in its tooltip.

import { useEffect, useRef, useState } from 'react';
import { Scissors, Copy, ClipboardPaste, Trash2, SplitSquareVertical, Play, Link2, VolumeX } from 'lucide-react';

export interface ContextAction {
  id: 'cut' | 'copy' | 'paste' | 'ripple' | 'split' | 'attach' | 'mute' | 'loop' | 'blade';
  label: string;
  shortcut?: string;
  hint: string;
  disabled: boolean;
  onRun: () => void;
}

export function TimelineContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: ContextAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Flip the menu back inside the viewport.
  //
  // Right-clicking near the right edge is completely ordinary, and a menu that
  // opens off-screen cannot be read or clicked. Measuring AFTER mount and
  // correcting once is the only reliable way - measuring before would need the
  // element's own size, which is not known until it exists.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.min(x, window.innerWidth - r.width - pad),
      top: Math.min(y, window.innerHeight - r.height - pad),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // The browser's own menu is suppressed only while ours is open, so text
  // selection and "right-click to inspect" still work everywhere else.
  useEffect(() => {
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Timeline actions"
      style={pos}
      className="fixed z-[70] min-w-[196px] rounded-md-edge-strong bg-surface-raised py-1 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((a, i) => {
        const Icon =
          a.id === 'cut'
            ? Scissors
            : a.id === 'copy'
              ? Copy
              : a.id === 'paste'
                ? ClipboardPaste
                : a.id === 'ripple'
                  ? Trash2
                  : a.id === 'split'
                    ? SplitSquareVertical
                    : a.id === 'attach'
                      ? Link2
                      : a.id === 'mute'
                        ? VolumeX
                        : a.id === 'loop'
                          ? Play
                          : Scissors;
        return (
          <div key={a.id}>
            {/* A rule above the attachment and mute actions: those operate on
                the clip's MEDIA relationship rather than on the timeline
                position, and mixing the two in one undifferentiated list is
                how people delete the wrong thing. */}
            {i === 5 && <div className="my-1 h-px bg-surface-overlay" />}
            <button
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                if (a.disabled) return;
                a.onRun();
                onClose();
              }}
              title={a.disabled ? `Not available here. ${a.hint}` : a.hint}
              className={[
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[8px] transition-colors',
                a.disabled ? 'cursor-not-allowed text-fg-muted/60' : 'text-fg hover:text-[#ff6500]',
              ].join(' ')}
            >
              <Icon className="h-2 w-2 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{a.label}</span>
              {a.shortcut && (
                <kbd
                  className={[
                    'shrink-0 rounded px-1 py-0.5 font-mono text-[8px]',
                    a.disabled ? 'border-edge' : 'border-edge-strong text-fg-secondary',
                  ].join(' ')}
                >
                  {a.shortcut}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

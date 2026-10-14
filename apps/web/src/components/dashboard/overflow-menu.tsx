'use client';

/**
 * ============================================================================
 * DASHBOARD OVERFLOW MENU  -  Chrome-style three-dot menu
 * ============================================================================
 *
 * Chrome ke omnibox me jo 3-dots (⋮) menu hota hai, usi pattern par based
 * hai - app ke andar compact actions ke liye.
 *
 * ---- ACCESSIBILITY (ye menu keyboard + screen-reader friendly hai) ----
 *  - Proper `<button>` with `aria-haspopup` / `aria-expanded` / `aria-controls`
 *  - Click OUTSIDE par band (pointerdown pe, click se pehle - warna button
 *    ke andar ka click bhi band kar deta)
 *  - ESCAPE se band
 *  - Arrow keys se items navigate, Home/End se pehla/akhri
 *  - Focus trap jab menu khula ho (Tab bahar nahi jayega)
 *  - Menu kholte hi pehle item pe focus (keyboard users ke liye)
 *  - `role="menu"` / `role="menuitem"` semantics
 *
 * ---- SECURITY NOTE ----
 *  - Ye menu koi privileged action nahi karta. Logout bhi server-side
 *    invalidate karta hai (backend me session revoke hota hai), sirf cookie
 *    delete karna kaafi nahi hai - isliye logout handler backend call
 *    karta hai.
 *
 * Hinglish comments: har block ka arth
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

import {
  grafanaDanger,
  grafanaDangerBg,
  grafanaFocusRingVisible,
  grafanaPanel,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
} from '@wideo11/ui/design-system';

export type MenuItem = {
  id: string;
  label: string;
  /** Chhota grey text - item kya karta hai, ek line me */
  hint?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Dangerous action (logout) ko alag dikhate hain */
  danger?: boolean;
  disabled?: boolean;
};

export type OverflowMenuProps = {
  items: MenuItem[];
  /** Menu ka accessible label */
  label?: string;
  className?: string;
  /** Right-align the panel (default) ya left */
  align?: 'left' | 'right';
};

export function OverflowMenu({
  items,
  label = 'More options',
  className,
  align = 'right',
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    // Focus wapas trigger button pe - keyboard users ke liye zaroori hai,
    // warna focus body pe chala jayega aur context lost ho jayega.
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
  }, []);

  // ---- Click outside ----
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // `pointerdown` (click nahi) - taaki trigger ka click menu ko
    // turant reopen na kar de (click event bubble hota hai).
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // ---- Escape band + arrow navigation ----
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      const enabledIndexes = items
        .map((item, i) => (item.disabled ? -1 : i))
        .filter((i) => i >= 0);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const current = enabledIndexes.indexOf(
          itemRefs.current.findIndex((el) => el === document.activeElement)
        );
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextPos =
          current === -1
            ? e.key === 'ArrowDown'
              ? 0
              : enabledIndexes.length - 1
            : (current + delta + enabledIndexes.length) % enabledIndexes.length;
        itemRefs.current[enabledIndexes[nextPos]]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        itemRefs.current[enabledIndexes[0]]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        itemRefs.current[enabledIndexes[enabledIndexes.length - 1]]?.focus();
      } else if (e.key === 'Tab') {
        // Focus trap - Tab se bahar nahi jaana chahiye jab menu khula hai.
        const first = itemRefs.current[enabledIndexes[0]];
        const last = itemRefs.current[enabledIndexes[enabledIndexes.length - 1]];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, items.length, close]);

  // ---- Open hone par pehle item pe focus ----
  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus();
    }
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="dashboard-overflow-menu"
        aria-label={label}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          `${grafanaTextMuted} ${productPanelHover} hover:${grafanaText}`,
          `${grafanaFocusRingVisible}`
        )}
      >
        <MoreVertical className="h-2.5 w-2.5" aria-hidden="true" />
      </button>

      {open ? (
        <>
          {/* Click-away layer - mobile par tap karne se band ho jata hai.
              `invisible` (not hidden) rakha hai taki aria-expanded panel
              ko screen readers "rendered" samjhe, jabki visually transparent ho. */}
          <div
            className="fixed inset-0 z-40 invisible"
            onClick={() => close()}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id="dashboard-overflow-menu"
            role="menu"
            aria-label={label}
            className={cn(
              'absolute z-50 mt-2 w-72 overflow-hidden rounded-md',
              `${grafanaPanel} shadow-2xl shadow-black/60`,
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors',
                  `focus-visible:outline-none focus-visible:${productPanelHover}`,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  item.danger
                    ? `${grafanaDanger} hover:${grafanaDangerBg}/10`
                    : `${grafanaText} ${productPanelHover}`
                )}
              >
                {item.icon ? (
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  {item.hint ? (
                    <span className={`mt-0.5 block text-[11px] leading-snug ${grafanaTextMuted}`}>
                      {item.hint}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}


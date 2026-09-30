"use client";

// ============================================================================
// Top menu bar
// ============================================================================
//
// ---- WHY A MENU BAR AND NOT JUST ICONS ----
//
// The left rail is icon-only, which is compact but opaque: nine identical
// grey squares teach a new user nothing. A menu bar does the opposite job -
// it names the commands in plain language and, critically, prints the
// keyboard shortcut next to each one. That is how desktop editors teach:
// Premiere, DaVinci and Movavi all put the shortcut in the menu item, so the
// shortcut is discoverable without a help page.
//
// So the two surfaces are complementary, not redundant:
//
//   rail  - the nine CREATIVE MODES, always visible, icon + tooltip
//   menu  - every COMMAND, named, with its shortcut
//
// ---- WHY THE SHORTCUTS ARE SHOWN, NOT JUST SUPPORTED ----
//
// An undocumented shortcut is a secret. Printing it next to the command means
// the muscle memory is built from using the menu, not from reading docs.
//
// ---- MENUS CLOSE ON: outside click, Escape, or item activation ----
//
// A menu that stays open after you pick something is the classic desktop-app
// bug. All three closures are handled: clicking away (a document-level
// listener, so it catches clicks on the canvas too), Escape, and the item
// itself. Only one menu is open at a time - opening a second closes the first.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  /** Keyboard shortcut, shown right-aligned. Omit for no shortcut. */
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Renders a separator above this item. */
  separatorBefore?: boolean;
}

export interface Menu {
  id: string;
  label: string;
  items: MenuItem[];
}

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenId(null), []);

  // Document-level listener so a click anywhere - including the canvas, which
  // stops propagation - still dismisses the menu.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId, close]);

  // Alt (or F10) focuses the menu bar, which is the standard way to reach
  // menus without a mouse. Without it the bar is keyboard-unreachable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F10' || (e.altKey && e.key === 'f')) {
        e.preventDefault();
        const first = menus[0]?.id;
        if (first) setOpenId((cur) => (cur ? null : first));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menus]);

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Main menu"
      className="flex h-9 shrink-0 items-center gap-0.5 border-b border-edge bg-surface px-2"
    >
      {menus.map((menu) => {
        const open = openId === menu.id;
        return (
          <div key={menu.id} className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              // Click toggles; the outside-click handler closes.
              onClick={() => setOpenId((cur) => (cur === menu.id ? null : menu.id))}
              onMouseEnter={() => {
                // Once one menu is open, hovering the others switches to
                // them - the behaviour every desktop menu bar has, and the
                // reason a user can sweep across the bar without clicking.
                if (openId) setOpenId(menu.id);
              }}
              className={[
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                open
                  ? 'bg-surface-overlay text-white'
                  : 'text-fg-secondary hover:bg-surface-overlay/60 hover:text-fg',
              ].join(' ')}
            >
              {menu.label}
            </button>

            {open && (
              <div
                role="menu"
                aria-label={menu.label}
                className="absolute left-0 top-full z-50 mt-0.5 min-w-[240px] rounded-md border border-edge-strong bg-surface-raised py-1 shadow-xl"
              >
                {menu.items.map((item, i) => (
                  <div key={`${item.label}-${i}`}>
                    {item.separatorBefore && <div className="my-1 h-px bg-surface-overlay" />}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        close();
                        item.onSelect?.();
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition-colors',
                        item.disabled
                          ? 'cursor-not-allowed text-fg-muted'
                          : 'text-fg hover:bg-sky-600 hover:text-white',
                      ].join(' ')}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <kbd
                          className={[
                            'shrink-0 rounded border px-1 py-0.5 font-mono text-[10px]',
                            item.disabled
                              ? 'border-edge text-fg-muted'
                              : 'border-edge-strong text-fg-secondary',
                          ].join(' ')}
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Wraps a child in a titled group, used for the toolbar sections. */
export function ToolbarGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={title}
      title={title}
      className="flex items-center gap-0.5 border-r border-edge px-2 last:border-r-0"
    >
      {children}
    </div>
  );
}

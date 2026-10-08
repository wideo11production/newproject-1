'use client';

// ============================================================================
// PER-ICON HELP
// ============================================================================
//
// Hover any tool and a card appears: what it does, where you would use it,
// what it is good at, and — the part almost every app leaves out — what it
// costs you.
//
// ---- WHY A POPOVER AND NOT A TOOLTIP ----
//
// A tooltip holds one line. A useful answer needs four. Four lines of text in a
// small card is still less reading than the manual, and it arrives exactly
// when the question is being asked.
//
// ---- WHY THERE IS A "FULL HELP" LINK ----
//
// Because a hover card is for a decision you are making RIGHT NOW, and the full
// page is for one you are planning. Without the link, a user who wants to
// understand a feature properly has to leave the editor and come back and find
// their place again, so they simply do not learn it.
//
// ---- WHY IT IS NOT THE MODAL ----
//
// The modal covers the editor. Covering the editor to explain a button in the
// editor is the wrong trade for something you may want to read twice while
// working.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ThumbsUp, ThumbsDown, BookOpen } from 'lucide-react';
import { helpFor, type HelpEntry } from '../../lib/help-registry';

/**
 * A popover for ONE control.
 *
 * `anchorId` is the `aria-label` of the control being explained, which is how
 * the toolbar hands it over without every button needing a ref.
 */
export function HelpPopover({
  anchorId,
  anchorRect,
  onClose,
}: {
  anchorId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const entry: HelpEntry | null = helpFor(anchorId);
  const [pos, setPos] = useState({ left: anchorRect.left, top: anchorRect.bottom + 6 });

  // Keep the card on screen. A card attached to an icon near the right edge
  // would otherwise open half off the window, which is where the "no point
  // reading this" feeling comes from.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - r.width - 8)),
      top: Math.min(anchorRect.bottom + 6, window.innerHeight - r.height - 8),
    });
  }, [anchorRect]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // A short delay, so a card does not appear under a cursor that was only
    // passing over the toolbar on its way somewhere else.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
    }, 120);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!entry) return null;

  return (
    <div
      ref={cardRef}
      role="tooltip"
      style={pos}
      className="fixed z-[80] w-[320px] bg-surface-raised p-3 shadow-2xl"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold text-fg">{entry.title}</h3>
        <span className="rounded-md bg-surface-overlay px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-fg-muted">
          {entry.category}
        </span>
        {entry.keys && (
          <kbd className="ml-auto rounded-md border-0 bg-surface-sunken px-1 py-0.5 font-mono text-[8px] text-fg-secondary">
            {entry.keys}
          </kbd>
        )}
      </div>

      <p className="mb-2 text-[8px] leading-snug text-fg-secondary">{entry.what}</p>

      <p className="mb-2 text-[8px] leading-snug text-fg-muted">
        <span className="text-fg-secondary">Use it for: </span>
        {entry.use}
      </p>

      <div className="space-y-1.5-0 bg-surface-sunken pt-2">
        <p className="flex items-start gap-1.5 text-[8px] leading-snug text-fg-secondary">
          <ThumbsUp className="mt-0.5 h-2 w-2 shrink-0 text-emerald-400" aria-hidden="true" />
          {entry.good}
        </p>
        <p className="flex items-start gap-1.5 text-[8px] leading-snug text-fg-secondary">
          <ThumbsDown className="mt-0.5 h-2 w-2 shrink-0 text-amber-400" aria-hidden="true" />
          {entry.cost}
        </p>
      </div>

      <Link
        href={`/help#${entry.id}`}
        onClick={onClose}
        className="mt-2.5 flex items-center gap-1 text-[8px] text-sky-300 transition-colors duration-150 hover:text-sky-200"
      >
        <BookOpen className="h-2 w-2" aria-hidden="true" />
        Full help for this tool
        <ArrowUpRight className="ml-auto h-2 w-2" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * Hover-any-icon wiring for a container.
 *
 * Delegated, not per-button. Fifty buttons each carrying their own mouse
 * handlers is fifty chances to get the delay subtly wrong, and the symptom -
 * cards that open when you were only reaching for something else - is worse than
 * having no cards at all.
 */
export function useIconHelp(containerRef: React.RefObject<HTMLElement>) {
  const [state, setState] = useState<{ id: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const findButton = (target: EventTarget | null): HTMLElement | null => {
      let el = target as HTMLElement | null;
      while (el && el !== root) {
        if (el.tagName === 'BUTTON' || el.tagName === 'A') return el;
        el = el.parentElement;
      }
      return null;
    };

    const onOver = (e: MouseEvent) => {
      const btn = findButton(e.target);
      if (!btn) return;
      const id = btn.getAttribute('aria-label') || '';
      // Only buttons we actually have an entry for. A card that says "no help
      // available" is worse than no card.
      if (!helpFor(id)) return;
      if (timer.current) clearTimeout(timer.current);
      const rect = btn.getBoundingClientRect();
      timer.current = setTimeout(() => setState({ id, rect }), 450);
    };

    const onOut = (e: MouseEvent) => {
      const btn = findButton(e.target);
      const to = findButton(e.relatedTarget);
      if (btn === to) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(null), 160);
    };

    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseout', onOut);
    return () => {
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [containerRef]);

  return {
    popover: state ? <HelpPopover anchorId={state.id} anchorRect={state.rect} onClose={() => setState(null)} /> : null,
  };
}

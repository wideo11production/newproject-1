'use client';

// ============================================================================
// Help entry point + hover wiring for the whole toolbar
// ============================================================================
//
// Two jobs, deliberately in one file:
//
//  1. THE HELP BUTTON, which lives on the TOP menu bar. It was a toolbar
//     button and that was wrong twice: it looked like a tool, so people used it
//     instead of learning the tools, and it sat inside a strip whose only job
//     is to hold tools.
//
//  2. THE HOVER LAYER. Every tool explains ITSELF on hover - what it does,
//     where you would use it, what it is good at, and what it costs you. That
//     last question is the one every app leaves out, and the one that actually
//     helps you decide whether to use the feature at all.
//
//     Delegated from the container rather than per button. Fifty buttons each
//     with their own hover handler is fifty chances to get the timing subtly
//     wrong, and the failure mode - a card opening under a cursor that was only
//     passing through - is worse than having no cards at all.

import { useState, useRef, type RefObject } from 'react';
import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { HelpModal } from './help-modal';
import { useIconHelp } from './icon-help';
import { HELP } from '../../lib/help-registry';

export function HelpTip() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        title="What every control does — hover any tool for its own card, or open the full guide"
        className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
      >
        <HelpCircle className="h-2 w-2" aria-hidden="true" />
      </button>
      {open && <HelpModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Mount the hover layer once over a container. */
export function useToolbarHelp(containerRef: RefObject<HTMLElement>) {
  return useIconHelp(containerRef);
}

export { HELP };


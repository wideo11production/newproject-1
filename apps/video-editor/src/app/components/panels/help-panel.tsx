'use client';

// ============================================================================
// Help panel
// ============================================================================
//
// The shortcut list is generated from ONE table, and the menu bar prints from
// the same table. That is the point: a shortcut list maintained by hand drifts
// from the keyboard handler within a week, and a user who presses `S` and gets
// nothing has no way to tell a broken binding from an undocumented one.
//
// The table lives in `lib/shortcuts.ts`.

import { Keyboard, MousePointer2, Sparkles } from 'lucide-react';
import { PanelSection } from './panel-kit';
import { SHORTCUTS, MOUSE_ACTIONS, FEATURES } from '../../lib/shortcuts';

export function HelpPanel() {
  return (
    <div className="space-y-3">
      <PanelSection title="Keyboard" hint="Every one of these is also printed next to its command in the menu bar.">
        <ul className="space-y-1">
          {SHORTCUTS.map((s) => (
            <li key={`${s.group}-${s.keys}`} className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-[11px] text-fg-secondary">
                <span className="block text-fg">{s.label}</span>
                {s.hint && <span className="block text-[10px] text-fg-muted">{s.hint}</span>}
              </span>
              <kbd className="shrink-0 rounded border border-edge-strong px-1.5 py-0.5 font-mono text-[10px] text-fg">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection
        title={
          <span className="inline-flex items-center gap-1">
            <MousePointer2 className="h-3 w-3" aria-hidden="true" />
            Mouse
          </span>
        }
        hint="Gestures cannot be typed, so they are listed here instead."
      >
        <ul className="space-y-1">
          {MOUSE_ACTIONS.map((m) => (
            <li key={m.gesture} className="text-[11px]">
              <span className="text-fg">{m.gesture}</span>
              <span className="block text-[10px] text-fg-muted">{m.does}</span>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection
        title={
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            What runs locally
          </span>
        }
        hint="Nothing in this editor sends your media anywhere."
      >
        <ul className="space-y-1">
          {FEATURES.map((f) => (
            <li key={f.name} className="text-[11px]">
              <span className="text-fg">{f.name}</span>
              <span className="block text-[10px] leading-snug text-fg-muted">{f.how}</span>
            </li>
          ))}
        </ul>
      </PanelSection>

      <p className="flex items-start gap-1.5 text-[10px] leading-snug text-fg-muted">
        <Keyboard className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        Shortcuts are ignored while you are typing in a text field, so a title can contain the letter
        S without cutting a clip.
      </p>
    </div>
  );
}

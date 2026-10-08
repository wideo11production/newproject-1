'use client';

// ============================================================================
// Help panel — borderless, rounded-md
// ============================================================================
//
// Hinglish: is panel me koi bhi `border-edge` separator nahi hai. PanelSection
// ek `bg-[#1a1a1a]` Rich Charcoal block hai jo contrast grid bana deta hai bina
// kisi line ke. Kbd element: `rounded-md`, 150ms transition, hover par
// `border-[#ff6500]` accent hota hai — wo highlight hai, separator nahi.

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
              <span className="min-w-0 text-[8px] text-fg-secondary">
                <span className="block text-fg">{s.label}</span>
                {s.hint && <span className="block text-[8px] text-fg-muted">{s.hint}</span>}
              </span>
              <kbd className="shrink-0 rounded-md border-0 bg-surface-sunken px-1.5 py-0.5 font-mono text-[8px] text-fg">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection
        title={
          <span className="inline-flex items-center gap-1">
            <MousePointer2 className="h-2 w-2" aria-hidden="true" />
            Mouse
          </span>
        }
        hint="Gestures cannot be typed, so they are listed here instead."
      >
        <ul className="space-y-1">
          {MOUSE_ACTIONS.map((m) => (
            <li key={m.gesture} className="text-[8px]">
              <span className="text-fg">{m.gesture}</span>
              <span className="block text-[8px] text-fg-muted">{m.does}</span>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection
        title={
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-2 w-2" aria-hidden="true" />
            What runs locally
          </span>
        }
        hint="Nothing in this editor sends your media anywhere."
      >
        <ul className="space-y-1">
          {FEATURES.map((f) => (
            <li key={f.name} className="text-[8px]">
              <span className="text-fg">{f.name}</span>
              <span className="block text-[8px] leading-snug text-fg-muted">{f.how}</span>
            </li>
          ))}
        </ul>
      </PanelSection>

      <p className="flex items-start gap-1.5 text-[8px] leading-snug text-fg-muted">
        <Keyboard className="mt-0.5 h-2 w-2 shrink-0" aria-hidden="true" />
        Shortcuts are ignored while you are typing in a text field, so a title can contain the letter
        S without cutting a clip.
      </p>
    </div>
  );
}

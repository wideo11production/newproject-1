'use client';

// ============================================================================
// BORDERLESS PANEL DESIGN — Hinglish architecture note
// ============================================================================
//
// Panel sections, tiles, inputs — sabke `border-edge` / `border-edge-strong`
// separators hata diye gaye hain. Panel sections ab `bg-[#1a1a1a]` Rich
// Charcoal blocks hain (sidebar role), jo ek contrast grid bana dete hain
// bina kisi line ke. Tiles: default me koi nahi, `hover` par
// `border-[#ff6500]` orange-red accent appear hota hai. Inputs: base
// hata diya, `focus` par `border-[#ff6500]` accent aata hai.
//
// Default quiet, interaction par accent — ye principle saare components me
// hai. Saare interactive elements `rounded-md`, 150ms transition.
// ============================================================================
// Panel building blocks
// ============================================================================
//
// The editor's left column is a stack of small, dense panels. They were each
// hand-rolled with their own Card/Separator/Label wrappers, which is how the
// column ended up with four different heading sizes and two different slider
// styles. These are the shared pieces they are all built from.
//
// Shared means a change to density or focus colour lands in every panel at
// once. Four copies is how a design drifts apart without anyone deciding it
// should.

import type { ReactNode } from 'react';
import { TEXT_FONTS, type TextAnimationKind, DEFAULT_TEXT_ANIMATION } from '../../lib/engine/types';

export function PanelSection({
  title,
  hint,
  children,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="bg-[#1a1a1a] pb-3 last:bg-[#0a0a0a]">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
        {action}
      </div>
      {hint && <p className="mb-2 text-[8px] leading-snug text-fg-muted">{hint}</p>}
      {children}
    </section>
  );
}

/** A grid of clickable tiles. Used by transitions, filters, presets, layouts. */
export function TileGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-1.5 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{children}</div>
  );
}

export function Tile({
  active,
  label,
  hint,
  swatch,
  onClick,
  ariaLabel,
}: {
  active?: boolean;
  label: string;
  hint?: string;
  swatch?: string;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={Boolean(active)}
      aria-label={ariaLabel ?? label}
      title={hint ? `${label}\n${hint}` : label}
      className={[
        'group flex flex-col gap-1 bg-[#1a1a1a] p-1.5 text-left transition-colors duration-150',
        active
          ? 'bg-[#ff6500]/15 text-[#ff6500]'
          : 'text-fg-secondary hover:bg-[#ff6500]/20 hover:text-fg',
      ].join(' ')}
    >
      {swatch && <span className={`h-7 w-full bg-gradient-to-br ${swatch}`} aria-hidden="true" />}
      <span className="truncate text-[8px] font-medium text-fg">{label}</span>
      {hint && <span className="line-clamp-2 text-[8px] leading-snug text-fg-muted">{hint}</span>}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[8px] text-fg-secondary">
        <span>{label}</span>
        {hint && <span className="font-mono text-[8px] text-fg-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`h-1 w-full cursor-pointer accent-[#ff6500] ${className}`}
    />
  );
}

export function TextInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#1a1a1a] px-2 py-1 text-[8px] text-fg placeholder:text-fg-muted focus:ring-1 focus:ring-inset focus:ring-[#ff6500]/60 focus:outline-none"
    />
  );
}

export function NumberInput({
  value,
  onChange,
  ariaLabel,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="w-full bg-[#1a1a1a] px-2 py-1 font-mono text-[8px] text-fg focus:ring-1 focus:ring-inset focus:ring-[#ff6500]/60 focus:outline-none"
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ve-select-dropdown">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full bg-[#1a1a1a] px-2 py-1 text-[8px] text-fg focus:ring-1 focus:ring-inset focus:ring-[#ff6500]/60 focus:outline-none border border-[#ff6500]/30 hover:border-[#ff6500] hover:text-[#ff6500] focus:border-[#ff6500] focus:text-[#ff6500] transition-colors duration-150"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[8px] text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 h-2.5 w-2.5 shrink-0 accent-[#ff6500]"
      />
      <span>
        <span>{label}</span>
        {hint && <span className="block text-[8px] text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function ColorInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return (
    <input
      type="color"
      value={safe}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full cursor-pointer bg-[#1a1a1a] p-0.5"
    />
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  full,
  ariaLabel,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'danger';
  disabled?: boolean;
  full?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const styles = {
    default: 'text-[#ff6500] hover:text-[#e55800]',
    outline: 'bg-[#1a1a1a] text-fg hover:text-[#ff6500]',
    danger: 'text-rose-400 hover:text-rose-300',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[8px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-[#1a1a1a] p-3 text-center">
      <p className="text-[8px] font-medium text-fg-secondary">{title}</p>
      <p className="mt-1 text-[8px] leading-snug text-fg-muted">{body}</p>
    </div>
  );
}

/** Font family selector using the curated TEXT_FONTS catalogue. */
export function FontSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const entry = TEXT_FONTS.find((f) => f.id === value);
  const displayFont = entry?.family ?? value;
  return (
    <div className="ve-select-dropdown">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1a1a1a] px-2 py-1 text-[8px] text-fg focus:ring-1 focus:ring-inset focus:ring-[#ff6500]/60 focus:outline-none border border-[#ff6500]/30 hover:border-[#ff6500] hover:text-[#ff6500] focus:border-[#ff6500] focus:text-[#ff6500] transition-colors duration-150"
        style={{ fontFamily: displayFont }}
      >
        {TEXT_FONTS.map((f) => (
          <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const ANIMATION_KINDS: Array<{ value: TextAnimationKind; label: string; hint: string }> = [
  { value: 'none', label: 'None', hint: 'No animation' },
  { value: 'fade', label: 'Fade in', hint: 'Smooth opacity fade' },
  { value: 'typewriter', label: 'Typewriter', hint: 'Character by character reveal' },
  { value: 'slide-up', label: 'Slide up', hint: 'Slide up from bottom' },
  { value: 'slide-down', label: 'Slide down', hint: 'Slide down from top' },
  { value: 'slide-left', label: 'Slide left', hint: 'Slide left from right' },
  { value: 'slide-right', label: 'Slide right', hint: 'Slide right from left' },
  { value: 'scale-in', label: 'Scale in', hint: 'Zoom from small to normal' },
  { value: 'bounce', label: 'Bounce', hint: 'Elastic bounce entrance' },
  { value: 'rotate-in', label: 'Rotate in', hint: 'Rotate and scale in' },
  { value: 'wave', label: 'Wave', hint: 'Per-character wave motion' },
  { value: 'fade-up', label: 'Fade up', hint: 'Fade in while sliding up' },
];

/** Animation kind selector for text entrance effects. */
export function AnimationSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: TextAnimationKind;
  onChange: (v: TextAnimationKind) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ve-select-dropdown">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as TextAnimationKind)}
        className="w-full bg-[#1a1a1a] px-2 py-1 text-[8px] text-fg focus:ring-1 focus:ring-inset focus:ring-[#ff6500]/60 focus:outline-none border border-[#ff6500]/30 hover:border-[#ff6500] hover:text-[#ff6500] focus:border-[#ff6500] focus:text-[#ff6500] transition-colors duration-150"
      >
        {ANIMATION_KINDS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

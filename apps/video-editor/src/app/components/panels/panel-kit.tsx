'use client';

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
    <section className="border-b border-edge pb-3 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
        {action}
      </div>
      {hint && <p className="mb-2 text-[11px] leading-snug text-fg-muted">{hint}</p>}
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
        'group flex flex-col gap-1 rounded-md border p-1.5 text-left transition-colors',
        active
          ? 'border-sky-500 bg-sky-500/15 ring-1 ring-sky-500/40'
          : 'border-edge bg-surface-raised/60 hover:border-edge-strong hover:bg-surface-overlay/60',
      ].join(' ')}
    >
      {swatch && <span className={`h-7 w-full rounded bg-gradient-to-br ${swatch}`} aria-hidden="true" />}
      <span className="truncate text-[11px] font-medium text-fg">{label}</span>
      {hint && <span className="line-clamp-2 text-[10px] leading-snug text-fg-muted">{hint}</span>}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[11px] text-fg-secondary">
        <span>{label}</span>
        {hint && <span className="font-mono text-[10px] text-fg-muted">{hint}</span>}
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
      className={`h-1 w-full cursor-pointer accent-sky-500 ${className}`}
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
      className="w-full rounded-md border border-edge-strong bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-muted focus:border-sky-500 focus:outline-none"
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
      className="w-full rounded-md border border-edge-strong bg-surface px-2 py-1 font-mono text-[11px] text-fg focus:border-sky-500 focus:outline-none"
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
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-md border border-edge-strong bg-surface px-2 py-1 text-[11px] text-fg focus:border-sky-500 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 h-3 w-3 shrink-0 accent-sky-500"
      />
      <span>
        <span>{label}</span>
        {hint && <span className="block text-[10px] text-fg-muted">{hint}</span>}
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
      className="h-7 w-full cursor-pointer rounded border border-edge-strong bg-surface p-0.5"
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
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'danger';
  disabled?: boolean;
  full?: boolean;
  ariaLabel?: string;
}) {
  const styles = {
    default: 'bg-sky-600 text-white hover:bg-sky-500',
    outline: 'border border-edge-strong text-fg hover:bg-surface-overlay',
    danger: 'border border-rose-900 text-rose-300 hover:bg-rose-950/50',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${
        full ? 'w-full' : ''
      }`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-dashed border-edge p-3 text-center">
      <p className="text-[11px] font-medium text-fg-secondary">{title}</p>
      <p className="mt-1 text-[10px] leading-snug text-fg-muted">{body}</p>
    </div>
  );
}

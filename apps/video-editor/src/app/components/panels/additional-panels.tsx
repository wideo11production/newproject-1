'use client';

// ============================================================================
// Additional editor panels: samples, backgrounds, intros, effects, tools
// ============================================================================
//
// Hinglish: Ye panels mode-rail ke naye modes ke liye hain jo user ne request kia
// tha — "sample videos, backgrounds, intro videos, effects, tools".
// Har panel ek grid-based layout use karta hai jo Movavi-style banata hai.
//
// Zero background framing boxes — flat design with sharp outlines only.
// Active highlights use orange-red (#ff6500) signature theme.

import { useMemo } from 'react';
import {
  Film,
  SquareStack,
  Layers,
  Wand2,
  Settings,
  Play,
  Sparkles,
} from 'lucide-react';
import { PanelSection, Tile, TileGrid, Button, Field, Slider, EmptyState, Toggle } from './panel-kit';
import type { TimelineClip } from '../../lib/engine/types';

// ---------------------------------------------------------------------------
// Sample Videos Panel
// ---------------------------------------------------------------------------

const SAMPLE_VIDEOS = [
  {
    id: 'broll-nature',
    label: 'Nature B-Roll',
    hint: '4K forest, waterfall, wildlife — 10 clips, royalty-free',
    previewSwatch: 'from-green-500/30 to-green-900/10',
  },
  {
    id: 'broll-urban',
    label: 'Urban Motion',
    hint: 'City timelapses, street scenes, people — 8 clips, 4K',
    previewSwatch: 'from-blue-500/30 to-slate-900/10',
  },
  {
    id: 'broll-business',
    label: 'Business',
    hint: 'Office scenes, meetings, presentations — 6 clips',
    previewSwatch: 'from-slate-500/30 to-slate-900/10',
  },
  {
    id: 'broll-animated',
    label: 'Animated FX',
    hint: 'Motion graphics elements, lower-thirds — 12 clips',
    previewSwatch: 'from-purple-500/30 to-purple-900/10',
  },
];

export function SamplesPanel() {
  const filtered = useMemo(() => SAMPLE_VIDEOS.slice(), []);

  return (
    <div className="space-y-3">
      <PanelSection
        title="Sample Videos"
        hint="Drag-and-drop stock clips. All royalty-free, all 4K unless noted."
      >
        <TileGrid cols={2}>
          {filtered.map((s) => (
            <Tile
              key={s.id}
              label={s.label}
              hint={s.hint}
              swatch={s.previewSwatch}
              onClick={() => {}}
              ariaLabel={`Import sample: ${s.label}`}
            />
          ))}
        </TileGrid>
      </PanelSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backgrounds Panel
// ---------------------------------------------------------------------------

const BACKGROUND_COLORS = [
  { id: 'black', label: 'Black', value: '#000000' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'grey', label: 'Mid Grey', value: '#808080' },
  { id: 'orange', label: 'Orange', value: '#ff6500' },
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'green', label: 'Green', value: '#22c55e' },
];

const BACKGROUND_GRADIENTS = [
  { id: 'sunset', label: 'Sunset', swatch: 'from-[#ff6500] to-[#1e3a8a]' },
  { id: 'ocean', label: 'Ocean', swatch: 'from-[#3b82f6] to-[#0ea5e9]' },
  { id: 'forest', label: 'Forest', swatch: 'from-[#22c55e] to-[#16a34a]' },
  { id: 'midnight', label: 'Midnight', swatch: 'from-[#1e293b] to-[#0f172a]' },
  { id: 'rose', label: 'Rose', swatch: 'from-[#ec4899] to-[#db2777]' },
  { id: 'amber', label: 'Amber', swatch: 'from-[#f59e0b] to-[#d97706]' },
];

export function BackgroundsPanel() {
  return (
    <div className="space-y-3">
      <PanelSection
        title="Colour backgrounds"
        hint="Solid colour for the project canvas or a clip overlay."
      >
        <TileGrid cols={3}>
          {BACKGROUND_COLORS.map((c) => (
            <Tile
              key={c.id}
              label={c.label}
              onClick={() => {}}
              ariaLabel={`Set background to ${c.label}`}
              swatch={`bg-[${c.value}]`}
            />
          ))}
        </TileGrid>
      </PanelSection>

      <PanelSection
        title="Gradient backgrounds"
        hint="Linear gradients for depth and mood."
      >
        <TileGrid cols={2}>
          {BACKGROUND_GRADIENTS.map((g) => (
            <Tile
              key={g.id}
              label={g.label}
              onClick={() => {}}
              ariaLabel={`Set gradient background to ${g.label}`}
              swatch={`bg-gradient-to-br ${g.swatch}`}
            />
          ))}
        </TileGrid>
      </PanelSection>

      <PanelSection title="Custom colour" hint="Enter a hex code for a bespoke background.">
        <Field label="Hex colour" hint="#RRGGBB">
          <input
            type="text"
            defaultValue="#000000"
            className="w-full rounded-edge bg-surface-raised px-1 font-mono text-[8px] text-fg focus:border-[#ff6500] focus:outline-none"
            aria-label="Custom background hex"
          />
        </Field>
      </PanelSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intros Panel
// ---------------------------------------------------------------------------

const INTRO_PRESETS = [
  {
    id: 'intro-cinematic',
    label: 'Cinematic',
    hint: 'Slow zoom with title reveal. 5 seconds.',
    duration: 5,
    swatch: 'from-[#ff6500]/40 to-slate-900/20',
  },
  {
    id: 'intro-glitch',
    label: 'Glitch',
    hint: 'Digital glitch effect into title. 3 seconds.',
    duration: 3,
    swatch: 'from-purple-500/40 to-slate-900/20',
  },
  {
    id: 'intro-brush',
    label: 'Brush Stroke',
    hint: 'Animated brush reveals the title. 4 seconds.',
    duration: 4,
    swatch: 'from-cyan-500/40 to-slate-900/20',
  },
  {
    id: 'intro-elegant',
    label: 'Elegant',
    hint: 'Minimal fade with serif type. 3 seconds.',
    duration: 3,
    swatch: 'from-slate-500/40 to-slate-900/20',
  },
];

export interface IntrosPanelProps {
  playheadFrame: number;
  fps: number;
  onApplyIntro: (introId: string, atFrame: number) => void;
}

export function IntrosPanel({ playheadFrame, fps, onApplyIntro }: IntrosPanelProps) {
  const formatDuration = (seconds: number): string => {
    const frames = Math.round(seconds * fps);
    return `${seconds}s (${frames}f)`;
  };

  return (
    <div className="space-y-3">
      <PanelSection
        title="Intro sequences"
        hint="Drop at the playhead to prepend to your timeline."
      >
        <TileGrid cols={2}>
          {INTRO_PRESETS.map((intro) => (
            <Tile
              key={intro.id}
              label={intro.label}
              hint={`${formatDuration(intro.duration)} · ${intro.swatch}`}
              swatch={intro.swatch}
              onClick={() => onApplyIntro(intro.id, playheadFrame)}
              ariaLabel={`Place ${intro.label} intro at playhead`}
            />
          ))}
        </TileGrid>
      </PanelSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effects Panel
// ---------------------------------------------------------------------------

const EFFECT_CATEGORIES = [
  {
    name: 'Blur',
    effects: [
      { id: 'blur-gaussian', label: 'Gaussian Blur', hint: 'Softens the entire clip.' },
      { id: 'blur-tilt', label: 'Tilt-Shift', hint: 'Fake miniature with gradient blur.' },
    ],
  },
  {
    name: 'Distort',
    effects: [
      { id: 'distort-glitch', label: 'Glitch', hint: 'Digital corruption artifact.' },
      { id: 'distort-wave', label: 'Wave', hint: 'Sinusoidal displacement.' },
    ],
  },
  {
    name: 'Stylize',
    effects: [
      { id: 'stylize-vintage', label: 'Vintage', hint: 'Film emulation with grain.' },
      { id: 'stylize-comic', label: 'Comic', hint: 'Halftone dots and bold lines.' },
    ],
  },
  {
    name: 'Key',
    effects: [
      { id: 'key-chroma', label: 'Chroma Key', hint: 'Remove a single colour.' },
      { id: 'key-luma', label: 'Luma Key', hint: 'Remove based on brightness.' },
    ],
  },
];

export interface EffectsPanelProps {
  clip: TimelineClip | null;
  onApplyEffect: (effectId: string) => void;
  onRemoveEffect: (effectId: string) => void;
}

export function EffectsPanel({ clip, onApplyEffect, onRemoveEffect }: EffectsPanelProps) {
  const applied = useMemo(() => new Set(clip?.effects ?? []), [clip]);

  return (
    <div className="space-y-3">
      {EFFECT_CATEGORIES.map((cat) => (
        <PanelSection key={cat.name} title={cat.name} hint={`Visual effects in the ${cat.name} category.`}>
          <TileGrid cols={2}>
            {cat.effects.map((e) => {
              const on = applied.has(e.id);
              return (
                <Tile
                  key={e.id}
                  label={e.label}
                  hint={e.hint}
                  active={on}
                  onClick={() => (on ? onRemoveEffect(e.id) : onApplyEffect(e.id))}
                  ariaLabel={`${on ? 'Remove' : 'Apply'} effect: ${e.label}`}
                />
              );
            })}
          </TileGrid>
        </PanelSection>
      ))}

      {!clip && <EmptyState title="Select a clip" body="Effects apply to one clip at a time, so select the clip you want to change." />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools Panel
// ---------------------------------------------------------------------------

const TOOL_GROUPS = [
  {
    name: 'Performance',
    tools: [
      { id: 'proxy', label: 'Proxy mode', hint: 'Use lower-res proxies for smoother scrubbing' },
      { id: 'cache', label: 'Cache frames', hint: 'Pre-render effects to cache' },
    ],
  },
  {
    name: 'Quality',
    tools: [
      { id: 'hdr', label: 'HDR output', hint: 'Render in HDR10 (requires HDR display)' },
      { id: 'denoise', label: 'Frame interpolation', hint: 'Generate intermediate frames' },
    ],
  },
  {
    name: 'Import',
    tools: [
      { id: 'hevc', label: 'HEVC hardware decode', hint: 'Use GPU for HEVC playback' },
      { id: 'gpu', label: 'GPU acceleration', hint: 'Enable WebGL compositor' },
    ],
  },
];

export interface ToolsPanelProps {
  settings: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
}

export function ToolsPanel({ settings, onToggle }: ToolsPanelProps) {
  return (
    <div className="space-y-3">
      {TOOL_GROUPS.map((group) => (
        <PanelSection key={group.name} title={group.name}>
          <div className="space-y-2">
            {group.tools.map((t) => {
              const val = settings[t.id] ?? false;
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between-edge py-1.5 last:border-b-0"
                >
                  <div>
                    <span className="text-[8px] font-medium text-fg">{t.label}</span>
                    <p className="text-[7px] text-fg-muted">{t.hint}</p>
                  </div>
                   <Toggle
                     checked={val}
                     onChange={(v: boolean) => onToggle(t.id, v)}
                     label={t.label}
                     hint={t.hint}
                   />
                </div>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </div>
  );
}

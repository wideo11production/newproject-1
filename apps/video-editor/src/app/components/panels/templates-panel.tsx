'use client';

import { useMemo } from 'react';
import { LayoutTemplate, Film, Type, Clock, Zap } from 'lucide-react';
import { PanelSection, Tile, TileGrid, EmptyState } from './panel-kit';
import type { TimelineClip } from '../../lib/engine/types';

export interface TemplateDefs {
  id: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  duration: number;
  layerCount: number;
  tags: string[];
  previewSwatch: string;
}

export const TEMPLATE_PRESETS: TemplateDefs[] = [
  {
    id: 'intro-simple',
    label: 'Simple intro',
    hint: 'Text slides in over a blurred background. 3 seconds, 2 layers.',
    icon: Type,
    duration: 3,
    layerCount: 2,
    tags: ['intro', 'text', 'animated'],
    previewSwatch: 'from-[#ff6500]/40 to-slate-900/20',
  },
  {
    id: 'end-screen',
    label: 'End screen',
    hint: 'Subscribe prompt with a video slot. 10 seconds, 3 layers.',
    icon: LayoutTemplate,
    duration: 10,
    layerCount: 3,
    tags: ['endscreen', 'call-to-action', 'interactive'],
    previewSwatch: 'from-violet-500/40 to-slate-900/20',
  },
  {
    id: 'lower-third',
    label: 'Lower third',
    hint: 'Name and title slide in from the left. 4 seconds, 1 overlay layer.',
    icon: Type,
    duration: 4,
    layerCount: 1,
    tags: ['lower-third', 'text', 'quick'],
    previewSwatch: 'from-cyan-500/40 to-slate-900/20',
  },
  {
    id: 'transition-wipe',
    label: 'Wipe transition',
    hint: 'Push-wipe between two clips. 1 second, overlays the boundary.',
    icon: Zap,
    duration: 1,
    layerCount: 0,
    tags: ['transition', 'motion', 'quick'],
    previewSwatch: 'from-amber-500/40 to-slate-900/20',
  },
  {
    id: 'countdown',
    label: 'Countdown timer',
    hint: 'Animated 3-2-1 countdown. 3 seconds, 1 text layer.',
    icon: Clock,
    duration: 3,
    layerCount: 1,
    tags: ['countdown', 'text', 'numbered'],
    previewSwatch: 'from-rose-500/40 to-slate-900/20',
  },
  {
    id: 'highlight-reel',
    label: 'Highlight reel',
    hint: 'Ken Burns montage across 5 media slots. 15 seconds, 5 layers.',
    icon: Film,
    duration: 15,
    layerCount: 5,
    tags: ['montage', 'cinematic', 'multi'],
    previewSwatch: 'from-emerald-500/40 to-slate-900/20',
  },
];

export interface TemplatesPanelProps {
  /** The clip under the playhead, if any — templates can overlay it. */
  clip: TimelineClip | null;
  /** Current playhead frame, for placing a new template. */
  playheadFrame: number;
  /** Project fps, so duration can be shown in frames. */
  fps: number;
  /** Apply a template at the playhead position. */
  onApplyTemplate: (templateId: string, atFrame: number) => void;
  /** Replace a clip's source with a template-based composition. */
  onStampTemplate: (templateId: string, clipId: string) => void;
}

function NoSelection({ what }: { what: string }) {
  return (
    <EmptyState
      title={`Select a clip or place ${what}`}
      body="Templates can overlay a selected clip, or drop onto an empty track at the playhead. Click the playhead area to position one without a selection."
    />
  );
}

export function TemplatesPanel({ clip, playheadFrame, fps, onApplyTemplate, onStampTemplate }: TemplatesPanelProps) {
  const filtered = useMemo(() => {
    return TEMPLATE_PRESETS.slice();
  }, []);

  const formatDuration = (seconds: number): string => {
    const frames = Math.round(seconds * fps);
    return `${seconds}s (${frames}f)`;
  };

  return (
    <div className="space-y-3">
      <PanelSection
        title="Templates"
        hint="Ready-made template graphics: animated lower-thirds, intro sequences, end screens, transitions. Click one to place it at the playhead — the editor builds the layers from the template's saved composition."
      >
        <TileGrid cols={2}>
          {filtered.map((t) => {
            return (
              <Tile
                key={t.id}
                label={t.label}
                hint={`${formatDuration(t.duration)} · ${t.layerCount} layers`}
                swatch={t.previewSwatch}
                onClick={() => onApplyTemplate(t.id, playheadFrame)}
                ariaLabel={`Place the ${t.label} template at the playhead`}
              />
            );
          })}
        </TileGrid>

        {!clip && (
          <NoSelection what="a template" />
        )}
      </PanelSection>

      {clip && (
        <PanelSection title="Stamp onto clip" hint="Replace the selected clip's content with a template composition while keeping its position and length.">
          <TileGrid cols={2}>
            {filtered.map((t) => (
              <Tile
                key={`stamp-${t.id}`}
                label={t.label}
                hint="Stamp this template onto the selected clip"
                swatch={t.previewSwatch}
                onClick={() => onStampTemplate(t.id, clip.id)}
                ariaLabel={`Stamp ${t.label} onto ${clip.mediaName}`}
              />
            ))}
          </TileGrid>
        </PanelSection>
      )}

      <PanelSection title="How templates work" hint="Each template is a self-contained composition: it carries its own layers, timing and keyframes. Placing it drops a composite clip on the timeline that you can edit like any other — change a text field, move a corner, adjust a fade, and the change applies to that instance only.">
        <div className="space-y-1 text-[8px] text-fg-secondary">
          <p>Templates are compositions, not media imports — nothing is downloaded. Each one reads its layer data from the stock template resources and resolves every clip against the project's own media store.</p>
          <p>Drop one at the playhead, or stamp it onto a selected clip to replace that clip's content with the template's composition while keeping the original position, length, and speed.</p>
        </div>
      </PanelSection>
    </div>
  );
}


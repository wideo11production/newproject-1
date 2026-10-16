'use client';

// ============================================================================
// Left mode rail
// ============================================================================
//
// ---- WHY THIS IS SEPARATE FROM THE PANEL COLUMN ----
//
// In Movavi there are TWO distinct left-hand columns and merging them (which
// is what the first version did) breaks the model:
//
//   rail  - a fixed strip of ICONS, one per creative mode (Import, Filters,
//           Transitions, Titles, Stickers, Pan & Zoom, ...). It is narrow and
//           never scrolls; it is navigation between modes.
//   bin   - the panel for the active mode. Wide, scrolls, holds the content.
//
// When they were merged, every mode label became a row in a scrolling list
// beside the media, so switching from "Transitions" to "Titles" put the
// transition list above the titles list, and the media bin was replaced by
// whichever panel you were last looking at. Separating them means the column
// is always in the same place and the rail is always the same icons.
//
// ---- WHY DISABLED MODES STAY VISIBLE ----
//
// A grey square with a dot says "there is more here". Hiding the mode instead
// would leave a user with no way to know the editor has filters at all, and a
// rail that silently reorders itself as features land is disorienting.
//
// Each disabled mode says WHY in its tooltip. "Not built yet" on its own is
// not an answer, and neither is a plausible-sounding description of a
// feature that does not exist.

import {
  Upload,
  Palette,
  Shuffle,
  Type,
  Smile,
  Move,
  LayoutGrid,
  Music,
  FolderOpen,
  HelpCircle,
  MessageSquare,
  Shield,
  Droplets,
  Gauge,
  AudioWaveform,
  Grid3x3,
  Magnet,
  Badge,
  User,
  FunctionSquare,
  LayoutTemplate,
  Film,
  SquareStack,
  Layers,
  Wand2,
  Sparkles,
  Settings,
  Puzzle,
} from 'lucide-react';

export type EditorMode =
  | 'media'
  | 'filters'
  | 'transitions'
  | 'titles'
  | 'stickers'
  | 'panzoom'
  | 'layouts'
  | 'audio'
  | 'expressions'
  | 'templates'
  | 'project'
  | 'help'
  | 'callouts'
  | 'stabilize'
  | 'chroma'
  | 'branding'
  | 'samples'
  | 'backgrounds'
  | 'intros'
  | 'effects'
  | 'tools'
  | 'plugins';

interface ModeDef {
  id: EditorMode;
  label: string;
  Icon: typeof Upload;
  hint: string;
  status: 'ready' | 'soon';
  /** Why it is not built, shown in the tooltip of a disabled mode. */
  why?: string;
}

const MODES: ModeDef[] = [
  { id: 'media', label: 'Import', Icon: Upload, status: 'ready', hint: 'Bring video, audio, images and text into the project. Click a tile to drop it at the playhead, or drag it onto a lane.' },
  { id: 'filters', label: 'Filters', Icon: Palette, status: 'ready', hint: 'Colour grades read out of the stock sample resources. Click one to apply it to the selected clip.' },
  { id: 'transitions', label: 'Transitions', Icon: Shuffle, status: 'ready', hint: 'What happens between two clips. Pick one and it goes on the join at the end of the selected clip.' },
  { id: 'titles', label: 'Titles', Icon: Type, status: 'ready', hint: 'Text overlays. Drop a title on the text track, then edit the words, size and colour here.' },
  { id: 'stickers', label: 'Stickers', Icon: Smile, status: 'ready', hint: 'Decorative overlays drawn on an overlay track. Position and size them from this panel.' },
  { id: 'panzoom', label: 'Pan & Zoom', Icon: Move, status: 'ready', hint: 'A slow push in or pull out across a clip. The presets are the two-keyframe envelopes from the sample resources.' },
  { id: 'layouts', label: 'Overlays', Icon: LayoutGrid, status: 'ready', hint: 'Picture-in-picture and split-screen. These need a second video track — add one with + on the Tracks header.' },
  { id: 'audio', label: 'Audio', Icon: Music, status: 'ready', hint: 'Web Audio effects, level matching and local silence removal. Nothing here uploads your audio.' },
  { id: 'expressions', label: 'Expressions', Icon: FunctionSquare, status: 'ready', hint: 'Keyframes linked by a formula: position follows rotation, opacity follows a sine wave, anything that can be measured can be animated with one. No scripting language — just the operators an editor reaches for.' },
  { id: 'templates', label: 'Templates', Icon: LayoutTemplate, status: 'ready', hint: 'Ready-made template graphics: animated lower-thirds, intro sequences, end screens. Each one is a saved composition the editor stamps onto your timeline — change the text, it changes everywhere.' },
  { id: 'branding', label: 'Branding', Icon: Badge, status: 'ready', hint: 'Select a channel to auto-apply its logo, colour and position to the branding track.' },
  { id: 'samples', label: 'Sample Videos', Icon: Film, status: 'ready', hint: 'Stock sample videos and royalty-free clips you can drag directly to the timeline.' },
  { id: 'backgrounds', label: 'Backgrounds', Icon: SquareStack, status: 'ready', hint: 'Solid colour and gradient backgrounds for your project canvas.' },
  { id: 'intros', label: 'Intro Videos', Icon: Layers, status: 'ready', hint: 'Animated intro sequences you can place at the start of your timeline.' },
  { id: 'effects', label: 'Effects', Icon: Wand2, status: 'ready', hint: 'Visual effects: blur, glow, glitch, particle — applied to the selected clip.' },
  { id: 'tools', label: 'Tools', Icon: Settings, status: 'ready', hint: 'Editor configuration: proxy mode, caching, performance tuning.' },
  { id: 'plugins', label: 'Plugins', Icon: Puzzle, status: 'ready', hint: 'Manage and configure editor plugins: effects, filters, transitions, and tools.' },
  { id: 'project', label: 'Project', Icon: FolderOpen, status: 'ready', hint: 'New, open, save, autosave, recent projects, and the resolution and frame rate everything else follows.' },
  { id: 'help', label: 'Help', Icon: HelpCircle, status: 'ready', hint: 'Every keyboard shortcut and mouse gesture, generated from the same table the editor uses.' },
  {
    id: 'callouts',
    label: 'Callouts',
    Icon: MessageSquare,
    status: 'soon',
    hint: 'Speech bubbles that point at something on screen.',
    why: 'Not built. A callout needs a leader line anchored to a point that tracks as the picture moves, and nothing here anchors a point to a frame yet.',
  },
  {
    id: 'stabilize',
    label: 'Stabilization',
    Icon: Shield,
    status: 'ready',
    hint: 'Smooth out hand-held shake using local motion estimation and camera path analysis. Reduces jitter and stabilizes footage in real-time with AI-powered temporal filtering.',
  },
  {
    id: 'chroma',
    label: 'Chroma Key',
    Icon: Droplets,
    status: 'ready',
    hint: 'Remove a flat colour and make it transparent using local per-pixel color keying and alpha matting.',
  },
];

export function ModeRail({
  active,
  onChange,
  waveformVisible,
  onToggleWaveforms,
  gridVisible,
  onToggleGrid,
  snapEnabled,
}: {
  active: EditorMode;
  onChange: (m: EditorMode) => void;
  waveformVisible: boolean;
  onToggleWaveforms: () => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
}) {
  return (
    <nav
      aria-label="Editor modes"
      className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto bg-[#1a1a1a] py-2"
    >
      {MODES.map(({ id, label, Icon, hint, status, why }) => {
        const on = active === id;
        const ready = status === 'ready';
        return (
          <button
            key={id}
            type="button"
            onClick={() => ready && onChange(id)}
            // Disabled rather than no-op: a control that cannot act should say
            // so instead of appearing broken.
            disabled={!ready}
            aria-pressed={on}
            aria-label={ready ? label : `${label} (not built)`}
            // Three lines: what it is, what it does, and — for a mode that
            // does not work — exactly what is missing.
            title={`${label}\n${hint}${ready ? '' : `\n\nNot built. ${why ?? ''}`}`}
          className={[
            // TIGHT icon selector, not a selected tab.
            //
            // 32px square with a 3px left bar instead of a 36px filled block.
            // The previous treatment made the ACTIVE icon the biggest thing in
            // the rail, which inverts the hierarchy: the rail is a switchboard,
            // not a list of destinations, and a destination should not shout
            // louder than the picture.
            'group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
            !ready
              ? 'cursor-not-allowed text-fg-muted/50'
              : on
                ? 'text-[#ff6500]'
                : 'text-fg-muted hover:text-[#ff6500]',
          ].join(' ')}
        >
          {/*
            The active marker is a 3px BAR, not a fill.
            Same reason: a filled block is a bigger target for the eye than the
            thing it points at.
          */}
          {on && ready && (
            <span className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[#ff6500]" aria-hidden="true" />
          )}
          <Icon className="h-2.5 w-2.5" aria-hidden="true" />
            {!ready && (
              // A dot, not a "coming soon" label. Enough to signal "not yet"
              // without turning the rail into a list of apologies.
              <span
                className="absolute bottom-1 right-1 h-1 w-1 rounded-full bg-fg-muted"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}

      {/* ---- Workspace toggles.
          These three live at the BOTTOM of the rail, away from the modes, and
          that is deliberate: they are settings that apply to everything rather
          than to whatever is open, and mixing them into the list of creative
          modes is how a user ends up hunting for "where is the grid toggle".
          Every one is pressed-state visible and persists. ---- */}
      <div className="mt-auto flex flex-col gap-0.5 pt-2">
        <button
          type="button"
          onClick={onToggleWaveforms}
          aria-pressed={waveformVisible}
          aria-label="Toggle waveforms"
          title={`${waveformVisible ? 'Hide' : 'Show'} audio waveforms on clips.\nThe peaks are decoded from your own file; a file the browser cannot decode draws a flat line rather than a fake one.`}
           className={[
            'flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150',
            waveformVisible ? 'text-[#ff6500]' : 'hover:text-fg',
          ].join(' ')}
        >
          <AudioWaveform className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleGrid}
          aria-pressed={gridVisible}
          aria-label="Toggle the frame grid"
          title={`${gridVisible ? 'Hide' : 'Show'} the frame grid behind the lanes.\nDrawn from the real frame count, so it moves when you zoom.`}
           className={[
            'flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150',
            gridVisible ? 'text-[#ff6500]' : 'hover:text-fg',
          ].join(' ')}
        >
          <Grid3x3 className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!snapEnabled}
          onClick={() => onChange(active)}
          aria-pressed={snapEnabled}
          aria-label="Snapping"
          title={`Snapping is ${snapEnabled ? 'on' : 'off'} — toggle it with N.\nClips land on the playhead, clip edges, markers and the ends of the timeline.`}
           className={[
            'flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150',
            snapEnabled ? 'text-[#ff6500]' : 'cursor-not-allowed text-fg-muted',
          ].join(' ')}
        >
          <Magnet className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
<button
          type="button"
          onClick={() => onChange(active)}
          aria-pressed={active === 'project'}
          aria-label="Project settings"
          title="Project\nNew, open, save, autosave, and the resolution everything else follows."
           className={[
            'flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150',
            active === 'project' ? 'text-[#ff6500]' : 'hover:text-fg',
          ].join(' ')}
        >
          <Gauge className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

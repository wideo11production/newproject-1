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
  Sun,
  Moon,
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
  | 'project'
  | 'help'
  | 'callouts'
  | 'stabilize'
  | 'chroma';

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
    status: 'soon',
    hint: 'Smooth out hand-held shake.',
    why: 'Not built. It needs motion estimation between frames to find the camera path, which is a real analysis job rather than a filter — and doing it badly looks worse than not doing it.',
  },
  {
    id: 'chroma',
    label: 'Chroma Key',
    Icon: Droplets,
    status: 'soon',
    hint: 'Remove a flat colour and make it transparent.',
    why: 'Not built. A real key is a per-pixel shader; the canvas filter API has no chroma operator, and a per-pixel JavaScript pass at preview resolution is too slow to be usable.',
  },
];

export function ModeRail({
  active,
  onChange,
  theme,
  onToggleTheme,
  waveformVisible,
  onToggleWaveforms,
  gridVisible,
  onToggleGrid,
  snapEnabled,
}: {
  active: EditorMode;
  onChange: (m: EditorMode) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  waveformVisible: boolean;
  onToggleWaveforms: () => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
}) {
  return (
    <nav
      aria-label="Editor modes"
      className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-edge bg-surface py-2"
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
              'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
              !ready
                ? 'cursor-not-allowed text-fg-muted'
                : on
                  ? 'bg-sky-600 text-white'
                  : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
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
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            waveformVisible ? 'text-sky-400' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
          ].join(' ')}
        >
          <AudioWaveform className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleGrid}
          aria-pressed={gridVisible}
          aria-label="Toggle the frame grid"
          title={`${gridVisible ? 'Hide' : 'Show'} the frame grid behind the lanes.\nDrawn from the real frame count, so it moves when you zoom.`}
          className={[
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            gridVisible ? 'text-sky-400' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
          ].join(' ')}
        >
          <Grid3x3 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!snapEnabled}
          onClick={() => onChange(active)}
          aria-pressed={snapEnabled}
          aria-label="Snapping"
          title={`Snapping is ${snapEnabled ? 'on' : 'off'} — toggle it with N.\nClips land on the playhead, clip edges, markers and the ends of the timeline.`}
          className={[
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            snapEnabled ? 'text-sky-400' : 'text-fg-muted',
          ].join(' ')}
        >
          <Magnet className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={`${theme === 'dark' ? 'Light' : 'Dark'} theme\nPersisted, so it survives a refresh like everything else here.`}
          className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onChange('project')}
          aria-pressed={active === 'project'}
          aria-label="Project settings"
          title="Project\nNew, open, save, autosave, and the resolution everything else follows."
          className={[
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            active === 'project' ? 'bg-sky-600 text-white' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
          ].join(' ')}
        >
          <Gauge className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

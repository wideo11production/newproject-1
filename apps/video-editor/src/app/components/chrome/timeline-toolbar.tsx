'use client';

import {
  Scissors,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Magnet,
  ZoomIn,
  ZoomOut,
  MonitorUp,
  Maximize2,
  Minimize2,
  Link2,
  Flag,
  MoveHorizontal,
  Move,
  Gauge,
  Timer,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  Video,
} from 'lucide-react';
import { ToolbarGroup } from './menu-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wideo11/ui/select';
import {
  SUPPORTED_FPS,
  AURA_ONLY_FPS,
  MICRO_PLAYBACK_SPEEDS,
  PLAYBACK_SPEEDS,
  formatSpeed,
  clampPxPerFrame,
  hasHighFrameRates,
} from '../../lib/engine/frames';

interface TimelineToolbarProps {
  canSplit: boolean;
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  linkedSelection: boolean;
  ripple: boolean;
  pxPerFrame: number;
  fps: number;
  onSplit: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onToggleSnapping: () => void;
  snapping: boolean;
  onToggleRipple: () => void;
  onZoom: (delta: number) => void;
  onZoomTo: (pxPerFrame: number) => void;
  onFit: () => void;
  onFullscreen: () => void;
  onToggleLoop: () => void;
  loopOn: boolean;
  onFpsChange: (fps: number) => void;
  playbackRate: number;
  onPlaybackRate: (rate: number) => void;
  onEdgeEdit: (kind: 'ripple' | 'slide' | 'slip', delta: number) => void;
  /**
   * The plan's frame-rate ceiling, in fps.
   *
   * 60 on every plan except the AURA lifetime plan, which is 240. Both
   * dropdowns below are filtered from this one number, so the second toolbar on
   * screen cannot offer a rate the first one refuses.
   */
  maxFps: number;
  /** Recorder kholta hai (RecorderDialog). Hinglish: timeline toolbar me
   *  recording icon — same 10px glyph + muted->#ff6500 hover pattern. */
  onRecord?: () => void;
}

export function TimelineToolbar({
  canSplit,
  canDelete,
  canUndo,
  canRedo,
  selectedCount,
  linkedSelection,
  ripple,
  pxPerFrame,
  fps,
  onSplit,
  onDelete,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onToggleSnapping,
  snapping,
  onToggleRipple,
  onZoom,
  onZoomTo,
  onFit,
  onFullscreen,
  onToggleLoop,
  loopOn,
  onFpsChange,
  playbackRate,
  onPlaybackRate,
  onEdgeEdit,
  maxFps,
  onRecord,
}: TimelineToolbarProps) {
  const zoomPct = Math.round((pxPerFrame / 3) * 100);

  // ---- THE PLAN'S CEILING, APPLIED TO THE TWO DROPDOWNS ----
  //
  // Both lists are the FULL set, and the AURA-only entries are DISABLED rather
  // than removed. A list that hides the 240fps option is a list that never tells
  // you it exists; a list that shows it greyed out with "(AURA)" on it tells you
  // both what you are missing and what it is called. Same derivation as the
  // editor toolbar, from the same constants, so the two cannot disagree about
  // what a plan may use.
  const fpsOptions = SUPPORTED_FPS;
  const speedOptions = PLAYBACK_SPEEDS;
  const auraRates = hasHighFrameRates(maxFps);

  const groups: Array<Array<{
    id: string;
    label: string;
    hint: string;
    shortcut?: string;
    Icon: typeof Scissors;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
  }>> = [
    [
      {
        id: 'record',
        label: 'Record screen or camera',
        hint: 'Open the recorder — takes land in the media bin',
        Icon: Video,
        onClick: () => onRecord?.(),
      },
      {
        id: 'split',
        label: 'Split at playhead',
        hint: 'Cut the clip under the playhead in two',
        shortcut: 'S',
        Icon: Scissors,
        onClick: onSplit,
        disabled: !canSplit,
      },
      {
        id: 'delete',
        label: ripple
          ? `Ripple delete ${selectedCount} clip${selectedCount === 1 ? '' : 's'}`
          : `Delete ${selectedCount} selected clip${selectedCount === 1 ? '' : 's'}`,
        hint: 'Remove selection and close the gap (ripple) or leave a gap',
        shortcut: 'Del',
        Icon: Trash2,
        onClick: onDelete,
        disabled: !canDelete,
      },
    ],
    [
      {
        id: 'undo',
        label: 'Undo',
        hint: 'Step back one history state',
        shortcut: 'Ctrl+Z',
        Icon: Undo2,
        onClick: onUndo,
        disabled: !canUndo,
      },
      {
        id: 'redo',
        label: 'Redo',
        hint: 'Step forward one history state',
        shortcut: 'Ctrl+Shift+Z',
        Icon: Redo2,
        onClick: onRedo,
        disabled: !canRedo,
      },
      {
        id: 'copy',
        label: 'Copy',
        hint: 'Copy selected clips to clipboard',
        shortcut: 'Ctrl+C',
        Icon: Copy,
        onClick: onCopy,
        disabled: !canDelete,
      },
      {
        id: 'paste',
        label: 'Paste',
        hint: 'Paste clips from clipboard at the playhead',
        shortcut: 'Ctrl+V',
        Icon: ClipboardPaste,
        onClick: onPaste,
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        hint: 'Duplicate selected clips in place',
        shortcut: 'Ctrl+D',
        Icon: CopyPlus,
        onClick: onDuplicate,
        disabled: !canDelete,
      },
    ],
    [
      {
        id: 'snapping',
        label: 'Snapping',
        hint: 'Snap clips to each other and to the playhead',
        shortcut: 'N',
        Icon: Magnet,
        onClick: onToggleSnapping,
        active: snapping,
      },
      {
        id: 'ripple',
        label: ripple ? 'Ripple mode on' : 'Ripple mode off',
        hint: ripple ? 'Deleting closes gaps automatically' : 'Deleting leaves gaps',
        shortcut: 'L',
        Icon: MoveHorizontal,
        onClick: onToggleRipple,
        active: ripple,
      },
      {
        id: 'link',
        label: linkedSelection ? 'Linked selection' : 'Unlinked selection',
        hint: 'Toggle audio/video link for the selected clip',
        shortcut: 'L',
        Icon: Link2,
        onClick: () => {},
        disabled: selectedCount !== 1,
        active: linkedSelection,
      },
    ],
    [
      {
        id: 'zoom-out',
        label: 'Zoom out',
        hint: 'See more of the timeline',
        shortcut: '-',
        Icon: ZoomOut,
        onClick: () => onZoom(-0.25),
      },
      {
        id: 'zoom-in',
        label: 'Zoom in',
        hint: 'See clips frame by frame',
        shortcut: '+',
        Icon: ZoomIn,
        onClick: () => onZoom(0.25),
      },
      {
        id: 'fit',
        label: 'Fit the timeline',
        hint: 'Back to 100% — one second is 90 pixels',
        shortcut: '0',
        Icon: MonitorUp,
        onClick: onFit,
      },
      {
        id: 'full',
        label: 'Full screen',
        hint: 'Expand the player to the whole screen',
        shortcut: 'F11',
        Icon: Maximize2,
        onClick: onFullscreen,
      },
    ],
    [
      {
        id: 'loop',
        label: loopOn ? 'Loop region on' : 'Loop region off',
        hint: 'Toggle loop playback between in/out points',
        shortcut: 'Shift+L',
        Icon: Move,
        onClick: onToggleLoop,
        active: loopOn,
      },
    ],
    [
      {
        id: 'rippletrim',
        label: 'Ripple trim',
        hint: "Move the selected clip's out-edge one frame later and slide EVERYTHING after it left by the same amount, so no gap is left behind",
        shortcut: 'Shift+Alt+→',
        Icon: MoveHorizontal,
        onClick: () => onEdgeEdit('ripple', 1),
        disabled: selectedCount !== 1,
      },
      {
        id: 'rippletrim-back',
        label: 'Ripple trim back',
        hint: 'The same, one frame earlier',
        shortcut: 'Shift+Alt+←',
        Icon: MoveHorizontal,
        onClick: () => onEdgeEdit('ripple', -1),
        disabled: selectedCount !== 1,
      },
      {
        id: 'slide',
        label: 'Slide',
        hint: "Move the selected clip between its neighbours, which grow and shrink to fill. Nothing outside the clip's neighbours moves",
        shortcut: 'Alt+→',
        Icon: MoveHorizontal,
        onClick: () => onEdgeEdit('slide', 1),
        disabled: selectedCount !== 1,
      },
      {
        id: 'slip',
        label: 'Slip',
        hint: 'Slide the SOURCE inside the clip without moving it: same position, same length, same neighbours, different frames of the file',
        shortcut: 'Alt+Shift+→',
        Icon: Move,
        onClick: () => onEdgeEdit('slip', 1),
        disabled: selectedCount !== 1,
      },
    ],
  ];

  return (
    <div
      role="toolbar"
      aria-label="Timeline editing tools"
      className="flex h-8 shrink-0 items-center gap-0.5 bg-[#1a1a1a] px-1.5 border-b border-[#2a2a2a]"
    >
      {groups.map((group, gi) => (
        <ToolbarGroup key={gi} title={group[0].label + ' tools'}>
          {group.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={b.onClick}
              disabled={b.disabled}
              aria-label={b.label}
              title={`${b.label}\n${b.hint}${b.shortcut ? `\nShortcut: ${b.shortcut}` : ''}`}
              className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors duration-150',
                b.disabled
                  ? 'cursor-not-allowed text-fg-muted'
                  : b.active
                  ? 'text-[#ff6500] bg-[#ff6500]/10'
                  : 'text-fg-secondary hover:text-[#ff6500] hover:bg-[#ff6500]/5',
              ].join(' ')}
            >
              <b.Icon className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          ))}
        </ToolbarGroup>
      ))}
      <ToolbarGroup title="Timeline zoom">
        <input
          type="range"
          min={1}
          max={6400}
          step={1}
          value={Math.round(pxPerFrame * 100)}
          onChange={(e) => onZoomTo(clampPxPerFrame(Number(e.target.value) / 100))}
          aria-label="Timeline zoom"
          title={`Timeline zoom: ${zoomPct}% — ${pxPerFrame.toFixed(2)} pixels per frame\nDrag to zoom, or Alt+scroll on the ruler. Above 24px a single frame is plainly visible.`}
          className="ve-fader mx-1 h-1 w-14 cursor-pointer"
        />
        <span className="w-7 shrink-0 font-mono text-[7px] tabular-nums text-fg-muted" aria-label="Zoom percentage">
          {zoomPct}%
        </span>
      </ToolbarGroup>
      <ToolbarGroup title="Playback speed">
        {/*
          Radix Select replaced the native <select>. WHY: native dropdown
          popups on Windows/Chrome are drawn by the OS, so CSS
          `::-webkit-scrollbar` never applies to them - the list's scrollbar
          and highlight stayed default BLUE no matter what globals.css said.
          Radix renders its own DOM, so the orange-red theme reaches the list.
        */}
        <Select value={String(playbackRate)} onValueChange={(v) => onPlaybackRate(Number(v))}>
          <SelectTrigger
            aria-label="Playback speed"
            title={
              auraRates
                ? 'Playback speed — AURA plan, micro-steps included'
                : 'Playback speed — the micro-steps below 0.25x need the AURA plan'
            }
            className="h-6 w-16 rounded-md border-0 bg-surface px-1 text-[7px] text-fg outline-none transition-colors duration-150 hover:text-[#ff6500] focus:text-[#ff6500] focus:ring-1 focus:ring-[#ff6500]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-md border-0 bg-[#1a1a1a] text-[7px] text-fg shadow-none">
            {speedOptions.map((r) => {
              const isMicroSpeed = MICRO_PLAYBACK_SPEEDS.includes(r as (typeof MICRO_PLAYBACK_SPEEDS)[number]);
              const blocked = isMicroSpeed && !auraRates;
              return (
                <SelectItem
                  key={r}
                  value={String(r)}
                  disabled={blocked}
                  className={`rounded-md text-[7px] outline-none transition-colors duration-150 ${
                    blocked
                      ? 'text-fg-muted/40 cursor-not-allowed'
                      : 'text-fg-muted focus:bg-[#ff6500]/10 focus:text-[#ff6500] data-[state=checked]:bg-[#ff6500] data-[state=checked]:text-white'
                  }`}
                >
                  {formatSpeed(r)}{blocked ? ' (AURA)' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </ToolbarGroup>
      <ToolbarGroup title="Frame rate">
        <Select value={String(fps)} onValueChange={(v) => onFpsChange(Number(v))}>
          <SelectTrigger
            aria-label="Timeline frame rate"
            title={
              auraRates
                ? 'Timeline frame rate — AURA plan, 120 and 240 included'
                : 'Timeline frame rate — 120 and 240 need the AURA plan'
            }
            className="h-6 w-16 rounded-md border-0 bg-surface px-1 text-[7px] text-fg outline-none transition-colors duration-150 hover:text-[#ff6500] focus:text-[#ff6500] focus:ring-1 focus:ring-[#ff6500]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-md border-0 bg-[#1a1a1a] text-[7px] text-fg shadow-none">
            {fpsOptions.map((f) => {
              const blocked = AURA_ONLY_FPS.includes(f as (typeof AURA_ONLY_FPS)[number]) && !auraRates;
              return (
                <SelectItem
                  key={f}
                  value={String(f)}
                  disabled={blocked}
                  className={`rounded-md text-[7px] outline-none transition-colors duration-150 ${
                    blocked
                      ? 'text-fg-muted/40 cursor-not-allowed'
                      : 'text-fg-muted focus:bg-[#ff6500]/10 focus:text-[#ff6500] data-[state=checked]:bg-[#ff6500] data-[state=checked]:text-white'
                  }`}
                >
                  {f} fps{blocked ? ' (AURA)' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </ToolbarGroup>
    </div>
  );
}
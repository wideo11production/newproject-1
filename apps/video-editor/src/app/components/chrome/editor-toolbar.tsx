'use client';
import { useState } from 'react';

// ============================================================================
// BORDERLESS CHROME DESIGN — Hinglish architecture note
// ============================================================================
//
// Toolbar ek `#1a1a1a` Rich Charcoal band hai — sidebar role, isliye tone
// contrast hai ki jagah. Group separators (`border-r-edge`)
// hata diye gaye; groups ab apne `bg-[#1a1a1a]` background se alag hote
// hain jo ek contrast grid bana deta hai bina kisi line ke.
//
// Select controls (fps, playback rate): base `border-edge` hata diya
// gaya — default state me koi nahi, sirf `bg-surface-raised` fill.
// Hover / focus par `border-[#ff6500]` orange-red accent appear hota hai,
// jo user ne explicitly KEEP kiya hai. Ye design principle hai: default me
// quiet, interaction par accent.
//
// Saare interactive elements `rounded-md`, 150ms transition. Accent
// rings / borders (`border-[#ff6500]`, `ring-[#ff6500]`) KEEP hain.
// ============================================================================
// Editor toolbar
// ============================================================================
//
// Sits directly under the menu bar, in the style of every desktop NLE:
// grouped icon clusters separated by hairlines, each button an icon with a
// hover tooltip, and the group itself titled on hover.
//
// ---- WHY ICON-ONLY, AND WHY THE TOOLTIP CARRIES THE WEIGHT ----
//
// Text labels on twenty controls need more than a whole row and turn the
// toolbar into a wall of words. The cost is discoverability, and the tooltip
// is what pays it back - so each tooltip answers three questions, not one:
//
//   1. What is it called?        "Blade (split)"
//   2. What does it do?          "Cut the clip under the playhead in two"
//   3. How do I use it?          "S"
//
// ---- DISABLED STATE IS REAL ----
//
// Buttons that cannot act right now are disabled rather than silently doing
// nothing. A click that does nothing with no feedback is the worst possible
// answer.

import {
  Scissors,
  Copy,
  ClipboardPaste,
  CopyPlus,
  CheckSquare,
  Trash2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Magnet,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Circle,
  AudioWaveform,
  Camera,
  Upload,
  FilePlus2,
  Save,
  Film,
  Repeat,
  Link2,
  Flag,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Timer,
  HelpCircle,
  MoveHorizontal,
  Move,
  MonitorUp,
  ScanLine,
  FolderOpen,
} from 'lucide-react';
import { MenuBar, ToolbarGroup, type Menu } from './menu-bar';
import { AuthNav } from './auth-nav';
import { HelpTip, useToolbarHelp } from './help-tip';
import { SUPPORTED_FPS, clampPxPerFrame } from '../../lib/engine/frames';

/** The speeds offered. Real time first, because that is the only one most
 *  projects are cut at, and a list that starts at 0.5 implies otherwise. */
const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4];

interface ToolButton {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  Icon: typeof Scissors;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

interface EditorToolbarProps {
  canSplit: boolean;
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSelectAll: boolean;
  canProcessAudio: boolean;
  selectedCount: number;
  isPlaying: boolean;
  recording: boolean;
  linkedSelection: boolean;
  ripple: boolean;
  dirty: boolean;
  projectName: string;
  savedAt: number | null;
  loopOn: boolean;
  onTogglePlay: () => void;
  onStep: (frames: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onToggleSnapping: () => void;
  snapping: boolean;
  onToggleRipple: () => void;
  onZoom: (delta: number) => void;
  onZoomTo: (pxPerFrame: number) => void;
  pxPerFrame: number;
  onFit: () => void;
  onFullscreen: () => void;
  onOpenBin: () => void;
  onRecord: () => void;
  onNewProject: () => void;
  onSave: () => void;
  onExport: () => void;
  onSnapshot: () => void;
  onToggleLoop: () => void;
  onOpenProject: () => void;
  onAddMarker: () => void;
  markerCount: number;
  onClearMarkers: () => void;
  onMarkerStep: (dir: -1 | 1) => void;
  onEdgeEdit: (kind: 'ripple' | 'slide' | 'slip', delta: number) => void;
  onFpsChange: (fps: number) => void;
  fps: number;
  playbackRate: number;
  onPlaybackRate: (rate: number) => void;
  /** Whether to render the icon toolbar below the menu bar. Default true. */
  showToolbar?: boolean;
}

export function EditorToolbar({
  canSplit,
  canDelete,
  canUndo,
  canRedo,
  canSelectAll,
  canProcessAudio,
  selectedCount,
  isPlaying,
  recording,
  linkedSelection,
  ripple,
  dirty,
  projectName,
  savedAt,
  loopOn,
  onTogglePlay,
  onStep,
  onSplit,
  onDelete,
  onUndo,
  onRedo,
  onSelectAll,
  onCopy,
  onPaste,
  onDuplicate,
  onToggleSnapping,
  snapping,
  onToggleRipple,
  onZoom,
  onZoomTo,
  pxPerFrame,
  onFit,
  onFullscreen,
  onOpenBin,
  onRecord,
  onNewProject,
  onSave,
  onExport,
  onSnapshot,
  onToggleLoop,
  onOpenProject,
  onAddMarker,
  markerCount,
  onClearMarkers,
  onMarkerStep,
  onEdgeEdit,
  onFpsChange,
  fps,
  playbackRate,
  onPlaybackRate,
  showToolbar = true,
}: EditorToolbarProps) {
  // Help modal state. Local to the toolbar because the toolbar OWNS the
  // trigger - lifting it would put a boolean in the editor shell for one
  // dialog.

  const menus: Menu[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'New project', shortcut: 'Ctrl+N', onSelect: onNewProject },
        { label: 'Open project…', shortcut: 'Ctrl+Shift+P', onSelect: onOpenProject },
        { label: 'Import media…', shortcut: 'Ctrl+O', onSelect: onOpenBin },
        { label: 'Record camera or microphone…', shortcut: 'R', onSelect: onRecord },
        { label: 'Save project', shortcut: 'Ctrl+S', onSelect: onSave, separatorBefore: true },
        { label: 'Export video…', shortcut: 'Ctrl+M', onSelect: onExport },
        { label: 'Take a snapshot of this frame', shortcut: 'Ctrl+Shift+S', onSelect: onSnapshot },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: onUndo, disabled: !canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onSelect: onRedo, disabled: !canRedo },
        { label: 'Copy', shortcut: 'Ctrl+C', onSelect: onCopy, disabled: !canDelete },
        { label: 'Paste', shortcut: 'Ctrl+V', onSelect: onPaste },
        { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: onDuplicate, disabled: !canDelete },
        {
          label: ripple
            ? `Ripple delete ${selectedCount} clip${selectedCount === 1 ? '' : 's'}`
            : `Delete ${selectedCount} selected clip${selectedCount === 1 ? '' : 's'}`,
          shortcut: 'Del',
          onSelect: onDelete,
          disabled: !canDelete,
          separatorBefore: true,
        },
        { label: 'Clear the selection', shortcut: 'Esc', onSelect: onSelectAll === undefined ? undefined : () => undefined },
      ],
    },
    {
      id: 'clip',
      label: 'Clip',
      items: [
        { label: 'Select all clips', shortcut: 'Ctrl+A', onSelect: onSelectAll, disabled: !canSelectAll },
        { label: 'Split at playhead', shortcut: 'S', onSelect: onSplit, disabled: !canSplit, separatorBefore: true },
        { label: 'Trim clip edges', shortcut: 'drag a clip edge' },
        { label: 'Fade in / fade out', shortcut: 'drag the amber corners' },
        { label: 'Link or unlink', shortcut: 'L', disabled: selectedCount !== 1 },
        { label: 'Clip properties', shortcut: 'Enter', disabled: selectedCount !== 1 },
        { label: 'Remove silence from a recording', shortcut: 'M', onSelect: onOpenBin, disabled: !canProcessAudio },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { label: 'Zoom in', shortcut: '+', onSelect: () => onZoom(0.25) },
        { label: 'Zoom out', shortcut: '-', onSelect: () => onZoom(-0.25) },
        { label: 'Fit the timeline', shortcut: '0', onSelect: onFit },
        { label: 'Full screen', shortcut: 'F11', onSelect: onFullscreen, separatorBefore: true },
      ],
    },
    {
      id: 'playback',
      label: 'Playback',
      items: [
        { label: isPlaying ? 'Pause' : 'Play', shortcut: 'Space', onSelect: onTogglePlay },
        { label: 'Previous frame', shortcut: '←', onSelect: () => onStep(-1) },
        { label: 'Next frame', shortcut: '→', onSelect: () => onStep(1) },
        { label: loopOn ? 'Stop looping' : 'Loop the marked region', shortcut: 'L', onSelect: onToggleLoop, separatorBefore: true },
        { label: 'Go to the start', shortcut: 'Home' },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'User Menu & FAQs', shortcut: 'F1', onSelect: () => window.open('/help', '_blank') },
        { label: 'Keyword Shortcuts Matrix', shortcut: '?', onSelect: () => {} },
        { label: 'AURA Micro-Frame Studio Walkthrough', shortcut: 'Ctrl+H', onSelect: () => { window.location.href = 'help-micro-frame'; } },
        { label: 'Logo & Sponsor Placement Guidelines', shortcut: 'Ctrl+L', onSelect: () => {}, separatorBefore: true },
      ],
    },
  ];

  const groups: ToolButton[][] = [
    [
      {
        id: 'new', label: 'New project', hint: 'Clear the timeline and start a fresh project',
        shortcut: 'Ctrl+N', Icon: FilePlus2, onClick: onNewProject,
      },
      {
        id: 'save', label: 'Save project', hint: dirty
          ? 'There are unsaved changes — write the arrangement and the media to this browser'
          : savedAt
            ? `Last saved at ${new Date(savedAt).toLocaleTimeString()}`
            : 'Write the arrangement and the media to this browser',
        shortcut: 'Ctrl+S', Icon: Save, onClick: onSave, active: dirty,
      },
      {
        id: 'export', label: 'Export video', hint: 'Render the timeline to a file with the browser’s own encoder',
        shortcut: 'Ctrl+M', Icon: Film, onClick: onExport,
      },
      {
        id: 'snapshot', label: 'Take a snapshot', hint: 'Save the current frame as a PNG at the project’s own resolution',
        shortcut: 'Ctrl+Shift+S', Icon: Camera, onClick: onSnapshot,
      },
    ],
    [
      {
        id: 'rippletrim', label: 'Ripple trim', hint: 'Move the selected clip\'s out-edge one frame later and slide EVERYTHING after it left by the same amount, so no gap is left behind',
        shortcut: 'Shift+Alt+→', Icon: MoveHorizontal, onClick: () => onEdgeEdit('ripple', 1), disabled: selectedCount !== 1,
      },
      {
        id: 'rippletrim-back', label: 'Ripple trim back', hint: 'The same, one frame earlier',
        shortcut: 'Shift+Alt+←', Icon: MoveHorizontal, onClick: () => onEdgeEdit('ripple', -1), disabled: selectedCount !== 1,
      },
      {
        id: 'slide', label: 'Slide', hint: 'Move the selected clip between its neighbours, which grow and shrink to fill. Nothing outside the clip\'s neighbours moves',
        shortcut: 'Alt+→', Icon: MoveHorizontal, onClick: () => onEdgeEdit('slide', 1), disabled: selectedCount !== 1,
      },
      {
        id: 'slip', label: 'Slip', hint: 'Slide the SOURCE inside the clip without moving it: same position, same length, same neighbours, different frames of the file',
        shortcut: 'Alt+Shift+→', Icon: Move, onClick: () => onEdgeEdit('slip', 1), disabled: selectedCount !== 1,
      },
    ],
    [
      {
        id: 'prevmarker', label: 'Previous marker', hint: 'Jump to the marker before the playhead',
        shortcut: ',', Icon: ChevronLeft, onClick: () => onMarkerStep(-1),
      },
      {
        id: 'nextmarker', label: 'Next marker', hint: 'Jump to the marker after the playhead',
        shortcut: '.', Icon: ChevronRight, onClick: () => onMarkerStep(1),
      },
    ],
    [
      {
        id: 'selectall', label: 'Select all clips', hint: 'Select every clip on every track, so you can move or delete them together',
        shortcut: 'Ctrl+A', Icon: CheckSquare, onClick: onSelectAll, disabled: !canSelectAll,
      },
      {
        id: 'copy', label: 'Copy clips', hint: 'Put the selected clips on the clipboard',
        shortcut: 'Ctrl+C', Icon: Copy, onClick: onCopy, disabled: !canDelete,
      },
      {
        id: 'paste', label: 'Paste clips', hint: 'Drop the clipboard at the playhead, keeping the spacing between clips',
        shortcut: 'Ctrl+V', Icon: ClipboardPaste, onClick: onPaste,
      },
      {
        id: 'duplicate', label: 'Duplicate clips', hint: 'Copy the selection and place the copy immediately after it',
        shortcut: 'Ctrl+D', Icon: CopyPlus, onClick: onDuplicate, disabled: !canDelete,
      },
      {
        id: 'delete', label: ripple ? 'Ripple delete' : 'Delete selected', hint: ripple
          ? 'Delete the selection and slide everything after it left to close the gap'
          : canDelete
            ? `Remove ${selectedCount} selected clip${selectedCount === 1 ? '' : 's'} — one undo step, so Ctrl+Z brings them all back`
            : 'Select one or more clips first (click, shift-click, or drag a marquee)',
        shortcut: 'Del', Icon: Trash2, onClick: onDelete, disabled: !canDelete, active: ripple,
      },
    ],
    [
      {
        id: 'split', label: 'Blade', hint: 'Cut the clip under the playhead into two',
        shortcut: 'S', Icon: Scissors, onClick: onSplit, disabled: !canSplit,
      },
      {
        id: 'link', label: 'Link or unlink', hint: linkedSelection
          ? 'Both sides of the link are selected — moving either moves both'
          : 'Bind this clip to the same file on another track, so they move together (L)',
        shortcut: 'L', Icon: Link2, onClick: () => undefined, disabled: true, active: linkedSelection,
      },
    ],
    [
      {
        id: 'snap', label: 'Snapping', hint: 'Clamp clip edges to the playhead and to other clips',
        shortcut: 'N', Icon: Magnet, onClick: onToggleSnapping, active: snapping,
      },
      {
        id: 'ripple', label: 'Ripple delete mode', hint: 'Delete closes the gap instead of leaving a hole',
        shortcut: 'Shift+Del', Icon: ScanLine, onClick: onToggleRipple, active: ripple,
      },
    ],
    [
      {
        id: 'marker', label: 'Add a marker', hint: 'Drop a marker at the playhead, then step between markers with , and . to get back to a note you made forty cuts ago',
        shortcut: 'M', Icon: Flag, onClick: onAddMarker, active: markerCount > 0,
      },
      {
        id: 'prevmarker', label: 'Previous marker', hint: 'Jump to the marker before the playhead',
        shortcut: ',', Icon: ChevronLeft, onClick: () => onMarkerStep(-1),
      },
      {
        id: 'nextmarker', label: 'Next marker', hint: 'Jump to the marker after the playhead',
        shortcut: '.', Icon: ChevronRight, onClick: () => onMarkerStep(1),
      },
    ],
    [
      {
        id: 'prev', label: 'Previous frame', hint: 'Move one frame back for precise cutting',
          shortcut: '←', Icon: SkipBack, onClick: () => onStep(-1),
      },
      {
        id: 'play', label: isPlaying ? 'Pause' : 'Play', hint: isPlaying ? 'Pause playback' : 'Start playback',
        shortcut: 'Space', Icon: isPlaying ? Pause : Play, onClick: onTogglePlay,
      },
      {
        id: 'next', label: 'Next frame', hint: 'Move one frame forward for precise cutting',
        shortcut: '→', Icon: SkipForward, onClick: () => onStep(1),
      },
      {
        id: 'loop', label: 'Loop', hint: loopOn
          ? 'Playback wraps at the region marked on the ruler'
          : 'Mark a region on the ruler and play it over and over',
        Icon: Repeat, onClick: onToggleLoop, active: loopOn,
      },
    ],
    [
      {
        id: 'record', label: 'Record', hint: 'Record from your camera and/or microphone, with a preview before you keep it',
        shortcut: 'R', Icon: Circle, onClick: onRecord, active: recording,
      },
      {
        id: 'silence', label: 'Remove silence', hint: 'Cut the quiet gaps out of a recording, locally in your browser — no upload, no cost',
        shortcut: 'M', Icon: AudioWaveform, onClick: onOpenBin, disabled: !canProcessAudio,
      },
    ],
    [
      {
        id: 'zoomout', label: 'Zoom out', hint: 'Show more of the timeline',
        shortcut: '-', Icon: ZoomOut, onClick: () => onZoom(-0.25),
      },
      {
        id: 'zoomin', label: 'Zoom in', hint: 'See clips frame by frame',
        shortcut: '+', Icon: ZoomIn, onClick: () => onZoom(0.25),
      },
      {
        id: 'fit', label: 'Fit the timeline', hint: 'Back to 100% — one second is 90 pixels',
        shortcut: '0', Icon: MonitorUp, onClick: onFit,
      },
      {
        id: 'full', label: 'Full screen', hint: 'Expand the player to the whole screen',
        shortcut: 'F11', Icon: Maximize2, onClick: onFullscreen,
      },
    ],
  ];

  // The zoom SLIDER.
  //
  // It used to live in the track header, which was fine at 178px and
  // impossible at 30px - it rendered clipped and unreadable, and when the
  // header became icon-only it disappeared entirely. It belongs beside the
  // zoom buttons it complements: the buttons jump by a step, the slider is for
  // finding the exact zoom you want, and a control you can only step is no use
  // when you are looking for 6.4 pixels per frame.
  const zoomPct = Math.round((pxPerFrame / 3) * 100);

  return (
    <>
      <MenuBar menus={menus}>
        {/*
          Help and the session controls, BOTH on the top strip.

          Help was a toolbar button and it was wrong there: the toolbar is
          forty editing tools, and a button that explains the toolbar does not
          belong inside it. It also looked like a tool, so people used it
          instead of learning the tools. On the top line it reads as what it
          is - a way into the documentation.
        */}
        <HelpTip />
        <AuthNav />
      </MenuBar>
      {showToolbar && (
        <div
          role="toolbar"
          aria-label="Editing tools"
          className="flex h-10 shrink-0 items-center bg-[#1a1a1a]"
        >
      {/*
        Tool groups SCROLL hain (40+ buttons), session indicator NAHI.
       
        Pehle ye ek hi `overflow-x-auto` container tha, jisme AuthNav last
        me tha - matbara content viewport se chhota ho to auth controls
        viewport ke BAHAR chale jaate the aur user ko "logged in ya out"
        dikhai hi nahi deta tha. Do region banaye: left scrollable, right
        fixed.
      */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5">
        {groups.map((group, gi) => (
          <ToolbarGroup key={gi} title={group[0].label + ' tools'}>
            {group.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={b.onClick}
                disabled={b.disabled}
                aria-label={b.label}
                // Two-line tooltip: what it is, what it does, how to use it.
                title={`${b.label}\n${b.hint}${b.shortcut ? `\nShortcut: ${b.shortcut}` : ''}`}
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center transition-colors duration-150',
                  b.disabled
                    ? 'cursor-not-allowed text-fg-muted'
                    : b.active
                      ? 'text-[#ff6500]'
                      : 'text-fg-secondary hover:text-[#ff6500]',
                ].join(' ')}
              >
                <b.Icon className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            ))}
          </ToolbarGroup>
        ))}
        <ToolbarGroup title="Timeline zoom">
          {/*
            The slider. 1 to 64 pixels per frame, which is the range
            `clampPxPerFrame` allows - a slider whose range stops short of what
            the app allows is a control that lies about its own limits.
          */}
          <input
            type="range"
            min={1}
            max={6400}
            step={1}
            value={Math.round(pxPerFrame * 100)}
            onChange={(e) => onZoomTo(clampPxPerFrame(Number(e.target.value) / 100))}
            aria-label="Timeline zoom"
            title={`Timeline zoom: ${zoomPct}% — ${pxPerFrame.toFixed(2)} pixels per frame\nDrag to zoom, or Alt+scroll on the ruler. Above 24px a single frame is plainly visible.`}
            className="ve-fader mx-1 h-1 w-16 cursor-pointer"
          />
          <span className="w-8 shrink-0 font-mono text-[8px] tabular-nums text-fg-muted" aria-label="Zoom percentage">
            {zoomPct}%
          </span>
        </ToolbarGroup>

<ToolbarGroup title="Frame rate and playback speed">
          {/*
            The two numbers that decide what every other number on screen
            MEANS. They are selects rather than buttons because each has a fixed
            set of correct answers - five frame rates and a set of speeds - and a
            cycle button makes the user press it just to find out where they are.
          */}
          <label
            className="flex items-center gap-1 px-1"
            title="The rate the timeline counts in. Every frame number depends on it; changing it rescales the zoom so the timeline keeps the same size in seconds."
          >
            <Gauge className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
            <div className="ve-select-dropdown">
            <select
              value={String(fps)}
              onChange={(e) => onFpsChange(Number(e.target.value))}
              aria-label="Timeline frame rate"
              className="h-6 w-16 cursor-pointer bg-[#1a1a1a] px-1 font-mono text-[8px] text-fg-muted outline-none transition-colors duration-150 border border-[#9fa7b3]/25 hover:border-[#ff6500]/40 hover:text-[#ff6500] focus:border-[#ff6500]/60 focus:text-[#ff6500]"
            >
              {SUPPORTED_FPS.map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
            </div>
          </label>
          <label
            className="flex items-center gap-1 px-1"
            title="Play the timeline faster or slower than real time. The picture comes off the timeline clock either way, so this changes what you see and hear, not what would be exported."
          >
            <Timer className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
            <div className="ve-select-dropdown">
            <select
              value={String(playbackRate)}
              onChange={(e) => onPlaybackRate(Number(e.target.value))}
              aria-label="Playback speed"
              className="h-6 w-16 cursor-pointer bg-[#1a1a1a] px-1 font-mono text-[8px] text-fg-muted outline-none transition-colors duration-150 border border-[#9fa7b3]/25 hover:border-[#ff6500]/40 hover:text-[#ff6500] focus:border-[#ff6500]/60 focus:text-[#ff6500]"
            >
              {PLAYBACK_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
            </div>
          </label>
        </ToolbarGroup>

      </div>
        {/*
          The right-hand group.

          `ml-auto` + `shrink-0` EK SAATH nahi ho sakte jab toolbar
          `overflow-x-auto` ho: content viewport se chhota ho to scroll hota
          hai, aur `ml-auto` wale items viewport ke BAHAR chale jaate hain.
          Isi liye auth controls ek alag `shrink-0` group me hain - unhe
          kabhi scroll nahi hona chahiye, kyunki "main logged in hoon ya nahi"
          ek aisi baat hai jo user ko HAMESHA dikhni chahiye.

          Left side ko hi scroll hone diya jaata hai: aapne 40+ buttons open
          kar liye to tools hat jaate hain, session indicator nahi.
        */}
        <div className="ml-3 flex shrink-0 items-center gap-1 bg-[#1a1a1a] pl-2">
          <span className="truncate text-[8px] text-fg-secondary" title={projectName}>
            {projectName}
            <span className={dirty ? 'ml-1 text-[#ff6500]' : 'ml-1 text-fg-muted'}>
              {dirty ? '● unsaved' : savedAt ? '● saved' : '○ new'}
            </span>
          </span>
          {savedAt && (
            <span className="font-mono text-[8px] text-fg-muted">{new Date(savedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </div>
      )}
    </>
  );
}

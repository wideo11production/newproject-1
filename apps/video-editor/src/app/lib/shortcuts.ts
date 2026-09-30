// ============================================================================
// Shortcut table
// ============================================================================
//
// ONE table, read by the help panel, the menu bar and the keyboard handler's
// own documentation. A shortcut list maintained separately from the handler
// drifts within a week, and a user who presses `S` and gets nothing then has
// no way to tell a broken binding from an undocumented one.
//
// `keys` is the human string. `match` is the predicate the global handler
// uses, so the table decides what a key DOES rather than only what it is
// called - which is the failure mode of a table used purely for display.

export type KeyGroup = 'File' | 'Edit' | 'Clip' | 'View' | 'Playback' | 'Audio';

export interface Shortcut {
  group: KeyGroup;
  keys: string;
  label: string;
  hint?: string;
  match: (e: KeyboardEvent) => boolean;
}

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
};

/** `e.key` is normalised so `Numpad` keys and capitalisation both match. */
const k = (e: KeyboardEvent) => e.key.toLowerCase();

export const SHORTCUTS: Shortcut[] = [
  { group: 'File', keys: 'Ctrl+N', label: 'New project', match: (e) => mod(e) && !e.shiftKey && k(e) === 'n' },
  { group: 'File', keys: 'Ctrl+S', label: 'Save project', match: (e) => mod(e) && k(e) === 's' },
  { group: 'File', keys: 'Ctrl+O', label: 'Import media', match: (e) => mod(e) && k(e) === 'o' },
  { group: 'File', keys: 'Ctrl+M', label: 'Export video', match: (e) => mod(e) && k(e) === 'm' },
  { group: 'File', keys: 'Ctrl+Shift+S', label: 'Take a snapshot', match: (e) => mod(e) && e.shiftKey && k(e) === 's' },

  { group: 'Edit', keys: 'Ctrl+Z', label: 'Undo', match: (e) => mod(e) && !e.shiftKey && k(e) === 'z' },
  { group: 'Edit', keys: 'Ctrl+Shift+Z / Ctrl+Y', label: 'Redo', match: (e) => mod(e) && (e.shiftKey && k(e) === 'z' || k(e) === 'y') },
  { group: 'Edit', keys: 'Ctrl+C', label: 'Copy clips', match: (e) => mod(e) && k(e) === 'c' },
  { group: 'Edit', keys: 'Ctrl+X', label: 'Cut clips', match: (e) => mod(e) && k(e) === 'x' },
  { group: 'Edit', keys: 'Ctrl+V', label: 'Paste clips', match: (e) => mod(e) && k(e) === 'v' },
  { group: 'Edit', keys: 'Ctrl+D', label: 'Duplicate clips', match: (e) => mod(e) && k(e) === 'd' },
  { group: 'Edit', keys: 'Ctrl+A', label: 'Select all clips', match: (e) => mod(e) && k(e) === 'a' },
  { group: 'Edit', keys: 'Esc', label: 'Clear the selection', match: (e) => e.key === 'Escape' },
  { group: 'Edit', keys: 'Delete', label: 'Delete selected clips', match: (e) => e.key === 'Delete' || e.key === 'Backspace' },

  { group: 'Clip', keys: 'S', label: 'Split at the playhead', match: (e) => !mod(e) && k(e) === 's' },
  { group: 'Clip', keys: 'N', label: 'Toggle snapping', match: (e) => !mod(e) && k(e) === 'n' },
  { group: 'Clip', keys: 'Shift+Delete', label: 'Ripple delete — close the gap', match: (e) => e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') },
  { group: 'Clip', keys: 'L', label: 'Link or unlink the selected clip', match: (e) => !mod(e) && k(e) === 'l' },
  { group: 'Clip', keys: 'Enter', label: 'Open clip properties', match: (e) => e.key === 'Enter' },
  { group: 'Clip', keys: 'I / O', label: 'Set the fade in or out point to the playhead', match: (e) => !mod(e) && (k(e) === 'i' || k(e) === 'o') },
  { group: 'Clip', keys: 'M', label: 'Remove silence from a recording', match: (e) => !mod(e) && k(e) === 'm' },

  { group: 'Playback', keys: 'Space', label: 'Play or pause', match: (e) => e.code === 'Space' },
  { group: 'Playback', keys: 'J / K / L', label: 'Shuttle back, stop, forward', hint: 'J and L speed up the longer you hold them', match: (e) => !mod(e) && (k(e) === 'j' || k(e) === 'k' || k(e) === 'l' && !e.shiftKey) },
  { group: 'Playback', keys: '← / →', label: 'Step one frame', hint: 'With Shift, ten frames', match: (e) => e.key === 'ArrowLeft' || e.key === 'ArrowRight' },
  { group: 'Playback', keys: 'Home / End', label: 'Go to the start or the end', match: (e) => e.key === 'Home' || e.key === 'End' },
  { group: 'Playback', keys: 'R', label: 'Record camera or microphone', match: (e) => !mod(e) && k(e) === 'r' },
  { group: 'Playback', keys: '+ / -', label: 'Zoom the timeline', match: (e) => e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' },
  { group: 'Playback', keys: 'F11', label: 'Full screen', match: (e) => e.key === 'F11' },
  { group: 'Playback', keys: '0', label: 'Fit the timeline to the window', match: (e) => !mod(e) && e.key === '0' },

  { group: 'Audio', keys: 'Shift+scroll', label: 'Change a track’s volume', hint: 'Over its fader in the track header', match: () => false },
  { group: 'Audio', keys: 'M', label: 'Mute or solo from the track header', match: () => false },
];

/** Does this key event belong to the editor, or is the user typing? */
export function isEditorKey(e: KeyboardEvent): boolean {
  return !typing(e);
}

export interface MouseAction {
  gesture: string;
  does: string;
}

export const MOUSE_ACTIONS: MouseAction[] = [
  { gesture: 'Click a clip', does: 'Select it. Shift-click adds, Ctrl-click toggles.' },
  { gesture: 'Double-click a clip', does: 'Open its properties — speed, volume, fades, filters, position.' },
  { gesture: 'Drag a clip', does: 'Move it. Drag it onto another lane to move it between tracks.' },
  { gesture: 'Drag a clip edge', does: 'Trim the start or the end. The clip cannot go below 0.2s.' },
  { gesture: 'Drag an amber corner', does: 'Lengthen the fade in or the fade out.' },
  { gesture: 'Drag on empty lane space', does: 'Marquee-select. A click without movement seeks instead.' },
  { gesture: 'Click a transition badge', does: 'Select it; drag its edges to change its length, Delete to remove it.' },
  { gesture: 'Scroll on a track fader', does: 'Change that track’s volume without moving the pointer off it.' },
  { gesture: 'Hover a clip', does: 'Preview that clip in the player. Moving away restores what was playing.' },
  { gesture: 'Wheel on the ruler', does: 'Scrub. The ruler is a slider, so arrow keys move it a frame at a time.' },
];

export interface FeatureNote {
  name: string;
  how: string;
}

export const FEATURES: FeatureNote[] = [
  { name: 'Silence removal', how: 'RMS windowing in the browser. No model, no upload, no cost.' },
  { name: 'Audio effects', how: 'Real Web Audio graphs built from the stock sample resources in this repo.' },
  { name: 'Colour grades, pan & zoom, picture-in-picture', how: 'Read out of the Movavi sample resources, not hand-typed.' },
  { name: 'Waveforms', how: 'Decoded once per file and cached as peaks. A file the browser cannot decode draws a flat line, not a fake squiggle.' },
  { name: 'Thumbnails', how: 'A real decoded frame at 10% of the file, time-boxed at 1.5s.' },
  { name: 'Export', how: 'MediaRecorder on the compositor’s own canvas plus the audio graph. Real-time, WebM, nothing leaves the machine.' },
  { name: 'Projects', how: 'Arrangement in localStorage, media bytes in IndexedDB. Autosave every 30 seconds.' },
];

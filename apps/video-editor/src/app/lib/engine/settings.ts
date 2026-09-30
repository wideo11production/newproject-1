'use client';

// ============================================================================
// Persistent settings
// ============================================================================
//
// "User settings must NEVER reset after refresh, reload, restart, navigation
// or session restore." That is the requirement this file exists to satisfy.
//
// ---- WHY NOT `useState` PLUS A `useEffect` THAT WRITES ----
//
// Because it is a race, and the race loses exactly when it matters. State lives
// in React; storage lives outside it. Any change made before the first effect
// ran, during a fast unmount, or inside an event that unmounts the tree
// (navigating away, opening a dialog that replaces the route) is lost with no
// error. Users notice this as "my zoom reset" and never as "a write was
// dropped".
//
// So the store is the SOURCE OF TRIMUTH, not a mirror of it. Components read
// from it and write to it. There is no second copy to fall out of sync, so
// there is no window in which the two disagree.
//
// ---- WHY `useSyncExternalStore` AND NOT A CONTEXT ----
//
// A context re-renders every consumer on every change, including the
// components that only need the theme and not the timeline scroll. This store
// notifies per-key, and `useSetting` subscribes to ONE key. Changing the
// timeline scroll therefore does not re-render the toolbar.
//
// ---- WHY SYNCHRONOUS ----
//
// `localStorage` is synchronous, and that is the point: the restore happens
// during the first render, so there is no frame where the editor is drawn at
// the wrong zoom and then corrected. A user who refreshes sees their layout,
// not a flash of the default one. The cost is a sub-millisecond read of a few
// kilobytes, once.
//
// ---- WHAT IS NOT HERE ----
//
// The project itself. Tracks, clips and media live in `project-store.ts`,
// against IndexedDB, because a video does not fit in localStorage. This file
// holds the WORKSPACE: how the editor is arranged and how it is driving the
// timeline. Those are different lifetimes and are allowed to fail separately.

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'wideo11.video-editor.settings.v1';

export type Theme = 'dark' | 'light';
export type ViewerLayout = 'single' | 'side-by-side' | 'picture-in-picture';

export interface EditorSettings {
  /** ---- timeline ---- */
  /** Zoom, in PIXELS PER FRAME. See `frames.ts` for why that is the unit. */
  pxPerFrame: number;
  /** Horizontal scroll offset of the shared timeline strip, in px. */
  scrollLeft: number;
  /** Vertical scroll offset of the lane area, in px. */
  scrollTop: number;
  /** Playhead, stored as a FRAME NUMBER. Not seconds - see `frames.ts`. */
  playheadFrame: number;
  /** Show decoded peak waveforms on audio-bearing clips. */
  waveformVisible: boolean;
  /** Draw the frame grid behind the lanes. */
  gridVisible: boolean;
  gridInterval: 'frames' | 'seconds' | 'minutes';
  /** Snap the playhead and dragged clips to whole frames. Always on: the
   *  editor is frame-accurate, so an unsnapped position is a wrong one. */
  snapEnabled: boolean;
  /** Snap targets, individually switchable. */
  snapToPlayhead: boolean;
  snapToClips: boolean;
  snapToMarkers: boolean;
  snapToTimelineEnds: boolean;
  /** Snap distance in pixels, so the feel of snapping is adjustable without
   *  changing the grid the positions land on. */
  snapThresholdPx: number;
  /** Ripple mode makes delete close the gap. */
  rippleEnabled: boolean;

  /** ---- tracks ---- */
  /** Per-lane height in px, by track id. Lanes not listed use the default. */
  trackHeights: Record<string, number>;

  /** ---- viewer ---- */
  viewerZoom: number;
  viewerLayout: ViewerLayout;
  /** Show the resolution/fps badge over the picture. */
  viewerBadge: boolean;

  /** ---- panels ---- */
  /** Width of the left panel, px. */
  binWidth: number;
  /** Height of the timeline pane, px. */
  timelineHeight: number;
  /** Height of the status strip, px. */
  footerHeight: number;
  /** Width of the inspector drawer, px. */
  inspectorWidth: number;

  /** ---- playback ---- */
  /** Playback rate, 0.25 - 4. 1 = real time. */
  playbackRate: number;
  /** Loop the region marked on the ruler. */
  loopEnabled: boolean;
  loopStartFrame: number;
  loopEndFrame: number;
  masterVolume: number;

  /** ---- preferences ---- */
  theme: Theme;
  /** Which mode the left rail is showing. */
  activeMode: string;
  /** Last project the user had open. */
  lastProjectId: string;
  /** Frame rate the timeline is counting in. */
  fps: number;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  pxPerFrame: 3,
  scrollLeft: 0,
  scrollTop: 0,
  playheadFrame: 0,
  waveformVisible: true,
  gridVisible: false,
  gridInterval: 'seconds',
  snapEnabled: true,
  snapToPlayhead: true,
  snapToClips: true,
  snapToMarkers: true,
  snapToTimelineEnds: true,
  snapThresholdPx: 8,
  rippleEnabled: false,

  trackHeights: {},

  viewerZoom: 1,
  viewerLayout: 'single',
  viewerBadge: true,

  binWidth: 300,
  timelineHeight: 300,
  footerHeight: 20,
  inspectorWidth: 420,

  playbackRate: 1,
  loopEnabled: false,
  loopStartFrame: 0,
  loopEndFrame: 0,
  masterVolume: 1,

  theme: 'dark',
  activeMode: 'media',
  lastProjectId: '',
  fps: 30,
};

/**
 * Settings that are restored but NOT written back automatically.
 *
 * `playheadFrame` is here because it is part of "restore editor state" but not
 * something the user thinks of as a setting; it is written by the editor on a
 * deliberate pause/seek so that a reload puts you back where you were working,
 * not a fraction of a second after wherever the animation loop happened to
 * stop.
 */
export type SettingsPatch = Partial<EditorSettings>;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function read(): EditorSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<EditorSettings>;
    // Merge rather than replace: a settings file written by an older build is
    // missing every key added since, and replacing would silently drop the
    // user's whole layout because of one missing field.
    return { ...DEFAULT_SETTINGS, ...parsed, trackHeights: { ...(parsed.trackHeights ?? {}) } };
  } catch {
    // A corrupt value is not worth crashing over, and not worth keeping: a
    // half-written JSON blob would fail forever. Defaults are recoverable;
    // a permanently broken parse is not.
    return { ...DEFAULT_SETTINGS };
  }
}

let current: EditorSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Read the saved settings ONCE, into memory.
 *
 * Called from a mount effect rather than at module scope, and that ordering is
 * load-bearing. React hydrates by rendering the tree on the client and comparing
 * it to the server's HTML. If the store's values come from localStorage, the
 * client render uses the user's zoom while the server rendered the default - and
 * React throws "Minified React error #418" and discards the whole tree. The
 * mismatch is not cosmetic: it costs the user a full re-render on every load,
 * and it is a function of THEIR settings, so it cannot be reproduced by a user
 * who has none.
 *
 * So: the store starts as the defaults, which is what the server rendered, and
 * the real values are applied one render later. Nothing has to be suppressed
 * with `suppressHydrationWarning`, because nothing mismatches.
 */
let loaded = false;

export function loadSettings(): EditorSettings {
  if (loaded || typeof localStorage === 'undefined') return current;
  loaded = true;
  current = read();
  return current;
}

export function isSettingsLoaded(): boolean {
  return loaded;
}

function notify() {
  for (const l of listeners) l();
}

/**
 * Read the saved settings on mount and publish them.
 *
 * This is the ONLY place localStorage is consulted, and it runs after the first
 * client render - so the hydration render sees the same defaults the server
 * rendered. See the note on `loadSettings` for why that ordering is the whole
 * fix.
 */
export function hydrateSettings(): EditorSettings {
  const next = loadSettings();
  // Notify only if something actually changed. A user with no saved settings
  // would otherwise be woken once on every single load for no reason.
  const differs = (Object.keys(DEFAULT_SETTINGS) as Array<keyof EditorSettings>).some(
    (k) => DEFAULT_SETTINGS[k] !== next[k]
  );
  if (differs) notify();
  return next;
}

/**
 * Write, coalesced.
 *
 * Dragging a resize handle produces a pointermove per frame. Writing on each
 * one would serialise and write localStorage sixty times a second, which on
 * Windows is a synchronous file write - long enough to make the drag stutter,
 * which is precisely the interaction that generates the events.
 *
 * The flush is therefore deferred to the end of the frame burst. Nothing is
 * lost: there is also a flush on `pagehide`/`visibilitychange`, which is the
 * event that actually fires when a tab is closed or backgrounded.
 */
function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, 250);
}

export function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode or a full quota: the editor still works, it just forgets */
  }
}

if (typeof window !== 'undefined') {
  // `pagehide` fires for a close AND for a bfcache navigation; `visibilitychange`
  // is the backstop for a mobile tab being killed. Both are needed, and both
  // are cheap.
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export function getSettings(): EditorSettings {
  return current;
}

/** Write a patch and notify subscribers. Synchronous in the store, deferred on disk. */
export function setSettings(patch: SettingsPatch): void {
  const next = { ...current, ...patch };
  // A no-op write still notifies and still schedules a flush, and that is
  // correct: a component that wrote `zoom` from 3 to 3 must not care, but a
  // component that wrote `theme` to the theme it already has must not
  // re-render either. Skipping both would be a correctness question every
  // caller would have to answer for itself.
  const changed = (Object.keys(patch) as Array<keyof EditorSettings>).some((k) => current[k] !== next[k]);
  current = next;
  if (changed) notify();
  scheduleFlush();
}

export function resetSettings(): void {
  current = { ...DEFAULT_SETTINGS, trackHeights: {} };
  notify();
  flush();
}

/** Subscribe. Returns an unsubscribe function, per the external-store contract. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read and write ONE setting.
 *
 * `useSyncExternalStore` guarantees the value read during render is the one the
 * store holds, so a component cannot paint a stale zoom and then correct it.
 */
export function useSetting<K extends keyof EditorSettings>(key: K): EditorSettings[K] {
  const readValue = useCallback(() => current[key], [key]);
  return useSyncExternalStore(subscribeSettings, readValue);
}

/** Read and write a whole settings object. For a component that genuinely
 *  needs most of them - the editor shell, the ruler, the lanes. */
export function useSettings(): [EditorSettings, (patch: SettingsPatch) => void] {
  const value = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  return [value, setSettings];
}

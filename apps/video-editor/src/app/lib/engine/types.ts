// ============================================================================
// Project model
// ============================================================================
//
// ONE definition of a clip, a track and a project, shared by the timeline, the
// preview compositor, the exporter and the save file. It used to live inside
// `timeline-tracks.tsx`, which meant the preview could not import the type it
// renders without importing a React component that renders the timeline, and
// the save format had no home at all.
//
// ---- WHY EVERY FIELD HAS A DEFAULT THAT MEANS "UNTOUCHED" ----
//
// Old projects are opened from localStorage. A field added today is `undefined`
// in every project saved before it existed, so every reader has to cope with
// that. Rather than sprinkle `?? 0.5` through the compositor, `normaliseClip`
// fills the gaps once, at load. The defaults below are the ones that preserve
// the old behaviour exactly: no speed change, full opacity, no filter, no fade.

import type { Marker } from './markers';

let uid = 0;
/** Generate a short unique ID with a prefix. */
export const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export type TrackType = 'video' | 'audio' | 'text' | 'image' | 'branding';

/**
 * `base` is the bottom lane - its absence is black, and it carries picture
 * sound. `overlay` is a lane above it, drawn with its own opacity, corner and
 * size. This is the difference between "a second video track" and
 * "picture-in-picture", and it is why the two cannot be the same flag.
 */
export type LayerRole = 'base' | 'overlay';

export interface ClipFilter {
  brightness: number; // 1 = untouched
  contrast: number;
  saturate: number;
  hue: number; // degrees, -180..180
  blur: number; // px
  grayscale: number; // 0..1
  sepia: number; // 0..1
  invert: number; // 0..1
  /** Warm/cool push in degrees-ish. -1 cool, 0 neutral, 1 warm. */
  temperature: number;
}

export const NEUTRAL_FILTER: ClipFilter = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  temperature: 0,
};

/** Where and how big an overlay clip sits over the base layer. */
export interface ClipTransform {
  /** 0..1 of canvas width/height, 0.5 = centre. */
  x: number;
  y: number;
  /** 1 = 100% of the frame. */
  scale: number;
  /** degrees, clockwise. */
  rotation: number;
  /** How the source fills the destination box. */
  fit: 'contain' | 'cover' | 'fill' | 'pip';
  /** Which corner a `pip` fit snaps to. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** PIP box width as a fraction of canvas width, 0.1..0.6. */
  pipSize: number;
  /** Ken Burns: scale drift applied across the clip's own duration. */
  zoomStart: number;
  zoomEnd: number;
  /** Ken Burns: pan drift as a fraction of frame width across the duration. */
  panX: number;
  panY: number;
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  fit: 'contain',
  corner: 'bottom-right',
  pipSize: 0.28,
  zoomStart: 1,
  zoomEnd: 1,
  panX: 0,
  panY: 0,
};

export interface TextClipStyle {
  content: string;
  fontFamily: string;
  /** Font size as a fraction of canvas height, so it survives resolution changes. */
  size: number;
  color: string;
  background: string;
  align: 'left' | 'center' | 'right';
  weight: number;
  italic: boolean;
  shadow: boolean;
  uppercase: boolean;
  letterSpacing: number; // em
  lineHeight: number;
}

export const DEFAULT_TEXT_STYLE: TextClipStyle = {
  content: 'Text',
  fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif',
  size: 0.08,
  color: '#ffffff',
  background: 'transparent',
  align: 'center',
  weight: 700,
  italic: false,
  shadow: true,
  uppercase: false,
  letterSpacing: 0,
  lineHeight: 1.2,
};

export interface TimelineClip {
  id: string;
  mediaId: string;
  mediaName: string;
  /** Seconds on the timeline. */
  startTime: number;
  /** Seconds on the timeline, already divided by `speed`. */
  duration: number;
  type: TrackType;
  /** Image/poster data URL for the tile. Never a path to a file. */
  thumbnail?: string;
  /** The media's own blob: URL - needed to PLAY a clip, not just draw it. */
  url?: string;
  /** Decoded poster frame, 320px data URL. */
  poster?: string;
  /** Free-form effect names, kept for the effects list in the inspector. */
  effects: string[];

  /** Seconds into the source media that this clip starts at. */
  sourceIn: number;
  /** Playback rate. 1 = real time. Duration on the timeline is source / speed. */
  speed: number;

  /** 0..1. Deliberately capped at unity: this is a real gain node, and 200% is
   *  clipping, not volume. */
  volume: number;
  muted: boolean;
  /** 0..1, applied when the clip is composited. */
  opacity: number;
  /** Seconds. A linear ramp on the clip's own level. */
  fadeIn: number;
  fadeOut: number;

  filter: ClipFilter;
  transform: ClipTransform;
  /** Present on `text` clips. */
  text?: TextClipStyle;

  /** Peaks (0..1) per bucket for the waveform. Populated lazily. */
  peaks?: number[];

  /** The audio clip bound to this one, or vice versa. Movavi calls this a
   *  linked track: move one, the other follows. */
  linkedId?: string | null;

  /**
   * Which branding slot this clip occupies, on the branding track.
   *
   * The track carries up to two marks: the channel's own logo, and a sponsor (or a
   * second personal logo) in another corner. They are the same kind of thing — a
   * corner-anchored image over the video — so they share a track and a draw path,
   * and the role is what tells them apart.
   *
   * ABSENT MEANS CHANNEL. Every clip made before this field existed is a channel
   * logo, and a project saved before it has no value here at all. Treating the
   * absent case as the channel slot is what lets those projects open with their
   * logo intact instead of silently losing it.
   *
   * A second track type would have been the tidier answer and a far larger one: a
   * track type, a tint, drag rules and an `acceptsTrack` rule, all to distinguish
   * two images that draw identically.
   */
  brandingRole?: 'channel' | 'sponsor';
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  role: LayerRole;
  clips: TimelineClip[];
  /** 0..1 track fader. */
  volume: number;
  muted: boolean;
  /** Solo wins over mute, and over every other track's un-soloed state. */
  solo: boolean;
  visible: boolean;
  locked: boolean;
}

export type TransitionType =
  | 'dissolve'
  | 'dip-black'
  | 'fade-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right'
  | 'circle-open'
  | 'zoom-in';

/** A transition, and what the panel shows while one is selected. */
export interface Transition {
  id: string;
  /** The track whose join this transition sits on. */
  trackId: string;
  type: TransitionType;
  /** The boundary: the outgoing clip's end == the incoming clip's start. */
  atTime: number;
  /** Seconds. The outgoing clip is held past its end for this long. */
  duration: number;
}

/** A project as listed in the "recent projects" list. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
  clipCount: number;
}

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  name: 'Untitled project',
  width: 1280,
  height: 720,
  fps: 30,
  background: '#000000',
};

/** Project presets for common aspect ratios. */
export interface ProjectPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Human-readable description of the use case. */
  hint: string;
}

/** Available project presets. */
export const PROJECT_PRESETS: ProjectPreset[] = [
  { id: 'desktop', label: 'Desktop (16:9)', width: 1920, height: 1080, hint: 'YouTube, Vimeo, standard widescreen' },
  { id: 'mobile', label: 'Mobile (9:16)', width: 1080, height: 1920, hint: 'Shorts, Reels, TikTok, Stories' },
  { id: 'square', label: 'Square (1:1)', width: 1080, height: 1080, hint: 'Instagram feed, LinkedIn, Twitter' },
  { id: 'cinema', label: 'Cinema (21:9)', width: 2560, height: 1080, hint: 'Ultra-wide cinematic' },
  { id: 'portrait-4-5', label: 'Portrait (4:5)', width: 1080, height: 1350, hint: 'Instagram portrait posts' },
];

/**
 * Where a channel logo sits for a given delivery target.
 *
 * ---- WHY THE EDITOR OWNS THIS TABLE ----
 *
 * It looks like channel setup should decide this, and `branding-panel.tsx` reads
 * `logo_position` / `logo_auto_size` off the channel. Those two fields DO NOT EXIST
 * on the backend: there is no column for them, they are absent from the setup
 * response struct, and they are absent from the update request struct. They appear
 * in exactly two TSX files and nowhere in the service.
 *
 * So the panel was reading `undefined` on every channel and silently falling back to
 * `bottom-right` at 12%. Every user got the same position regardless of what the
 * dashboard showed them, and a PATCH carrying those fields would be accepted and
 * dropped.
 *
 * Position is therefore a property of the PROJECT, not of the channel — which is the
 * more honest model anyway: the same channel is published to a widescreen upload and
 * a vertical one, and the logo belongs in a different corner in each. It lives on the
 * branding clip's transform, so it saves, reloads and undoes like everything else.
 */
export interface BrandingPreset {
  id: string;
  label: string;
  hint: string;
  /** Corner the logo sits in. */
  corner: ClipTransform['corner'];
  /** Logo width as a fraction of the frame width. */
  size: number;
}

export const BRANDING_PRESETS: BrandingPreset[] = [
  { id: 'widescreen', label: '16:9 landscape', hint: 'YouTube, Vimeo — logo top right', corner: 'top-right', size: 0.15 },
  { id: 'vertical', label: '9:16 vertical', hint: 'Shorts, Reels, TikTok — logo top left', corner: 'top-left', size: 0.22 },
  { id: 'square', label: '1:1 square', hint: 'Instagram feed — logo top right', corner: 'top-right', size: 0.18 },
];

export function getBrandingPreset(id: string): BrandingPreset {
  return BRANDING_PRESETS.find((p) => p.id === id) ?? BRANDING_PRESETS[0];
}

/** Find a preset by id, or return the desktop preset as fallback. */
export function getPreset(id: string): ProjectPreset {
  return PROJECT_PRESETS.find((p) => p.id === id) ?? PROJECT_PRESETS[0];
}

/** Create default project settings from a preset. */
export function settingsFromPreset(presetId: string, name = 'Untitled project'): ProjectSettings {
  const p = getPreset(presetId);
  return { name, width: p.width, height: p.height, fps: 30, background: '#000000' };
}

/** A saved project. Media bytes live in IndexedDB, keyed by `mediaId`. */
export interface ProjectDoc {
  /** Bumped when the shape changes so old saves can be migrated, not misread. */
  version: number;
  id: string;
  settings: ProjectSettings;
  tracks: TimelineTrack[];
  transitions: Transition[];
  /** Timeline markers, in frames. Project content, so they save with it. */
  markers?: Marker[];
  /** Serialised undo/redo stacks, so redo survives a reload. */
  history: TimelineTrack[][];
  future: TimelineTrack[][];
  savedAt: number;
  duration: number;
}

export const PROJECT_VERSION = 2;

// ---------------------------------------------------------------------------
// Construction + migration
// ---------------------------------------------------------------------------

export const DEFAULT_TRACKS: TimelineTrack[] = [
  { id: 'v1', name: 'Video 1', type: 'video', role: 'base', clips: [], volume: 1, muted: false, solo: false, visible: true, locked: false },
  { id: 'a1', name: 'Audio 1', type: 'audio', role: 'base', clips: [], volume: 1, muted: false, solo: false, visible: true, locked: false },
  { id: 't1', name: 'Text 1', type: 'text', role: 'overlay', clips: [], volume: 1, muted: false, solo: false, visible: true, locked: false },
  { id: 'b1', name: 'Branding', type: 'branding', role: 'overlay', clips: [], volume: 1, muted: false, solo: false, visible: true, locked: true },
];

/**
 * Fill in every field a clip from an older project is missing.
 *
 * Called on load and on read, never on write. Defaults preserve the previous
 * behaviour exactly, so a project saved before speed existed opens at speed 1
 * and looks identical to how it did when it was saved.
 */
export function normaliseClip(raw: Partial<TimelineClip> & { id: string }): TimelineClip {
  return {
    id: raw.id,
    mediaId: raw.mediaId ?? raw.id,
    mediaName: raw.mediaName ?? 'Untitled clip',
    startTime: raw.startTime ?? 0,
    duration: raw.duration ?? 1,
    type: raw.type ?? 'video',
    thumbnail: raw.thumbnail,
    url: raw.url,
    poster: raw.poster,
    effects: raw.effects ?? [],
    sourceIn: raw.sourceIn ?? 0,
    speed: raw.speed && raw.speed > 0 ? raw.speed : 1,
    volume: raw.volume ?? 1,
    muted: raw.muted ?? false,
    opacity: raw.opacity ?? 1,
    fadeIn: raw.fadeIn ?? 0,
    fadeOut: raw.fadeOut ?? 0,
    filter: { ...NEUTRAL_FILTER, ...(raw.filter ?? {}) },
    transform: { ...DEFAULT_TRANSFORM, ...(raw.transform ?? {}) },
    text: raw.text ? { ...DEFAULT_TEXT_STYLE, ...raw.text } : undefined,
    peaks: raw.peaks,
    linkedId: raw.linkedId ?? null,
    // ---- MUST BE LISTED ----
    //
    // This function rebuilds a clip from an explicit field list, so a field that is
    // added to the interface but not here is dropped every time a project is
    // opened. A field that silently disappears on reload is worse than one that was
    // never added: the value is there while you are editing and gone after.
    brandingRole: raw.brandingRole === 'sponsor' ? 'sponsor' : 'channel',
  };
}

export function normaliseTrack(raw: Partial<TimelineTrack> & { id: string }): TimelineTrack {
  return {
    id: raw.id,
    name: raw.name ?? 'Track',
    type: raw.type ?? 'video',
    role: raw.role ?? (raw.type === 'video' ? 'base' : raw.type === 'branding' ? 'overlay' : 'overlay'),
    clips: (raw.clips ?? []).map((c) => normaliseClip(c)),
    volume: raw.volume ?? 1,
    muted: raw.muted ?? false,
    solo: raw.solo ?? false,
    visible: raw.visible ?? true,
    locked: raw.locked ?? false,
  };
}

export function normaliseProject(raw: Partial<ProjectDoc>): ProjectDoc {
  return {
    version: PROJECT_VERSION,
    id: raw.id ?? `p-${Date.now()}`,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    tracks: (raw.tracks ?? DEFAULT_TRACKS).map((t) => normaliseTrack(t)),
    transitions: raw.transitions ?? [],
    markers: raw.markers ?? [],
    history: (raw.history ?? []).map((snap) => snap.map((t) => normaliseTrack(t))),
    future: (raw.future ?? []).map((snap) => snap.map((t) => normaliseTrack(t))),
    savedAt: raw.savedAt ?? Date.now(),
    duration: raw.duration ?? 30,
  };
}

// ---------------------------------------------------------------------------
// Queries shared by the timeline, the compositor and the exporter
// ---------------------------------------------------------------------------

/** End of a clip on the timeline. */
export function clipEnd(c: TimelineClip): number {
  return c.startTime + c.duration;
}

/** The clip covering `t` on a track, or null. */
export function clipAt(track: TimelineTrack, t: number): TimelineClip | null {
  for (const c of track.clips) {
    if (t >= c.startTime && t < clipEnd(c)) return c;
  }
  return null;
}

/**
 * Where `t` sits inside the SOURCE media for a clip.
 *
 * `sourceIn` plus the elapsed timeline time, divided by speed. A clip at 2x
 * started 1s into the source and the playhead is 3s in: the source is being
 * read at 1 + 3*2 = 7s.
 */
export function sourceTimeAt(c: TimelineClip, t: number): number {
  return c.sourceIn + (t - c.startTime) * c.speed;
}

/**
 * The clip's audio level at `t`, 0..1.
 *
 * Fades are the reason this is a function and not a stored number: a fade is
 * a ramp, so its value changes on every frame of playback. Track volume, mute
 * and solo are applied by the caller because they are per-track, not per-clip.
 */
export function clipGainAt(c: TimelineClip, t: number): number {
  if (c.muted || c.volume <= 0) return 0;
  let g = c.volume;
  if (c.fadeIn > 0) {
    const into = t - c.startTime;
    if (into < c.fadeIn) g *= Math.max(0, into / c.fadeIn);
  }
  if (c.fadeOut > 0) {
    const left = clipEnd(c) - t;
    if (left < c.fadeOut) g *= Math.max(0, left / c.fadeOut);
  }
  return Math.max(0, Math.min(1, g));
}

/** Total timeline length implied by the clips. */
export function projectDuration(tracks: TimelineTrack[], min = 5): number {
  let end = 0;
  for (const t of tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return Math.max(end, min);
}

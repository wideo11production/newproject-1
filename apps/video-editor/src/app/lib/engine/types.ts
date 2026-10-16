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

// ============================================================================
// VIDEO EFFECTS - AI-driven per-clip effects applied by the compositor
// ============================================================================

export type VideoEffectType =
  | 'chroma-key'
  | 'water-ripple'
  | 'water-reflection'
  | 'background-remove'
  | 'blur-mask'
  | 'color-shift'
  | 'glitch'
  | 'vignette'
  | 'film-grain'
  | 'slow-motion'
  | 'stabilize';

export interface VideoEffect {
  id: string;
  type: VideoEffectType;
  enabled: boolean;
  /** Effect-specific parameters, stored as key-value pairs. */
  params: Record<string, number | string | boolean>;
  /** When this effect was applied (timestamp). */
  appliedAt: number;
  /** AI prompt that generated this effect, if any. */
  sourcePrompt?: string;
}

export interface ChromaKeyParams {
  keyColor: { r: number; g: number; b: number };
  tolerance: number;
  softness: number;
  spillSuppression: number;
  replaceWith: 'transparent' | 'color' | 'image';
  replaceColor: { r: number; g: number; b: number };
  replaceImageUrl?: string;
}

export interface WaterRippleParams {
  amplitude: number;
  frequency: number;
  speed: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface WaterReflectionParams {
  intensity: number;
  waveHeight: number;
  waveSpeed: number;
  reflectionHeight: number;
}

export interface BackgroundRemoveParams {
  method: 'chroma' | 'ai-segmentation';
  tolerance: number;
  edgeFeather: number;
  backgroundImageUrl?: string;
  backgroundColor: { r: number; g: number; b: number };
}

export interface TemplateClip {
  id: string;
  name: string;
  thumbnail?: string;
  /** The full clip state saved as a template - transform, filter, effects. */
  clipState: Partial<TimelineClip>;
  /** Frames this template applies to (per-frame template). */
  frameRange?: { startFrame: number; endFrame: number };
  createdAt: number;
  usageCount: number;
}

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

/**
 * A curated font catalogue. Each entry is a CSS `font-family` string the
 * compositor writes straight into `ctx.font`, so what you pick is what you
 * get — there is no fallback guessing at render time.
 *
 * The list is the same one the Titles panel offers, so adding a font here is
 * adding it everywhere: the panel, the inspector and the export.
 */
export const TEXT_FONTS: Array<{ id: string; label: string; family: string }> = [
  { id: 'system', label: 'System UI', family: 'system-ui, Segoe UI, Roboto, sans-serif' },
  { id: 'inter', label: 'Inter', family: '"Inter", system-ui, sans-serif' },
  { id: 'montserrat', label: 'Montserrat', family: '"Montserrat", system-ui, sans-serif' },
  { id: 'raleway', label: 'Raleway', family: '"Raleway", system-ui, sans-serif' },
  { id: 'poppins', label: 'Poppins', family: '"Poppins", system-ui, sans-serif' },
  { id: 'roboto', label: 'Roboto', family: '"Roboto", system-ui, sans-serif' },
  { id: 'open-sans', label: 'Open Sans', family: '"Open Sans", system-ui, sans-serif' },
  { id: 'lato', label: 'Lato', family: '"Lato", system-ui, sans-serif' },
  { id: 'oswald', label: 'Oswald', family: '"Oswald", system-ui, sans-serif' },
  { id: 'bebas', label: 'Bebas Neue', family: '"Bebas Neue", system-ui, sans-serif' },
  { id: 'playfair', label: 'Playfair', family: '"Playfair Display", Georgia, serif' },
  { id: 'merriweather', label: 'Merriweather', family: '"Merriweather", Georgia, serif' },
  { id: 'mono', label: 'Mono', family: '"JetBrains Mono", "SF Mono", Menlo, monospace' },
];

/** Resolve a stored font id (or an arbitrary family string) to a CSS family. */
export function fontFamilyFor(id: string): string {
  return TEXT_FONTS.find((f) => f.id === id)?.family ?? id;
}

/** Resolve a stored font id to its catalogue entry, or null for a custom string. */
export function fontEntryFor(id: string) {
  return TEXT_FONTS.find((f) => f.id === id) ?? null;
}

/**
 * Word-level animation presets.
 *
 * Each one is a CSS-like transform envelope the compositor evaluates per
 * frame, so the same animation reads identically in preview and export. The
 * `kind` is the single dispatch key; the remaining fields are parameters.
 */
export type TextAnimationKind =
  | 'none'
  | 'fade'
  | 'typewriter'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'scale-in'
  | 'bounce'
  | 'rotate-in'
  | 'wave'
  | 'fade-up';

export interface TextAnimation {
  kind: TextAnimationKind;
  /** 0..1. Duration of the entrance, as a fraction of the clip. */
  duration: number;
  /** 0..1. Delay before the entrance starts, as a fraction of the clip. */
  delay: number;
  /** True once the entrance has finished; the clip then holds its final state. */
  loop: boolean;
}

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  kind: 'none',
  duration: 0.3,
  delay: 0,
  loop: false,
};

export interface TextClipStyle {
  content: string;
  /** Id into `TEXT_FONTS`, or a raw CSS family string for custom fonts. */
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
  /** Outline drawn around every glyph, in px. 0 = off. */
  outlineWidth: number;
  /** Outline colour. */
  outlineColor: string;
  /** Outer glow: blur radius in px. 0 = off. */
  glowWidth: number;
  /** Outer glow colour. */
  glowColor: string;
  /** Word-level entrance animation. */
  animation: TextAnimation;
}

export const DEFAULT_TEXT_STYLE: TextClipStyle = {
  content: 'Text',
  fontFamily: 'system',
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
  outlineWidth: 0,
  outlineColor: '#000000',
  glowWidth: 0,
  glowColor: '#ff6500',
  animation: DEFAULT_TEXT_ANIMATION,
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

  /** Reference to a FrameTemplate if this clip uses per-frame editing. */
  frameTemplateId?: string | null;

  /** Video effects applied to this clip - processed by the compositor per-frame. */
  videoEffects?: VideoEffect[];

  /** Expressions keyed by property name. The compositor evaluates each on every
   *  frame during preview and export. Stored as strings so they survive save/load
   *  and undo/redo like every other clip field. */
  expressions?: Record<string, string>;

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

/**
 * A single-frame overlay: a text title, sticker, or expression that occupies
 * exactly ONE frame on the timeline.
 *
 * This is the core primitive of AURA Micro-Frame Studio: instead of a clip that
 * spans seconds, an overlay is pinned to a single frame index and clamps its
 * visual representation to that frame's boundary. Movavi handles this via
 * "title clips" that snap to frame boundaries; here we make it explicit in the
 * type system so the compositor and the timeline agree.
 */
export interface FrameOverlay {
  /** Unique identifier for this overlay instance. */
  id: string;
  /** The frame index this overlay is clamped to. */
  frame: number;
  /** Start time in seconds (derived from `frame / fps`). */
  startTime: number;
  /** Duration in seconds — always exactly one frame. */
  duration: number;
  /** The media content: text content, image URL, or expression blob. */
  content: string;
  /** Visual type of the overlay. */
  kind: 'text' | 'image' | 'expression';
  /** Opacity 0..1. */
  opacity: number;
  /** Transform for positioning/scaling on the frame. */
  transform: ClipTransform;
  /** Text style when kind === 'text'. */
  textStyle?: TextClipStyle;
  /** Effect names applied to this overlay. */
  effects: string[];
}

/**
 * An overlay track: a lane that carries FrameOverlay items clamped to
 * single-frame durations.
 *
 * Visually distinct from base tracks: drawn above the base layer with its own
 * opacity, corner, and size transform — same as LayerRole.overlay, but scoped
 * to single-frame keyframes.
 */
export interface OverlayTrack extends TimelineTrack {
  /** Overlay items carried on this track, each pinned to a single frame. */
  overlays: FrameOverlay[];
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
    frameTemplateId: raw.frameTemplateId ?? null,
    videoEffects: raw.videoEffects ?? [],
    expressions: raw.expressions ?? {},
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

// ============================================================================
// PER-FRAME TEMPLATE SYSTEM - Frame-by-frame editable template data model
// ============================================================================
//
// Each clip on the timeline can own a FrameTemplate: a stack of frames,
// each frame carrying up to 5 layers (Image, Text, Shape, Video, Mask).
// Frames share a synced size (default 3x normal). Clicking a layer opens
// an isolated editor box for that element. Templates are reusable and
// savable as .wido-template JSON.
//
// Default frame size = 3x normal editor size for premium look.
// Max layers per frame = 5.
// Resize handles: min 100px, max 500px width per frame thumbnail.
// ============================================================================

export type LayerType = 'image' | 'text' | 'shape' | 'video' | 'mask';

export interface FrameSize {
  width: number;   // pixels
  height: number;  // pixels
}

export interface FrameTransform {
  x: number;   // 0..1 center fraction
  y: number;   // 0..1 center fraction
  scale: number; // 1 = 100%
  rotation: number; // degrees
}

export interface FrameMask {
  id: string;
  /** Bezier path points as [{x, y}, ...] in normalized 0..1 coords. */
  points: Array<{ x: number; y: number }>;
  feather: number; // 0..100 px
  invert: boolean; // invert mask (reveal outside instead of inside)
  opacity: number; // 0..1 mask opacity
}

export interface FrameLayer {
  id: string;
  type: LayerType;
  /** Element content: image URL, text string, or shape data. */
  content: string;
  /** Position/scale on the frame. */
  transform: FrameTransform;
  /** Layer opacity 0..1. */
  opacity: number;
  /** Z-order: higher = drawn on top. */
  zIndex: number;
  /** Visible toggle. */
  visible: boolean;
  /** Locked - cannot be edited. */
  locked: boolean;
  /** Optional mask applied to this layer. */
  maskId?: string | null;
  /** When true, this layer is being edited in isolated box. */
  isolated: boolean;
}

export interface Frame {
  /** Frame index within the template. */
  index: number;
  /** Start time in seconds (derived from index / fps). */
  startTime: number;
  /** Duration - always exactly one frame. */
  duration: number;
  /** Layers on this frame (max 5 enforced at UI level). */
  layers: FrameLayer[];
  /** Masks available to layers on this frame. */
  masks: FrameMask[];
  /** Frame-specific size override (if sizeLocked is false). */
  size?: FrameSize;
}

export interface FrameTemplate {
  id: string;
  name: string;
  /** Thumbnail data URL for the template tile. */
  thumbnail?: string;
  /** Shared size across all frames when sizeLocked is true. */
  frameSize: FrameSize;
  /** When true, resizing one frame resizes all frames. */
  sizeLocked: boolean;
  /** All frames in the template. */
  frames: Frame[];
  /** Currently active frame index for editing. */
  activeFrameIndex: number;
  /** Created timestamp. */
  createdAt: number;
  /** Last modified timestamp. */
  updatedAt: number;
  /** Usage count across projects. */
  usageCount: number;
  /** Source clip this template was generated from. */
  sourceClipId?: string | null;
}

export interface TemplateStoreState {
  templates: FrameTemplate[];
  activeTemplateId: string | null;
  addTemplate: (template: Omit<FrameTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>) => string;
  getTemplate: (id: string) => FrameTemplate | null;
  getAllTemplates: () => FrameTemplate[];
  deleteTemplate: (id: string) => boolean;
  setActiveTemplate: (id: string | null) => void;
  setActiveFrame: (templateId: string, frameIndex: number) => void;
  addLayer: (templateId: string, frameIndex: number, layer: Omit<FrameLayer, 'id' | 'isolated'>) => void;
  removeLayer: (templateId: string, frameIndex: number, layerId: string) => void;
  updateLayer: (templateId: string, frameIndex: number, layerId: string, updates: Partial<FrameLayer>) => void;
  addMask: (templateId: string, frameIndex: number, mask: Omit<FrameMask, 'id'>) => void;
  updateMask: (templateId: string, frameIndex: number, maskId: string, updates: Partial<FrameMask>) => void;
  resizeFrameSize: (templateId: string, size: FrameSize) => void;
  toggleSizeLock: (templateId: string) => void;
  toggleLayerIsolated: (templateId: string, frameIndex: number, layerId: string) => void;
  exportTemplate: (id: string) => string;
  importTemplate: (json: string) => string | null;
}

/** Default frame size - 3x normal (premium look per user request). */
export const DEFAULT_FRAME_SIZE: FrameSize = { width: 1920 * 3, height: 1080 * 3 };

/** Minimum frame thumbnail resize width. */
export const MIN_FRAME_WIDTH = 100;
/** Maximum frame thumbnail resize width. */
export const MAX_FRAME_WIDTH = 500;
/** Maximum layers per frame. */
export const MAX_LAYERS_PER_FRAME = 5;

export const DEFAULT_FRAME_TRANSFORM: FrameTransform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
};

export const DEFAULT_FRAME_LAYER: Omit<FrameLayer, 'id' | 'isolated'> = {
  type: 'image',
  content: '',
  transform: { ...DEFAULT_FRAME_TRANSFORM },
  opacity: 1,
  zIndex: 0,
  visible: true,
  locked: false,
  maskId: null,
};

/** Create a blank frame template for a given clip duration and fps. */
export function createBlankFrameTemplate(
  name: string,
  clipDurationSeconds: number,
  fps: number,
  sourceClipId?: string | null
): Omit<FrameTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'> {
  const totalFrames = Math.max(1, Math.ceil(clipDurationSeconds * fps));
  const frames: Frame[] = [];
  for (let i = 0; i < totalFrames; i++) {
    frames.push({
      index: i,
      startTime: i / fps,
      duration: 1 / fps,
      layers: [],
      masks: [],
      size: { ...DEFAULT_FRAME_SIZE },
    });
  }
  return {
    name,
    frameSize: { ...DEFAULT_FRAME_SIZE },
    sizeLocked: true,
    frames,
    activeFrameIndex: 0,
    sourceClipId,
  };
}

/** Get the active frame from a template. */
export function getActiveFrame(template: FrameTemplate): Frame | null {
  return template.frames[template.activeFrameIndex] ?? null;
}

/** Get layers of the active frame. */
export function getActiveFrameLayers(template: FrameTemplate): FrameLayer[] {
  const frame = getActiveFrame(template);
  return frame ? frame.layers : [];
}

/** Get masks of the active frame. */
export function getActiveFrameMasks(template: FrameTemplate): FrameMask[] {
  const frame = getActiveFrame(template);
  return frame ? frame.masks : [];
}

/** Validate layer count does not exceed max. */
export function canAddLayer(frame: Frame): boolean {
  return frame.layers.length < MAX_LAYERS_PER_FRAME;
}

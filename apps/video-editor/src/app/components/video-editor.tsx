'use client';

// ============================================================================
// Video editor shell
// ============================================================================
//
// Layout (Movavi / Resolve style), top to bottom:
//
//   [ menu bar + toolbar ]
//   [ rail | panel      | preview          ]   top
//                       [ player controls  ]
//   [ timeline, FULL WIDTH                  ]   bottom
//   [ status strip                        ]
//
// The full-width timeline is the defining structural feature: a timeline's
// width IS its value, and a clip whose end you cannot see is a clip you cannot
// cut precisely.
//
// ---- WHERE STATE LIVES, AND WHY THE SETTINGS ARE NOT IN IT ----
//
// Two stores with different jobs:
//
// * `lib/engine/settings.ts` - the WORKSPACE. Zoom, scroll, panel sizes, lane
//   heights, frame rate, snapping, theme, playback rate, last project. Read
//   and written through `useSettings`, which is backed by localStorage and
//   restores DURING the first render, so there is no frame where the editor is
//   drawn at the wrong zoom and then corrected. None of it is React state,
//   because React state is what "resets on refresh" is made of.
//
// * The hooks below - the PROJECT. Tracks, clips, transitions, markers,
//   selection, undo. Held here, snapshotted for undo, and written to
//   IndexedDB by `project-store`.
//
// ---- WHY UNDO IS "RESTORE THIS SNAPSHOT" ----
//
// Undo is one assignment that cannot be wrong. The alternative - an inverse
// operation per edit - is where undo systems drift: the two implementations
// disagree and undo produces a project that never existed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TimelineTracks,
  TrackHeaders,
  TrackAddMenu,
  TimelineFooter,
  acceptsTrack,
  TRACK_HEADER_W,
  type SnapOptionsProp,
  type TimelineClip,
  type TimelineTrack,
  type TrackType,
  type Transition,
} from './timeline/timeline-tracks';
import { ModeRail, type EditorMode } from './sidebar/mode-rail';
import { PlayerBar } from './player-bar';
import { EditorToolbar } from './chrome/editor-toolbar';
import { useSession } from '../lib/session';
import { TimelineToolbar } from './chrome/timeline-toolbar';
import { RecorderDialog } from './chrome/recorder-dialog';
import { TimelineRuler, RULER_HEIGHT } from './timeline/timeline-ruler';
import { TimelineRail } from './timeline/timeline-rail';
import { PreviewCanvas } from './preview/preview-canvas';
import { ResizableHandle, useClampToViewport } from './layout/resizable';
import { MediaBin } from './panels/media-bin';
import { TransitionsPanel } from './panels/transitions-panel';
import { TemplatesPanel } from './panels/templates-panel';
import { FiltersPanel, TitlesPanel, StickersPanel, PanZoomPanel, LayoutsPanel } from './panels/style-panels';
import { AudioPanel } from './panels/audio-panel';
import { ExpressionsPanel } from './panels/expressions-panel';
import { trackClick, startClickTracking } from '@/lib/click-tracker';
import { PluginsPanel } from './panels/plugins-panel';
import { Layers } from 'lucide-react';
import { ProjectPanel } from './panels/project-panel';
import { FrameTemplateEditor } from './frame-template/FrameTemplateEditor';
import type { FrameTemplate } from '../lib/engine/types';
import {
  SamplesPanel,
  BackgroundsPanel,
  IntrosPanel,
  EffectsPanel,
  ToolsPanel,
} from './panels/additional-panels';
import { BrandingPanel } from './panels/branding-panel';
import { ClipProperties } from './inspector/clip-properties';
import { ExportDialog } from './export/export-dialog';
import { HelpPanel } from './panels/help-panel';
import { DeletedClip } from './recover-dialog';
import { ConfirmationDialog } from './confirmation-dialog';
import { RecoverDialog } from './recover-dialog';
import { AuraMicroFrameStudio } from './aura-micro-frame-studio';
import { AIPromptStudio } from './chrome/ai-prompt-studio';
import AuraFpsGate from './chrome/AuraFpsGate';
import { FrameTemplateNodes } from './timeline/FrameTemplateNodes';
import { MediaPlayerCanvasOverlay } from './preview/MediaPlayerCanvasOverlay';
import { AURA_MAX_FPS } from '../lib/plan';
import { stereoLevels } from '../lib/engine/audio-graph';
import { Compositor } from '../lib/engine/compositor';
import { extractPeaks } from '../lib/engine/waveform';
import { useMediaStore, type MediaItem, type MediaKind } from '../lib/engine/media-store';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRACKS,
  DEFAULT_TRANSFORM,
  NEUTRAL_FILTER,
  PROJECT_VERSION,
  clipAt,
  clipEnd,
  nextId,
  normaliseProject,
  projectDuration,
  type ClipFilter,
  type ClipTransform,
  type ProjectDoc,
  type ProjectSettings,
  type TextClipStyle,
  type TransitionType,
} from '../lib/engine/types';
import { DEFAULT_TRANSITION_DURATION } from '../lib/engine/transitions';
import {
  clampPxPerFrame,
  coerceFps,
  coerceFpsTo,
  frameToSeconds,
  rescalePxPerFrame,
  secondsToFrame,
  timecode,
} from '../lib/engine/frames';
import { useSettings, setSettings, getSettings, hydrateSettings } from '../lib/engine/settings';
import { nextMarkerId, nextMarker, prevMarker, type Marker } from '../lib/engine/markers';
import { MIN_CLIP_FRAMES, rippleTrim, roll, slide, slip, extendBranding } from '../lib/engine/edits';
import { attach } from '../lib/engine/attach';
import { buildCompositorSources } from '../lib/engine/sources';
import {
  loadProject,
  saveProject,
  setLastOpenedId,
  lastOpenedId,
  parseProjectFile,
  type SaveResult,
} from '../lib/engine/project-store';
import { isEditorKey } from '../lib/shortcuts';

// Bounds are product decisions, not defaults.
const BIN = { min: 200, max: 480 };
const TIMELINE = { min: 140, max: 620 };
const FOOTER = { min: 18, max: 48 };

/**
 * The clip the playhead is inside, across every track.
 *
 * `clipAt` is per-track; this is the version the player bar needs, because the
 * frame-data read-out has to say which frame of WHICH file is on screen and a
 * two-track timeline has two answers.
 */
function clipUnderPlayhead(tracks: TimelineTrack[], time: number): TimelineClip | null {
  let hit: TimelineClip | null = null;
  for (const track of tracks) {
    const c = clipAt(track, time);
    // Bottom lane first, so a top-lane title does not hide the picture's own
    // source frame - the picture is what the read-out is about.
    if (c && (!hit || track.role === 'base')) hit = c;
  }
  return hit;
}

export function VideoEditor() {
  const media = useMediaStore();
  // AURA gate ke liye session identity (editor twin me wahi superadmin+env
  // guard lagta hai jo web dialog me hai — review finding #2 ka fix).
  const { session } = useSession();

  // ---- Persistent workspace ----
  // One hook for all of it. `settings.fps` is the timeline's rate: a 2 second
  // clip is 48 frames at 24 and 120 at 60, so which rate is in force changes
  // what every number on the timeline means.
  const [settings, patch] = useSettings();

  // ---- THE PLAN'S FRAME-RATE CEILING ----
  //
  // `session.maxFps` is the plan's `max_fps` capability: 60 on every plan except
  // the AURA lifetime plan, which is 240. It is read from the same server route
  // that answers the access gate, so it cannot disagree with the dashboard, and
  // it arrives as 60 until the server answers — which is also the value the
  // hydration render sees, so a slow read never flashes a rate the plan may not
  // grant.
  const maxFps = session.maxFps ?? 60;

  // The rate in force is the saved one CLAMPED to the plan. Not the saved one:
  // a project saved at 240fps on AURA and reopened on a 60fps plan would
  // otherwise keep counting at 240 while every dropdown on screen offered
  // nothing above 60 — the timeline would be showing frame numbers the user
  // cannot select, and the ruler would disagree with the toolbar.
  const fps = coerceFpsTo(settings.fps, maxFps);

  // ---- Project ----
  const [projectId, setProjectId] = useState('p-welcome');
  const [projectName, setProjectName] = useState('Untitled project');
  const [resolution, setResolution] = useState({ width: 1280, height: 720 });
  const [background, setBackground] = useState('#000000');
  const [tracks, setTracks] = useState<TimelineTrack[]>(DEFAULT_TRACKS);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [playheadFrame, setPlayheadFrame] = useState(getSettings().playheadFrame);
  const [playing, setPlaying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TimelineClip[]>([]);
  const [history, setHistory] = useState<TimelineTrack[][]>([]);
  const [future, setFuture] = useState<TimelineTrack[][]>([]);

  const [mode, setMode] = useState<EditorMode>(() => (getSettings().activeMode as EditorMode) ?? 'media');
  const [shuttle, setShuttle] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [clipToDelete, setClipToDelete] = useState<string | null>(null);
  const [clipsToDelete, setClipsToDelete] = useState<Set<string>>(new Set());
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [transitionToDelete, setTransitionToDelete] = useState<string | null>(null);
  const [markerToDelete, setMarkerToDelete] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState(false);
  const [recoveredClips, setRecoveredClips] = useState<DeletedClip[]>([]);
  const [showRecoverDialog, setShowRecoverDialog] = useState(false);
const [showAuraStudio, setShowAuraStudio] = useState(false);
  const [showAIPromptStudio, setShowAIPromptStudio] = useState(false);
  const [showFrameTemplateEditor, setShowFrameTemplateEditor] = useState(false);
  const [frameTemplateClipId, setFrameTemplateClipId] = useState<string | null>(null);
  const [activeFrameTemplate, setActiveFrameTemplate] = useState<FrameTemplate | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState({ startFrame: 0, endFrame: 100 });
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [previewClip, setPreviewClip] = useState<TimelineClip | null>(null);
  const [hoverClipFrame, setHoverClipFrame] = useState<number | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [hoveredFrameIndex, setHoveredFrameIndex] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const laneScrollRef = useRef<HTMLDivElement | null>(null);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const bladeRef = useRef<(() => string | null) | null>(null);
  const patchStamp = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const playheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pxPerFrame = clampPxPerFrame(settings.pxPerFrame);
  const duration = useMemo(() => projectDuration(tracks, 5), [tracks]);
  const durationFrames = Math.max(1, Math.round(duration * fps));
  const laneWidth = Math.max(durationFrames * pxPerFrame, 200);
  const playheadSeconds = playheadFrame / fps;

// Feature flag check for AURA Micro-Frame Studio
  const isAuraStudioEnabled = process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';

  // Feature flag check for AI Prompt Studio (separate env var)
  const isAIPromptStudioEnabled = process.env.NEXT_PUBLIC_AI_PROMPT_STUDIO_ENABLED === 'true' || process.env.NEXT_PUBLIC_AURA_MICRO_FRAME_STUDIO_ENABLED === 'true';

  /** The playhead, persisted.
   *
   *  Debounced rather than written per frame: playback moves this sixty times a
   *  second and a synchronous localStorage write per frame is what turns a
   *  smooth playhead into a stuttering one. The write happens when the user
   *  pauses, seeks, or edits - which are the moments "where was I" is asked.
   */
  const setPlayhead = useCallback(
    (frame: number) => {
      const next = Math.max(0, Math.min(Math.round(frame), durationFrames));
      setPlayheadFrame(next);
      if (playheadTimer.current) clearTimeout(playheadTimer.current);
      playheadTimer.current = setTimeout(() => setSettings({ playheadFrame: next }), 400);
    },
    [durationFrames]
  );

  const seekTo = useCallback((time: number) => setPlayhead(secondsToFrame(time, fps)), [setPlayhead, fps]);

  // ---- Undo ----
  // Nesting a setter inside another setter's updater is the bug this shape
  // avoids: React may invoke an updater twice, and on the second invocation
  // `prev` is already the NEW state, so the "before" snapshot captured the new
  // state and undo restored the new state. Every observable signal said success
  // while nothing moved.
  const applyEdit = useCallback((before: TimelineTrack[], after: TimelineTrack[]) => {
    setHistory((h) => [...h.slice(-49), before]);
    setFuture([]);
    setTracks(after);
    setDirty(true);
  }, []);

  const commit = useCallback((next: TimelineTrack[]) => applyEdit(tracks, next), [applyEdit, tracks]);

  /**
   * Commit SEVERAL changes as ONE edit, computed from the state as it is when the
   * update runs.
   *
   * `commit(next)` takes the next state as a value, and the only state it has is
   * the `tracks` captured when the callback was last created. So two `commit`
   * calls in one handler both compute from the same snapshot and the second
   * overwrites the first.
   *
   * That is not hypothetical: "Keep to timeline" in separate mode adds a camera
   * clip and a voiceover clip in a single handler, and only the second one ever
   * existed. The user asked for two clips and got one, with no error.
   *
   * The updater form fixes it — each change sees the previous one's result — while
   * `history` still gets the state from BEFORE the whole batch, so one undo
   * reverses the batch rather than half of it.
   */
  const commitFrom = useCallback(
    (update: (prev: TimelineTrack[]) => TimelineTrack[]) => {
      setHistory((h) => [...h.slice(-49), tracks]);
      setFuture([]);
      setTracks((prev) => update(prev));
      setDirty(true);
    },
    [tracks]
  );

  const docSnapshot = useCallback(
    (): ProjectDoc => ({
      // `PROJECT_VERSION`, not a literal.
      //
      // This was `3` while `engine/types.ts` exports `PROJECT_VERSION = 2`. The
      // two disagreed in a way that was invisible and corrupting: every document
      // saved by the editor was written as version 3, and `normaliseProject` -
      // which is what runs on load and on import - overwrites `version` with
      // `PROJECT_VERSION`, so it came back as 2 on the very next read.
      //
      // Consequences: every save wrote a number that no reader believed, and any
      // migration keyed on `version` would have had no correct input to key on -
      // the value in the file was never the value in memory. Two projects exported
      // from the editor disagreed with two projects imported by it.
      //
      // Referencing the constant means the two cannot drift again: there is one
      // number, and TypeScript fails the build if the shape it describes changes.
      // `project-panel.tsx`'s `makeDoc` had the same literal and the same fix.
      version: PROJECT_VERSION,
      id: projectId,
      settings: { name: projectName, width: resolution.width, height: resolution.height, fps, background },
      tracks,
      transitions,
      markers,
      history,
      future,
      savedAt: Date.now(),
      duration,
    }),
    [projectId, projectName, resolution, fps, background, tracks, transitions, markers, history, future, duration]
  );

  const undo = useCallback(() => {
    if (history.length === 0) {
      setToast('Nothing to undo');
      return;
    }
    const before = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture([...future, tracks]);
    setTracks(before);
    setSelectedIds(new Set());
    setSelectedTransitionId(null);
    setToast('Undone');
  }, [history, future, tracks]);

  const redo = useCallback(() => {
    if (future.length === 0) {
      setToast('Nothing to redo');
      return;
    }
    const next = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setHistory([...history, tracks]);
    setTracks(next);
    setSelectedIds(new Set());
    setToast('Redone');
  }, [future, history, tracks]);

  const clipById = useMemo(() => {
    const map = new Map<string, { clip: TimelineClip; track: TimelineTrack }>();
    for (const t of tracks) for (const c of t.clips) map.set(c.id, { clip: c, track: t });
    return map;
  }, [tracks]);

  const selectedClip = inspecting ? clipById.get(inspecting)?.clip ?? null : null;
  const selectedIdsArr = useMemo(() => [...selectedIds], [selectedIds]);
  const panelClip = selectedIdsArr.length ? clipById.get(selectedIdsArr[0])?.clip ?? null : null;

  const setSelect = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setSelectedTransitionId(null);
  }, []);

  // ---- Waveforms ----
  const needPeaks = useCallback(
    (mediaId: string, url: string) => {
      void extractPeaks(url).then((peaks) => {
        if (!peaks) return;
        media.setPeaks(mediaId, peaks);
        setTracks((prev) =>
          prev.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.mediaId === mediaId ? { ...c, peaks } : c)),
          }))
        );
      });
    },
    [media.setPeaks]
  );

  // ---- Adding media ----
  const makeClip = useCallback((item: MediaItem, type: TrackType, startFrame: number, lengthFramesN: number): TimelineClip => ({
    id: nextId('clip'),
    mediaId: item.id,
    mediaName: item.name,
    startTime: frameToSeconds(startFrame, fps),
    duration: frameToSeconds(lengthFramesN, fps),
    type,
    thumbnail: item.kind === 'image' ? item.url : (item.poster ?? item.url),
    url: item.url,
    poster: item.poster ?? undefined,
    effects: [],
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0,
    filter: { ...NEUTRAL_FILTER },
    transform: { ...DEFAULT_TRANSFORM },
    linkedId: null,
  }), [fps]);

  const addToTracks = useCallback((after: TimelineTrack[], trackId: string, clip: TimelineClip): TimelineTrack[] => {
    let placed = false;
    const out = after.map((t) => {
      if (t.id !== trackId || placed) return t;
      placed = true;
      return { ...t, clips: [...t.clips, clip].sort((a, b) => a.startTime - b.startTime) };
    });
    return placed ? out : after;
  }, []);

  // Pure, so it can be called on the STATE INSIDE a batched update rather than
  // only on the snapshot the callback captured.
  const pickTrack = useCallback(
    (list: TimelineTrack[], type: TrackType, role: 'base' | 'overlay' = 'base') =>
      list.find((t) => t.type === type && t.role === role) ??
      list.find((t) => t.type === type) ??
      list[0],
    []
  );

  const firstTrackOf = useCallback(
    (type: TrackType, role: 'base' | 'overlay' = 'base') => pickTrack(tracks, type, role),
    [pickTrack, tracks]
  );

  /** Track type a media kind lands on. One place, so batch and single agree. */
  const trackTypeOf = useCallback((kind: MediaKind): TrackType => {
    return kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : kind === 'image' ? 'image' : 'video';
  }, []);

  const addMedia = useCallback(
    (item: MediaItem, trackId?: string, atFrame?: number) => {
      const type = trackTypeOf(item.kind);
      const target = trackId ? tracks.find((t) => t.id === trackId) : firstTrackOf(type);
      if (!target) {
        setToast(`There is no track to put “${item.name}” on`);
        return;
      }
      if (!acceptsTrack(type, target.type)) {
        setToast(`A ${type} item cannot go on ${target.name} (${target.type})`);
        return;
      }
      const lenFrames = item.duration && item.duration > 0 ? Math.round(item.duration * fps) : fps * 5;
      const start = Math.max(0, atFrame ?? playheadFrame);
      const clip = makeClip(item, type, start, lenFrames);
      commitFrom((prev) => extendBranding(addToTracks(prev, target.id, clip), (start + lenFrames + 1) / fps));
      setSelectedIds(new Set([clip.id]));
      setToast(`Added “${item.name}” to ${target.name} at frame ${start} (${timecode(frameToSeconds(start, fps), fps)})`);
    },
    [tracks, playheadFrame, firstTrackOf, makeClip, addToTracks, commitFrom, trackTypeOf, fps]
  );

  /**
   * Add several clips in one action, and one undo step.
   *
   * Used by the two features that produce more than one clip at a time: a
   * recording kept as separate camera + voiceover, and silence removal. Both were
   * calling `addMedia` in a loop, where each call rebuilt the track list from the
   * same captured snapshot and only the last survived.
   *
   * It also refuses to drop a clip quietly. The old code returned early when no
   * suitable track existed, so a second clip could simply never appear.
   */
  const addMediaBatch = useCallback(
    (list: MediaItem[], atFrame?: number) => {
      if (!list.length) return;
      const start = Math.max(0, atFrame ?? playheadFrame);
      const placed: Array<{ clip: TimelineClip; trackName: string }> = [];
      const refused: string[] = [];

      commitFrom((prev) => {
        let next = prev;
        for (const item of list) {
          const type = trackTypeOf(item.kind);
          // Resolved against `next`, so a second video clip still sees the track
          // list as the first one left it.
          const target = pickTrack(next, type);
          if (!target) {
            refused.push(item.name);
            continue;
          }
          if (!acceptsTrack(type, target.type)) {
            refused.push(`${item.name} (needs a ${type} track, ${target.name} is ${target.type})`);
            continue;
          }
const lenFrames = item.duration && item.duration > 0 ? Math.round(item.duration * fps) : fps * 5;
      const clip = makeClip(item, type, start, lenFrames);
      next = addToTracks(next, target.id, clip);
      // The logo follows the timeline, so a clip added past the end of the
      // branding overlay still gets one. Same history entry as the add, so one
      // undo takes back both.
      next = extendBranding(next, (start + lenFrames + 1) / fps);
      placed.push({ clip, trackName: target.name });
        }
        return next;
      });

      if (placed.length) setSelectedIds(new Set([placed[placed.length - 1].clip.id]));

      if (refused.length) {
        // Named, because a clip that never arrived is otherwise indistinguishable
        // from one the app forgot.
        setToast(`Could not add ${refused.join(', ')} — no matching track`);
      } else {
        setToast(`Added ${placed.length} recording${placed.length === 1 ? '' : 's'} at frame ${start}`);
      }
    },
    [playheadFrame, pickTrack, trackTypeOf, makeClip, addToTracks, commitFrom, fps]
  );

  const addText = useCallback(
    (style: Partial<TextClipStyle>, transform?: Partial<ClipTransform>) => {
      const target = firstTrackOf('text', 'overlay') ?? firstTrackOf('text');
      if (!target) return;
      const text: TextClipStyle = { ...DEFAULT_TEXT_STYLE, ...style };
      // A title has no media file behind it, so it is built directly rather
      // than through `makeClip`: there is no MediaItem to pass in, and
      // pretending otherwise would give the compositor a phantom source to look
      // up and fail to find.
      const clip: TimelineClip = {
        id: nextId('text'),
        mediaId: `text-${Date.now().toString(36)}`,
        mediaName: text.content,
        startTime: frameToSeconds(playheadFrame, fps),
        duration: frameToSeconds(fps * 4, fps),
        type: 'text',
        effects: [],
        sourceIn: 0,
        speed: 1,
        volume: 1,
        muted: false,
        opacity: 1,
        fadeIn: 0,
        fadeOut: 0,
        filter: { ...NEUTRAL_FILTER },
        transform: { ...DEFAULT_TRANSFORM, ...(transform ?? {}) },
        linkedId: null,
        text,
      };
      // A title can be the last thing on the timeline, so the logo is extended here too.
      commitFrom((prev) =>
        extendBranding(addToTracks(prev, target.id, clip), clip.startTime + clip.duration + 1 / fps)
      );
      setSelectedIds(new Set([clip.id]));
      setToast('Title added — edit the words in this panel');
    },
    [firstTrackOf, addToTracks, playheadFrame, commitFrom, fps]
  );

  const addTemplate = useCallback(
    (templateId: string, atFrame: number) => {
      const target = firstTrackOf('video', 'base') ?? firstTrackOf('video') ?? firstTrackOf('text');
      if (!target) {
        setToast('No video or text track to place the template on');
        return;
      }
      const clip: TimelineClip = {
        id: nextId('tmpl'),
        mediaId: `template:${templateId}`,
        mediaName: `Template: ${templateId}`,
        startTime: frameToSeconds(atFrame, fps),
        duration: 5,
        type: target.type,
        effects: [],
        sourceIn: 0,
        speed: 1,
        volume: 1,
        muted: false,
        opacity: 1,
        fadeIn: 0,
        fadeOut: 0,
        filter: { ...NEUTRAL_FILTER },
        transform: { ...DEFAULT_TRANSFORM },
        expressions: {},
        linkedId: null,
      };
      commitFrom((prev) => extendBranding(addToTracks(prev, target.id, clip), clip.startTime + clip.duration + 1 / fps));
      setSelectedIds(new Set([clip.id]));
      setMode('project');
      setToast(`Template "${templateId}" placed at frame ${atFrame}`);
    },
    [firstTrackOf, addToTracks, commitFrom, frameToSeconds, fps, setToast, setSelectedIds, setMode]
  );

  // ---- Clip editing ----
  const removeClipById = useCallback(
    (clipId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      setClipToDelete(clipId);
    },
    [clipById]
  );

  /** Delete clip with confirmation */
  const deleteClipById = useCallback(
    (clipId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      const next = tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
      commit(next);
      setSelectedIds((s) => {
        const n = new Set(s);
        n.delete(clipId);
        return n;
      });
      setClipToDelete(null);
      // Add to recovery bin
      const deletedClip: DeletedClip = {
        id: hit.clip.id,
        mediaId: hit.clip.mediaId,
        mediaName: hit.clip.mediaName,
        trackName: hit.track.name,
        startTime: hit.clip.startTime,
        duration: hit.clip.duration,
        deletedAt: Date.now(),
      };
      setRecoveredClips((prev) => [...prev, deletedClip]);
      setToast(`Clip "${hit.clip.mediaName}" removed and added to recovery bin`);
    },
    [clipById, tracks, commit]
  );

  /**
   * Delete, with an optional ripple.
   *
   * Ripple is a MODE rather than a separate command, because it is the same
   * gesture with a different consequence, and a toolbar with "delete" and
   * "ripple delete" invites the question of which one they want before they have
   * made the edit.
   */
  const removeSelected = useCallback(
    (ripple?: boolean) => {
      const doRipple = ripple ?? getSettings().rippleEnabled;
      if (!selectedIds.size) return;
      setClipsToDelete(new Set(selectedIds));
    },
    [selectedIds]
  );

  /** Delete selected clips with confirmation */
  const deleteSelected = useCallback(
    (ripple?: boolean) => {
      const doRipple = ripple ?? getSettings().rippleEnabled;
      if (!clipsToDelete.size) return;
      const selectedClips = Array.from(clipsToDelete);
      const count = selectedClips.length;
      const next = tracks.map((t) => {
        const gone = t.clips.filter((c) => selectedClips.includes(c.id));
        if (gone.length === 0) return t;
        const kept = t.clips.filter((c) => !selectedClips.includes(c.id));
        if (!doRipple) return { ...t, clips: kept };
        const total = gone.reduce((n, c) => n + Math.round(c.duration * fps), 0);
        const boundary = gone.reduce((m, c) => Math.max(m, Math.round(clipEnd(c) * fps)), 0);
        return {
          ...t,
          clips: kept.map((c) =>
            Math.round(c.startTime * fps) >= boundary
              ? { ...c, startTime: frameToSeconds(Math.round(c.startTime * fps) - total, fps) }
              : c
          ),
        };
      });
      commit(next);
      setSelectedIds(new Set());
      setInspecting(null);
      setClipsToDelete(new Set());
      // Add deleted clips to recovery bin
      selectedClips.forEach((clipId) => {
        const hit = clipById.get(clipId);
        if (hit) {
          const deletedClip: DeletedClip = {
            id: hit.clip.id,
            mediaId: hit.clip.mediaId,
            mediaName: hit.clip.mediaName,
            trackName: hit.track.name,
            startTime: hit.clip.startTime,
            duration: hit.clip.duration,
            deletedAt: Date.now(),
          };
          setRecoveredClips((prev) => [...prev, deletedClip]);
        }
      });
      setToast(doRipple ? `Ripple-deleted ${count} clip${count === 1 ? '' : 's'} and closed the gap` : `Deleted ${count} clip${count === 1 ? '' : 's'}`);
    },
    [clipsToDelete, tracks, commit, fps]
  );

  /**
   * Trim, in FRAMES. The only unit the timeline speaks.
   *
   * Clamped to TWO bounds, and the upper one is the interesting one:
   *
   *   MIN - one frame, because a zero-length clip is not a clip.
   *   MAX - the length the SOURCE FILE can actually supply. A clip cannot be
   *         longer than `mediaDuration - sourceIn`, or the tail of it is frames
   *         the decoder will never produce and the export will end on a frozen
   *         picture. Without this bound, dragging an out-edge past the end of
   *         the file silently extends the clip into footage that does not exist,
   *         and the timeline shows a duration the media can never deliver.
   */
  const trimClip = useCallback(
    (clipId: string, edge: 'in' | 'out', deltaFrames: number) => {
      setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            const item = media.byId.get(c.mediaId);
            const startFrame = Math.round(c.startTime * fps);
            const lengthFrames = Math.max(1, Math.round(c.duration * fps));
            // The media length is in seconds and the clip may be running at a
            // different rate, so the available SOURCE frames are what bound the
            // TIMELINE frames - at 2x a 3s file supplies 180 frames, not 90.
            const mediaFrames = item?.duration ? Math.round(item.duration * fps) : Number.POSITIVE_INFINITY;
            const maxLengthFrames = Math.max(MIN_CLIP_FRAMES, Math.floor((mediaFrames - Math.round(c.sourceIn * fps)) / Math.max(c.speed, 0.01)));

            if (edge === 'in') {
              const shift = Math.max(-startFrame, Math.min(deltaFrames, lengthFrames - MIN_CLIP_FRAMES));
              return {
                ...c,
                startTime: frameToSeconds(startFrame + shift, fps),
                duration: frameToSeconds(lengthFrames - shift, fps),
                // The source has to follow the in point, or trimming the head
                // would show the same frames for longer rather than starting
                // later in the file.
                sourceIn: Math.max(0, c.sourceIn + frameToSeconds(shift, fps)),
              };
            }
            return {
              ...c,
              duration: frameToSeconds(Math.min(maxLengthFrames, Math.max(MIN_CLIP_FRAMES, lengthFrames + deltaFrames)), fps),
            };
          }),
        }))
      );
    },
    [fps, media.byId]
  );

  const setFade = useCallback((clipId: string, edge: 'in' | 'out', seconds: number) => {
    setTracks((prev) =>
      prev.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          const capped = Math.max(0, Math.min(seconds, c.duration / 2));
          return edge === 'in' ? { ...c, fadeIn: capped } : { ...c, fadeOut: capped };
        }),
      }))
    );
  }, []);

  const patchClip = useCallback(
    (clipId: string, p: Partial<TimelineClip>, coalesceKey?: string) => {
      const before = tracks;
      const after = before.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...p } : c)) }));
      // A slider dragged across twenty positions is ONE edit, not twenty.
      // Coalescing by (clip, gesture) inside a short window is what stops the
      // undo stack filling with half-second increments.
      const now = Date.now();
      const key = `${clipId}:${coalesceKey ?? ''}`;
      const sameRun = patchStamp.current.id === key && now - patchStamp.current.at < 1200;
      patchStamp.current = { id: key, at: now };
      if (sameRun) setTracks(after);
      else applyEdit(before, after);
    },
    [tracks, applyEdit]
  );

  const stampTemplate = useCallback(
    (templateId: string, clipId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      patchClip(clipId, { effects: [...hit.clip.effects.filter((e) => !e.startsWith('template:')), `template:${templateId}`] }, 'template');
      setToast(`Template "${templateId}" stamped onto "${hit.clip.mediaName}"`);
    },
     [patchClip, clipById, setToast]
  );

  // ---- Intros Panel handlers ----
  const addIntro = useCallback(
    (introId: string, atFrame: number) => {
      const target = firstTrackOf('video', 'base') ?? firstTrackOf('video') ?? firstTrackOf('text');
      if (!target) {
        setToast('No video or text track to place the intro on');
        return;
      }
      const introClip: TimelineClip = {
        id: nextId('intro'),
        mediaId: `intro:${introId}`,
        mediaName: `Intro: ${introId}`,
        startTime: frameToSeconds(atFrame, fps),
        duration: 3,
        type: target.type,
        effects: [introId],
        sourceIn: 0,
        speed: 1,
        volume: 1,
        muted: false,
        opacity: 1,
        fadeIn: 0,
        fadeOut: 0,
        filter: { ...NEUTRAL_FILTER },
        transform: { ...DEFAULT_TRANSFORM },
        linkedId: null,
      };
      commitFrom((prev) => extendBranding(addToTracks(prev, target.id, introClip), introClip.startTime + introClip.duration + 1 / fps));
      setSelectedIds(new Set([introClip.id]));
      setToast(`Intro "${introId}" placed at frame ${atFrame}`);
    },
    [firstTrackOf, addToTracks, patchClip, extendBranding, frameToSeconds, commitFrom, fps, setSelectedIds, setToast]
  );

  // ---- Effects Panel handlers ----
  const toggleEffect = useCallback(
    (clipId: string, effectId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      const on = hit.clip.effects.includes(effectId);
      patchClip(clipId, { effects: on ? hit.clip.effects.filter((e) => e !== effectId) : [...hit.clip.effects, effectId] }, 'effects');
    },
    [clipById, patchClip]
  );

  const splitClip = useCallback(
    (clipId: string, atTime: number) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      const atFrame = secondsToFrame(atTime, fps);
      const startFrame = Math.round(hit.clip.startTime * fps);
      const lengthFrames = Math.round(hit.clip.duration * fps);
      const offset = atFrame - startFrame;
      // Both halves must keep MIN_CLIP_FRAMES. A cut that leaves a one-frame
      // stub is a clip nobody can grab again, and deleting it needs a different
      // gesture than making it.
      if (offset < MIN_CLIP_FRAMES || offset > lengthFrames - MIN_CLIP_FRAMES) {
        setToast(`Too close to the edge — a cut must leave at least ${MIN_CLIP_FRAMES} frames on each side`);
        return;
      }
      const left: TimelineClip = { ...hit.clip, duration: frameToSeconds(offset, fps), id: nextId(hit.clip.id + '-a') };
      const right: TimelineClip = {
        ...hit.clip,
        id: nextId(hit.clip.id + '-b'),
        startTime: frameToSeconds(atFrame, fps),
        duration: frameToSeconds(lengthFrames - offset, fps),
        sourceIn: hit.clip.sourceIn + frameToSeconds(offset, fps),
        linkedId: null,
      };
      const next = tracks.map((t) =>
        t.id === hit.track.id
          ? { ...t, clips: [...t.clips.filter((c) => c.id !== clipId), left, right].sort((a, b) => a.startTime - b.startTime) }
          : t
      );
      commit(next);
      setToast(`Cut at frame ${atFrame} — nothing shifted`);
    },
    [clipById, tracks, commit, fps]
  );

  // Live drag feedback, NOT committed: an abandoned drag leaves no history.
  const previewMove = useCallback(
    (clipId: string, startFrame: number, trackId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      const deltaFrames = startFrame - Math.round(hit.clip.startTime * fps);
      const partnerId = hit.clip.linkedId;
      const byId = new Map(tracks.flatMap((t) => t.clips).map((c) => [c.id, c]));
      setTracks((prev) =>
        prev.map((t) => {
          const kept = t.clips.filter((c) => c.id !== clipId && c.id !== partnerId);
          const drop: TimelineClip[] = [];
          if (t.id === trackId) drop.push({ ...hit.clip, startTime: frameToSeconds(startFrame, fps) });
          if (partnerId && t.id === hit.track.id) {
            const partner = byId.get(partnerId);
            if (partner) {
              const at = Math.max(0, Math.round(partner.startTime * fps) + deltaFrames);
              drop.push({ ...partner, startTime: frameToSeconds(at, fps) });
            }
          }
          return { ...t, clips: [...kept, ...drop].sort((a, b) => a.startTime - b.startTime) };
        })
      );
    },
    [clipById, tracks, fps]
  );

  const commitMove = useCallback(
    (clipId: string, startFrame: number, trackId: string, prevStartFrame: number, prevTrackId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      if (startFrame === prevStartFrame && trackId === prevTrackId) return;
      const deltaFrames = startFrame - prevStartFrame;
      const partnerId = hit.clip.linkedId;
      const relocate = (t: TimelineTrack): TimelineTrack => {
        const kept = t.clips.filter((c) => c.id !== clipId && c.id !== partnerId);
        const drop: TimelineClip[] = [];
        if (t.id === trackId) drop.push({ ...hit.clip, startTime: frameToSeconds(startFrame, fps) });
        if (partnerId && t.id === hit.track.id) {
          const partner = tracks.flatMap((x) => x.clips).find((c) => c.id === partnerId);
          if (partner) {
            const at = Math.max(0, Math.round(partner.startTime * fps) + deltaFrames);
            drop.push({ ...partner, startTime: frameToSeconds(at, fps) });
          }
        }
        return { ...t, clips: [...kept, ...drop].sort((a, b) => a.startTime - b.startTime) };
      };
      // `before` and `after` come from the SAME function, so one Ctrl+Z is
      // exactly correct rather than approximately correct.
      const before = tracks.map((t) =>
        t.id === prevTrackId
          ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, startTime: frameToSeconds(prevStartFrame, fps) } : c)) }
          : t
      );
      applyEdit(before, tracks.map(relocate));
    },
    [clipById, tracks, applyEdit, fps]
  );

  // ---- The keyboard handler reads TRACKS THROUGH A REF, NOT ITS CLOSURE ----
//
// Every handler here used to close over `tracks`. That snapshot is whatever the
// value was at the last render, and a keydown that arrives before React has
// re-rendered acts on it — so the "before" it records for undo can be several
// edits old. The symptom is an undo that jumps much further back than the action
// it is undoing: one Ctrl+Z after a slip removed the clip entirely, because the
// snapshot on top of the history was from before the clip was ever added.
//
// A ref assigned during render is the standard latest-value escape hatch for
// exactly this, and the codebase already uses it in the preview render loop.
const tracksRef = useRef(tracks);
tracksRef.current = tracks;

// ---- ONE COMMIT THAT RECORDS THE STATE IT IS ACTUALLY CHANGING ----
//
// `applyEdit(before, after)` trusted the caller's `before`, which is how a stale
// one got in. These take the update function instead and read the true previous
// state from the updater's own argument, which React always hands over as the
// state immediately before this change.
//
// The two `setState` calls are batched into one commit by React 18, so the history
// entry and the new tracks are written together and cannot be observed apart.
const commitTracks = useCallback((update: (prev: TimelineTrack[]) => TimelineTrack[]) => {
    let before: TimelineTrack[] = tracksRef.current;
    setHistory((h) => [...h.slice(-49), before]);
    setFuture([]);
    setTracks((prev) => {
      before = prev;
      return update(prev);
    });
    setDirty(true);
  }, []);

// ---- The four edge edits ----
  const applyEditResult = useCallback(
    (kind: 'ripple' | 'slide' | 'slip', deltaFrames: number) => {
      const id = selectedIdsArr[0];
      const hit = id ? clipById.get(id) : null;
      if (!id || !hit) {
        setToast('Select one clip first');
        return;
      }

      // Computed HERE, against the ref, not inside the updater.
      //
      // A `setState` updater does not run when it is called — React runs it during
      // the render phase, after this function has returned. So reading a flag the
      // updater set meant reading it before it was set: every one of these edits
      // reported "That edit needs two adjacent clips" while visibly working, because
      // the branch that decides the message had not been reached yet.
      //
      // The ref holds the latest rendered state, which is the same state the
      // updater would have been handed, so the operation is computed against the
      // right thing either way — and now its result can actually be read.
      const prev = tracksRef.current;
      const result =
        kind === 'ripple'
          ? rippleTrim(prev, hit.track.id, id, 'out', deltaFrames, fps)
          : kind === 'slide'
            ? slide(prev, hit.track.id, id, deltaFrames, fps)
            : slip(prev, hit.track.id, id, deltaFrames, fps);

      if (!result) {
        setToast('That edit needs two adjacent clips on the same lane');
        return;
      }
      commitTracks(() => result.tracks);
      setToast(result.label);
    },
    [selectedIdsArr, clipById, commitTracks, fps]
  );

  const onRoll = useCallback(
    (trackId: string, leftId: string, rightId: string, deltaFrames: number) => {
      // Same reason as `applyEditResult`: a result read out of a `setState` updater
      // is read before it is set, because the updater runs at render time.
      const result = roll(tracksRef.current, trackId, leftId, rightId, deltaFrames, fps);
      if (!result) {
        setToast('A roll needs two adjacent clips on the same lane');
        return;
      }
      commitTracks(() => result.tracks);
      setToast(result.label);
    },
    [commitTracks, fps]
  );

  /** Ripple trim on the selected clip's edge, moved by `deltaFrames`. */
  const doRippleTrim = useCallback(
    (edge: 'in' | 'out', deltaFrames: number) => {
      applyEditResult('ripple', deltaFrames);
      void edge;
    },
    [applyEditResult]
  );

  const doSlip = useCallback((deltaFrames: number) => applyEditResult('slip', deltaFrames), [applyEditResult]);

  const doSlide = useCallback((deltaFrames: number) => applyEditResult('slide', deltaFrames), [applyEditResult]);

  /** One entry point for all three, so the toolbar and the keyboard agree. */
  const edgeEdit = useCallback(
    (kind: 'ripple' | 'slide' | 'slip', deltaFrames: number) => {
      applyEditResult(kind, deltaFrames);
    },
    [applyEditResult]
  );

  // ---- Tracks ----
  const toggleTrack = useCallback((trackId: string, key: 'muted' | 'visible' | 'locked' | 'solo') => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, [key]: !t[key] } : t)));
  }, []);

  const trackVolume = useCallback((trackId: string, volume: number) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, volume } : t)));
  }, []);

  const trackHeight = useCallback((trackId: string, height: number) => {
    patch({ trackHeights: { ...getSettings().trackHeights, [trackId]: Math.round(height) } });
  }, [patch]);

  const addTrack = useCallback((type: TrackType) => {
    setTracks((prev) => {
      const n = prev.filter((t) => t.type === type).length + 1;
      const visual = (t: TrackType) => t === 'video' || t === 'image';
      const role: 'base' | 'overlay' = visual(type)
        ? prev.some((t) => visual(t.type) && t.role === 'base')
          ? 'overlay'
          : 'base'
        : 'overlay';
      const label = type === 'text' ? 'Text' : type === 'image' ? 'Image' : type === 'audio' ? 'Audio' : 'Video';
      const track: TimelineTrack = {
        id: nextId(type),
        name: `${label} ${n}`,
        type,
        role,
        clips: [],
        volume: 1,
        muted: false,
        solo: false,
        visible: true,
        locked: false,
      };
      // Insert directly AFTER the last lane of the same family. V2 has to sit
      // above V1 and A2 beside A1; appending puts the new lane below three
      // others, which means the picture-in-picture you just set up renders
      // under the title track and is off-screen when you drag onto it.
      const family = (t: TrackType) => (visual(t) ? 'visual' : t);
      let insertAt = prev.findIndex((t) => family(t.type) !== family(type));
      if (insertAt === -1) insertAt = prev.length;
      return [...prev.slice(0, insertAt), track, ...prev.slice(insertAt)];
    });
    setToast('Track added. Drag a clip onto it, or drop one from the bin.');
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    setTrackToDelete(trackId);
  }, []);

  /** Delete track with confirmation */
  const deleteTrack = useCallback((trackId: string) => {
    setTracks((prev) => (prev.length <= 1 ? prev : prev.filter((t) => t.id !== trackId)));
    setTransitions((prev) => prev.filter((t) => t.trackId !== trackId));
    setTrackToDelete(null);
    // Add deleted track to recovery bin
    const deletedTrack = tracks.find((t) => t.id === trackId);
    if (deletedTrack) {
      const deletedClip: DeletedClip = {
        id: `track-${deletedTrack.id}`,
        mediaId: deletedTrack.id,
        mediaName: deletedTrack.name,
        trackName: 'Track',
        startTime: 0,
        duration: 0,
        deletedAt: Date.now(),
      };
      setRecoveredClips((prev) => [...prev, deletedClip]);
    }
    setToast('Track removed');
  }, []);

  // ---- Transitions ----
  const applyTransition = useCallback((trackId: string, atTime: number, type: TransitionType) => {
    setTransitions((prev) => {
      const existing = prev.find((t) => t.trackId === trackId && Math.abs(t.atTime - atTime) < 1e-3);
      if (existing) return prev.map((t) => (t.id === existing.id ? { ...t, type } : t));
      return [...prev, { id: nextId('tr'), trackId, type, atTime, duration: DEFAULT_TRANSITION_DURATION }];
    });
    setToast('Transition added. Click its badge on the timeline to change its length.');
  }, []);

  const changeTransition = useCallback((id: string, p: Partial<Transition>) => {
    setTransitions((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
    setDirty(true);
  }, []);

  /** Transition editing */

  const removeTransition = useCallback((id: string) => {
    setTransitionToDelete(id);
  }, []);

  /** Delete transition with confirmation */
  const deleteTransition = useCallback((id: string) => {
    setTransitions((prev) => prev.filter((t) => t.id !== id));
    setSelectedTransitionId(null);
    setTransitionToDelete(null);
    setToast('Transition removed');
  }, []);

  // ---- Markers ----
  //
  // `setDirty(true)` on every mutation, and that is the whole fix for
  // "markers are not saved with the project".
  //
  // Markers HAVE always been part of the project document - `docSnapshot()`
  // includes them (`:232`), `ProjectDoc.markers` is typed as project content
  // (`engine/types.ts:243`), and `project-store.ts` writes the whole doc to
  // localStorage including markers. `doSave()` therefore saves them correctly.
  //
  // What was missing is that nothing here marked the document dirty. Autosave is
  // gated entirely on `dirty` - a 30s interval that returns early if `!dirty`
  // (`:1030`), and an 8s debounce with the same guard (`:1039`) - so the effect
  // dependency list already contained `markers` and the guard discarded every
  // trigger. Adding a marker changed React state, the effect re-ran, and the
  // guard said "nothing to save".
  //
  // Explicit Ctrl+S worked, which is why this looked intermittent: it saved on
  // demand and never on a timer. The help registry compounded it by telling the
  // user outright that markers are not saved - so the behaviour and the
  // documentation agreed with each other and both were wrong.
  const addMarker = useCallback(() => {
    setMarkers((prev) => [
      ...prev,
      { id: nextMarkerId(), frame: playheadFrame, label: `Marker ${prev.length + 1}`, colour: 'amber', kind: 'point' },
    ]);
    setDirty(true);
    setToast(`Marker added at frame ${playheadFrame}`);
  }, [playheadFrame, setDirty]);

  const gotoMarker = useCallback(
    (dir: 1 | -1) => {
      const m = dir === 1 ? nextMarker(markers, playheadFrame) : prevMarker(markers, playheadFrame);
      if (!m) {
        setToast(dir === 1 ? 'No later marker' : 'No earlier marker');
        return;
      }
      setPlayhead(m.frame);
      setToast(`${m.label || 'Marker'} — frame ${m.frame}`);
    },
    [markers, playheadFrame, setPlayhead]
  );

  /** Marker editing */

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
    // Without this, deleting a marker was the one edit that could never be
    // undone by closing the tab - the row came back on reload, because nothing
    // scheduled a save.
    setDirty(true);
  }, [setDirty]);

  // ---- Clipboard ----
  const copySelected = useCallback(() => {
    const picked: TimelineClip[] = [];
    for (const t of tracks) for (const c of t.clips) if (selectedIds.has(c.id)) picked.push({ ...c });
    if (!picked.length) {
      setToast('Nothing selected to copy');
      return;
    }
    setClipboard(picked);
    setToast(`Copied ${picked.length} clip${picked.length === 1 ? '' : 's'}`);
  }, [tracks, selectedIds]);

  const pasteClipboard = useCallback(() => {
    if (!clipboard.length) {
      setToast('Clipboard is empty');
      return;
    }
    const base = Math.min(...clipboard.map((c) => c.startTime));
    const fresh = clipboard.map((c) => ({
      ...c,
      id: nextId('clip'),
      startTime: frameToSeconds(playheadFrame + Math.round((c.startTime - base) * fps), fps),
      linkedId: null,
    }));
    const next = [...tracks];
    for (const clip of fresh) {
      const target = next.find((t) => acceptsTrack(clip.type, t.type)) ?? next[0];
      if (!target) break;
      target.clips = [...target.clips, clip].sort((a, b) => a.startTime - b.startTime);
    }
    commit(next);
    setSelect(fresh.map((c) => c.id));
    setToast(`Pasted ${fresh.length} clip${fresh.length === 1 ? '' : 's'} at frame ${playheadFrame}`);
  }, [clipboard, tracks, playheadFrame, commit, setSelect, fps]);

  const duplicateSelected = useCallback(() => {
    const picked: TimelineClip[] = [];
    for (const t of tracks) for (const c of t.clips) if (selectedIds.has(c.id)) picked.push(c);
    if (!picked.length) {
      setToast('Nothing selected to duplicate');
      return;
    }
    setClipboard(picked.map((c) => ({ ...c })));
    const fresh = picked.map((c) => ({
      ...c,
      id: nextId('clip'),
      startTime: frameToSeconds(Math.round(clipEnd(c) * fps), fps),
      linkedId: null,
    }));
    const next = [...tracks];
    for (const clip of fresh) {
      const target = next.find((t) => acceptsTrack(clip.type, t.type)) ?? next[0];
      if (!target) break;
      target.clips = [...target.clips, clip].sort((a, b) => a.startTime - b.startTime);
    }
    commit(next);
    setSelect(fresh.map((c) => c.id));
  }, [tracks, selectedIds, commit, setSelect, fps]);

  // ---- Linking ----
  const toggleLink = useCallback(
    (clipId: string) => {
      const hit = clipById.get(clipId);
      if (!hit) return;
      if (hit.clip.linkedId) {
        const partner = clipById.get(hit.clip.linkedId);
        commit(
          tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
              c.id === clipId || (partner && c.id === partner.clip.id) ? { ...c, linkedId: null } : c
            ),
          }))
        );
        setToast('Unlinked');
        return;
      }
      // A link is only meaningful between two instances of the same file; a link
      // between two unrelated clips is a lie the timeline would then enforce.
      const partner = tracks.flatMap((t) => t.clips).find((c) => c.id !== clipId && c.mediaId === hit.clip.mediaId);
      if (!partner) {
        setToast('Nothing to link to — put the same file on another lane first');
        return;
      }
      commit(
        tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => (c.id === clipId || c.id === partner.id ? { ...c, linkedId: c.id === clipId ? partner.id : clipId } : c)),
        }))
      );
      setToast(`Linked to “${partner.mediaName}” — moving one moves the other`);
    },
    [clipById, tracks, commit]
  );

  const linkedMove = selectedIds.size > 0 && [...selectedIds].every((id) => {
    const hit = clipById.get(id);
    if (!hit?.clip.linkedId) return true;
    const partner = clipById.get(hit.clip.linkedId);
    return Boolean(partner) && selectedIds.has(partner!.clip.id);
  });

  // ---- Project lifecycle ----

  const doSave = useCallback(async (): Promise<SaveResult> => {
    const res = await saveProject(docSnapshot(), media.items);
    if (res.saved) {
      setSavedAt(Date.now());
      setDirty(false);
      setLastOpenedId(projectId);
      setSettings({ lastProjectId: projectId });
    }
    return res;
  }, [docSnapshot, media.items, projectId]);

  const newProject = useCallback(() => {
    const id = nextId('p');
    setProjectId(id);
    setProjectName(DEFAULT_SETTINGS.name);
    setTracks(structuredClone(DEFAULT_TRACKS));
    setTransitions([]);
    setMarkers([]);
    setHistory([]);
    setFuture([]);
    setSelectedIds(new Set());
    setPlayheadFrame(0);
    setPlaying(false);
    setSavedAt(null);
    setDirty(false);
    setLastOpenedId(id);
    setSettings({ lastProjectId: id, playheadFrame: 0 });
    media.clear();
    setToast('New project. Import media to begin.');
  }, [media]);

  const openProject = useCallback(
    async (id: string) => {
      const loaded = await loadProject(id);
      if (!loaded) {
        setToast('That project could not be read from storage');
        return;
      }
      const doc = normaliseProject(loaded.doc);
      const rate = coerceFps(doc.settings.fps);
      setProjectId(doc.id);
      setProjectName(doc.settings.name);
      setResolution({ width: doc.settings.width, height: doc.settings.height });
      setBackground(doc.settings.background);
      setTracks(doc.tracks);
      setTransitions(doc.transitions);
      setMarkers(doc.markers ?? []);
      setHistory(doc.history ?? []);
      setFuture(doc.future ?? []);
      setSelectedIds(new Set());
      setPlayheadFrame(0);
      setPlaying(false);
      setSavedAt(doc.savedAt);
      setDirty(false);
      setLastOpenedId(doc.id);
      /**
       * The WORKSPACE's frame rate wins over the project's.
       *
       * Both hold a rate, and they can disagree: a user switches a project to
       * 25fps, opens a different one saved at 30, and comes back. If the
       * project's rate won, the setting they deliberately chose would be
       * silently reverted by opening a file - which is exactly the class of
       * "my settings reset" complaint this whole store exists to end.
       *
       * The project's stored rate is adopted instead, so the two converge: the
       * project is re-saved at the rate now in force, and the next open agrees.
       */
      patch({ lastProjectId: doc.id, playheadFrame: 0 });
      media.restore(loaded.media);
      setToast(
        loaded.missing.length
          ? `Opened “${doc.settings.name}” at ${rate}fps. ${loaded.missing.length} media file(s) were missing — re-import them.`
          : `Opened “${doc.settings.name}” at ${rate}fps with ${loaded.media.length} media file(s)`
      );
    },
    [media, patch, pxPerFrame, fps]
  );

  const importProjectFile = useCallback(
    async (file: File) => {
      const parsed = await parseProjectFile(await file.text());
      if (!parsed) return;
      const doc = normaliseProject(parsed.doc);
      setProjectId(doc.id);
      setProjectName(doc.settings.name);
      setResolution({ width: doc.settings.width, height: doc.settings.height });
      setBackground(doc.settings.background);
      setTracks(doc.tracks);
      setTransitions(doc.transitions);
      setMarkers(doc.markers ?? []);
      setHistory([]);
      setFuture([]);
      setSavedAt(doc.savedAt);
      setDirty(true);
      setLastOpenedId(doc.id);
      patch({ lastProjectId: doc.id, fps: coerceFps(doc.settings.fps) });
      if (parsed.media.length) media.restore(parsed.media);
      setToast(`Opened “${doc.settings.name}” from file`);
    },
    [media, patch]
  );

  // ---- Restore, once ----
  /**
   * Hydrate the workspace, then reopen the last project.
   *
   * The store starts as the DEFAULTS so that the hydration render matches the
   * HTML the server sent - see `lib/engine/settings.ts`. Here, after the first
   * client render has already succeeded, the user's real settings are read and
   * published.
   *
   * One effect does BOTH halves on purpose. Zoom, scroll, panel sizes, lane
   * heights, frame rate, snapping and theme have to be in hand BEFORE the
   * project opens, because `openProject` rescales the zoom to the project's
   * frame rate and sets the last-project id. Split them and the project open
   * races the settings restore, and the user comes back to a timeline at the
   * wrong zoom - which is the exact complaint this whole store exists to fix.
   */
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    hydrateSettings();
    const s = getSettings();
    // `activeMode` is workspace, not React state, so it has to be pushed into
    // the component once the store has been read.
    setMode((s.activeMode as EditorMode) ?? 'media');
    setPlayheadFrame(s.playheadFrame);
    const id = s.lastProjectId || lastOpenedId();
    if (id) void openProject(id);
  }, [hydrated, openProject]);

  // Autosave: every 30 seconds, and never more than once every 8 seconds after
  // a change, so holding down a slider does not write a project per frame.
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      if (dirty) void doSave();
    }, 30000);
    return () => clearInterval(id);
  }, [hydrated, dirty, doSave]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    const id = setTimeout(() => void doSave(), 8000);
    return () => clearTimeout(id);
  }, [hydrated, dirty, doSave, tracks, transitions, markers, resolution, projectName]);

  // Reopen whatever was open last happens in `hydrateSettings` above, together
  // with the workspace settings, so a reload is not a lost session. That is also
  // what makes REDO work across a reload: the future stack is part of the saved
  // document, not a session artefact.


  // ---- Zoom ----
  /**
   * Zoom, anchored on a screen x.
   *
   * Anchoring on the pointer is what makes the timeline feel like it is being
   * pulled rather than pushed: the frame under the cursor stays under the
   * cursor. Anchoring on the viewport's left edge instead moves the thing the
   * user is looking at, which is how a zoom ends up feeling like the timeline
   * jumped.
   */
  const zoomAt = useCallback(
    (factor: number, anchorClientX: number | null) => {
      const el = laneScrollRef.current;
      const next = clampPxPerFrame(pxPerFrame * factor);
      if (!el || anchorClientX === null) {
        patch({ pxPerFrame: next });
        return;
      }
      const stripLeft = el.getBoundingClientRect().left;
      const frameAtAnchor = (anchorClientX - stripLeft + el.scrollLeft) / pxPerFrame;
      patch({ pxPerFrame: next });
      // Restated in a layout effect so the DOM has the new scale before the
      // scroll position is applied to it.
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, frameAtAnchor * next - (anchorClientX - stripLeft));
      });
    },
    [pxPerFrame, patch]
  );

  // Scroll persistence. Debounced, for the same reason the playhead is.
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = laneScrollRef.current;
    if (!el) return;
    // Restore once, immediately: the settings are read synchronously, so the
    // first paint is already at the user's scroll position.
    const s = getSettings();
    if (s.scrollLeft) el.scrollLeft = s.scrollLeft;
    if (s.scrollTop) el.scrollTop = s.scrollTop;

    const onScroll = () => {
      const updateRange = () => {
        const startFrame = Math.max(0, Math.round(el.scrollLeft / pxPerFrame));
        const endFrame = startFrame + Math.ceil(el.clientWidth / pxPerFrame);
        setVisibleRange({ startFrame, endFrame });
      };
      updateRange();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(
        () => setSettings({ scrollLeft: Math.round(el.scrollLeft), scrollTop: Math.round(el.scrollTop) }),
        250
      );
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [pxPerFrame]);

  // Header column mirrors the lanes' vertical scroll, so every name stays beside
  // its own lane. Two columns cannot share one scrollbar.
  useEffect(() => {
    const lanes = laneScrollRef.current;
    const headers = headerScrollRef.current;
    if (!lanes || !headers) return;
    const sync = () => {
      if (headers.scrollTop !== lanes.scrollTop) headers.scrollTop = lanes.scrollTop;
    };
    lanes.addEventListener('scroll', sync, { passive: true });
    return () => lanes.removeEventListener('scroll', sync);
  }, []);

  // ---- Ruler horizontal scroll sync ----
  //
  // The ruler MUST stay fixed vertically while clips scroll. So the ruler lives
  // in its own container (rulerScrollRef) with overflow-x-auto only (NO overflow-y).
  // But horizontally, the ruler and tracks MUST scroll in perfect sync so time
  // markers align with clips. This effect syncs rulerScrollRef.scrollLeft with
  // laneScrollRef.scrollLeft on every horizontal scroll event.
  useEffect(() => {
    const ruler = rulerScrollRef.current;
    const lanes = laneScrollRef.current;
    if (!ruler || !lanes) return;
    const sync = () => {
      if (ruler.scrollLeft !== lanes.scrollLeft) ruler.scrollLeft = lanes.scrollLeft;
    };
    lanes.addEventListener('scroll', sync, { passive: true });
    return () => lanes.removeEventListener('scroll', sync);
  }, []);

  // ---- Theme ----
  useEffect(() => {
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme]);

  // ---- Snapshot ----
  const snapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas backing store is the project resolution, so this is a
    // full-size PNG rather than a screenshot of the preview pane.
    canvas.toBlob((blob) => {
      if (!blob) {
        setToast('Snapshot failed');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/[^\w-]+/g, '_') || 'frame'}-${timecode(playheadSeconds, fps).replace(/:/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setToast(`Snapshot saved at ${timecode(playheadSeconds, fps)}`);
    }, 'image/png');
  }, [projectName, playheadSeconds, fps]);

  // ---- Playback ----
  /**
   * Play / pause, and play ALWAYS starts from where the playhead is.
   *
   * Pressing play at frame 0 used to resume from wherever the clock last stood,
   * which is the single most confusing thing a transport can do: the timeline
   * looks reset and the picture is already three seconds in. So the rule is
   * one sentence long - play from the playhead, and the playhead is the start if
   * the user put it there - and it removes the whole class of bug.
   */
  const togglePlay = useCallback(() => {
    trackClick('play_pause_btn', playing ? 'Pause' : 'Play', 'play-pause-btn');
    setPlaying((p) => {
      if (p) return false;
      // A timeline scrolled to its final frame would otherwise play one frame
      // and stop, which reads as "play is broken".
      if (playheadFrame >= durationFrames - 1) setPlayhead(0);
      return true;
    });
  }, [playheadFrame, durationFrames, setPlayhead, playing]);

  useEffect(() => {
    if (!playing || !settings.loopEnabled) return;
    if (settings.loopEndFrame > settings.loopStartFrame && playheadFrame >= settings.loopEndFrame) {
      setPlayhead(settings.loopStartFrame);
    }
  }, [playing, settings.loopEnabled, settings.loopStartFrame, settings.loopEndFrame, playheadFrame, setPlayhead]);

  // Shuttle rate applied here, because it has to keep moving the playhead after
  // the key is released.
  useEffect(() => {
    if (!playing || shuttle === 0) return;
    const id = setInterval(() => {
      setPlayheadFrame((p) => {
        const next = p + (shuttle * 2 * settings.playbackRate) / fps;
        if (next >= durationFrames) {
          setPlaying(false);
          setShuttle(0);
          return durationFrames;
        }
        if (next <= 0) return 0;
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [playing, shuttle, fps, durationFrames, settings.playbackRate]);

  // Loop region, expressed in frames in the settings and in seconds to the
  // components that draw it.
  const loop = useMemo(
    () => ({
      on: settings.loopEnabled,
      start: frameToSeconds(settings.loopStartFrame, fps),
      end: frameToSeconds(settings.loopEndFrame, fps),
    }),
    [settings.loopEnabled, settings.loopStartFrame, settings.loopEndFrame, fps]
  );

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isEditorKey(e)) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.preventDefault();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.shiftKey && k === 's') return snapshot();
      if (mod && k === 's') {
        e.preventDefault();
        void doSave().then((r) => setToast(r.saved ? `Saved “${projectName}” with ${r.mediaSaved} media file(s)` : r.error ?? 'Save failed'));
        return;
      }
      if (mod && k === 'n') {
        e.preventDefault();
        newProject();
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
if (mod && k === 'm') {
          e.preventDefault();
          setExportOpen(true);
          return;
        }
        if (mod && e.shiftKey && k === 'r') {
          e.preventDefault();
          setShowRecoverDialog(true);
          return;
        }
        if (mod && e.shiftKey && k === 'a') {
          e.preventDefault();
          setShowAuraStudio(true);
          return;
        }
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((mod && e.shiftKey && k === 'z') || (mod && k === 'y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        setSelect(tracks.flatMap((t) => t.clips.map((c) => c.id)));
        return;
      }
      if (mod && k === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && k === 'x') {
        e.preventDefault();
        copySelected();
        removeSelected();
        return;
      }
      if (mod && k === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (e.key === 'Escape') {
        setSelect([]);
        setSelectedTransitionId(null);
        setInspecting(null);
        return;
      }
      if (e.key === 'Enter' && selectedIds.size === 1) {
        e.preventDefault();
        setInspecting([...selectedIds][0]);
        return;
      }
      if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        removeSelected(true);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
        return;
      }

      // ============================================================================
// THE THREE EDGE EDITS — at the TOP LEVEL of the handler, deliberately
// ============================================================================
//
// These used to live INSIDE the `if (!mod)` block further down, which reads like
// an unrelated grouping and is not one: `mod` is `ctrlKey || metaKey`, so anything
// under `!mod` can never fire while ctrl is held. A shortcut for slip needs ctrl
// (see below), so placed there it was unreachable — the keypress was swallowed by
// the guard above it and did nothing at all, with no toast and nothing on screen to
// say so.
//
// Two of the three use only Shift and Alt, so they happened to work by sitting in a
// block they had no business being in. Being accidentally reachable is not the same
// as being wired: it survives only until someone adds a modifier to a shortcut.
//
// They are here, before that block, because they are not about modifiers — they
// are about an edge, and all three share one destination.
//
//   Shift+Alt+Arrow   RIPPLE TRIM the out point; everything after it slides.
//   Alt+Arrow         SLIDE; the neighbours grow and shrink to absorb the move.
//   Ctrl+Alt+Arrow    SLIP; nothing on the timeline moves, only the source in.
//
// Why slip could not keep Alt+Shift+Arrow: two different branches of this same
// handler claimed that combination, the ripple one first, so it returned before
// the slip branch was ever reached. Slip had therefore never once performed a
// slip. It only looked wired — the gesture produced a plausible-looking ripple, so
// editing appeared to work while quietly changing the clip's length.
if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
  e.preventDefault();
  const delta = e.key === 'ArrowLeft' ? -1 : 1;
  if (e.ctrlKey || e.metaKey) doSlip(delta);
  else if (e.shiftKey) doRippleTrim('out', delta);
  else doSlide(delta);
  return;
}

if (!mod) {
        if (k === 's') {
          e.preventDefault();
          const hit = bladeRef.current?.();
          setToast(hit ? `Split “${hit}” at frame ${playheadFrame}` : 'Nothing under the playhead to split');
          return;
        }
        if (k === 'n') {
          e.preventDefault();
          patch({ snapEnabled: !settings.snapEnabled });
          setToast(`Snapping ${settings.snapEnabled ? 'off' : 'on'}`);
          return;
        }
        if (k === 'r') {
          e.preventDefault();
          setRecording(true);
          return;
        }
        if (k === 'm') {
          e.preventDefault();
          addMarker();
          return;
        }
        if (k === ',') {
          e.preventDefault();
          gotoMarker(-1);
          return;
        }
        if (k === '.') {
          e.preventDefault();
          gotoMarker(1);
          return;
        }
        if (k === 'l' && selectedIds.size === 1) {
          e.preventDefault();
          toggleLink([...selectedIds][0]);
          return;
        }
        if ((k === 'i' || k === 'o') && selectedIds.size === 1) {
          e.preventDefault();
          const id = [...selectedIds][0];
          const hit = clipById.get(id);
          if (hit) {
            const into = playheadFrame - Math.round(hit.clip.startTime * fps);
            const left = Math.round(clipEnd(hit.clip) * fps) - playheadFrame;
            patchClip(id, k === 'i' ? { fadeIn: Math.max(0, Math.min(into, hit.clip.duration / 2)) / fps } : { fadeOut: Math.max(0, Math.min(left, hit.clip.duration / 2)) / fps });
            setToast(k === 'i' ? 'Fade in set to the playhead' : 'Fade out set to the playhead');
          }
          return;
        }
        if (k === 'j' || k === 'k' || k === 'l') {
          if (k === 'k') {
            e.preventDefault();
            setShuttle(0);
            setPlaying(false);
            return;
          }
          e.preventDefault();
          const dir = k === 'j' ? -1 : 1;
          setShuttle((s) => {
            const next = Math.sign(s || dir) === dir ? Math.min(8, Math.abs(s || 1) * 2) : dir;
            if (next > 0) setPlaying(true);
            return next;
          });
          return;
        }
        if (k === 'm') return;
      }

      if (e.key === 'ArrowLeft') setPlayhead(playheadFrame - (e.shiftKey ? 10 : 1));
      if (e.key === 'ArrowRight') setPlayhead(playheadFrame + (e.shiftKey ? 10 : 1));
      if (e.key === 'Home') setPlayhead(0);
      if (e.key === 'End') setPlayhead(durationFrames);
      if (e.key === '+' || e.key === '=') zoomAt(1.4, null);
      if (e.key === '-' || e.key === '_') zoomAt(1 / 1.4, null);
      if (e.key === '0') patch({ pxPerFrame: 3 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    doRippleTrim, doSlip, doSlide, duplicateSelected, doSave, durationFrames, newProject, pasteClipboard,
    playheadFrame, copySelected, patch, removeSelected, seekTo, selectedIds, setSelect, settings.snapEnabled,
    snapshot, toggleLink, undo, redo, patchClip, clipById, addMarker, gotoMarker, zoomAt, projectName, fps
  ]);

  // ---- Toast ----
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  useClampToViewport(settings.binWidth, (v) => patch({ binWidth: v }), BIN.min, 0.4);

  // The first click anywhere unlocks the audio context: browsers refuse to
  // start one without a gesture, and every click on the timeline is one.
  useEffect(() => {
    const unlock = () => Compositor.unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    // Start click tracking on mount
    startClickTracking();
  }, []);

  const onCanvasReady = useCallback((c: HTMLCanvasElement | null) => {
    canvasRef.current = c;
  }, []);

  const setBlade = useCallback((fn: () => string | null) => {
    bladeRef.current = fn;
  }, []);

  const onPickFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      void media.addFiles(list).then((added) => {
        for (const item of added) addMedia(item);
        if (added.length) setMode('media');
      });
    },
    [media, addMedia]
  );

  /**
   * Everything the compositor can be asked to draw, by clip `mediaId`.
   *
   * Built by `buildCompositorSources` - shared with `preview-canvas.tsx`, so
   * the preview and the export can never disagree about which clips resolve.
   * See `lib/engine/sources.ts` for why branding clips are in the map.
   */
  const compositorSources = useMemo(
    () => buildCompositorSources(media.items, tracks),
    [media.items, tracks]
  );

  const compositorState = useMemo(
    () => ({
      tracks,
      transitions,
      settings: { name: projectName, width: resolution.width, height: resolution.height, fps, background },
      sources: compositorSources,
      masterVolume: settings.masterVolume,
      activeFrameLayers:
        showFrameTemplateEditor && activeFrameTemplate?.frames[activeFrameIndex]
          ? activeFrameTemplate.frames[activeFrameIndex].layers
          : undefined,
    }),
    [
      tracks,
      transitions,
      projectName,
      resolution,
      fps,
      background,
      compositorSources,
      settings.masterVolume,
      showFrameTemplateEditor,
      activeFrameTemplate,
      activeFrameIndex,
    ]
  );

  const snapOptions: SnapOptionsProp = {
    enabled: settings.snapEnabled,
    toPlayhead: settings.snapToPlayhead,
    toClips: settings.snapToClips,
    toMarkers: settings.snapToMarkers,
    toTimelineEnds: settings.snapToTimelineEnds,
    thresholdPx: settings.snapThresholdPx,
    playheadFrame,
  };

  const panelProps = {
    clip: panelClip,
    applyFilter: (f: Partial<ClipFilter>) => panelClip && patchClip(panelClip.id, { filter: { ...panelClip.filter, ...f } }, 'filter'),
    applyTransform: (t: Partial<ClipTransform>) => panelClip && patchClip(panelClip.id, { transform: { ...panelClip.transform, ...t } }, 'transform'),
    applyText: (t: Partial<TextClipStyle>) => panelClip && patchClip(panelClip.id, { text: { ...(panelClip.text ?? DEFAULT_TEXT_STYLE), ...t } }, 'text'),
    addText: (style: Partial<TextClipStyle>, transform?: Partial<ClipTransform>) => addText(style, transform),
    addSticker: (emoji: string) => addText({ content: emoji, size: 0.18, shadow: true }, { y: 0.25 }),
  };

  const clipTotal = tracks.reduce((n, t) => n + t.clips.length, 0);
  /**
   * How many clips are actually in the DOM.
   *
   * The lanes are virtualised, so this is usually lower than the model count.
   * It is reported in the footer rather than hidden: a timeline that silently
   * drops 400 clips looks broken, and the same timeline that SAYS it drew 5 of
   * 405 looks like a feature.
   */
  const drawnClipCount = useMemo(
    () => tracks.reduce((n, t) => n + t.clips.filter((c) => {
      const s = Math.round(c.startTime * fps);
      const e = Math.round(clipEnd(c) * fps);
      const pad = Math.ceil(600 * pxPerFrame);
      return e >= visibleRange.startFrame - pad && s <= visibleRange.endFrame + pad;
    }).length, 0),
    [tracks, fps, pxPerFrame, visibleRange]
  );

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#0a0a0a]">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,text/*"
        className="sr-only"
        aria-label="Import media files"
        onChange={(e) => {
          onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <EditorToolbar
        showToolbar={false}
        maxFps={maxFps}
        canSplit={Boolean(panelClip)}
        canDelete={selectedIds.size > 0}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        canSelectAll={clipTotal > 0}
        canProcessAudio={Boolean(audioUrl)}
        selectedCount={selectedIds.size}
        isPlaying={playing}
        recording={recording}
        linkedSelection={linkedMove}
        ripple={settings.rippleEnabled}
        dirty={dirty}
        projectName={projectName}
        savedAt={savedAt}
        onTogglePlay={togglePlay}
        onStep={(frames) => setPlayhead(playheadFrame + frames)}
        onSplit={() => {
          trackClick('split_btn', 'Split clip', 'split-btn');
          const hit = bladeRef.current?.();
          setToast(hit ? `Split “${hit}” at frame ${playheadFrame}` : 'Nothing under the playhead to split');
        }}
        onDelete={() => {
          trackClick('delete_btn', 'Delete clip', 'delete-btn');
          removeSelected()
        }}
        onUndo={() => {
          trackClick('undo_btn', 'Undo', 'undo-btn');
          undo()
        }}
        onRedo={() => {
          trackClick('redo_btn', 'Redo', 'redo-btn');
          redo()
        }}
        onSelectAll={() => setSelect(tracks.flatMap((t) => t.clips.map((c) => c.id)))}
        onCopy={() => {
          trackClick('copy_btn', 'Copy', 'copy-btn');
          copySelected()
        }}
        onPaste={() => {
          trackClick('paste_btn', 'Paste', 'paste-btn');
          pasteClipboard()
        }}
        onDuplicate={() => {
          trackClick('duplicate_btn', 'Duplicate', 'duplicate-btn');
          duplicateSelected()
        }}
        onToggleSnapping={() => {
          trackClick('snapping_btn', 'Toggle snapping', 'snapping-btn');
          patch({ snapEnabled: !settings.snapEnabled })
        }}
        snapping={settings.snapEnabled}
        onToggleRipple={() => patch({ rippleEnabled: !settings.rippleEnabled })}
        onZoom={(d) => {
          trackClick('zoom_btn', d > 0 ? 'Zoom in' : 'Zoom out', 'zoom-btn');
          zoomAt(d > 0 ? 1.25 : 1 / 1.25, null)
        }}
        onZoomTo={(px) => patch({ pxPerFrame: px })}
        pxPerFrame={pxPerFrame}
        onFit={() => patch({ pxPerFrame: 3 })}
        onFullscreen={() => {
          trackClick('fullscreen_btn', 'Toggle fullscreen', 'fullscreen-btn');
          const el = document.querySelector('[data-preview-pane]');
          if (el instanceof HTMLElement) {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen().catch(() => {});
          }
        }}
        onOpenBin={() => fileInputRef.current?.click()}
        onRecord={() => {
          trackClick('record_btn', 'Record', 'record-btn');
          setRecording(true)
        }}
        onNewProject={() => {
          trackClick('new_project_btn', 'New project', 'new-project-btn');
          newProject()
        }}
        onSave={() => {
          trackClick('save_btn', 'Save project', 'save-btn');
          void doSave().then((r) => setToast(r.saved ? 'Project saved' : r.error ?? 'Save failed'))
        }}
        onExport={() => {
          trackClick('export_btn', 'Export video', 'export-btn');
          setExportOpen(true)
        }}
        onSnapshot={() => {
          trackClick('snapshot_btn', 'Snapshot', 'snapshot-btn');
          snapshot()
        }}
        onToggleLoop={() => {
          trackClick('loop_btn', 'Toggle loop', 'loop-btn');
          patch(
            settings.loopEnabled
              ? { loopEnabled: false }
              : { loopEnabled: true, loopStartFrame: Math.max(0, playheadFrame - Math.round(fps * 5)), loopEndFrame: durationFrames }
          )
        }}
        loopOn={settings.loopEnabled}
        onOpenProject={() => {
          trackClick('open_project_btn', 'Open project', 'open-project-btn');
          setMode('project')
        }}
        onAddMarker={addMarker}
        markerCount={markers.length}
        onClearMarkers={() => {
          // Marks dirty, which "remove all markers" did not. A bulk delete that
          // survives a reload is the most confusing version of this bug: the user
          // clears them, sees them gone, reloads, and they are all back.
          setMarkers([]);
          setDirty(true);
        }}
        onMarkerStep={gotoMarker}
        onEdgeEdit={edgeEdit}
        onFpsChange={(f) => {
          const rate = coerceFps(f);
          patch({ fps: rate, pxPerFrame: rescalePxPerFrame(pxPerFrame, fps, rate) });
        }}
        fps={fps}
        playbackRate={settings.playbackRate}
        onPlaybackRate={(v) => patch({ playbackRate: v })}
      />

      {/* ---- Top row ---- */}
      <div className="flex min-h-0 flex-1">
        <ModeRail
          active={mode}
          onChange={(m) => {
            setMode(m);
            setSettings({ activeMode: m });
          }}
          waveformVisible={settings.waveformVisible}
          onToggleWaveforms={() => patch({ waveformVisible: !settings.waveformVisible })}
          gridVisible={settings.gridVisible}
          onToggleGrid={() => patch({ gridVisible: !settings.gridVisible })}
          snapEnabled={settings.snapEnabled}
        />

        {settings.binWidth > 0 && (
          <div style={{ width: settings.binWidth }} className="shrink-0 overflow-hidden bg-[#1a1a1a]">
            <div className="h-full overflow-y-auto p-2.5">
              {mode === 'media' && (
                <MediaBin selectedId={selectedMediaId} onAdd={(item) => { setSelectedMediaId(item.id); addMedia(item); }} />
              )}
              {mode === 'transitions' && (
                <TransitionsPanel
                  tracks={tracks}
                  transitions={transitions}
                  selectedClipId={selectedIdsArr.length === 1 ? selectedIdsArr[0] : null}
                  selectedTransitionId={selectedTransitionId}
                  onApply={applyTransition}
                  onSelectTransition={setSelectedTransitionId}
                  onChangeTransition={changeTransition}
                  onRemoveTransition={removeTransition}
                  onClose={() => setSelectedTransitionId(null)}
                />
              )}
              {mode === 'filters' && <FiltersPanel {...panelProps} />}
              {mode === 'titles' && <TitlesPanel {...panelProps} />}
              {mode === 'stickers' && <StickersPanel {...panelProps} />}
              {mode === 'panzoom' && <PanZoomPanel {...panelProps} />}
              {mode === 'layouts' && <LayoutsPanel {...panelProps} />}
              {mode === 'audio' && (
                <AudioPanel
                  clip={panelClip}
                  audioUrl={audioUrl}
                  onToggleEffect={(id) => {
                    if (!panelClip) return;
                    const on = panelClip.effects.includes(id);
                    patchClip(panelClip.id, { effects: on ? panelClip.effects.filter((e) => e !== id) : [...panelClip.effects, id] }, 'effects');
                  }}
                  onClearEffects={() => panelClip && patchClip(panelClip.id, { effects: [] })}
                  onClipVolume={(v) => panelClip && patchClip(panelClip.id, { volume: v }, 'volume')}
                  onClipFade={(edge, v) => panelClip && patchClip(panelClip.id, edge === 'in' ? { fadeIn: v } : { fadeOut: v }, 'fade')}
                  onMatchLevel={(targetDb) => {
                    if (!panelClip) return;
                    const g = Math.max(0, Math.min(1, Math.pow(10, targetDb / 20)));
                    patchClip(panelClip.id, { volume: g });
                    setToast(`Volume set to -1 dBFS (${Math.round(g * 100)}% of full scale)`);
                  }}
                  onSilenceRemoved={(blob) => {
                    // Same rule as a recording: register the bytes in the store so
                    // the clip has a source, a waveform and a durable copy. This
                    // path had the identical defect — `file` was set but the item
                    // was never in `media.items`, so nothing downstream could find
                    // it.
                    const item = media.addRecorded({
                      name: `silence-removed-${Date.now()}.wav`,
                      kind: 'audio',
                      blob,
                      duration,
                    });
                    setAudioUrl(item.url);
                    addMediaBatch([item]);
                  }}
                  onRecord={() => setRecording(true)}
                />
              )}
              {mode === 'expressions' && (
                <ExpressionsPanel
                  clip={panelClip}
                  onApplyExpression={(property, expression) => {
                    if (!panelClip) return;
                    const next = { ...(panelClip.expressions ?? {}), [property]: expression };
                    patchClip(panelClip.id, { expressions: next }, 'expressions');
                  }}
                  onClearExpression={(property) => {
                    if (!panelClip) return;
                    const next = { ...(panelClip.expressions ?? {}) };
                    delete next[property];
                    patchClip(panelClip.id, { expressions: next }, 'expressions');
                  }}
                  onRemoveAllExpressions={() => {
                    if (!panelClip) return;
                    patchClip(panelClip.id, { expressions: {} }, 'expressions');
                    setToast('All expressions cleared');
                  }}
                />
              )}
              {mode === 'templates' && (
                <TemplatesPanel
                  clip={panelClip}
                  playheadFrame={playheadFrame}
                  fps={fps}
                  onApplyTemplate={(templateId, atFrame) => {
                    void addTemplate(templateId, atFrame);
                  }}
                  onStampTemplate={(templateId, clipId) => {
                    stampTemplate(templateId, clipId);
                  }}
                />
              )}
               {mode === 'project' && (
                 <ProjectPanel
                   doc={docSnapshot()}
                   media={media.items}
                   dirty={dirty}
                   lastSavedAt={savedAt}
                   autosave
                   onSettings={(p: Partial<ProjectSettings>) => {
                     if (p.name !== undefined) setProjectName(p.name);
                     if (p.width !== undefined) setResolution((r) => ({ ...r, width: p.width as number }));
                     if (p.height !== undefined) setResolution((r) => ({ ...r, height: p.height as number }));
                     if (p.background !== undefined) setBackground(p.background);
                     if (p.fps !== undefined) {
                       const rate = coerceFps(p.fps);
                       // The zoom is re-expressed so the timeline keeps the same
                       // apparent size in SECONDS. Without this, switching 30 -> 60
                       // would silently double the zoom.
                       patch({ fps: rate, pxPerFrame: rescalePxPerFrame(pxPerFrame, fps, rate) });
                     }
                     setDirty(true);
                   }}
                   onNew={newProject}
                   onOpen={openProject}
                   onSave={doSave}
                   onImported={importProjectFile}
                 />
               )}

               {/* ---- New Movavi-style panels ----
                   Hinglish: ye panels mode-rail me naye modes ke liye hain:
                   samples (stock video), backgrounds, intros, effects, tools
                   Sabhi zero background framing boxes ke saath banaye gaye hain
                   aur orange-red hover (#ff6500) use karte hain.
               */}

               {mode === 'samples' && <SamplesPanel />}
               {mode === 'backgrounds' && <BackgroundsPanel />}
               {mode === 'intros' && (
                 <IntrosPanel
                   playheadFrame={playheadFrame}
                   fps={fps}
                   onApplyIntro={(introId, atFrame) => { void addIntro(introId, atFrame); }}
                 />
               )}
               {mode === 'effects' && (
                 <EffectsPanel
                   clip={panelClip}
                   onApplyEffect={(effectId) => {
                     if (!panelClip) return;
                     toggleEffect(panelClip.id, effectId);
                   }}
                   onRemoveEffect={(effectId) => {
                     if (!panelClip) return;
                     toggleEffect(panelClip.id, effectId);
                   }}
                 />
               )}
{mode === 'tools' && (
                  <ToolsPanel
                    settings={settings.tools ?? {}}
                    onToggle={(key, value) => {
                      const next = { ...(settings.tools ?? {}), [key]: value };
                      patch({ tools: next });
                    }}
                  />
                )}
                {mode === 'plugins' && (
                  <PluginsPanel
                    activePluginId={activePluginId}
                    onSelectPlugin={setActivePluginId}
                    onEnablePlugin={() => {}}
                    onConfigurePlugin={() => {}}
                    onRemovePlugin={() => {}}
                  />
                )}
                {/* ---- BRANDING EDITS GO THROUGH THE HISTORY ----

                  All three of these used to call `setTracks` directly. That made
                  applying, changing and removing a logo invisible to undo: the user
                  could add a logo, change their mind, press undo, and watch
                  everything else in the project revert while the logo stayed —
                  because the undo stack never heard about it. A control that edits
                  the document without joining the history is an edit you cannot take
                  back, which for a visible overlay on every exported frame is the
                  worst kind.

                  This note is a SIBLING of the conditional below rather than its
                  first child. A JSX comment as the first thing inside the
                  parentheses of an `&&` expression does not parse at all, and the
                  failure is reported several lines away at the element's first
                  attribute, which is a long way from the actual cause.
                */}
              {mode === 'branding' && (
                <BrandingPanel
                  tracks={tracks}
                  onAddClip={(clip, trackId) =>
                    commitFrom((prev) =>
                      prev.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t))
                    )
                  }
                  onRemoveClip={(clipId) =>
                    commitFrom((prev) =>
                      prev.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }))
                    )
                  }
                  onUpdateClip={(clipId, patch) =>
                    commitFrom((prev) =>
                      prev.map((t) => ({
                        ...t,
                        clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
                      }))
                    )
                  }
                  onAddSponsor={(file) => {
                    const track = tracks.find((t) => t.type === 'branding');
                    if (!track) return;
                    // Registered as MEDIA, not as a bare URL. A blob URL held only by
                    // a clip cannot be written to IndexedDB, so this mark would
                    // disappear on reload — the same class of bug that stopped
                    // recordings from surviving a save.
                    const item = media.addRecorded({
                      name: file.name || 'Sponsor logo',
                      kind: 'image',
                      blob: file,
                      duration: projectDuration(tracks, 30),
                    });
                    const clip: TimelineClip = {
                      ...makeClip(item, 'video', 0, Math.max(1, Math.round(projectDuration(tracks, 30) * fps))),
                      id: nextId('clip'),
                      mediaName: item.name,
                      type: 'branding',
                      brandingRole: 'sponsor',
                      muted: true,
                      volume: 0,
                      opacity: 1,
                      transform: {
                        ...DEFAULT_TRANSFORM,
                        corner: 'bottom-right',
                        pipSize: 0.1,
                        x: 0.5,
                        y: 0.5,
                      },
                    };
                    commitFrom((prev) =>
                      extendBranding(addToTracks(prev, track.id, clip), projectDuration(tracks, 30))
                    );
                    setToast(`“${item.name}” added as the bottom-right mark`);
                  }}
                  onRemoveSponsor={(clipId) => removeClipById(clipId)}
                />
              )}
              {mode === 'help' && <HelpPanel />}
            </div>
          </div>
        )}
        <ResizableHandle
          axis="x"
          label={settings.binWidth > 0 ? 'Resize media bin' : 'Show media bin'}
          value={settings.binWidth}
          min={BIN.min}
          max={BIN.max}
          onChange={(v) => patch({ binWidth: v })}
        />

        {/* ---- Preview + player controls ----
            `min-h-0 flex-1` so it absorbs the leftover space: the timeline
            handle moves the TIMELINE's height and the preview takes the rest,
            so growing the timeline shrinks the preview rather than pushing the
            status strip off the screen. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div data-preview-pane className="min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]">
            <MediaPlayerCanvasOverlay
              isActive={true}
              videoWidth={resolution.width}
              videoHeight={resolution.height}
              onSelectRegion={(x, y, width, height) => {
                // Handle region selection
              }}
              onCoordinatesChange={(x, y) => {
                // Handle coordinate change
              }}
              scale={settings.viewerZoom}
              offsetX={0}
              offsetY={0}
            >
              <PreviewCanvas
                tracks={tracks}
                transitions={transitions}
                settings={{ name: projectName, width: resolution.width, height: resolution.height, fps, background }}
                currentFrame={playheadFrame}
                fps={fps}
                playing={playing}
                playbackRate={settings.playbackRate}
                masterVolume={settings.masterVolume}
                viewerZoom={settings.viewerZoom}
                viewerLayout={settings.viewerLayout}
                showBadge={settings.viewerBadge}
                previewClip={previewClip}
                onHoverClipFrame={setHoverClipFrame}
                seekTo={seekTo}
                onFrame={setPlayheadFrame}
                onEnded={() => {
                  setPlaying(false);
                  if (settings.loopEnabled) setPlayhead(settings.loopStartFrame);
                }}
                onCanvasReady={onCanvasReady}
                onNeedPeaks={needPeaks}
              />
            </MediaPlayerCanvasOverlay>
          </div>
          <PlayerBar
            currentFrame={playheadFrame}
            durationFrames={durationFrames}
            fps={fps}
            isPlaying={playing}
            volume={settings.masterVolume}
            muted={settings.masterVolume === 0}
            viewerZoom={settings.viewerZoom}
            viewerLayout={settings.viewerLayout}
            onViewerZoom={(z) => patch({ viewerZoom: z })}
            onViewerLayout={(l) => patch({ viewerLayout: l })}
            badge={settings.viewerBadge}
            onToggleBadge={() => patch({ viewerBadge: !settings.viewerBadge })}
            clipUnderPlayhead={clipUnderPlayhead(tracks, playheadSeconds)}
            loopOn={settings.loopEnabled}
            onToggleLoop={() =>
              patch(
                settings.loopEnabled
                  ? { loopEnabled: false }
                  : { loopEnabled: true, loopStartFrame: Math.max(0, playheadFrame - Math.round(fps * 5)), loopEndFrame: durationFrames }
              )
            }
            onVolume={(v) => patch({ masterVolume: v })}
            onTogglePlay={togglePlay}
            onSeek={(frame) => setPlayhead(frame)}
          />
        </div>
      </div>

      {/* ---- Horizontal split handle: `invert` because growing the timeline
          means dragging UP. ---- */}
      <ResizableHandle
        axis="y"
        label="Resize timeline"
        value={settings.timelineHeight}
        min={TIMELINE.min}
        max={TIMELINE.max}
        onChange={(v) => patch({ timelineHeight: v })}
        invert
      />

      {/* ---- Timeline, full width.
          NEW STRUCTURE: the ruler is FIXED — it stays put when clips scroll
          vertically. The ruler lives in its OWN horizontally-scrollable container
          (rulerScrollRef) with overflow-y-hidden only. The tracks live in
          laneScrollRef with overflow-y-auto. A scroll-sync effect keeps both
          containers' scrollLeft in lockstep so time markers stay aligned with clips.

          Ruler height is RULER_HEIGHT (40px), imported from the ruler component
          so the header column row cannot drift.

          will-change: promotes both scroll containers to GPU layers for 60FPS
          mobile touch scrolling — no jank on trackpads or phone screens. ---- */}
      <div style={{ height: settings.timelineHeight }} className="flex min-h-0 shrink-0 flex-col overflow-hidden">
        {/*
          RULER ROW — FIXED: does NOT scroll vertically with clips.
          Only overflows horizontally, synced to the tracks below.
          The ruler's own TimelineRuler component renders its internal playhead
          (rose-500 bar + triangle head) within this RULER_HEIGHT window. ---- */}
        <div className="relative flex shrink-0 flex-col overflow-hidden bg-[#1a1a1a]">
          <TimelineToolbar
            maxFps={maxFps}
            canSplit={Boolean(panelClip)}
            canDelete={selectedIds.size > 0}
            canUndo={history.length > 0}
            canRedo={future.length > 0}
            selectedCount={selectedIds.size}
            linkedSelection={linkedMove}
            ripple={settings.rippleEnabled}
            pxPerFrame={pxPerFrame}
            fps={fps}
            onSplit={() => {
              const hit = bladeRef.current?.();
              setToast(hit ? `Split "${hit}" at frame ${playheadFrame}` : 'Nothing under the playhead to split');
            }}
            onDelete={() => removeSelected()}
            onUndo={undo}
            onRedo={redo}
            onCopy={copySelected}
            onPaste={pasteClipboard}
            onDuplicate={duplicateSelected}
            onToggleSnapping={() => patch({ snapEnabled: !settings.snapEnabled })}
            snapping={settings.snapEnabled}
            onToggleRipple={() => patch({ rippleEnabled: !settings.rippleEnabled })}
            onZoom={(d) => zoomAt(d > 0 ? 1.25 : 1 / 1.25, null)}
            onZoomTo={(px) => patch({ pxPerFrame: px })}
            onFit={() => patch({ pxPerFrame: 3 })}
            onRecord={() => setRecording(true)}
            onFullscreen={() => {
              const el = document.querySelector('[data-preview-pane]');
              if (el instanceof HTMLElement) {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void el.requestFullscreen().catch(() => {});
              }
            }}
onToggleLoop={() =>
              patch(
                settings.loopEnabled
                  ? { loopEnabled: false }
                  : { loopEnabled: true, loopStartFrame: Math.max(0, playheadFrame - Math.round(fps * 5)), loopEndFrame: durationFrames }
              )
            }
            loopOn={settings.loopEnabled}
            onFpsChange={(fps) => patch({ fps })}
            playbackRate={settings.playbackRate}
            onPlaybackRate={(rate) => patch({ playbackRate: rate })}
            onEdgeEdit={edgeEdit}
            isPromptStudioOpen={showAIPromptStudio}
            onTogglePromptStudio={() => setShowAIPromptStudio((o) => !o)}
            onOpenFrameTemplateEditor={() => {
              const id = selectedIdsArr.length === 1 ? selectedIdsArr[0] : null;
              if (id) {
                setFrameTemplateClipId(id);
                setShowFrameTemplateEditor(true);
              } else {
                setToast('Select one clip first to open Frame Template Editor');
              }
            }}
          />
          {/*
            RULER ROW — FIXED: does NOT scroll vertically with clips.
            Only overflows horizontally, synced to the tracks below.
            The ruler's own TimelineRuler component renders its internal playhead
            (rose-500 bar + triangle head) within this RULER_HEIGHT window. ---- */}
          <div className="relative flex shrink-0 overflow-hidden bg-[#1a1a1a]">
            {/*
              A slot the width of the track-header column, parallel to the
              ruler — and the ADD-TRACK button lives here, FIXED.

              Hinglish: pehle yahan sirf khaali spacer tha aur "+" icon header
              column ke andar tha. Header column lanes ke saath vertically
              scroll hota hai, to clips scroll karne se "+" gum ho jata tha.
              Ab button yahan ruler ke exactly parallel hai — kabhi scroll
              nahi hota. Header ke andar uska RULER_HEIGHT column hatane se
              header ke track rows bhi lanes se perfectly align ho gaye
              (pehle 40px neeche the).
            */}
            <div
              style={{ width: TRACK_HEADER_W, height: RULER_HEIGHT }}
              className="flex shrink-0 items-center justify-center bg-[#1a1a1a]"
            >
              <TrackAddMenu onAddTrack={addTrack} />
            </div>
<div
            ref={rulerScrollRef}
            className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth will-change-scroll-position custom-scrollbar horizontal"
            style={{ height: RULER_HEIGHT }}
          >
              <div className="relative" style={{ width: laneWidth, height: RULER_HEIGHT }}>
                <TimelineRuler
                  duration={duration}
                  currentFrame={playheadFrame}
                  pxPerFrame={pxPerFrame}
                  fps={fps}
                  laneWidth={laneWidth}
                  onSeek={seekTo}
                  onZoomAt={zoomAt}
                  loop={loop}
                  onSetLoop={(start, end) =>
                    patch({ loopEnabled: true, loopStartFrame: Math.round(start * fps), loopEndFrame: Math.round(end * fps) })
                  }
                  markers={markers}
                  measure={{ start: settings.measureStartFrame, end: settings.measureEndFrame }}
                  onSetMeasure={(start, end) => patch({ measureStartFrame: start, measureEndFrame: end })}
                  gridVisible={settings.gridVisible}
                  snapEnabled={settings.snapEnabled}
                />
              </div>
            </div>
          </div>
        </div>
        {/*
          ======================================================================
          TIMELINE ROW — ADAPTIVE LAYOUT (isAuraOpen ? 50/50 split : 100% lanes)
          ======================================================================
          Hinglish:
            * AURA band (isAuraOpen === false): lane-scroll `flex-1` = lanes
              100% full container width le lete hain. AURA panel slot
              conditionally NAHI render hota — cleanly unmount + collapse.
            * AURA open (superadmin gate pass): andar ek flex row:
              [ lanes w-1/2 ][ 1px separator ][ AURA panel w-1/2 ]
              — symmetric 50/50 division, separator flat minimalist 1px line
              (hover par #ff6500). Koi overlay nahi — sab flex children.
        */}
        <div className="flex min-h-0 flex-1">
          <div ref={headerScrollRef} className="shrink-0 overflow-x-hidden overflow-y-auto custom-scrollbar">
            <TrackHeaders
              tracks={tracks}
              trackHeights={settings.trackHeights}
              onTrackHeight={trackHeight}
              onToggleTrack={toggleTrack}
              onTrackVolume={trackVolume}
              onPatchClip={patchClip}
              onAddTrack={addTrack}
              onRemoveTrack={removeTrack}
              pxPerFrame={pxPerFrame}
              onZoom={(v) => patch({ pxPerFrame: v })}
              onFit={() => patch({ pxPerFrame: 3 })}
            />
          </div>
          <div className="flex min-w-0 flex-1">
            {/* ---- LEFT: standard multi-track rails ----
                Design token: grayish-black slate (#1e1e1e) backdrop.
                AURA closed -> flex-1 (100%); AURA open -> w-1/2. */}
            <div
              ref={laneScrollRef}
              data-lane-scroll=""
              className={
                showAuraStudio
                  ? 'min-w-0 w-1/2 overflow-x-auto overflow-y-auto bg-[#1e1e1e] will-change-transform custom-scrollbar'
                  : 'min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-[#1e1e1e] will-change-transform custom-scrollbar'
              }
            >
            <div className="relative" style={{ width: laneWidth }}>
              <TimelineTracks
                tracks={tracks}
                transitions={transitions}
                markers={markers}
                duration={duration}
                currentFrame={playheadFrame}
                pxPerFrame={pxPerFrame}
                fps={fps}
                visibleRange={visibleRange}
                trackHeights={settings.trackHeights}
                waveformVisible={settings.waveformVisible}
                gridVisible={settings.gridVisible}
                snapOptions={snapOptions}
                onSeek={seekTo}
                onSelectClip={(id) => setSelect(id ? [id] : [])}
                onSelectClips={(ids, additive) => {
                  setSelectedIds((prev) => {
                    const next = additive ? new Set(prev) : new Set<string>();
                    for (const id of ids) {
                      if (additive && next.has(id)) next.delete(id);
                      else next.add(id);
                    }
                    return next;
                  });
                  setSelectedTransitionId(null);
                }}
                onRemoveClip={removeClipById}
                onTrimClip={trimClip}
                onSetFade={setFade}
                onSplitClip={splitClip}
                onMoveClip={previewMove}
                onMoveCommit={commitMove}
                onRoll={onRoll}
                onHoverClip={setPreviewClip}
                hoverClipFrame={hoverClipFrame}
                hoverClipId={previewClip?.id ?? null}
                onBladeReady={setBlade}
                  onToggleTrack={toggleTrack}
                  onTrackVolume={trackVolume}
                  onTrackHeight={trackHeight}
                  onAddTrack={addTrack}
                  onRemoveTrack={removeTrack}
                  onSelectTransition={setSelectedTransitionId}
                  onRemoveTransition={removeTransition}
                  onChangeTransition={changeTransition}
                  onOpenInspector={setInspecting}
                  onOpenFrameTemplateEditor={(clipId) => {
                    setFrameTemplateClipId(clipId);
                    setShowFrameTemplateEditor(true);
                  }}
                  onToggleLink={toggleLink}
                  onDropMedia={(mediaId, trackId, atFrame) => {
                    const item = media.byId.get(mediaId);
                    if (item) addMedia(item, trackId, atFrame);
                  }}
                  onDropHoverChange={() => undefined}
                  selectedClipId={selectedIdsArr.length === 1 ? selectedIdsArr[0] : null}
                  selectedTransitionId={selectedTransitionId}
                  selectedIdsCount={selectedIds.size}
                  clipboardHasContent={clipboard.length > 0}
                  // ONE handler for the context menu, the toolbar and the
                  // keyboard. If each had its own implementation they would
                  // drift, and "Cut" from the menu would quietly do something
                  // slightly different from Ctrl+X.
                  onContextAction={(action) => {
                    if (action === 'cut') {
                      copySelected();
                      removeSelected();
                    } else if (action === 'copy') copySelected();
                    else if (action === 'paste') pasteClipboard();
                    else if (action === 'ripple') removeSelected(true);
                    else if (action === 'attach') {
                      // Attach / DETACH. The label in the menu states the action,
                      // so this one call does both - the same toggle the clip's
                      // own button uses, so the two can never disagree.
                      const id = selectedIdsArr[0];
                      const hit = id ? clipById.get(id) : null;
                      if (!id || !hit) {
                        setToast('Select one clip first');
                        return;
                      }
                      const result = attach(tracks, id);
                      if (!result.ok) {
                        setToast(result.label);
                        return;
                      }
                      commit(result.tracks);
                      setToast(result.label);
                    } else if (action === 'mute') {
                      const id = selectedIdsArr[0];
                      const hit = id ? clipById.get(id) : null;
                      if (!id || !hit) {
                        setToast('Select one clip first');
                        return;
                      }
                      patchClip(id, { muted: !hit.clip.muted });
                      setToast(hit.clip.muted ? `Unmuted “${hit.clip.mediaName}”` : `Muted “${hit.clip.mediaName}” — the rest of the lane is unaffected`);
                    } else if (action === 'split') {
                      const hit = bladeRef.current?.();
                      setToast(hit ? `Split “${hit}” at frame ${playheadFrame}` : 'Nothing under the playhead to split');
                    }
                  }}
                />
                {inspecting && (() => {
                  const clip = clipById.get(inspecting)?.clip;
                  if (clip) {
                    const track = clipById.get(inspecting)?.track;
                    const trackHeight = track ? settings.trackHeights[track.id] ?? 80 : 80;
                    return (
                      <FrameTemplateNodes
                        key={clip.id}
                        clipId={clip.id}
                        clipStartFrame={Math.round(clip.startTime * fps)}
                        clipDurationFrames={Math.round(clip.duration * fps)}
                        fps={fps}
                        pxPerFrame={pxPerFrame}
                        trackHeight={trackHeight}
                        onFrameSelect={(clipId, frameIndex) => setSelectedFrameIndex(frameIndex)}
                        onFrameEdit={(frameIndex, action) => {
                          // Handle frame edit actions
                        }}
                        onFrameHover={(clipId, frameIndex) => setHoveredFrameIndex(frameIndex)}
                        selectedFrameIndex={selectedFrameIndex}
                        hoveredFrameIndex={hoveredFrameIndex}
                        isAura={session.maxFps >= AURA_MAX_FPS}
                        isSuperadmin={session.isSuperadmin}
                      />
                    );
                  }
                  return null;
                })()}
                {/*
                  Playhead for tracks area ONLY. The ruler has its own playhead
                  inside TimelineRuler (orange-red bar + triangle). This one lives
                  in the tracks container so it follows vertical scroll of clips
                  but stays anchored horizontally with the shared scroll sync.
                */}
                <div
                  className="pointer-events-none absolute top-0 z-30 h-full w-px bg-[#ff6500]/80"
                  style={{ left: playheadFrame * pxPerFrame }}
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* ---- 1px FLAT SPLIT SEPARATOR (sirf AURA open par) ----
                Hinglish: minimalist 1px line — hover par #ff6500 accent.
                Ye `divide`/`border` class NAHI hai (wo borderless.css me 0
                hoti), balki ek plain bg-colored div hai — isliie dikhti hai. */}
            {showAuraStudio && (
              <div
                className="w-px shrink-0 bg-[#2a2a2a] transition-colors duration-150 hover:bg-[#ff6500]"
                aria-hidden="true"
              />
            )}

            {/* ---- RIGHT: AURA Micro-Frame Studio (inline 50/50 slot) ----
                Hinglish: AURA band ho to ye slot render hi nahi hota (unmount)
                aur lanes flex-1 se poori width le lete hain. Open par w-1/2.
                Panel apne andar superadmin+env gate check karta hai. */}
            {showAuraStudio && isAuraStudioEnabled && (
              <div className="w-1/2 shrink-0 overflow-hidden p-1">
                <AuraMicroFrameStudio
                  open={showAuraStudio}
                  onOpenChange={setShowAuraStudio}
                  activeFrame={playheadFrame}
                  fps={fps}
                  totalFrames={durationFrames}
                  onFrameChange={setPlayhead}
                  onPlayPause={togglePlay}
                  isPlaying={playing}
                  playbackSpeed={settings.playbackRate}
                  onPlaybackSpeedChange={(v) => patch({ playbackRate: v })}
                  durationMs={Math.round(duration * 1000)}
                  currentTimeMs={Math.round(playheadSeconds * 1000)}
                  userEmail={session.email}
                  isSuperadmin={session.isSuperadmin}
                />
              </div>
            )}
          </div>

            {/*
              The right rail: the voice meter at the full height of the lanes, and
              the ruler's zoom.

              It was in the player bar as a 16px stub, which read as a decoration
              rather than as a meter - and the ruler's zoom controls had been
              moved to the toolbar and then lost. Both belong here, beside the
              timeline they measure and zoom, using height the lanes already have.
            */}
            <TimelineRail
              playing={playing}
            />
          </div>
<TimelineFooter
            currentFrame={playheadFrame}
            duration={duration}
            fps={fps}
            tracks={tracks}
            transitions={transitions}
            markers={markers}
            drawnClips={drawnClipCount}
            selectedCount={selectedIds.size}
            projectName={projectName}
            dirty={dirty}
            snapEnabled={settings.snapEnabled}
            measure={{ start: settings.measureStartFrame, end: settings.measureEndFrame }}
            playbackRate={settings.playbackRate}
            /* Hinglish: AURA footer-center toggle. `visible` = superadmin
               session + env flag dono (RBAC gate) — warna footer me kuch
               nahi dikhta. Click = timeline 50/50 panel toggle. */
            auraToggle={{
              visible: isAuraStudioEnabled && session.isSuperadmin,
              open: showAuraStudio,
              onToggle: () => setShowAuraStudio((o) => !o),
            }}
            /* Hinglish: AI Prompt Studio footer-right toggle. `visible` = superadmin
               session + env flag dono (RBAC gate) — warna footer me kuch
               nahi dikhta. Click = AI chat window on top of all toggle. */
            aiToggle={{
              visible: isAIPromptStudioEnabled && session.isSuperadmin,
              open: showAIPromptStudio,
              onToggle: () => setShowAIPromptStudio((o) => !o),
            }}
          />
        </div>


      <RecorderDialog
        open={recording}
        onClose={() => setRecording(false)}
        onKeep={(items) => {
          // ---- INTO THE LIBRARY, NOT STRAIGHT ONTO THE TIMELINE ----
          //
          // This used to do both: register the take AND drop clips on the timeline
          // at the playhead. The second half is the wrong default, and it was the
          // wrong default in a specific, reported way — a keep made in separate
          // mode silently put a "Voiceover" clip on the timeline that nobody asked
          // for, next to a camera clip, and the arrangement was already made before
          // the user had looked at anything.
          //
          // A take is a FILE until the user places it. The library already has the
          // two ways to place one — click a tile to drop it at the playhead, or
          // drag it onto a lane — so nothing is lost by not guessing, and the
          // take is no longer half-committed to a track.
          //
          // Switching to the media panel is deliberate: the thing that just
          // happened is only real to the user if they can see it. Closing a dialog
          // and landing on an empty timeline looks like nothing happened at all.
          const added = items.map((it) =>
            media.addRecorded({ name: it.name, kind: it.kind, blob: it.blob, duration: it.duration })
          );
          for (const item of added) if (item.kind === 'audio') setAudioUrl(item.url);
          setMode('media');
          setToast(
            added.length === 1
              ? `“${added[0].name}” added to your library — click it to place it on the timeline`
              : `${added.length} clips added to your library — click one to place it`
          );
        }}
      />

      <ClipProperties
        clip={selectedClip}
        fps={fps}
        linkedClip={selectedClip?.linkedId ? clipById.get(selectedClip.linkedId)?.clip ?? null : null}
        onPatch={(p) => selectedClip && patchClip(selectedClip.id, p, `insp:${Object.keys(p).join(',')}`)}
        onReset={() =>
          selectedClip &&
          patchClip(
            selectedClip.id,
            {
              opacity: 1,
              fadeIn: 0,
              fadeOut: 0,
              volume: 1,
              muted: false,
              speed: 1,
              filter: { ...NEUTRAL_FILTER },
              transform: { ...DEFAULT_TRANSFORM, zoomStart: 1, zoomEnd: 1, panX: 0, panY: 0, rotation: 0 },
            },
            'reset'
          )
        }
        onClose={() => setInspecting(null)}
        onOpenFilters={() => {
          setInspecting(null);
          setMode('filters');
        }}
        onOpenLayouts={() => {
          setInspecting(null);
          setMode('layouts');
        }}
        onUnlink={() => selectedClip && toggleLink(selectedClip.id)}
      />

      {/* Open Frame Template Editor for selected clip */}
      {selectedClip && (
        <div className="fixed bottom-6 left-6 z-50">
          <button
            onClick={() => {
              setFrameTemplateClipId(selectedClip.id);
              setShowFrameTemplateEditor(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#ff6500] text-white text-sm font-medium hover:bg-[#e55a00] transition-colors shadow-lg border border-[#ff6500]/40"
          >
            <Layers className="h-4 w-4" />
            <span>Open Frame Template Editor</span>
          </button>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        state={compositorState}
        settings={{ name: projectName, width: resolution.width, height: resolution.height, fps, background }}
        duration={duration}
        projectName={projectName}
        startTime={playheadSeconds}
        endTime={duration}
        onToast={setToast}
      />

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-12 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-full-edge-strong bg-surface-raised/95 px-4 py-1.5 text-center text-[8px] text-fg shadow-lg"
        >
          {toast}
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmationDialog
        open={clipToDelete !== null}
        title="Remove Clip"
        message={`Are you sure you want to remove the clip "${clipById.get(clipToDelete ?? '')?.clip.mediaName || 'unknown'}"? This action cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => deleteClipById(clipToDelete!)}
        onCancel={() => setClipToDelete(null)}
      />

      <ConfirmationDialog
        open={clipsToDelete.size > 0}
        title="Remove Clips"
        message={`Are you sure you want to remove ${clipsToDelete.size} clip${clipsToDelete.size === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => deleteSelected()}
        onCancel={() => setClipsToDelete(new Set())}
      />

      <ConfirmationDialog
        open={trackToDelete !== null}
        title="Remove Track"
        message={`Are you sure you want to remove the track "${tracks.find((t) => t.id === trackToDelete)?.name || 'unknown'}"? All clips on this track will be deleted.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => deleteTrack(trackToDelete!)}
        onCancel={() => setTrackToDelete(null)}
      />

      <ConfirmationDialog
        open={transitionToDelete !== null}
        title="Remove Transition"
        message={`Are you sure you want to remove this transition? This action cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => deleteTransition(transitionToDelete!)}
        onCancel={() => setTransitionToDelete(null)}
      />

      <ConfirmationDialog
        open={markerToDelete !== null}
        title="Remove Marker"
        message={`Are you sure you want to remove the marker "${markers.find((m) => m.id === markerToDelete)?.label || 'unknown'}"? This action cannot be undone.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => removeMarker(markerToDelete!)}
        onCancel={() => setMarkerToDelete(null)}
      />

      <ConfirmationDialog
        open={projectToDelete}
        title="New Project"
        message="This will clear the current timeline and create a new empty project. All progress will be lost. Continue?"
        confirmLabel="Create New Project"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={() => {
          newProject();
          setProjectToDelete(false);
        }}
        onCancel={() => setProjectToDelete(false)}
      />

      {/* Recover Dialog - 24-hour clip recycle bin */}
      <RecoverDialog
        open={showRecoverDialog}
        deletedClips={recoveredClips}
        onRecover={(clipId) => {
          const clip = recoveredClips.find((c) => c.id === clipId);
          if (clip) {
            // Restore the clip to its original track
            setTracks((prev) =>
              prev.map((t) =>
                t.name === clip.trackName
                  ? { ...t, clips: [...t.clips, { ...clip, id: nextId('clip') } as any].sort((a, b) => a.startTime - b.startTime) }
                  : t
              )
            );
            setRecoveredClips((prev) => prev.filter((c) => c.id !== clipId));
            setToast(`Clip "${clip.mediaName}" recovered`);
          }
        }}
        onRecoverAll={() => {
          // Group by track and restore all
          const byTrack = new Map<string, DeletedClip[]>();
          recoveredClips.forEach((clip) => {
            const arr = byTrack.get(clip.trackName) || [];
            arr.push(clip);
            byTrack.set(clip.trackName, arr);
          });
          setTracks((prev) =>
            prev.map((t) => {
              const clips = byTrack.get(t.name);
              if (!clips) return t;
              return {
                ...t,
                clips: [...t.clips, ...clips.map((c) => ({ ...c, id: nextId('clip') } as any))].sort((a, b) => a.startTime - b.startTime),
              };
            })
          );
          setRecoveredClips([]);
          setToast(`Recovered ${recoveredClips.length} clips`);
        }}
onClose={() => setShowRecoverDialog(false)}
      />

      {/* AI Prompt Studio — floating on-top chat window */}
      <AIPromptStudio
        isOpen={showAIPromptStudio}
        onClose={() => setShowAIPromptStudio(false)}
        currentClip={panelClip}
        panelClip={panelClip}
        timelineTime={playheadSeconds}
        tracks={tracks}
        patchClip={patchClip}
        setToast={setToast}
        setSelect={setSelect}
      />

      {/* Frame Template Editor — per-frame reusable template editor */}
      <FrameTemplateEditor
        isOpen={showFrameTemplateEditor}
        onClose={() => setShowFrameTemplateEditor(false)}
        clipId={frameTemplateClipId}
        clipName={panelClip?.mediaName ?? 'Clip'}
        clipDurationSeconds={panelClip?.duration ?? 5}
        fps={settings.fps}
        template={activeFrameTemplate}
        activeFrameIndex={activeFrameIndex}
        onTemplateCreated={(templateId) => {
          setToast('Frame template created for clip');
        }}
        onTemplateUpdated={(templateId) => {
          setToast('Frame template updated');
        }}
        onTemplateChange={(tpl, idx) => {
          setActiveFrameTemplate(tpl ?? null);
          setActiveFrameIndex(idx);
        }}
      />

    </div>
  );
}


























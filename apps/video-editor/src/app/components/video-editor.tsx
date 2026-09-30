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
  TimelineFooter,
  acceptsTrack,
  type SnapOptionsProp,
  type TimelineClip,
  type TimelineTrack,
  type TrackType,
  type Transition,
} from './timeline/timeline-tracks';
import { ModeRail, type EditorMode } from './sidebar/mode-rail';
import { PlayerBar } from './player-bar';
import { EditorToolbar } from './chrome/editor-toolbar';
import { RecorderDialog } from './chrome/recorder-dialog';
import { TimelineRuler } from './timeline/timeline-ruler';
import { PreviewCanvas } from './preview/preview-canvas';
import { ResizableHandle, useClampToViewport } from './layout/resizable';
import { MediaBin } from './panels/media-bin';
import { TransitionsPanel } from './panels/transitions-panel';
import { FiltersPanel, TitlesPanel, StickersPanel, PanZoomPanel, LayoutsPanel } from './panels/style-panels';
import { AudioPanel } from './panels/audio-panel';
import { ProjectPanel } from './panels/project-panel';
import { HelpPanel } from './panels/help-panel';
import { ClipProperties } from './inspector/clip-properties';
import { ExportDialog } from './export/export-dialog';
import { Compositor } from '../lib/engine/compositor';
import { extractPeaks } from '../lib/engine/waveform';
import { useMediaStore, type MediaItem } from '../lib/engine/media-store';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRACKS,
  DEFAULT_TRANSFORM,
  NEUTRAL_FILTER,
  clipEnd,
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
  frameToSeconds,
  rescalePxPerFrame,
  secondsToFrame,
  timecode,
} from '../lib/engine/frames';
import { useSettings, setSettings, getSettings } from '../lib/engine/settings';
import { nextMarkerId, nextMarker, prevMarker, type Marker } from '../lib/engine/markers';
import { MIN_CLIP_FRAMES, rippleTrim, roll, slide, slip } from '../lib/engine/edits';
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

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export function VideoEditor() {
  const media = useMediaStore();

  // ---- Persistent workspace ----
  // One hook for all of it. `settings.fps` is the timeline's rate: a 2 second
  // clip is 48 frames at 24 and 120 at 60, so which rate is in force changes
  // what every number on the timeline means.
  const [settings, patch] = useSettings();
  const fps = coerceFps(settings.fps);

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
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [previewClip, setPreviewClip] = useState<TimelineClip | null>(null);
  const [visibleRange, setVisibleRange] = useState({ startFrame: 0, endFrame: 600 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const laneScrollRef = useRef<HTMLDivElement | null>(null);
  const bladeRef = useRef<(() => string | null) | null>(null);
  const patchStamp = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const playheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pxPerFrame = clampPxPerFrame(settings.pxPerFrame);
  const duration = useMemo(() => projectDuration(tracks, 5), [tracks]);
  const durationFrames = Math.max(1, Math.round(duration * fps));
  const laneWidth = Math.max(durationFrames * pxPerFrame, 200);
  const playheadSeconds = playheadFrame / fps;

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

  const docSnapshot = useCallback(
    (): ProjectDoc => ({
      version: 3,
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
    thumbnail: item.kind === 'image' ? item.url : undefined,
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

  const firstTrackOf = useCallback(
    (type: TrackType, role: 'base' | 'overlay' = 'base') =>
      tracks.find((t) => t.type === type && t.role === role) ?? tracks.find((t) => t.type === type) ?? tracks[0],
    [tracks]
  );

  const addMedia = useCallback(
    (item: MediaItem, trackId?: string, atFrame?: number) => {
      const type: TrackType =
        item.kind === 'audio' ? 'audio' : item.kind === 'text' ? 'text' : item.kind === 'image' ? 'image' : 'video';
      const target = trackId ? tracks.find((t) => t.id === trackId) : firstTrackOf(type);
      if (!target) return;
      if (!acceptsTrack(type, target.type)) {
        setToast(`A ${type} item cannot go on ${target.name} (${target.type})`);
        return;
      }
      const lenFrames = item.duration && item.duration > 0 ? Math.round(item.duration * fps) : fps * 5;
      const start = Math.max(0, atFrame ?? playheadFrame);
      const clip = makeClip(item, type, start, lenFrames);
      commit(addToTracks(tracks, target.id, clip));
      setSelectedIds(new Set([clip.id]));
      setToast(`Added “${item.name}” to ${target.name} at frame ${start} (${timecode(frameToSeconds(start, fps), fps)})`);
    },
    [tracks, playheadFrame, firstTrackOf, makeClip, addToTracks, commit, fps]
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
      commit(addToTracks(tracks, target.id, clip));
      setSelectedIds(new Set([clip.id]));
      setToast('Title added — edit the words in this panel');
    },
    [firstTrackOf, addToTracks, playheadFrame, commit, tracks, fps]
  );

  // ---- Clip editing ----
  const removeClipById = useCallback(
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
      const count = selectedIds.size;
      const next = tracks.map((t) => {
        const gone = t.clips.filter((c) => selectedIds.has(c.id));
        if (gone.length === 0) return t;
        const kept = t.clips.filter((c) => !selectedIds.has(c.id));
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
      setToast(doRipple ? `Ripple-deleted ${count} clip${count === 1 ? '' : 's'} and closed the gap` : `Deleted ${count} clip${count === 1 ? '' : 's'}`);
    },
    [selectedIds, tracks, commit, fps]
  );

  /** Trim, in FRAMES. The only unit the timeline speaks. */
  const trimClip = useCallback(
    (clipId: string, edge: 'in' | 'out', deltaFrames: number) => {
      setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            const startFrame = Math.round(c.startTime * fps);
            const lengthFrames = Math.max(MIN_CLIP_FRAMES, Math.round(c.duration * fps));
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
              duration: frameToSeconds(Math.max(MIN_CLIP_FRAMES, lengthFrames + deltaFrames), fps),
            };
          }),
        }))
      );
    },
    [fps]
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
      const left: TimelineClip = { ...hit.clip, duration: frameToSeconds(offset, fps), id: `${hit.clip.id}-a-${uid++}` };
      const right: TimelineClip = {
        ...hit.clip,
        id: `${hit.clip.id}-b-${uid++}`,
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

  // ---- The four edge edits ----
  const applyEditResult = useCallback(
    (result: { tracks: TimelineTrack[]; label: string } | null) => {
      if (!result) {
        setToast('That edit needs two adjacent clips on the same lane');
        return;
      }
      commit(result.tracks);
      setToast(result.label);
    },
    [commit]
  );

  const onRoll = useCallback(
    (trackId: string, leftId: string, rightId: string, deltaFrames: number) => {
      applyEditResult(roll(tracks, trackId, leftId, rightId, deltaFrames, fps));
    },
    [tracks, fps, applyEditResult]
  );

  /** Ripple trim on the selected clip's edge, moved by `deltaFrames`. */
  const doRippleTrim = useCallback(
    (edge: 'in' | 'out', deltaFrames: number) => {
      const id = selectedIdsArr[0];
      const hit = id ? clipById.get(id) : null;
      if (!id || !hit) {
        setToast('Select one clip first');
        return;
      }
      applyEditResult(rippleTrim(tracks, hit.track.id, id, edge, deltaFrames, fps));
    },
    [selectedIdsArr, clipById, tracks, fps, applyEditResult]
  );

  const doSlip = useCallback(
    (deltaFrames: number) => {
      const id = selectedIdsArr[0];
      const hit = id ? clipById.get(id) : null;
      if (!id || !hit) {
        setToast('Select one clip first');
        return;
      }
      applyEditResult(slip(tracks, hit.track.id, id, deltaFrames, fps));
    },
    [selectedIdsArr, clipById, tracks, fps, applyEditResult]
  );

  const doSlide = useCallback(
    (deltaFrames: number) => {
      const id = selectedIdsArr[0];
      const hit = id ? clipById.get(id) : null;
      if (!id || !hit) {
        setToast('Select one clip first');
        return;
      }
      applyEditResult(slide(tracks, hit.track.id, id, deltaFrames, fps));
    },
    [selectedIdsArr, clipById, tracks, fps, applyEditResult]
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
    setTracks((prev) => (prev.length <= 1 ? prev : prev.filter((t) => t.id !== trackId)));
    setTransitions((prev) => prev.filter((t) => t.trackId !== trackId));
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

  const removeTransition = useCallback((id: string) => {
    setTransitions((prev) => prev.filter((t) => t.id !== id));
    setSelectedTransitionId(null);
    setToast('Transition removed');
  }, []);

  // ---- Markers ----
  const addMarker = useCallback(() => {
    setMarkers((prev) => [
      ...prev,
      { id: nextMarkerId(), frame: playheadFrame, label: `Marker ${prev.length + 1}`, colour: 'amber', kind: 'point' },
    ]);
    setToast(`Marker added at frame ${playheadFrame}`);
  }, [playheadFrame]);

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

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }, []);

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
      // The project's rate wins over the workspace's: a project saved at 25fps
      // reopened at 30fps would change the meaning of every frame on screen.
      patch({ fps: rate, lastProjectId: doc.id, playheadFrame: 0, pxPerFrame: rescalePxPerFrame(pxPerFrame, fps, rate) });
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

  // Reopen whatever was open last, so a reload is not a lost session. This is
  // also what makes REDO work across a reload: the future stack is part of the
  // saved document, not a session artefact.
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    const id = getSettings().lastProjectId || lastOpenedId();
    if (id) void openProject(id);
  }, [hydrated, openProject]);

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
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

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
        // Ripple trim: Shift+Alt+Arrow, because the plain arrows are frame
        // stepping and the alt+arrows are the other three edge edits.
        if (e.shiftKey && e.altKey) {
          const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
          if (delta) {
            e.preventDefault();
            doRippleTrim('out', delta);
            return;
          }
        }
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const delta = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) doSlip(delta);
          else doSlide(delta);
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
    const id = setTimeout(() => setToast(null), 3400);
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

  const compositorState = useMemo(
    () => ({
      tracks,
      transitions,
      settings: { name: projectName, width: resolution.width, height: resolution.height, fps, background },
      sources: new Map(media.items.map((i) => [i.id, { url: i.url, kind: i.kind }])),
      masterVolume: settings.masterVolume,
    }),
    [tracks, transitions, projectName, resolution, fps, background, media.items, settings.masterVolume]
  );

  const snapOptions: SnapOptionsProp = {
    enabled: settings.snapEnabled,
    toPlayhead: settings.snapToPlayhead,
    toClips: settings.snapToClips,
    toMarkers: settings.snapToMarkers,
    toTimelineEnds: settings.snapToTimelineEnds,
    thresholdPx: settings.snapThresholdPx,
    playheadFrame,
    onSnap: () => undefined,
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

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
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
          const hit = bladeRef.current?.();
          setToast(hit ? `Split “${hit}” at frame ${playheadFrame}` : 'Nothing under the playhead to split');
        }}
        onDelete={() => removeSelected()}
        onUndo={undo}
        onRedo={redo}
        onSelectAll={() => setSelect(tracks.flatMap((t) => t.clips.map((c) => c.id)))}
        onCopy={copySelected}
        onPaste={pasteClipboard}
        onDuplicate={duplicateSelected}
        onToggleSnapping={() => patch({ snapEnabled: !settings.snapEnabled })}
        snapping={settings.snapEnabled}
        onToggleRipple={() => patch({ rippleEnabled: !settings.rippleEnabled })}
        onZoom={(d) => zoomAt(d > 0 ? 1.25 : 1 / 1.25, null)}
        onFit={() => patch({ pxPerFrame: 3 })}
        onFullscreen={() => {
          const el = document.querySelector('[data-preview-pane]');
          if (el instanceof HTMLElement) {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen().catch(() => {});
          }
        }}
        onOpenBin={() => fileInputRef.current?.click()}
        onRecord={() => setRecording(true)}
        onNewProject={newProject}
        onSave={() => void doSave().then((r) => setToast(r.saved ? 'Project saved' : r.error ?? 'Save failed'))}
        onExport={() => setExportOpen(true)}
        onSnapshot={snapshot}
        onToggleLoop={() =>
          patch(
            settings.loopEnabled
              ? { loopEnabled: false }
              : { loopEnabled: true, loopStartFrame: Math.max(0, playheadFrame - Math.round(fps * 5)), loopEndFrame: durationFrames }
          )
        }
        loopOn={settings.loopEnabled}
        onOpenProject={() => setMode('project')}
        onAddMarker={addMarker}
        markerCount={markers.length}
        onClearMarkers={() => setMarkers([])}
        onMarkerStep={gotoMarker}
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
          theme={settings.theme}
          onToggleTheme={() => patch({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          waveformVisible={settings.waveformVisible}
          onToggleWaveforms={() => patch({ waveformVisible: !settings.waveformVisible })}
          gridVisible={settings.gridVisible}
          onToggleGrid={() => patch({ gridVisible: !settings.gridVisible })}
          snapEnabled={settings.snapEnabled}
        />

        {settings.binWidth > 0 && (
          <div style={{ width: settings.binWidth }} className="shrink-0 overflow-hidden border-r border-edge bg-surface">
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
                    const url = URL.createObjectURL(blob);
                    setAudioUrl(url);
                    addMedia({
                      id: nextId('m'),
                      name: `silence-removed-${Date.now()}.wav`,
                      kind: 'audio',
                      url,
                      duration: undefined,
                      sizeBytes: blob.size,
                      file: blob,
                      poster: null,
                      peaks: null,
                      createdAt: Date.now(),
                    });
                    setToast('Silence-removed take added at the playhead');
                  }}
                  onRecord={() => setRecording(true)}
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
          <div data-preview-pane className="min-h-0 flex-1 overflow-hidden">
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
              seekTo={seekTo}
              onFrame={setPlayheadFrame}
              onEnded={() => {
                setPlaying(false);
                if (settings.loopEnabled) setPlayhead(settings.loopStartFrame);
              }}
              onCanvasReady={onCanvasReady}
              onNeedPeaks={needPeaks}
            />
          </div>
          <PlayerBar
            currentFrame={playheadFrame}
            durationFrames={durationFrames}
            fps={fps}
            isPlaying={playing}
            volume={settings.masterVolume}
            muted={settings.masterVolume === 0}
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

      {/* ---- Timeline, full width. Ruler, lanes and playhead share ONE
          horizontally scrolled strip, with the header column beside it. That is
          what makes their time axes the same axis. ---- */}
      <div style={{ height: settings.timelineHeight }} className="flex min-h-0 shrink-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <div ref={headerScrollRef} className="shrink-0 overflow-x-hidden overflow-y-auto">
            <TrackHeaders
              tracks={tracks}
              trackHeights={settings.trackHeights}
              onTrackHeight={trackHeight}
              onToggleTrack={toggleTrack}
              onTrackVolume={trackVolume}
              onAddTrack={addTrack}
              onRemoveTrack={removeTrack}
              pxPerFrame={pxPerFrame}
              onZoom={(v) => patch({ pxPerFrame: v })}
              onFit={() => patch({ pxPerFrame: 3 })}
            />
          </div>
          <div ref={laneScrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-surface">
            <div className="relative" style={{ width: laneWidth }}>
              <TimelineRuler
                duration={duration}
                currentTime={playheadSeconds}
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
                gridVisible={settings.gridVisible}
                snapEnabled={settings.snapEnabled}
              />
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
                onToggleLink={toggleLink}
                onDropMedia={(mediaId, trackId, atFrame) => {
                  const item = media.byId.get(mediaId);
                  if (item) addMedia(item, trackId, atFrame);
                }}
                onDropHoverChange={() => undefined}
                selectedClipId={selectedIdsArr.length === 1 ? selectedIdsArr[0] : null}
                selectedTransitionId={selectedTransitionId}
              />
              <div
                className="pointer-events-none absolute top-0 z-30 h-full w-px bg-rose-500/70"
                style={{ left: playheadFrame * pxPerFrame }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
        <TimelineFooter
          currentFrame={playheadFrame}
          duration={duration}
          fps={fps}
          tracks={tracks}
          transitions={transitions}
          markers={markers}
          renderedClips={visibleRange.endFrame - visibleRange.startFrame}
        />
      </div>

      {/* ---- Status footer. Pinned to the very bottom, OUTSIDE the resizable
          timeline pane, and resizes in HEIGHT only: a status strip has no
          horizontal extent and offering a horizontal drag would imply a
          behaviour that does not exist. ---- */}
      <div
        className="flex shrink-0 items-center justify-between border-t border-edge bg-surface px-3"
        style={{ height: settings.footerHeight }}
      >
        <div className="flex items-center gap-3 font-mono text-[10px] text-fg-secondary">
          <span>TC {timecode(playheadSeconds, fps)}</span>
          <span className="text-fg-muted/40">|</span>
          <span>FRAME {playheadFrame}/{durationFrames}</span>
          <span className="text-fg-muted/40">|</span>
          <span>{fps} fps</span>
          <span className="text-fg-muted/40">|</span>
          <span>{settings.snapEnabled ? 'SNAP ON' : 'SNAP OFF'}</span>
          <span className="text-fg-muted/40">|</span>
          <span className="truncate">{projectName}</span>
          <span className={dirty ? 'text-amber-400' : 'text-fg-muted'}>
            {dirty ? '●' : '○'}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-fg-muted">
          <span>
            {clipTotal} clips
            {selectedIds.size > 0 ? ` . ${selectedIds.size} selected` : ''}
            {markers.length > 0 ? ` . ${markers.length} markers` : ''}
          </span>
        </div>
      </div>
      <ResizableHandle
        axis="y"
        label="Resize status bar"
        value={settings.footerHeight}
        min={FOOTER.min}
        max={FOOTER.max}
        onChange={(v) => patch({ footerHeight: v })}
      />

      <RecorderDialog
        open={recording}
        onClose={() => setRecording(false)}
        onKeep={(items) => {
          for (const it of items) {
            addMedia({
              id: nextId('rec'),
              name: it.name,
              kind: it.kind,
              url: it.url,
              duration: it.duration,
              sizeBytes: 0,
              file: undefined,
              poster: null,
              peaks: null,
              createdAt: Date.now(),
            });
            if (it.kind === 'audio') setAudioUrl(it.url);
          }
          setToast(`${items.length} recording${items.length === 1 ? '' : 's'} added at frame ${playheadFrame}`);
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
          className="pointer-events-none fixed bottom-12 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-full border border-edge-strong bg-surface-raised/95 px-4 py-1.5 text-center text-xs text-fg shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

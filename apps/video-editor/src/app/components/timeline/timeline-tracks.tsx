'use client';

// ============================================================================
// Timeline lanes
// ============================================================================
//
// The clips themselves, plus the handles that make them editable.
//
// ---- WHAT A DRAG MEANS, AND HOW IT IS DECIDED ----
//
// Six gestures share one pointer-down. Which one is running is decided by what
// was grabbed, not by a mode flag, because a mode flag is one more thing to
// get out of step with the selection:
//
//   body           move the clip, and it may change lanes
//   in / out edge   trim (or ripple-trim with the modifier)
//   boundary       roll the cut between two ADJACENT clips
//   fade corner    fade length
//   empty space    marquee select, or seek if it never moved
//
// ---- WHY EVERYTHING IS IN FRAMES ----
//
// Positions are `frame * pxPerFrame`, and a drag converts a pixel delta to
// frames ONCE, before anything is rounded. Converting seconds-to-frames at
// several points in one gesture is how a trim ends up a frame out: two
// roundings disagree and the clip is one frame longer than the picture it was
// cut from.
//
// ---- VIRTUALISATION ----
//
// A 1000-clip project renders its visible window, not its content. The
// overscan is deliberately generous (a third of a screen each way) because a
// clip that appears only when its left edge is on screen pops in mid-drag,
// which reads as the timeline being broken rather than as an optimisation.
// The clip count is still shown in the footer, so nothing is hidden without
// being accounted for.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Film,
  Image as ImageIcon,
  Music,
  Type,
  Trash2,
  Volume2,
  VolumeX,
  Headphones,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Shuffle,
  Link2,
  Unlink,
  Wand2,
  ChevronDown,
  Flag,
} from 'lucide-react';
import { frameToTimecode, timecodeCompact } from '../../lib/engine/frames';
import { clipEnd, type TimelineClip, type TimelineTrack, type TrackType, type Transition } from '../../lib/engine/types';
import { TRANSITION_BY_ID } from '../../lib/engine/transitions';
import { MIN_CLIP_FRAMES } from '../../lib/engine/edits';
import { MARKER_COLOURS, type Marker } from '../../lib/engine/markers';
import { collectSnapTargets, findSnap, thresholdFrames, type SnapTarget } from '../../lib/engine/snap';
import { TimelineZoom } from './timeline-ruler';

export type { TimelineClip, TimelineTrack, TrackType, Transition } from '../../lib/engine/types';
export { DEFAULT_TRACKS } from '../../lib/engine/types';

const TRACK_HEADER_W = 178;
const DEFAULT_TRACK_HEIGHT = 56;

/** Minimum lane height. Below this the fader and the name cannot coexist. */
const MIN_TRACK_HEIGHT = 40;
/** Maximum, so one lane cannot be dragged to fill the window and hide the rest. */
const MAX_TRACK_HEIGHT = 200;

/**
 * Can a clip of this type live on a track of that type?
 *
 * A picture and a video share a lane: a still dropped on Video 1 is normal in
 * every NLE, and refusing it would be a rule with no purpose.
 */
export function acceptsTrack(clipType: TrackType, trackType: TrackType): boolean {
  if (clipType === trackType) return true;
  const visual = (t: TrackType) => t === 'video' || t === 'image';
  return visual(clipType) && visual(trackType);
}

// ---------------------------------------------------------------------------
// Track headers
// ---------------------------------------------------------------------------

/**
 * The track header column: a SIBLING of the scrolling lanes, never a prefix
 * of the ruler's scroll strip. Keeping it out of the strip is what lets the
 * ruler and the lanes share one time origin.
 *
 * Lane heights are per-track and persisted, because a user who made the audio
 * lane tall to work on a waveform has to be able to make it tall again after a
 * refresh without redoing it.
 */
export function TrackHeaders({
  tracks,
  trackHeights,
  onTrackHeight,
  onToggleTrack,
  onTrackVolume,
  onAddTrack,
  onRemoveTrack,
  pxPerFrame,
  onZoom,
  onFit,
}: {
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  onTrackHeight: (trackId: string, height: number) => void;
  onToggleTrack: (trackId: string, key: 'muted' | 'visible' | 'locked' | 'solo') => void;
  onTrackVolume: (trackId: string, volume: number) => void;
  onAddTrack: (type: TrackType) => void;
  onRemoveTrack: (trackId: string) => void;
  pxPerFrame: number;
  onZoom: (next: number) => void;
  onFit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  return (
    <div style={{ width: TRACK_HEADER_W }} className="shrink-0 overflow-hidden border-r border-edge bg-surface">
      <div className="flex h-8 items-center justify-between border-b border-edge px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Tracks</span>
        <div className="flex items-center gap-0.5">
          <TimelineZoom pxPerFrame={pxPerFrame} onZoom={onZoom} onFit={onFit} />
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              aria-label="Add a track"
              title="Add a track\nA second video lane is how picture-in-picture works."
              className="rounded p-0.5 text-fg-muted hover:bg-surface-overlay hover:text-fg"
            >
              {menuOpen ? <ChevronDown className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </button>
            {menuOpen && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-edge-strong bg-surface-raised py-1 shadow-xl"
              >
                {(['video', 'audio', 'text', 'image'] as TrackType[]).map((t) => {
                  const { Icon, label } = TRACK_STYLE[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        onAddTrack(t);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg hover:bg-sky-600 hover:text-white"
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t === 'text' ? 'Text / title track' : `${label} track`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {tracks.map((track) => {
        const { Icon } = TRACK_STYLE[track.type];
        const height = trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
        return (
          <div
            key={track.id}
            style={{ height }}
            className={[
              'group flex flex-col justify-center gap-0.5 border-b border-edge px-2',
              track.visible ? '' : 'opacity-50',
            ].join(' ')}
          >
            {/* Lane height. A drag on the header's bottom edge resizes the
                lane, and the value is persisted - a timeline that forgets how
                tall you made its lanes every refresh is a timeline you rebuild
                every refresh. */}
            <div
              role="separator"
              aria-label={`Resize ${track.name} lane`}
              aria-orientation="horizontal"
              tabIndex={0}
              aria-valuenow={height}
              aria-valuemin={MIN_TRACK_HEIGHT}
              aria-valuemax={MAX_TRACK_HEIGHT}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const startY = e.clientY;
                const startH = height;
                const move = (ev: PointerEvent) => {
                  // The handle sits on the header's TOP edge, so dragging it UP
                  // grows the lane. A plain `startH + dy` would shrink it - which
                  // feels like the lane is fighting you, and is invisible until
                  // you notice the header is taller than the lane it labels.
                  const next = startH - (ev.clientY - startY);
                  onTrackHeight(track.id, Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, next)));
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') onTrackHeight(track.id, Math.min(MAX_TRACK_HEIGHT, height + 8));
                if (e.key === 'ArrowDown') onTrackHeight(track.id, Math.max(MIN_TRACK_HEIGHT, height - 8));
              }}
              title={`${track.name} lane height — drag or use Up/Down`}
              className="absolute -mt-1 hidden h-2 w-full cursor-ns-resize group-hover:block"
            />

            <div className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={track.name}>
                {track.name}
              </span>

              {track.type === 'audio' && (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleTrack(track.id, 'muted')}
                    aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                    title={track.muted ? `Unmute ${track.name}` : `Mute ${track.name} · click to silence this track`}
                    className={`rounded p-0.5 ${track.muted ? 'bg-amber-500/20 text-amber-300' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg'}`}
                  >
                    {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleTrack(track.id, 'solo')}
                    aria-label={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                    title={
                      track.solo
                        ? `Unsolo ${track.name} · every other track is currently silenced`
                        : `Solo ${track.name} · hear only this track`
                    }
                    className={`rounded p-0.5 ${track.solo ? 'bg-emerald-500/20 text-emerald-300' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg'}`}
                  >
                    <Headphones className="h-3 w-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onToggleTrack(track.id, 'visible')}
                aria-label={track.visible ? `Hide ${track.name}` : `Show ${track.name}`}
                title={track.visible ? `Hide ${track.name}` : `Show ${track.name}`}
                className="rounded p-0.5 text-fg-muted hover:bg-surface-overlay hover:text-fg"
              >
                {track.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => onToggleTrack(track.id, 'locked')}
                aria-label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
                title={track.locked ? `Unlock ${track.name} · this lane rejects clips and drags` : `Lock ${track.name} · clips on this lane cannot be moved or trimmed`}
                className="rounded p-0.5 text-fg-muted hover:bg-surface-overlay hover:text-fg"
              >
                {track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.muted ? 0 : track.volume}
                onChange={(e) => onTrackVolume(track.id, Number(e.target.value))}
                // Wheel over a fader changes the level, which is what a mouse
                // wheel on a mixer strip has always done, and it must not also
                // scroll the timeline sideways.
                onWheel={(e) => {
                  e.preventDefault();
                  onTrackVolume(track.id, Math.max(0, Math.min(1, track.volume - e.deltaY * 0.001)));
                }}
                aria-label={`${track.name} volume`}
                title={`${track.name} volume · ${Math.round(track.muted ? 0 : track.volume * 100)}% — scroll on the fader to change it`}
                className="h-1 min-w-0 flex-1 cursor-pointer accent-sky-500"
              />
              <span className="w-7 shrink-0 text-right font-mono text-[9px] text-fg-muted">
                {Math.round((track.muted ? 0 : track.volume) * 100)}
              </span>
              <button
                type="button"
                onClick={() => onRemoveTrack(track.id)}
                aria-label={`Remove track ${track.name}`}
                title={`Remove ${track.name} and the clips on it`}
                className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-rose-400 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lane rendering
// ---------------------------------------------------------------------------

interface TimelineTracksProps {
  tracks: TimelineTrack[];
  transitions: Transition[];
  markers: Marker[];
  duration: number;
  currentFrame: number;
  /** PIXELS PER FRAME. */
  pxPerFrame: number;
  fps: number;
  /** Frames currently visible, plus overscan, so only those clips render. */
  visibleRange: { startFrame: number; endFrame: number };
  trackHeights: Record<string, number>;
  waveformVisible: boolean;
  gridVisible: boolean;
  snapOptions: SnapOptionsProp;

  onSeek: (time: number) => void;
  onSelectClip: (clipId: string | null) => void;
  onSelectClips: (ids: string[], additive: boolean) => void;
  onRemoveClip: (clipId: string) => void;
  onTrimClip: (clipId: string, edge: 'in' | 'out', frames: number) => void;
  onSetFade: (clipId: string, edge: 'in' | 'out', seconds: number) => void;
  onSplitClip: (clipId: string, atTime: number) => void;
  onMoveClip: (clipId: string, startFrame: number, trackId: string) => void;
  onMoveCommit: (clipId: string, startFrame: number, trackId: string, prevStartFrame: number, prevTrackId: string) => void;
  /** Roll the cut between two adjacent clips. */
  onRoll: (trackId: string, leftId: string, rightId: string, deltaFrames: number) => void;
  onHoverClip: (clip: TimelineClip | null) => void;
  onBladeReady: (fn: () => string | null) => void;
  onToggleTrack: (trackId: string, key: 'muted' | 'visible' | 'locked' | 'solo') => void;
  onTrackVolume: (trackId: string, volume: number) => void;
  onTrackHeight: (trackId: string, height: number) => void;
  onAddTrack: (type: TrackType) => void;
  onRemoveTrack: (trackId: string) => void;
  onSelectTransition: (id: string | null) => void;
  onRemoveTransition: (id: string) => void;
  onChangeTransition: (id: string, patch: Partial<Transition>) => void;
  onOpenInspector: (clipId: string) => void;
  onToggleLink: (clipId: string) => void;
  onDropMedia: (mediaId: string, trackId: string, atFrame: number) => void;
  onDropHoverChange: (trackId: string | null) => void;
  selectedClipId?: string | null;
  selectedTransitionId?: string | null;
}

export interface SnapOptionsProp {
  enabled: boolean;
  toPlayhead: boolean;
  toClips: boolean;
  toMarkers: boolean;
  toTimelineEnds: boolean;
  thresholdPx: number;
  playheadFrame: number;
}

export function TimelineTracks({
  tracks,
  transitions,
  markers,
  duration,
  currentFrame,
  pxPerFrame,
  fps,
  visibleRange,
  trackHeights,
  waveformVisible,
  gridVisible,
  snapOptions,
  onSeek,
  onSelectClip,
  onSelectClips,
  onRemoveClip,
  onTrimClip,
  onSetFade,
  onSplitClip,
  onMoveClip,
  onMoveCommit,
  onRoll,
  onHoverClip,
  onBladeReady,
  onToggleTrack,
  onTrackVolume,
  onTrackHeight,
  onAddTrack,
  onRemoveTrack,
  onSelectTransition,
  onRemoveTransition,
  onChangeTransition,
  onOpenInspector,
  onToggleLink,
  onDropMedia,
  onDropHoverChange,
  selectedClipId,
  selectedTransitionId,
}: TimelineTracksProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const laneEls = useRef(new Map<string, HTMLDivElement>());
  const [movingId, setMovingId] = useState<string | null>(null);
  const [hoverTrack, setHoverTrack] = useState<string | null>(null);
  const [binDropTrack, setBinDropTrack] = useState<string | null>(null);
  const reportDropHover = useCallback((id: string | null) => setBinDropTrack(id), []);
  const [snapLabel, setSnapLabel] = useState<string | null>(null);

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const laneWidth = Math.max(totalFrames * pxPerFrame, 200);

  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  /**
   * Lane-local x, in FRAMES.
   *
   * The lane stack sits INSIDE the shared scroll strip, so its own rect already
   * accounts for the scroll: there is no `scrollLeft` term here, and adding one
   * would double-count it.
   */
  const frameAt = useCallback(
    (clientX: number) => {
      const el = laneRef.current;
      if (!el) return 0;
      return Math.max(0, Math.min(Math.round((clientX - el.getBoundingClientRect().left) / pxPerFrame), totalFrames));
    },
    [pxPerFrame, totalFrames]
  );

  const trackAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const lane = el?.closest?.('[data-track]') as HTMLElement | null;
    if (lane?.getAttribute('data-track')) return lane.getAttribute('data-track');
    for (const [id, node] of laneEls.current) {
      const r = node.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return id;
    }
    return null;
  }, []);

  /**
   * Snap a candidate frame against every enabled target.
   *
   * The threshold is converted from pixels to frames ONCE per drag, because it
   * is a distance on screen and the zoom is fixed for the duration of a gesture.
   */
  /**
   * Snap a candidate frame against every enabled target.
   *
   * Every dependency here is a PRIMITIVE or a stable callback, and that is
   * deliberate. The trim and roll listeners attach once when the gesture starts
   * and are torn down when it ends; if this callback were rebuilt on every
   * render, each `pointermove` would tear the listener down and put it back,
   * and the events arriving in that gap would be dropped. A trim that loses
   * one pointermove in three looks exactly like a trim that stutters - and it
   * does so only when snapping is on, which is the worst possible place for a
   * bug that only appears when the feature is enabled.
   */
  const snapTargets = useCallback((): SnapTarget[] => {
    if (!snapOptions.enabled) return [];
    return collectSnapTargets({
      fps,
      enabled: snapOptions.enabled,
      toPlayhead: snapOptions.toPlayhead,
      toClips: snapOptions.toClips,
      toMarkers: snapOptions.toMarkers,
      toTimelineEnds: snapOptions.toTimelineEnds,
      thresholdPx: snapOptions.thresholdPx,
      pxPerFrame,
      playheadFrame: snapOptions.playheadFrame,
      markers,
      transitions,
      durationFrames: totalFrames,
      tracks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fps,
    snapOptions.enabled,
    snapOptions.toPlayhead,
    snapOptions.toClips,
    snapOptions.toMarkers,
    snapOptions.toTimelineEnds,
    snapOptions.thresholdPx,
    snapOptions.playheadFrame,
    pxPerFrame,
    markers,
    transitions,
    totalFrames,
    tracks,
  ]);

  const snapFrame = useCallback(
    (frame: number, edges: number[], excludeClipId: string | null) => {
      const res = findSnap(frame, edges, snapTargets(), thresholdFrames(snapOptions.thresholdPx, pxPerFrame));
      setSnapLabel(res.target?.label ?? null);
      return res;
    },
    [snapTargets, snapOptions.thresholdPx, pxPerFrame]
  );

  // ---- Trim -------------------------------------------------------------

  const trimRef = useRef<{ clipId: string; edge: 'in' | 'out'; startClientX: number; startStartFrame: number; startLength: number } | null>(null);
  const [trimming, setTrimming] = useState(false);
  const beginTrim = (e: ReactPointerEvent, clip: TimelineClip, edge: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    const startFrame = Math.round(clip.startTime * fps);
    trimRef.current = {
      clipId: clip.id,
      edge,
      startClientX: e.clientX,
      startStartFrame: startFrame,
      startLength: Math.round((clip.duration * fps)),
    };
    setTrimming(true);
  };

  useEffect(() => {
    if (!trimming) return;
    const move = (e: PointerEvent) => {
      const t = trimRef.current;
      if (!t) return;
      const deltaFrames = Math.round((e.clientX - t.startClientX) / pxPerFrame);
      if (t.edge === 'in') {
        // The in-edge cannot pass the out-edge. The bound is expressed in
        // FRAMES, which is the only place it is correct: in seconds the same
        // bound is a different number at every frame rate.
        const maxShift = t.startLength - MIN_CLIP_FRAMES;
        const raw = Math.max(-t.startStartFrame, Math.min(deltaFrames, maxShift));
        const res = snapFrame(t.startStartFrame + raw, [t.startStartFrame + raw], t.clipId);
        // The snapper returns the corrected position; the shell wants the
        // DELTA from where the edge started. Converting here rather than
        // passing a correction is the difference between a trim that follows
        // the pointer and a trim that only ever moves by the snapping error.
        onTrimClip(t.clipId, 'in', res.frame - t.startStartFrame);
      } else {
        // The out-edge. The raw frame delta is passed straight through and the
        // SHELL clamps it, because only the shell knows the source file's real
        // length - a clamp here could only guard against the minimum, and would
        // silently let a clip grow past the end of its own footage.
        const end = t.startStartFrame + t.startLength + deltaFrames;
        const res = snapFrame(end, [end], t.clipId);
        // Measured from the ORIGINAL end, not from `end`. Passing
        // `res.frame - end` would pass the snapping CORRECTION, which is zero
        // on every drag that does not snap - which is to say, on almost all of
        // them.
        onTrimClip(t.clipId, 'out', res.frame - (t.startStartFrame + t.startLength));
      }
    };
    const up = () => {
      trimRef.current = null;
      setTrimming(false);
      setSnapLabel(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [trimming, pxPerFrame, onTrimClip, snapFrame, fps]);

  // ---- Roll -------------------------------------------------------------

  const rollRef = useRef<{ trackId: string; leftId: string; rightId: string; startClientX: number } | null>(null);
  const [rolling, setRolling] = useState(false);
  const beginRoll = (e: ReactPointerEvent, trackId: string, left: TimelineClip, right: TimelineClip) => {
    e.stopPropagation();
    e.preventDefault();
    rollRef.current = { trackId, leftId: left.id, rightId: right.id, startClientX: e.clientX };
    setRolling(true);
  };
  useEffect(() => {
    if (!rolling) return;
    const move = (e: PointerEvent) => {
      const r = rollRef.current;
      if (!r) return;
      const delta = Math.round((e.clientX - r.startClientX) / pxPerFrame);
      const track = tracks.find((t) => t.id === r.trackId);
      const left = track?.clips.find((c) => c.id === r.leftId);
      if (!track || !left) return;
      const boundary = Math.round((left.startTime + left.duration) * fps);
      const res = snapFrame(boundary + delta, [boundary + delta], left.id);
      onRoll(r.trackId, r.leftId, r.rightId, res.frame - boundary);
    };
    const up = () => {
      rollRef.current = null;
      setRolling(false);
      setSnapLabel(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [rolling, pxPerFrame, fps, tracks, onRoll, snapFrame]);

  // ---- Fade -------------------------------------------------------------

  const fadeRef = useRef<{ clipId: string; edge: 'in' | 'out'; startY: number; startValue: number } | null>(null);
  const [fading, setFading] = useState(false);
  const beginFade = (e: ReactPointerEvent, clip: TimelineClip, edge: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    fadeRef.current = { clipId: clip.id, edge, startY: e.clientY, startValue: edge === 'in' ? clip.fadeIn : clip.fadeOut };
    setFading(true);
  };
  useEffect(() => {
    if (!fading) return;
    const move = (e: PointerEvent) => {
      const f = fadeRef.current;
      if (!f) return;
      // 2px of pointer travel = 0.1s, capped at half the clip: a fade longer
      // than the clip is not a fade.
      const delta = (f.startY - e.clientY) / 2 / 10;
      onSetFade(f.clipId, f.edge, f.startValue + delta);
    };
    const up = () => {
      fadeRef.current = null;
      setFading(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [fading, onSetFade]);

  // ---- Move -------------------------------------------------------------

  const beginMove = (e: ReactPointerEvent, clip: TimelineClip, fromTrack: TimelineTrack) => {
    if ((e.target as HTMLElement).closest('[aria-label^="Trim"], [aria-label^="Fade"], [aria-label^="Roll"]')) return;
    if (e.button !== 0) return;
    if (fromTrack.locked) return;
    if (!laneRef.current) return;
    const grabFrame = frameAt(e.clientX);
    const grabOffset = grabFrame - Math.round(clip.startTime * fps);
    const pid = e.pointerId;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured; the window listeners cover it */
    }

    let started = false;
    let finalFrame = Math.round(clip.startTime * fps);
    let finalTrack = fromTrack.id;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const raw = frameAt(ev.clientX) - grabOffset;
      const len = Math.round(clip.duration * fps);

      const under = trackAtPoint(ev.clientX, ev.clientY);
      const target = under ? tracks.find((t) => t.id === under) : undefined;
      if (target && acceptsTrack(clip.type, target.type) && !target.locked) {
        finalTrack = target.id;
        setHoverTrack(target.id);
      }

      // Both edges are offered to the snapper, because a user lining a clip up
      // with a playhead means whichever end happens to be nearer, and deciding
      // for them would make the gesture feel wrong half the time.
      //
      // `snappedEdges[0]` is the START edge after snapping - when nothing
      // snapped it is simply the candidate, which is what makes this correct
      // both with and without a snap nearby.
      const candidate = Math.max(0, raw);
      const res = snapFrame(candidate, [candidate, candidate + len], clip.id);
      finalFrame = Math.max(0, res.snappedEdges[0]);

      if (!started) {
        // A threshold before committing, so a plain click does not nudge the
        // clip by a frame. Two frames, not one: one frame is small enough that
        // a trackpad's resting jitter crosses it.
        if (Math.abs(finalFrame - Math.round(clip.startTime * fps)) < 2) return;
        started = true;
        setMovingId(clip.id);
        onSelectClip(clip.id);
      }
      onMoveClip(clip.id, finalFrame, finalTrack);
    };

    const onBlur = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onBlur, true);
      setMovingId(null);
      setHoverTrack(null);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      onBlur();
      setSnapLabel(null);
      if (started) onMoveCommit(clip.id, finalFrame, finalTrack, Math.round(clip.startTime * fps), fromTrack.id);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', onBlur);
    // A new pointer going down always ends whatever was in progress: a button
    // released outside the window never sends its pointerup, and without this
    // the previous drag's listeners would wait forever.
    window.addEventListener('pointerdown', onBlur, true);
  };

  // ---- Blade ------------------------------------------------------------

  const bladeAtPlayhead = useCallback(() => {
    const t = currentFrame / fps;
    for (const track of tracks) {
      const hit = track.clips.find((c) => currentFrame > Math.round(c.startTime * fps) && currentFrame < Math.round(clipEnd(c) * fps));
      if (hit) {
        onSplitClip(hit.id, t);
        return hit.mediaName;
      }
    }
    return null;
  }, [tracks, currentFrame, fps, onSplitClip]);

  useEffect(() => {
    onBladeReady(bladeAtPlayhead);
  }, [onBladeReady, bladeAtPlayhead]);

  // ---- Rows -------------------------------------------------------------

  /**
   * Clip rows within a track.
   *
   * Two clips on one lane that overlap used to be drawn on top of each other,
   * so their names collided into an unreadable smear and the one underneath
   * could not be clicked. A pasted or duplicated clip lands on top of what it
   * was copied from, so this is not a rare state - it is where a first-time
   * user is within a minute of opening the app.
   */
  const rowsFor = useCallback((track: TimelineTrack) => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const rowEnds: number[] = [];
    const rows = new Map<string, number>();
    for (const c of sorted) {
      let row = rowEnds.findIndex((end) => end <= Math.round(c.startTime * fps));
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(0);
      }
      rowEnds[row] = Math.round(clipEnd(c) * fps);
      rows.set(c.id, row);
    }
    return { rows, count: Math.max(1, rowEnds.length) };
  }, [fps]);

  const transitionsFor = useCallback((trackId: string) => transitions.filter((t) => t.trackId === trackId), [transitions]);

  const overscanFrames = Math.ceil((totalFrames * pxPerFrame * 0.35) / Math.max(pxPerFrame, 0.001));
  const visStart = visibleRange.startFrame - overscanFrames;
  const visEnd = visibleRange.endFrame + overscanFrames;

  return (
    <div ref={laneRef} className="relative shrink-0" style={{ width: laneWidth }}>
      {/* Grid, behind the clips. Drawn once for the whole strip rather than
          per lane, because a per-lane grid repeats the same lines N times and
          a 1000-clip project then has a thousand of them. */}
      {gridVisible &&
        Array.from({ length: Math.floor(totalFrames / 6) + 1 }, (_, i) => {
          const frame = i * 6;
          return (
            <span
              key={`g${frame}`}
              className="pointer-events-none absolute top-0 z-0 h-full w-px bg-fg-muted/10"
              style={{ left: frame * pxPerFrame }}
            />
          );
        })}

      {/* Marker lines through the lanes. */}
      {snapOptions.toMarkers &&
        markers.map((m) => (
          <span
            key={m.id}
            className="pointer-events-none absolute top-0 z-[5] h-full w-px"
            style={{ left: m.frame * pxPerFrame, background: MARKER_COLOURS[m.colour], opacity: 0.35 }}
            aria-hidden="true"
          />
        ))}

      {tracks.map((track) => {
        const { rows, count } = rowsFor(track);
        const height = trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
        const rowH = Math.max(16, Math.floor((height - 8) / count));
        const visibleClips = track.clips.filter((c) => {
          const s = Math.round(c.startTime * fps);
          const e = Math.round(clipEnd(c) * fps);
          return e >= visStart && s <= visEnd;
        });

        return (
          <div
            key={track.id}
            data-track={track.id}
            data-track-type={track.type}
            data-track-role={track.role}
            style={{ height }}
            ref={(el) => {
              if (el) laneEls.current.set(track.id, el);
              else laneEls.current.delete(track.id);
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('[data-clip], [data-transition]')) return;
              const el = laneRef.current;
              if (!el) return;
              const x = e.clientX - el.getBoundingClientRect().left;
              const y = e.clientY - el.getBoundingClientRect().top;
              dragStart.current = { x, y };
              setMarquee({ x0: x, y0: y, x1: x, y1: y });
              onSelectTransition(null);

              const move = (ev: PointerEvent) => {
                const s = dragStart.current;
                if (!s) return;
                setMarquee({
                  x0: s.x,
                  y0: s.y,
                  x1: ev.clientX - el.getBoundingClientRect().left,
                  y1: ev.clientY - el.getBoundingClientRect().top,
                });
              };
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                const m = marquee;
                dragStart.current = null;
                setMarquee(null);
                // A gesture that never moved past the threshold was a CLICK:
                // seek, do not select. Four pixels is deliberate - it is about
                // the size of a trackpad's resting jitter, and a smaller
                // threshold turns every click into an empty marquee.
                const moved = m && (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4);
                if (moved) {
                  const left = Math.min(m!.x0, m!.x1);
                  const right = Math.max(m!.x0, m!.x1);
                  const picked: string[] = [];
                  for (const t of tracks) {
                    for (const c of t.clips) {
                      const cs = Math.round(c.startTime * fps) * pxPerFrame;
                      const cw = Math.round(c.duration * fps) * pxPerFrame;
                      if (cs < right && cs + cw > left) picked.push(c.id);
                    }
                  }
                  onSelectClips(picked, ev.shiftKey || ev.ctrlKey || ev.metaKey);
                } else {
                  onSeek(frameAt(ev.clientX) / fps);
                  if (!ev.shiftKey) onSelectClip(null);
                }
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-wideo11-media')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              reportDropHover(track.id);
            }}
            onDragLeave={() => reportDropHover(null)}
            onDrop={(e) => {
              const mediaId = e.dataTransfer.getData('application/x-wideo11-media');
              reportDropHover(null);
              if (!mediaId) return;
              e.preventDefault();
              e.stopPropagation();
              onDropMedia(mediaId, track.id, frameAt(e.clientX));
            }}
            className={[
              'relative border-b border-edge',
              track.locked ? 'bg-surface/60' : 'hover:bg-surface-raised/40',
              hoverTrack === track.id ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-400/60' : '',
              binDropTrack === track.id ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/70' : '',
            ].join(' ')}
          >
            {track.clips.length === 0 && (
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-fg-muted/60">
                {track.locked ? 'locked' : 'empty — pick a clip from the media bin'}
              </span>
            )}

            {visibleClips.map((clip) => {
              const cStyle = TRACK_STYLE[clip.type];
              const selected = selectedClipId === clip.id;
              const moving = movingId === clip.id;
              const startFrame = Math.round(clip.startTime * fps);
              const lengthFrames = Math.max(1, Math.round(clip.duration * fps));
              const width = lengthFrames * pxPerFrame;
              const row = rows.get(clip.id) ?? 0;
              // The clip after this one that starts exactly where it ends, if
              // any: that pair shares a roll handle.
              const neighbour = track.clips.find(
                (c) => c.id !== clip.id && Math.round(c.startTime * fps) === startFrame + lengthFrames
              );
              return (
                <div
                  key={clip.id}
                  data-clip
                  data-clip-id={clip.id}
                  data-frames-start={startFrame}
                  data-frames-length={lengthFrames}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onOpenInspector(clip.id);
                  }}
                  onPointerDown={(e) => beginMove(e, clip, track)}
                  onMouseEnter={() => onHoverClip(clip)}
                  onMouseLeave={() => onHoverClip(null)}
                  title={`${clip.mediaName} · frames ${startFrame}–${startFrame + lengthFrames} (${lengthFrames}f, ${frameToTimecode(lengthFrames, fps)}) — drag to move (lanes included), an edge to trim, the amber corner to fade, double-click for properties`}
                  className={[
                    'absolute flex items-center gap-1 overflow-hidden rounded border text-left',
                    moving ? 'z-30 cursor-grabbing select-none opacity-90 shadow-lg ring-2 ring-sky-400' : 'cursor-grab',
                    cStyle.clip,
                    selected ? 'ring-2 ring-white/70' : 'hover:brightness-110',
                    track.visible ? '' : 'opacity-40',
                  ].join(' ')}
                  style={{ left: startFrame * pxPerFrame, width, top: 4 + row * rowH, height: rowH, zIndex: 10 + row }}
                >
                  {clip.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={clip.poster} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45" />
                  )}

                  {waveformVisible && (clip.type === 'audio' || clip.type === 'video') && (
                    <Waveform peaks={clip.peaks} width={width} muted={clip.muted} />
                  )}

                  {clip.opacity < 1 && (
                    <span className="pointer-events-none absolute right-1 top-0.5 rounded bg-slate-950/70 px-1 font-mono text-[8px] text-slate-300">
                      {Math.round(clip.opacity * 100)}%
                    </span>
                  )}
                  {clip.fadeIn > 0 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 left-0 top-0 bg-gradient-to-r from-slate-950/80 to-transparent"
                      style={{ width: Math.min(clip.fadeIn * fps * pxPerFrame, width) }}
                    />
                  )}
                  {clip.fadeOut > 0 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 right-0 top-0 bg-gradient-to-l from-slate-950/80 to-transparent"
                      style={{ width: Math.min(clip.fadeOut * fps * pxPerFrame, width) }}
                    />
                  )}

                  {rowH >= 22 && (
                    <>
                      <span
                        role="separator"
                        aria-label={`Trim start of ${clip.mediaName}`}
                        aria-orientation="vertical"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => beginTrim(e, clip, 'in')}
                        title={`Trim start — frames ${startFrame} to ${startFrame}\nDrag, or Alt-drag to ripple everything after it.`}
                        className={[
                          // z-45, ABOVE the transition badge's z-40. The two
                          // both live on the boundary, and whichever is on top
                          // wins the click - so the handle has to be, or a
                          // transition makes the outgoing clip's trim handle
                          // unreachable exactly where a user wants it.
                          'absolute inset-y-0 left-0 z-45 w-2 cursor-ew-resize flex items-center justify-center',
                          selected ? 'opacity-100' : 'opacity-0 hover:opacity-100',
                          'transition-opacity',
                        ].join(' ')}
                      >
                        <span className="h-4 w-0.5 rounded bg-white/80" />
                      </span>
                      {rowH >= 22 && (
                        <span
                          role="separator"
                          aria-label={`Trim end of ${clip.mediaName}`}
                          aria-orientation="vertical"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => beginTrim(e, clip, 'out')}
                          title={`Trim end — frames ${startFrame + lengthFrames} to ${startFrame + lengthFrames}\nDrag, or Alt-drag to ripple everything after it.`}
                          className={[
                            'absolute inset-y-0 right-0 z-45 w-2 cursor-ew-resize flex items-center justify-center',
                            selected ? 'opacity-100' : 'opacity-0 hover:opacity-100',
                            'transition-opacity',
                          ].join(' ')}
                        >
                          <span className="h-4 w-0.5 rounded bg-white/80" />
                        </span>
                      )}
                      {/* Fade handles on the top corners, where every NLE puts
                          them and where they cannot be confused with the trim
                          edges along the bottom. */}
                      <span
                        role="separator"
                        aria-label={`Fade in of ${clip.mediaName}`}
                        aria-orientation="vertical"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => beginFade(e, clip, 'in')}
                        title={`Fade in ${clip.fadeIn.toFixed(2)}s — drag up to lengthen`}
                        className="absolute left-0 top-0 z-10 h-2.5 w-2.5 cursor-ns-resize"
                      >
                        <span className="block h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-300/80" />
                      </span>
                      <span
                        role="separator"
                        aria-label={`Fade out of ${clip.mediaName}`}
                        aria-orientation="vertical"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => beginFade(e, clip, 'out')}
                        title={`Fade out ${clip.fadeOut.toFixed(2)}s — drag up to lengthen`}
                        className="absolute right-0 top-0 z-10 h-2.5 w-2.5 cursor-ns-resize"
                      >
                        <span className="ml-auto block h-0 w-0 border-r-[6px] border-t-[6px] border-r-transparent border-t-amber-300/80" />
                      </span>
                    </>
                  )}

                  {!clip.poster && !clip.peaks && rowH >= 20 && (
                    <cStyle.Icon className="relative h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span className="pointer-events-none relative min-w-0 flex-1 truncate px-0.5 text-[10px] font-medium text-white/90 drop-shadow">
                    {clip.mediaName}
                  </span>
                  {pxPerFrame >= 2 && (
                    <span className="pointer-events-none relative shrink-0 pr-1 font-mono text-[8px] text-white/60">
                      {lengthFrames}f
                    </span>
                  )}
                  {clip.linkedId && (
                    <span className="pointer-events-none relative shrink-0 text-emerald-300" title="Linked to another clip — moving one moves the other">
                      <Link2 className="h-2.5 w-2.5" />
                    </span>
                  )}
                  {clip.effects.length > 0 && (
                    <span className="pointer-events-none relative shrink-0 text-amber-300" title={`${clip.effects.length} effect(s) applied`}>
                      <Wand2 className="h-2.5 w-2.5" />
                    </span>
                  )}

                  {/* Roll handle. It exists only where two clips are welded
                      together - a roll across a gap is a trim plus a slide, and
                      pretending otherwise would silently move a third clip. */}
                  {neighbour && rowH >= 20 && (
                    <span
                      role="separator"
                      aria-label={`Roll the cut between ${clip.mediaName} and ${neighbour.mediaName}`}
                      aria-orientation="vertical"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => beginRoll(e, track.id, clip, neighbour)}
                      title={`Roll — move the cut between these two clips.\nThe left clip grows, the right shrinks, total length unchanged.`}
                      className="absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-ew-resize"
                      style={{ left: width }}
                    >
                      <span className="mx-auto block h-full w-0.5 bg-white/25 hover:bg-white/70" />
                    </span>
                  )}

                  {selected && (
                    <div className="absolute right-0.5 top-0.5 z-20 flex gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleLink(clip.id);
                        }}
                        aria-label={clip.linkedId ? `Unlink ${clip.mediaName}` : `Link ${clip.mediaName}`}
                        title={clip.linkedId ? 'Unlink — stop moving this clip and its pair together' : 'Link — bind this clip to the same file on another track'}
                        className={`rounded bg-slate-950/80 p-0.5 ${clip.linkedId ? 'text-emerald-300' : 'text-slate-400 hover:text-emerald-300'}`}
                      >
                        {clip.linkedId ? <Unlink className="h-2.5 w-2.5" /> : <Link2 className="h-2.5 w-2.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInspector(clip.id);
                        }}
                        aria-label={`Properties of ${clip.mediaName}`}
                        title="Properties — speed, volume, fades, filters and position"
                        className="rounded bg-slate-950/80 p-0.5 text-slate-400 hover:text-white"
                      >
                        <Wand2 className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveClip(clip.id);
                        }}
                        aria-label={`Remove ${clip.mediaName}`}
                        title={`Remove ${clip.mediaName}`}
                        className="rounded bg-slate-950/80 p-0.5 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {transitionsFor(track.id).map((tr) => {
              const def = TRANSITION_BY_ID[tr.type];
              const selected = selectedTransitionId === tr.id;
              const w = Math.max(tr.duration * fps * pxPerFrame, 14);
              return (
                <div
                  key={tr.id}
                  data-transition
                  data-transition-id={tr.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Transition: ${def.label}, ${tr.duration.toFixed(2)} seconds`}
                  title={`${def.label}\n${def.hint}\nDrag the left or right edge to change its length, Delete to remove it.`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTransition(tr.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      onRemoveTransition(tr.id);
                    }
                  }}
                  className={[
                    // z-40: a transition is the join BETWEEN two clips, so it
                    // has to read as sitting on top of both - and it matters
                    // most exactly when clips already overlap.
                    //
                    // The fill is OPAQUE, not a translucent amber. Over a clip
                    // (which is always dark) a 40%-opacity amber reads as a
                    // pale wash and the glyph inside it disappears.
                    'absolute top-1/2 z-40 flex -translate-y-1/2 items-center justify-center overflow-hidden rounded border',
                    selected
                      ? 'border-sky-300 bg-sky-600 ring-2 ring-sky-300'
                      : 'border-amber-300/70 bg-amber-500 hover:bg-amber-400',
                  ].join(' ')}
                  // The badge SPANS the transition - it represents the overlap,
                  // not the cut - so its centre is the middle of the blend and
                  // its width is the overlap you will actually see.
                  style={{ left: Math.round(tr.atTime * fps) * pxPerFrame, width: Math.max(w, 14), height: 22 }}
                >
                  {selected && (
                    <>
                      {(['start', 'end'] as const).map((edge) => (
                        <span
                          key={edge}
                          role="separator"
                          aria-label={`${edge === 'start' ? 'Shorten' : 'Lengthen'} ${def.label}`}
                          aria-orientation="vertical"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const startX = e.clientX;
                            const startDur = tr.duration;
                            const move = (ev: PointerEvent) => {
                              const next = Math.max(0.1, Math.min(4, startDur + (ev.clientX - startX) / (fps * pxPerFrame)));
                              onChangeTransition(tr.id, { duration: Math.round(next * 100) / 100 });
                            };
                            const up = () => {
                              window.removeEventListener('pointermove', move);
                              window.removeEventListener('pointerup', up);
                            };
                            window.addEventListener('pointermove', move);
                            window.addEventListener('pointerup', up);
                          }}
                          className={`absolute inset-y-0 w-1.5 cursor-ew-resize bg-white/40 ${edge === 'start' ? 'left-0' : 'right-0'}`}
                        />
                      ))}
                    </>
                  )}
                  {w > 22 && <Shuffle className="h-3 w-3 text-white/90" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Marquee */}
      {marquee && (
        <div
          className="pointer-events-none absolute z-40 border border-sky-400/70 bg-sky-400/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {/* The snap line.
          A snap the user cannot SEE is indistinguishable from a snap that did
          not happen, so the line and the label are part of the feature and not
          a decoration on it. */}
      {snapLabel && snapOptions.enabled && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center gap-1.5 px-2 pt-0.5">
          <span className="rounded bg-sky-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
            snapped to {snapLabel}
          </span>
        </div>
      )}

      {/* Snap indicator column. Rendered last so it is above the clips. */}
      {selectedClipId && null}
    </div>
  );
}

/**
 * The waveform strip.
 *
 * A canvas rather than hundreds of DOM nodes: a 10 minute clip at one bar per
 * second is 600 elements, and the lanes redraw on every playhead move. The
 * canvas is a fixed 300 buckets wide and scaled by CSS, so the cost is
 * independent of the clip's length and of the zoom.
 */
function Waveform({
  peaks,
  width,
  muted,
}: {
  peaks?: number[] | null;
  width: number;
  muted: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  if (width <= 26) return null;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const H = canvas.height;
    const W = canvas.width;
    ctx.clearRect(0, 0, W, H);
    if (!peaks || !peaks.length) {
      // No data is a flat line. A decorative squiggle would tell the user
      // their audio has a shape it does not have.
      ctx.fillStyle = 'rgba(226,232,240,0.18)';
      ctx.fillRect(0, H / 2 - 0.5, W, 1);
      return;
    }
    ctx.fillStyle = muted ? 'rgba(148,163,184,0.25)' : 'rgba(226,232,240,0.55)';
    const bar = W / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.max(0.02, peaks[i]);
      const h = v * (H - 2);
      ctx.fillRect(i * bar, (H - h) / 2, Math.max(0.6, bar * 0.7), h);
    }
  }, [peaks, muted]);

  return (
    <canvas ref={ref} width={300} height={40} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />
  );
}

const TRACK_STYLE: Record<
  TrackType,
  { chip: string; clip: string; border: string; Icon: typeof Film; label: string }
> = {
  // The clip fill comes from a TOKEN, not a translucent Tailwind colour, and
  // that is the whole fix for unreadable clip names in light mode.
  //
  // `bg-sky-500/25` is 25% sky painted over whatever is behind it: dark in the
  // dark theme, near-white in the light theme. The name is `text-white`. So the
  // dark theme worked and the light theme lost every clip label, frame count and
  // icon - and it looked like the light theme had simply not been styled.
  //
  // The tokens are defined in `:root` and deliberately NOT overridden in
  // `.light`: a clip is MEDIA, not chrome. Resolve and Premiere both keep clips
  // dark in a light UI for the same reason.
  video: { chip: 'bg-sky-500/15 text-sky-300', clip: 'bg-[color:var(--ve-clip-video)] border-sky-400/60', border: 'border-sky-500/30', Icon: Film, label: 'Video' },
  audio: { chip: 'bg-violet-500/15 text-violet-300', clip: 'bg-[color:var(--ve-clip-audio)] border-violet-400/60', border: 'border-violet-500/30', Icon: Music, label: 'Audio' },
  text: { chip: 'bg-amber-500/15 text-amber-300', clip: 'bg-[color:var(--ve-clip-text)] border-amber-400/60', border: 'border-amber-500/30', Icon: Type, label: 'Text' },
  image: { chip: 'bg-emerald-500/15 text-emerald-300', clip: 'bg-[color:var(--ve-clip-image)] border-emerald-400/60', border: 'border-emerald-500/30', Icon: ImageIcon, label: 'Image' },
};

/**
 * The single status strip under the timeline.
 *
 * There used to be TWO bars here: one from the lanes (clip and transition
 * counts) and one below it (timecode, frame rate, project name). Two bars for
 * one piece of information is a bar the user has to look past, and the second
 * one cost 20px of timeline height for nothing. They are one strip now, with
 * the counts on the right and the position on the left.
 */
export function TimelineFooter({
  currentFrame,
  duration,
  fps,
  tracks,
  transitions,
  markers,
  drawnClips,
  selectedCount,
  projectName,
  dirty,
  snapEnabled,
  measure,
  playbackRate,
}: {
  currentFrame: number;
  duration: number;
  fps: number;
  tracks: TimelineTrack[];
  transitions: Transition[];
  markers: Marker[];
  /** Clips actually drawn in the DOM; the model may hold more, virtualised. */
  drawnClips: number;
  /** How many clips are selected. Shown so a multi-select is visible in the
   *  read-out as well as in the lane. */
  selectedCount: number;
  projectName: string;
  dirty: boolean;
  snapEnabled: boolean;
  /** The ruler measurement, in frames. -1 when nothing is measured. */
  measure: { start: number; end: number };
  playbackRate: number;
}) {
  const total = tracks.reduce((n, t) => n + t.clips.length, 0);
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const measureLen = measure.start >= 0 && measure.end > measure.start ? measure.end - measure.start : 0;
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t border-edge bg-surface px-3 font-mono text-[10px]">
      <div className="flex items-center gap-3 text-fg-secondary">
        <span title="Timecode at the playhead, HH:MM:SS:FF">TC {frameToTimecode(currentFrame, fps)}</span>
        <span className="text-fg-muted/40">|</span>
        <span title="Frame number, and the frame rate it is counted in">
          FRAME {currentFrame}/{totalFrames} @ {fps}fps
        </span>
        {measureLen > 0 && (
          <>
            <span className="text-fg-muted/40">|</span>
            <span className="text-sky-400" title="The selection measured on the ruler">
              MEASURE {measureLen}f · {(measureLen / fps).toFixed(3)}s
            </span>
          </>
        )}
        {playbackRate !== 1 && (
          <>
            <span className="text-fg-muted/40">|</span>
            <span className="text-amber-400">{playbackRate}× playback</span>
          </>
        )}
        <span className="text-fg-muted/40">|</span>
        <span className={snapEnabled ? 'text-sky-400' : 'text-fg-muted'} title="Snapping (N)">
          {snapEnabled ? 'SNAP' : 'NO SNAP'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-fg-muted">
        <span className="truncate max-w-[28ch]" title={projectName}>
          {projectName}
          <span className={dirty ? 'ml-1 text-amber-400' : 'ml-1'}>
            {dirty ? '●' : '○'}
          </span>
        </span>
        <span className="text-fg-muted/40">|</span>
        <span title="Clips in the project; the count in brackets is how many are drawn right now, because the lanes are virtualised">
          {total} clip{total === 1 ? '' : 's'}
          {total > drawnClips ? ` (${drawnClips} drawn)` : ''}
          {selectedCount > 0 && <span className="text-sky-400"> · {selectedCount} selected</span>}
        </span>
        {markers.length > 0 && <span>{markers.length} marker{markers.length === 1 ? '' : 's'}</span>}
        {transitions.length > 0 && <span>{transitions.length} transition{transitions.length === 1 ? '' : 's'}</span>}
      </div>
    </div>
  );
}

export { Flag };

'use client';

// ============================================================================
// Preview stage
// ============================================================================
//
// The canvas the timeline is composited onto, and the clock that drives it.
//
// ---- WHY THE PREVIEW OWNS THE CLOCK ----
//
// The canvas must redraw on every animation frame, but the rest of the editor
// only needs to know where the playhead is once per FRAME. Driving the
// playhead from a per-frame `setState` re-renders the whole editor - bin,
// lanes, every panel - sixty times a second, which is most of what makes a
// canvas app feel slow. So the canvas is authoritative for the picture, and the
// parent is told the time once per timeline frame.
//
// ---- WHY IT DOES NOT OWN THE ELEMENT CLOCK ----
//
// Media elements advance on wall time. At 30fps the compositor asks each one
// for the frame the playhead implies and lets it run in between, so playback
// is smooth rather than 30 hard seeks a second - and a hard seek per frame is
// what makes browser playback stutter and audio crackle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Compositor, type CompositorState } from '../../lib/engine/compositor';
import { extractPeaks } from '../../lib/engine/waveform';
import { allContexts, resumeAllContexts } from '../../lib/engine/audio-graph';
import { useMediaStore } from '../../lib/engine/media-store';
import { frameToSeconds, frameToTimecode } from '../../lib/engine/frames';
import { projectDuration, type TimelineClip, type TimelineTrack, type Transition } from '../../lib/engine/types';
import { buildCompositorSources } from '../../lib/engine/sources';

/**
 * Watermark characters: Wino, Rino, Tino.
 *
 * Initials on tinted discs, NOT images. The artwork does not exist yet, and a
 * broken `<img>` is worse than an honest placeholder - it reads as a bug rather
 * than as "coming soon". Swapping in the real art later is a one-line change
 * per character and the layout does not move.
 *
 * These are the COMPANY characters, and the mark is a logo lockup rather than
 * a decoration: it sits inside a dashed frame precisely so nobody mistakes a
 * placeholder for a finished brand.
 */
const WATERMARK_CHARACTERS = [
  { name: 'Wino', tint: 'from-amber-400 to-amber-600' },
  { name: 'Rino', tint: 'from-sky-400 to-sky-600' },
  { name: 'Tino', tint: 'from-emerald-400 to-emerald-600' },
] as const;

export function PreviewCanvas({
  tracks,
  transitions,
  settings,
  currentFrame,
  fps,
  playing,
  playbackRate,
  masterVolume,
  viewerZoom,
  viewerLayout,
  showBadge,
  previewClip,
  seekTo,
  onFrame,
  onEnded,
  onCanvasReady,
  onNeedPeaks,
}: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  settings: { width: number; height: number; fps: number; background: string; name: string };
  /** Playhead, as a FRAME. */
  currentFrame: number;
  fps: number;
  playing: boolean;
  /** Playback rate: 1 is real time, 2 is twice as fast. */
  playbackRate: number;
  masterVolume: number;
  /** Picture zoom, 1 = fit. */
  viewerZoom: number;
  viewerLayout: 'single' | 'side-by-side' | 'picture-in-picture';
  showBadge: boolean;
  /** Non-null while a clip is hovered: the preview shows that clip on its own. */
  previewClip: TimelineClip | null;
  seekTo: (t: number) => void;
  /** Called with the wall-clock FRAME once per timeline frame. */
  onFrame: (frame: number) => void;
  onEnded: () => void;
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
  onNeedPeaks: (mediaId: string, url: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const rafRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const media = useMediaStore();

  // Latest values for the render loop, without re-creating the loop on every
  // render. Reading a ref inside rAF is what keeps the loop a single closure.
  const live = useRef({ tracks, transitions, settings, currentFrame, fps, playing, playbackRate, previewClip });
  live.current = { tracks, transitions, settings, currentFrame, fps, playing, playbackRate, previewClip };

  const clock = useRef({ wall: 0, frame: 0 });
  const hoverClock = useRef({ wall: 0 });
  const lastReported = useRef(-1);

  // First click anywhere unlocks the audio context. A context starts SUSPENDED,
  // and a suspended context is silent however correct the graph is - which looks
  // exactly like a routing bug. So the first gesture resumes it here as well
  // as in the compositor.
  useEffect(() => {
    const unlock = () => void resumeAllContexts();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  /**
   * Everything the compositor can be asked to draw, by clip `mediaId`.
   *
   * Built by `buildCompositorSources` - shared with `video-editor.tsx`, so
   * the preview and the export can never disagree about which clips resolve.
   * See `lib/engine/sources.ts` for why branding clips are in the map.
   */
  const sources = useCallback(
    () => buildCompositorSources(media.items, tracks),
    [media.items, tracks]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let compositor: Compositor;
    try {
      compositor = new Compositor(canvas);
    } catch {
      return;
    }
    compositorRef.current = compositor;
    compositor.resize(settings.width, settings.height);
    onCanvasReady(canvas);
    return () => {
      cancelAnimationFrame(rafRef.current);
      compositor.dispose();
      compositorRef.current = null;
      onCanvasReady(null);
    };
    // The compositor is created once. Everything about it that changes is
    // pushed through `update`, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push state into the compositor whenever it changes. A push, not a
  // re-create: recreating it would throw away every decoded video frame.
  useEffect(() => {
    const state: CompositorState = {
      tracks,
      transitions,
      settings,
      sources: sources(),
      masterVolume,
    };
    compositorRef.current?.update(state);
    compositorRef.current?.resize(settings.width, settings.height);
  }, [tracks, transitions, settings, sources, masterVolume]);

  // Seeking: when paused the parent is authoritative. When playing the clock
  // is authoritative, and re-seeding it is what makes a click on the canvas
  // move the picture.
  useEffect(() => {
    if (!playing) clock.current = { wall: performance.now(), frame: currentFrame };
  }, [currentFrame, playing]);

  // A hover restarts its own clock, so the same clip keeps playing through
  // successive mouse-enter events instead of jumping back to the start.
  useEffect(() => {
    if (previewClip) hoverClock.current = { wall: performance.now() };
  }, [previewClip]);

  // Is anything actually on screen at the playhead?
  //
  // The watermark is an EMPTY-STATE marker, not a permanent overlay. A logo
  // burned over the user's own footage is the most irritating thing a media
  // player can do, and it is permanent: it sits on every frame they ever
  // export a still from. So it appears only when there is nothing to cover.
  const [hasPicture, setHasPicture] = useState(false);
  const hasPictureRef = useRef(false);
  const setHasPictureIfChanged = useCallback((on: boolean) => {
    if (hasPictureRef.current === on) return;
    hasPictureRef.current = on;
    setHasPicture(on);
  }, []);

  // Waveforms, requested only for clips that are actually on a lane.
  useEffect(() => {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'audio' && clip.type !== 'video') continue;
        if (clip.peaks?.length) continue;
        const item = media.byId.get(clip.mediaId);
        if (item?.url) onNeedPeaks(clip.mediaId, item.url);
      }
    }
  }, [tracks, media.byId, onNeedPeaks]);

  const durationFrames = useMemo(
    () => Math.max(1, Math.round(projectDuration(tracks, 5) * fps)),
    [tracks, fps]
  );

  useEffect(() => {
    // Hover preview takes over the canvas. Deliberately NOT the timeline
    // underneath: a scrub through the hovered clip is a different thing, and
    // the banner below says which one you are looking at.
    if (previewClip) {
      // A hovered clip IS a picture, and the watermark must get out of its way.
      //
      // This branch used to return before touching the state, so after hovering
      // a clip the empty-state watermark stayed painted ON TOP of the clip's own
      // frames. The symptom reads as "the logo is broken"; the cause was that
      // two different code paths were deciding what is on screen.
      setHasPictureIfChanged(true);
      const step = () => {
        const elapsed = (performance.now() - hoverClock.current.wall) / 1000;
        compositorRef.current?.renderClipOnly(previewClip, frameToSeconds(Math.round(elapsed * fps), fps), true);
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
      return () => {
        cancelAnimationFrame(rafRef.current);
        compositorRef.current?.pauseAll();
      };
    }

    const draw = (frame: number) => {
      const state = live.current;
      compositorRef.current?.renderFrame(frameToSeconds(frame, state.fps), state.playing);

      // "Is there a picture here?" is decided by the CLIPS, not by sampling
      // the canvas: a black clip and an empty lane look identical in pixels
      // but are completely different situations, and only the model knows which
      // one it is.
      const t = frameToSeconds(frame, state.fps);
      const painted = state.tracks.some(
        (track) => track.visible && track.clips.some((c) => t >= c.startTime && t < c.startTime + c.duration)
      );
      setHasPictureIfChanged(painted);

      if (lastReported.current !== frame) {
        lastReported.current = frame;
        onFrame(frame);
      }
    };

    if (!playing) {
      draw(currentFrame);
      return;
    }

    const step = () => {
      const state = live.current;
      const elapsed = (performance.now() - clock.current.wall) / 1000;
      const frame = clock.current.frame + elapsed * state.fps * state.playbackRate;
      if (frame >= durationFrames) {
        draw(durationFrames);
        onEnded();
        return;
      }
      // Whole frames only. A fractional frame would be a picture that does not
      // exist, and "no frame skipping" means the viewer shows a real frame at
      // every moment, not the nearest one drawn twice.
      const whole = Math.floor(frame);
      draw(whole);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tracks, previewClip, onFrame, onEnded, currentFrame, fps, durationFrames, playbackRate]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    seekTo(((e.clientX - box.left) / box.width) * frameToSeconds(durationFrames, fps));
  };

  const layoutClass =
    viewerLayout === 'side-by-side'
      ? 'w-[calc(50%-4px)]'
      : viewerLayout === 'picture-in-picture'
        ? 'absolute right-3 top-3 w-[32%] max-w-[280px]-edge-strong shadow-xl'
        : '';

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-slate-950 p-2">
      <div
        ref={containerRef}
        onClick={onClick}
        role="img"
        aria-label={`Preview at frame ${currentFrame}, ${frameToTimecode(currentFrame, fps)}`}
        // The app's OWN answer to "is there a picture here?", published so a
        // test can assert it instead of inferring it from whether the
        // watermark happens to be in the DOM. Inferring is how a check ends up
        // testing a rendering timing rather than the behaviour.
        data-has-picture={hasPicture ? 'true' : 'false'}
        className={`relative max-h-full max-w-full cursor-crosshair overflow-hidden rounded bg-black shadow-inner ${layoutClass}`}
        style={{
          aspectRatio: `${settings.width} / ${settings.height}`,
          width: viewerLayout === 'single' ? '100%' : undefined,
          maxHeight: '100%',
          transform: viewerZoom === 1 ? undefined : `scale(${viewerZoom})`,
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/*
          EMPTY-STATE logo placeholder. Only when there is nothing to show.

          `pointer-events-none` is not optional: a watermark that ate clicks
          would sit on top of the canvas the user scrubs on.
        */}
        {!hasPicture && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-[9%]"
            aria-hidden="true"
            data-empty-watermark="true"
          >
            {/* A dashed frame, so it reads as "nothing here yet" rather than
                as a design element. A solid mark would claim to be finished.

                SITTING LOW, in the lower third rather than dead centre. A logo
                over the middle of a frame sits exactly where the subject
                usually is; here it reads as a plate at the foot of the picture
                and leaves the middle clear for the thing being watched. */}
            <div className="flex items-center gap-3 rounded-md-dashed/20 bg-slate-950/40 px-5 py-2.5">
              {WATERMARK_CHARACTERS.map((c) => (
                <span
                  key={c.name}
                  className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${c.tint} text-[8px] font-semibold text-white/90 shadow-lg ring-1 ring-white/20`}
                  title={`${c.name} — artwork pending`}
                >
                  {c.name[0]}
                </span>
              ))}
            </div>
            <div className="text-center">
              <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/60">WIDEO11</p>
              <p className="mt-0.5 text-[8px] text-white/40">
                Logo placeholder — Wino / Rino / Tino artwork pending
              </p>
            </div>
          </div>
        )}
        {previewClip && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-slate-950/80 px-2 py-1 text-[8px] text-slate-300">
            <span className="truncate">Previewing “{previewClip.mediaName}”</span>
            <span className="ml-auto shrink-0 font-mono text-slate-500">move away to return to the timeline</span>
          </div>
        )}
        {showBadge && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[8px] text-slate-400">
            <Loader2 className="h-2 w-2" aria-hidden="true" />
            {settings.width}×{settings.height} · {fps}fps · f{currentFrame}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[8px] text-slate-300">
          {frameToTimecode(currentFrame, fps)}
        </div>
      </div>
    </div>
  );
}

/**
 * Diagnostic: what the audio graph actually looks like right now.
 *
 * "There is no sound" is a symptom with at least five possible causes that all
 * LOOK identical from the outside: the context is suspended, the context was
 * garbage collected, the element never started, its gain is zero, or the file
 * has no audio track. This reads the graph directly so the answer is a fact
 * rather than a guess. It is exposed on `window` only, and only for the test
 * harness - it is not a UI feature.
 */
export function audioGraphReport() {
  const ctxs = allContexts();
  const active = ctxs.filter((c) => c.state === 'running').length;
  return {
    contexts: ctxs.length,
    running: active,
    suspended: ctxs.filter((c) => c.state === 'suspended').length,
    state: ctxs[0]?.state ?? 'none',
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __veAudio?: () => unknown }).__veAudio = audioGraphReport;
}

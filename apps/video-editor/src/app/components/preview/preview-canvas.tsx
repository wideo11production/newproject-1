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

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Compositor, type CompositorState } from '../../lib/engine/compositor';
import { extractPeaks } from '../../lib/engine/waveform';
import { useMediaStore } from '../../lib/engine/media-store';
import { frameToSeconds, frameToTimecode } from '../../lib/engine/frames';
import { projectDuration, type TimelineClip, type TimelineTrack, type Transition } from '../../lib/engine/types';

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

  const sources = useCallback(() => {
    const map = new Map<string, { url: string; kind: string }>();
    for (const item of media.items) map.set(item.id, { url: item.url, kind: item.kind });
    return map;
  }, [media.items]);

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
        ? 'absolute right-3 top-3 w-[32%] max-w-[280px] border border-edge-strong shadow-xl'
        : '';

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-slate-950 p-2">
      <div
        ref={containerRef}
        onClick={onClick}
        role="img"
        aria-label={`Preview at frame ${currentFrame}, ${frameToTimecode(currentFrame, fps)}`}
        className={`relative max-h-full max-w-full cursor-crosshair overflow-hidden rounded bg-black shadow-inner ${layoutClass}`}
        style={{
          aspectRatio: `${settings.width} / ${settings.height}`,
          width: viewerLayout === 'single' ? '100%' : undefined,
          maxHeight: '100%',
          transform: viewerZoom === 1 ? undefined : `scale(${viewerZoom})`,
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {previewClip && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300">
            <span className="truncate">Previewing “{previewClip.mediaName}”</span>
            <span className="ml-auto shrink-0 font-mono text-slate-500">move away to return to the timeline</span>
          </div>
        )}
        {showBadge && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            <Loader2 className="h-2.5 w-2.5" aria-hidden="true" />
            {settings.width}×{settings.height} · {fps}fps · f{currentFrame}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
          {frameToTimecode(currentFrame, fps)}
        </div>
      </div>
    </div>
  );
}

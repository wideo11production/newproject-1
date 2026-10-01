'use client';

// ============================================================================
// Timeline compositor
// ============================================================================
//
// Draws the project at an instant in time onto a canvas. This is the single
// renderer: the preview shows its output, and the exporter records the same
// output to a stream. There is no second implementation, so what you see is
// what you get.
//
// ---- WHY A CANVAS AND NOT A `<video>` ELEMENT ----
//
// The preview used to point a single hidden `<video>` at whatever was last
// hovered, so it showed one clip and could not show a timeline: no
// transitions, no second lane, no filters, no titles, and no export. A canvas
// is the only thing in a browser that can composite a dozen sources with
// different opacities and still be captured frame by frame.
//
// ---- WHY THE RENDER LOOP IS NOT IN HERE ----
//
// `renderFrame(t, playing)` is a pure function of the time. The React stage
// drives it with rAF and a wall clock; the exporter drives it with its own
// clock and a capture stream. Putting a loop in here would make the exporter
// wait for the preview's idea of "now", which is exactly the coupling that
// makes exporters desynchronise from their audio.
//
// ---- THE SYNCHRONISATION RULE ----
//
// Each clip owns a media element. Every frame we ask that element for the
// source time the playhead implies. If it is more than a threshold away we
// seek; otherwise we leave it running and it keeps its own smooth clock. A
// hard seek on every frame would stutter audio to death, and playing the
// element and ignoring the playhead would drift, so both have a place - the
// threshold is the line between them.

import {
  clipAt,
  clipGainAt,
  clipEnd,
  sourceTimeAt,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  type ClipFilter,
  type ClipTransform,
  type ProjectSettings,
  type TextClipStyle,
  type TimelineClip,
  type TimelineTrack,
  type Transition,
} from './types';
import { applyTransition, transitionAt } from './transitions';
import { attachMedia, applyEffects, resumeAudio } from './audio-graph';
import { stockAudioEffects } from './resources.generated';
import type { StockAudioEffect } from './resources.generated';

/** How far the playhead may drift from a media element before we seek it. */
const SEEK_EPSILON_PAUSED = 0.02;
const SEEK_EPSILON_PLAYING = 0.45;

export interface CompositorState {
  tracks: TimelineTrack[];
  transitions: Transition[];
  settings: ProjectSettings;
  /** mediaId -> playable source. Resolved by the stage from the media store. */
  sources: Map<string, { url: string; kind: string }>;
  /** Master output level, 0..1. Second stage, after every clip and track. */
  masterVolume: number;
}

interface ClipRuntime {
  el: HTMLVideoElement | HTMLAudioElement | null;
  audio: ReturnType<typeof attachMedia>;
  ready: boolean;
  lastGain: number;
  /**
   * The clip this runtime was built for.
   *
   * `captureFilmstrip` needs the clip's `sourceIn` and `speed` to know WHICH
   * frames to pull, and the runtime is already the thing that owns the element
   * those frames come from. Storing the clip here is what lets the filmstrip
   * reuse the decoder without being handed the whole model again.
   */
  clip: TimelineClip | null;
}

const EFFECT_BY_NAME = new Map<string, StockAudioEffect>(stockAudioEffects.map((e) => [e.id, e]));

/** Turn a clip's `effects` list into stock effect definitions. */
export function effectsFor(clip: TimelineClip): StockAudioEffect[] {
  return clip.effects
    .map((name) => EFFECT_BY_NAME.get(name))
    .filter((e): e is StockAudioEffect => Boolean(e));
}

function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
) {
  const hue = hueFor(label || 'clip');
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `hsl(${hue} 32% 18%)`);
  g.addColorStop(1, `hsl(${hue} 28% 9%)`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(226,232,240,0.45)';
  ctx.font = `${Math.max(10, Math.round(h * 0.14))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = label.length > 22 ? `${label.slice(0, 21)}…` : label;
  ctx.fillText(text, x + w / 2, y + h / 2, w * 0.9);
}

function filterString(f: ClipFilter): string {
  const parts: string[] = [];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness.toFixed(3)})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast.toFixed(3)})`);
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate.toFixed(3)})`);
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue.toFixed(2)}deg)`);
  if (f.blur > 0) parts.push(`blur(${f.blur.toFixed(2)}px)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale.toFixed(3)})`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia.toFixed(3)})`);
  if (f.invert > 0) parts.push(`invert(${Math.min(1, f.invert).toFixed(3)})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Wrap `text` to `maxWidth`, honouring explicit newlines. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  style: TextClipStyle,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const text = style.uppercase ? style.content.toUpperCase() : style.content;
  const size = Math.max(8, style.size * h);
  ctx.save();
  ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${size}px ${style.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = style.align;
  const letterSpacing = `${(style.letterSpacing * size).toFixed(2)}px`;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = letterSpacing;

  const lines = wrapLines(ctx, text, w * 0.92);
  const lineHeight = size * style.lineHeight;
  const blockHeight = lines.length * lineHeight;
  let ty = y + (h - blockHeight) / 2;
  const tx = style.align === 'left' ? x + w * 0.04 : style.align === 'right' ? x + w * 0.96 : x + w / 2;

  if (style.background && style.background !== 'transparent') {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = size * 0.35;
    const bx = style.align === 'left' ? tx - padX : style.align === 'right' ? tx - widest - padX : tx - widest / 2 - padX;
    ctx.fillStyle = style.background;
    ctx.fillRect(bx, ty - padX, widest + padX * 2, blockHeight + padX * 2);
  }

  lines.forEach((line, i) => {
    const y0 = ty + i * lineHeight;
    if (style.shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(line, tx + size * 0.04, y0 + size * 0.05, w * 0.92);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, tx, y0, w * 0.92);
  });
  ctx.restore();
}

export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: CompositorState | null = null;
  private runtimes = new Map<string, ClipRuntime>();
  private scratchA: HTMLCanvasElement;
  private scratchB: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable - the preview cannot render without it');
    this.canvas = canvas;
    this.ctx = ctx;
    this.scratchA = document.createElement('canvas');
    this.scratchB = document.createElement('canvas');
    // Published for the timeline's filmstrip. Cleared on dispose so a torn-down
    // compositor is never reachable.
    Compositor.live = this;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Point the compositor at a canvas of a different size (export, resize). */
  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.scratchA.width = width;
    this.scratchA.height = height;
    this.scratchB.width = width;
    this.scratchB.height = height;
  }

  update(state: CompositorState) {
    this.state = state;
    // Drop elements for clips that no longer exist, so a deleted clip does not
    // keep a decoder and an audio graph alive for the rest of the session.
    const live = new Set<string>();
    for (const track of state.tracks) for (const c of track.clips) live.add(c.id);
    for (const [id, rt] of this.runtimes) {
      if (live.has(id)) continue;
      try {
        rt.el?.pause();
        rt.el?.removeAttribute('src');
        rt.el?.load();
      } catch {
        /* element already detached */
      }
      this.runtimes.delete(id);
    }
  }

  /** Call from a user gesture so the audio context is allowed to start. */
  static unlockAudio() {
    void resumeAudio();
  }

  private runtimeFor(clip: TimelineClip, kind: string): ClipRuntime {
    let rt = this.runtimes.get(clip.id);
    if (rt) return rt;
    // `clip` is stored so `captureFilmstrip` can read `sourceIn` and `speed`
    // without being handed the whole model a second time.
    rt = { el: null, audio: null, ready: false, lastGain: 1, clip };

    const source = this.state?.sources.get(clip.mediaId);
    if (source && (kind === 'video' || kind === 'audio') && source.url) {
      try {
        const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
        el.src = source.url;
        el.preload = 'auto';
        if (el instanceof HTMLVideoElement) el.playsInline = true;
        el.crossOrigin = 'anonymous';
        el.muted = false;
        el.volume = 1;
        // Off-screen rather than `display:none`: a `display:none` element may
        // never be decoded at all in some engines, which is a permanent no-op
        // with no error attached.
        el.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0';
        el.addEventListener('loadeddata', () => {
          rt!.ready = true;
        });
        el.addEventListener('error', () => {
          rt!.ready = false;
        });
        document.body.appendChild(el);
        rt.el = el;
        rt.audio = attachMedia(el);
        applyEffects(rt.audio, rt.audio?.ctx ?? null, effectsFor(clip));
      } catch {
        rt.el = null;
      }
    }
    this.runtimes.set(clip.id, rt);
    return rt;
  }

  dispose() {
    if (Compositor.live === this) Compositor.live = null;
    for (const rt of this.runtimes.values()) {
      try {
        rt.el?.pause();
        rt.el?.remove();
      } catch {
        /* already gone */
      }
    }
    this.runtimes.clear();
  }

  // -------------------------------------------------------------------------

  /**
   * Draw the project at `t`.
   *
   * `playing` only affects media-element transport, not the picture: seeking
   * with `playing` false still shows the correct frame for that instant.
   */
  renderFrame(t: number, playing: boolean) {
    const state = this.state;
    if (!state) return;
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = state.settings.background || '#000000';
    ctx.fillRect(0, 0, W, H);

    const anySolo = state.tracks.some((tr) => tr.solo);
    const visual = state.tracks.filter((tr) => tr.type === 'video' || tr.type === 'image');

    for (const track of visual) {
      if (!track.visible) continue;
      const tr = activeTransition(state.transitions, track, t);
      if (tr) {
        const outgoing = track.clips.find((c) => Math.abs(clipEnd(c) - tr.atTime) < 1e-6);
        const incoming = track.clips.find((c) => Math.abs(c.startTime - tr.atTime) < 1e-6);
        if (outgoing && incoming) {
          const p = (t - tr.atTime) / Math.max(0.001, tr.duration);
          this.paint(outgoing, t, track, this.scratchA.getContext('2d')!);
          this.paint(incoming, t, track, this.scratchB.getContext('2d')!);
          applyTransition(ctx, tr.type, p, this.scratchA, this.scratchB, W, H);
          continue;
        }
      }
      const clip = clipAt(track, t);
      if (clip) this.paint(clip, t, track, ctx);
    }

    // Titles last: text on top of picture is the whole point of a title track.
    for (const track of state.tracks) {
      if (track.type !== 'text' || !track.visible) continue;
      const clip = clipAt(track, t);
      if (!clip) continue;
      this.paintText(clip, ctx, W, H);
    }

    // Audio is not a drawing, but it is part of "this frame": elements that
    // are not on screen still have to be playing or silent correctly.
    //
    // A clip inside a transition stays active PAST its own end, because an
    // audio crossfade needs both takes audible at once. The picture is held
    // too, by `paint`, and holding only the picture would make a crossfade
    // look right and sound like a hard cut.
    for (const track of state.tracks) {
      if (track.type === 'text') continue;
      const audible = !track.muted && (!anySolo || track.solo);
      for (const clip of track.clips) {
        const end = effectiveEnd(state.transitions, track, clip);
        const on = t >= clip.startTime && t < end;
        if (!on) {
          this.pauseClip(clip);
          continue;
        }
        // The whole mix, multiplied once: clip level and fades, the track
        // fader, mute and solo, and finally the master. Doing it in one place
        // is what stops "muted but still audible" and "the fader overrode the
        // fade".
        const gain = audible ? track.volume * clipGainAt(clip, t) * state.masterVolume : 0;
        this.syncMedia(clip, t, playing, gain);
      }
    }
  }

  /**
   * Draw a single clip on its own, filling the frame.
   *
   * This is hover-to-preview. It runs on the same element and the same
   * compositor as normal playback, so hovering cannot leave the player showing
   * something the timeline does not contain - which is exactly what happened
   * when a hover used to point the shared `<video>` at a different source.
   */
  renderClipOnly(clip: TimelineClip, time: number, playing: boolean) {
    const state = this.state;
    if (!state) return;
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    // Position and opacity are reset for the preview: a hover is a look at
    // the FOOTAGE, and showing it at 30% scale in a corner because it happens
    // to be an overlay would be a lie about the clip. Its colour grade is kept,
    // because that is genuinely part of the clip.
    const flat: TimelineClip = {
      ...clip,
      opacity: 1,
      transform: { ...DEFAULT_TRANSFORM, fit: 'contain' },
    };

    if (clip.type === 'text') {
      this.paintText(flat, ctx, W, H);
      return;
    }
    const source = state.sources.get(clip.mediaId);
    if (!source) {
      drawPlaceholder(ctx, 0, 0, W, H, clip.mediaName);
      return;
    }
    if (clip.type === 'image') {
      const img = loadImage(source.url);
      if (img.complete && img.naturalWidth > 0) {
        this.blit(ctx, img, img.naturalWidth, img.naturalHeight, { x: 0, y: 0, w: W, h: H }, { z: 1, dx: 0, dy: 0 }, flat);
      } else {
        drawPlaceholder(ctx, 0, 0, W, H, clip.mediaName);
      }
      return;
    }
    // A video clip's source time is measured from ITS OWN start, because the
    // hover is a scrub through the file, not through the timeline.
    const local = Math.max(0, time - clip.startTime) * clip.speed + clip.sourceIn;
    const rt = this.runtimeFor(clip, 'video');
    const el = rt.el;
    if (!el) {
      drawPlaceholder(ctx, 0, 0, W, H, clip.mediaName);
      return;
    }
    const limit = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY;
    const target = Math.max(0, Math.min(local, Math.max(0, limit - 0.02)));
    if (Math.abs(el.currentTime - target) > 0.05) {
      try {
        el.currentTime = target;
      } catch {
        /* not seekable yet */
      }
    }
    if (el.paused) void el.play().catch(() => {});
    if (el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0) {
      this.blit(ctx, el, el.videoWidth, el.videoHeight, { x: 0, y: 0, w: W, h: H }, { z: 1, dx: 0, dy: 0 }, flat);
    } else if (clip.poster) {
      const img = loadImage(clip.poster);
      if (img.complete && img.naturalWidth > 0) this.blit(ctx, img, img.naturalWidth, img.naturalHeight, { x: 0, y: 0, w: W, h: H }, { z: 1, dx: 0, dy: 0 }, flat);
      else drawPlaceholder(ctx, 0, 0, W, H, clip.mediaName);
    } else {
      drawPlaceholder(ctx, 0, 0, W, H, clip.mediaName);
    }
  }

  /** Static handle on the live compositor.
   *
   * The timeline's filmstrip needs to reach the element that is ALREADY
   * decoding each clip, and the compositor is the only thing that owns those
   * elements. Threading a ref down through the preview to the lanes would work,
   * but the dependency is backwards - the lanes are chrome, they should not know
   * a compositor exists - so the live instance is published here instead. One
   * live compositor, which is also true: there is one preview.
   */
  private static live: Compositor | null = null;

  static getLive(): Compositor | null {
    return Compositor.live;
  }

  /** Build a clip's decoder on demand.
   *
   * A clip that is not under the playhead has no element yet, because nothing
   * has needed to draw it. The filmstrip needs one anyway, and waiting for the
   * playhead to wander over the clip would mean a strip that appears only once
   * you have already scrubbed past it.
   */
  ensureElement(clipId: string): boolean {
    const rt = this.runtimes.get(clipId);
    if (rt?.el) return true;
    // `paint` creates the runtime; a 1x1 rect is enough, we only want the
    // element, not a frame.
    const clip = this.findClip(clipId);
    if (!clip) return false;
    const created = this.runtimeFor(clip, clip.type === 'audio' ? 'audio' : 'video');
    return Boolean(created?.el);
  }

  private findClip(clipId: string): TimelineClip | null {
    for (const track of this.state?.tracks ?? []) {
      for (const c of track.clips) if (c.id === clipId) return c;
    }
    return null;
  }

  /**
   * Real frames from a clip's own source, for the timeline filmstrip.
   *
   * THIS DELIBERATELY REUSES THE CLIP'S EXISTING ELEMENT rather than making a
   * second one. A dedicated thumbnail video looked simpler, and it never
   * loaded: measured in the browser, the elements sat at `readyState 0`
   * forever, three extractions hung in flight, and the strip stayed empty
   * while the code read as though it should work.
   *
   * The compositor's element is already decoding - the preview proves it, frame
   * by frame - so reusing it means the filmstrip cannot fail in a way the
   * preview does not. One decoder per clip, not two.
   *
   * Frames come from the clip's own span, NOT from 0: a clip that starts at
   * 12s in its file would otherwise show the wrong twelve seconds entirely,
   * and the strip would then disagree with the preview - which is worse than
   * showing nothing.
   */
  async captureFilmstrip(clipId: string, count: number): Promise<string[]> {
    if (!this.ensureElement(clipId)) return [];
    const runtime = this.runtimes.get(clipId);
    const el = runtime?.el as HTMLVideoElement | null;
    const clip = runtime?.clip;
    if (!el || !clip) return [];

    if (el.readyState < 2 || !el.videoWidth) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        el.addEventListener('loadeddata', done, { once: true });
        el.addEventListener('canplay', done, { once: true });
        el.addEventListener('error', done, { once: true });
        setTimeout(done, 6000);
      });
    }
    if (el.readyState < 2 || !el.videoWidth) return [];

    const canvas = document.createElement('canvas');
    // 2x capture, displayed at 1x - see the note in `filmstrip.ts`. Drawing at
    // the DISPLAY size would sample too few pixels and then be upscaled back,
    // which is precisely the dullness this is meant to remove.
    canvas.width = 112;
    canvas.height = 68;
    const g = canvas.getContext('2d');
    if (!g) return [];

    const from = clip.sourceIn;
    const span = clip.duration * Math.max(clip.speed, 0.01);
    const wasPlaying = !el.paused;
    const wasTime = el.currentTime;
    if (wasPlaying) el.pause();

    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      // Sample the CENTRE of each slice, not its start. A frame taken exactly
      // on the cut often belongs to the previous slice, so every strip would
      // look one frame late.
      const t = from + span * ((i + 0.5) / count);
      const ok = await this.seekTo(el, t);
      if (!ok) break;
      try {
        // `imageSmoothingQuality: high` matters at 2x DOWNSCALE quality: the
        // default gives a soft, slightly aliased result that reads as a low
        // resolution image even though the capture is high resolution.
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(el, 0, 0, 112, 68);
        out.push(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        break;
      }
    }

    // Put the element back exactly where the timeline expects it. Capturing
    // frames must not visibly move the playhead or stop the audio.
    void this.seekTo(el, wasTime);
    if (wasPlaying) void el.play().catch(() => undefined);
    return out.length >= 2 ? out : [];
  }

  /** Seek with a timeout. An unseekable file must not hang the caller. */
  private seekTo(el: HTMLVideoElement, time: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        el.removeEventListener('seeked', onSeeked);
        el.removeEventListener('error', onError);
        resolve(ok);
      };
      const onSeeked = () => finish(true);
      const onError = () => finish(false);
      el.addEventListener('seeked', onSeeked);
      el.addEventListener('error', onError);
      setTimeout(() => finish(false), 2000);
      try {
        el.currentTime = Math.max(0, time);
      } catch {
        finish(false);
      }
    });
  }

  /** Stop everything. Used when the preview switches away from hover mode. */
  pauseAll() {
    for (const rt of this.runtimes.values()) {
      if (rt.el && !rt.el.paused) rt.el.pause();
    }
  }

  private pauseClip(clip: TimelineClip) {
    const rt = this.runtimes.get(clip.id);
    if (rt?.el && !rt.el.paused) rt.el.pause();
  }

  /**
   * Align one clip's media element with the playhead and set its level.
   *
   * The gain written here is the whole mix: clip volume, fades, the track
   * fader, mute and solo, already multiplied by the caller. Doing it in one
   * place is what stops "muted but still audible" and "faded in but the
   * fader overrode it".
   */
  private syncMedia(clip: TimelineClip, t: number, playing: boolean, gain: number) {
    const kind = clip.type === 'audio' ? 'audio' : 'video';
    const rt = this.runtimeFor(clip, kind);
    const el = rt.el;
    if (!el) return;

    const target = sourceTimeAt(clip, t);
    const limit = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY;
    const clamped = Math.max(0, Math.min(target, Math.max(0, limit - 0.02)));
    const epsilon = playing ? SEEK_EPSILON_PLAYING : SEEK_EPSILON_PAUSED;

    if (Math.abs(el.currentTime - clamped) > epsilon && Number.isFinite(clamped)) {
      try {
        el.currentTime = clamped;
      } catch {
        /* seeking before metadata is ready throws on some engines */
      }
    }
    if (Math.abs(el.playbackRate - clip.speed) > 0.01) el.playbackRate = clip.speed;

    if (playing && gain > 0) {
      if (el.paused) void el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }

    const g = Math.max(0, Math.min(1, gain));
    if (Math.abs(rt.lastGain - g) > 0.002) {
      rt.lastGain = g;
      if (rt.audio) {
        try {
          rt.audio.gain.gain.value = g;
        } catch {
          /* context closed */
        }
      } else {
        el.volume = g;
      }
    }
  }

  /** Draw one visual clip into `target`. */
  private paint(clip: TimelineClip, t: number, _track: TimelineTrack, target: CanvasRenderingContext2D) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const rect = destinationRect(clip.transform, W, H);
    const pan = kenBurns(clip.transform, clip, t);

    target.save();
    target.globalAlpha = Math.max(0, Math.min(1, clip.opacity));

    if (clip.type === 'text') {
      target.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      target.scale(pan.z, pan.z);
      target.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
      drawText(target, { ...DEFAULT_TEXT_STYLE, ...clip.text }, rect.x, rect.y, rect.w, rect.h);
      target.restore();
      return;
    }

    const source = this.state?.sources.get(clip.mediaId);
    if (!source) {
      drawPlaceholder(target, rect.x, rect.y, rect.w, rect.h, clip.mediaName);
      target.restore();
      return;
    }

    if (clip.type === 'image') {
      const img = loadImage(source.url);
      if (img.complete && img.naturalWidth > 0) {
        this.blit(target, img, img.naturalWidth, img.naturalHeight, rect, pan, clip);
      } else {
        drawPlaceholder(target, rect.x, rect.y, rect.w, rect.h, clip.mediaName);
      }
      target.restore();
      return;
    }

    // Video. A still image is also an acceptable frame source: `clip.poster`
    // is the frame at 10% of the file, so a clip that has not decoded yet
    // shows the right picture instead of a grey box.
    const rt = this.runtimeFor(clip, 'video');
    const el = rt.el;
    const useEl = Boolean(el && (el.readyState >= 2 || rt.ready));
    const usePoster = !useEl && !!clip.poster;

    if (!useEl && !usePoster) {
      drawPlaceholder(target, rect.x, rect.y, rect.w, rect.h, clip.mediaName);
      target.restore();
      return;
    }

    if (useEl) {
      const sw = (el as HTMLVideoElement).videoWidth;
      const sh = (el as HTMLVideoElement).videoHeight;
      if (sw > 0 && sh > 0) this.blit(target, el as HTMLVideoElement, sw, sh, rect, pan, clip);
      else drawPlaceholder(target, rect.x, rect.y, rect.w, rect.h, clip.mediaName);
    } else {
      const img = loadImage(clip.poster!);
      if (img.complete && img.naturalWidth > 0) this.blit(target, img, img.naturalWidth, img.naturalHeight, rect, pan, clip);
      else drawPlaceholder(target, rect.x, rect.y, rect.w, rect.h, clip.mediaName);
    }
    target.restore();
  }

  /** Fit / position a source into its destination box, then draw it. */
  private blit(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    sw: number,
    sh: number,
    rect: { x: number; y: number; w: number; h: number },
    pan: { z: number; dx: number; dy: number },
    clip: TimelineClip
  ) {
    const fit = clip.transform.fit;
    let sx = rect.x;
    let sy = rect.y;
    let sw2 = rect.w;
    let sh2 = rect.h;

    if (fit === 'contain' || fit === 'cover') {
      const scale = fit === 'contain' ? Math.min(rect.w / sw, rect.h / sh) : Math.max(rect.w / sw, rect.h / sh);
      const w = sw * scale;
      const h = sh * scale;
      sx = rect.x + (rect.w - w) / 2;
      sy = rect.y + (rect.h - h) / 2;
      sw2 = w;
      sh2 = h;
    }

    ctx.save();
    const cx = sx + sw2 / 2;
    const cy = sy + sh2 / 2;
    ctx.translate(cx, cy);
    ctx.scale(pan.z, pan.z);
    ctx.translate(pan.dx, pan.dy);
    ctx.translate(-cx, -cy);

    const f = clip.filter;
    ctx.filter = filterString(f);
    ctx.drawImage(src, sx, sy, sw2, sh2);

    // Temperature has no CSS filter operator, so it is a wash in the overlay
    // blend mode: warm pushes orange into the highlights, cool pushes blue
    // into the shadows, and both leave mid-greys alone.
    if (f.temperature !== 0) {
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.45, Math.abs(f.temperature) * 0.4);
      ctx.fillStyle = f.temperature > 0 ? '#ff9a3c' : '#3c8cff';
      ctx.fillRect(sx, sy, sw2, sh2);
    }
    ctx.restore();
  }

  private paintText(clip: TimelineClip, ctx: CanvasRenderingContext2D, W: number, H: number) {
    const rect = destinationRect(clip.transform, W, H);
    const pan = kenBurns(clip.transform, clip, 0);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, clip.opacity));
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(pan.z, pan.z);
    ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
    drawText(ctx, { ...DEFAULT_TEXT_STYLE, ...clip.text }, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Where a clip's picture lands on the frame.
 *
 * `x`/`y` are the CENTRE of the destination as a fraction of the canvas, so
 * 0.5/0.5 is dead centre and dragging an overlay moves it from there.
 * `pip` ignores them and snaps to a corner at `pipSize` of the frame width,
 * which is what "picture in picture" means and why it is a separate mode.
 */
export function destinationRect(
  t: ClipTransform,
  W: number,
  H: number
): { x: number; y: number; w: number; h: number } {
  if (t.fit === 'pip') {
    const w = t.pipSize * W;
    const h = w * 0.5625;
    const pad = W * 0.035;
    const x = t.corner.includes('right') ? W - w - pad : pad;
    const y = t.corner.includes('bottom') ? H - h - pad : pad;
    return { x, y, w, h };
  }
  const w = t.scale * W;
  const h = t.scale * H;
  return { x: t.x * W - w / 2, y: t.y * H - h / 2, w, h };
}

/** Ken Burns drift across the clip's own duration. Identity when unused. */
function kenBurns(t: ClipTransform, clip: TimelineClip, time: number) {
  const moving = t.zoomStart !== 1 || t.zoomEnd !== 1 || t.panX !== 0 || t.panY !== 0;
  if (!moving) return { z: 1, dx: 0, dy: 0 };
  const p = Math.max(0, Math.min(1, (time - clip.startTime) / Math.max(0.001, clip.duration)));
  const z = t.zoomStart + (t.zoomEnd - t.zoomStart) * p;
  return { z, dx: t.panX * p, dy: t.panY * p };
}

function activeTransition(transitions: Transition[], track: TimelineTrack, t: number): Transition | null {
  const found = transitionAt(transitions, track.id, t);
  if (!found) return null;
  return transitions.find((x) => x.trackId === track.id && x.atTime === found.atTime) ?? null;
}

/**
 * A clip's real end on the timeline.
 *
 * A transition holds the outgoing clip past its own end, so a crossfade has
 * both pictures - and both takes - on screen at once. Without this, audio
 * would hard-cut at the join while the picture crossfaded.
 */
function effectiveEnd(transitions: Transition[], track: TimelineTrack, clip: TimelineClip): number {
  const end = clipEnd(clip);
  const tr = transitions.find((x) => x.trackId === track.id && Math.abs(x.atTime - end) < 1e-6);
  return tr ? end + tr.duration : end;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>();

/**
 * One `Image` per URL, reused.
 *
 * Creating a fresh `Image` for every frame of a timeline playback is a way to
 * make a browser tab consume gigabytes, because each one holds a decoded
 * bitmap and nothing releases it.
 */
function loadImage(url: string): HTMLImageElement {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    imageCache.set(url, img);
  }
  return img;
}

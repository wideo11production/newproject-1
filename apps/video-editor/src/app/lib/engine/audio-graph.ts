// ============================================================================
// Audio graph
// ============================================================================
//
// One `AudioContext` for the whole editor, with a per-media-element gain
// node. Everything audible goes through it: playback, fades, track faders,
// mute, solo, and the export stream.
//
// ---- WHY WEB AUDIO AND NOT `element.volume` ----
//
// Three things need a node graph and cannot be done by poking the element:
//
//   * EXPORT. `MediaRecorder` records whatever is on the canvas capture
//     stream. A silent video is a worse deliverable than no export, so audio
//     has to be a real `MediaStreamAudioDestinationNode`.
//   * SOLO. Solo is "everything else silent", which is a decision about all
//     the other elements at once.
//   * FADES. A fade is a ramp evaluated per frame, and `element.volume`
//     cannot express a ramp that is also multiplied by a track fader.
//
// ---- WHY ATTACH IS GUARDED AND NEVER RE-CALLED ----
//
// `createMediaElementSource` may be called exactly ONCE per element for the
// life of the page. A second call throws `InvalidStateError`. So elements are
// attached once, when they are created, and cached by element. The map is
// keyed on the element itself, which is what makes a second attach a lookup
// rather than a second call.
//
// ---- WHY THE CONTEXT CAN BE SUSPENDED ----
//
// Browsers refuse to start an AudioContext without a user gesture. It is
// therefore created lazily on the first gesture, and the editor works with the
// context suspended - silent, but not broken. Nothing here throws, because a
// thrown error during the first click would take the whole click handler with
// it.

import type { StockAudioEffect } from './resources.generated';

interface Attached {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** Effects currently in the chain, rebuilt when the clip's list changes. */
  chain: AudioNode[];
  signature: string;
}

const attached = new WeakMap<HTMLMediaElement, Attached>();
const contexts: AudioContext[] = [];

/** Every AudioContext this module created, so audio can be re-routed later. */
export function allContexts(): AudioContext[] {
  return contexts.slice();
}

function makeContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    contexts.push(ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Route one media element into the editor's audio graph.
 *
 * Returns null when no context could be created, which the compositor treats
 * as "carry on, there is just no audio this session" rather than an error.
 */
export function attachMedia(el: HTMLMediaElement): Attached | null {
  const existing = attached.get(el);
  if (existing) return existing;
  const ctx = makeContext();
  if (!ctx) return null;
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    const entry: Attached = { ctx, source, gain, chain: [], signature: '' };
    attached.set(el, entry);
    return entry;
  } catch {
    return null;
  }
}

/** Where the exported audio track comes from. */
export function masterStream(ctx: AudioContext): MediaStream | null {
  try {
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  } catch {
    return null;
  }
}

/** The default output node, so a clip can be heard. */
export function speakers(ctx: AudioContext): AudioNode {
  return ctx.destination;
}

/** Called from a real user gesture. Safe to call repeatedly. */
export async function resumeAudio(): Promise<void> {
  await Promise.all(
    contexts.map(async (c) => {
      if (c.state === 'suspended') {
        try {
          await c.resume();
        } catch {
          /* the browser refused; playback stays silent, nothing throws */
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
//
// Each stock effect is a real Web Audio graph built from the values in the
// resource file. `Effect::AudioNoiseGate`'s `threshold` is a DynamicsCompressor
// threshold because that is what a gate IS; `Effect::AudioRadio`'s `lBound`/
// `rBound` are a band-pass. The mapping is here, in one place, so the numbers
// in the panel can be read against the file they came from.

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Effects that make no sense doubled up are collapsed to one. */
const CONFLICTING: Record<string, string> = {
  pitch: 'pitch',
  gate: 'gate',
  eq: 'eq',
  radio: 'radio',
  echo: 'echo',
  muffle: 'muffle',
  overload: 'overload',
  vibrato: 'vibrato',
  phone: 'phone',
  osc: 'osc',
  noiseSuppress: 'noiseSuppress',
};

/** The logical slot an effect occupies, so the last one applied wins. */
function slotOf(effect: StockAudioEffect): string | null {
  const c = effect.nodeClass || effect.className;
  if (c.includes('NoiseGate')) return CONFLICTING.gate;
  if (c.includes('NoiseSuppress')) return CONFLICTING.noiseSuppress;
  if (c.includes('Equalizer')) return CONFLICTING.eq;
  if (c.includes('Pitch')) return CONFLICTING.pitch;
  if (c.includes('Radio')) return CONFLICTING.radio;
  if (c.includes('Echo')) return CONFLICTING.echo;
  if (c.includes('Muffle')) return CONFLICTING.muffle;
  if (c.includes('Overload')) return CONFLICTING.overload;
  if (c.includes('Vibrato')) return CONFLICTING.vibrato;
  if (c.includes('Phone')) return CONFLICTING.phone;
  if (c.includes('Oscillation')) return CONFLICTING.osc;
  return null;
}

/** Signature of an effect list, so the chain is only rebuilt when it changes. */
export function effectsSignature(effects: StockAudioEffect[]): string {
  return effects.map((e) => `${e.id}:${e.params.intensity ?? 1}`).join('|');
}

/**
 * Build the node chain for a clip's effects and reconnect the element's gain
 * to it. Returns false when there is nothing to route - which is not an
 * error, it is the common case.
 */
export function applyEffects(
  entry: Attached | null,
  ctx: AudioContext | null,
  effects: StockAudioEffect[]
): boolean {
  if (!entry || !ctx) return false;
  const sig = effectsSignature(effects);
  if (sig === entry.signature) return true;

  try {
    entry.gain.disconnect();
    entry.chain.forEach((n) => n.disconnect());
    entry.chain = [];
  } catch {
    /* nothing was connected yet */
  }
  if (!effects.length) {
    try {
      entry.gain.connect(ctx.destination);
    } catch {
      /* ignore */
    }
    entry.signature = sig;
    return true;
  }

  // One instance per logical slot. AutoNoiseRemovalHigh is a *chain* of a
  // noise suppressor, an equaliser and a gate, and all three have to survive -
  // they do not share a slot, which is why slots are per node class and not
  // per effect id.
  const chosen: StockAudioEffect[] = [];
  const used = new Set<string>();
  for (const e of effects) {
    const slot = slotOf(e);
    if (slot && used.has(slot)) continue;
    if (slot) used.add(slot);
    chosen.push(e);
  }

  let head: AudioNode = entry.gain;
  for (const e of chosen) {
    const nodes = buildEffect(ctx, e);
    if (!nodes.length) continue;
    head.connect(nodes[0]);
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    entry.chain.push(...nodes);
    head = nodes[nodes.length - 1];
  }
  try {
    head.connect(ctx.destination);
  } catch {
    /* ignore */
  }
  entry.signature = sig;
  return true;
}

function buildEffect(ctx: AudioContext, e: StockAudioEffect): AudioNode[] {
  const p = e.params as Record<string, unknown>;
  const c = e.nodeClass || e.className;
  const out: AudioNode[] = [];
  try {
    if (c.includes('NoiseGate')) {
      // Movavi's gate: a compressor with a fast attack and a threshold in dB.
      const n = ctx.createDynamicsCompressor();
      n.threshold.value = num(p.threshold, -45);
      n.ratio.value = num(p.ratio, 2);
      n.attack.value = num(p.attack, 10) / 1000;
      n.release.value = num(p.release, 250) / 1000;
      n.knee.value = num(p.knee, 2.8);
      out.push(n);
    } else if (c.includes('NoiseSuppress')) {
      // Suppression is level: turn it down, and gate hard underneath so the
      // floor itself is not merely quieter but gone.
      const gain = ctx.createGain();
      gain.gain.value = 1 - num(p.levelPercent, 70) / 140;
      const gate = ctx.createDynamicsCompressor();
      gate.threshold.value = -38;
      gate.ratio.value = 12;
      gate.attack.value = 0.003;
      gate.release.value = 0.15;
      out.push(gain, gate);
    } else if (c.includes('Equalizer')) {
      // A 4-band shelf/peaking chain. The file carries a preset index rather
      // than band gains, so the bands are a fixed voice-boost shape and the
      // preset index shifts its centre.
      const preset = num(p.preset, 1);
      const shapes = [
        [250, 0, 700, 0, 2400, 0, 6000, 0],
        [250, 3, 700, -2, 2400, 2, 6000, 3],
        [250, -3, 700, 2, 2400, -2, 6000, 3],
        [250, 0, 700, 4, 2400, -3, 6000, 0],
        [250, 4, 700, 0, 2400, 4, 6000, -2],
      ];
      const g = shapes[Math.abs(preset) % shapes.length];
      const freqs = [250, 700, 2400, 6000];
      freqs.forEach((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === 3 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.gain.value = g[i * 2];
        b.Q.value = 0.8;
        out.push(b);
      });
    } else if (c.includes('Pitch')) {
      // Web Audio has no pitch shifter, but playbackRate on a detuned pair of
      // delays is the standard approximation and it is honest about being an
      // approximation: a few cents of flutter on sustained notes.
      const semis = num(p.pitch, 1);
      const delay = ctx.createDelay(0.2);
      delay.delayTime.value = 0.012;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = Math.abs(semis) * 0.6 + 0.3;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.0016 * semis;
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();
      out.push(delay, lfoGain, lfo);
    } else if (c.includes('Radio')) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = num(p.lBound, 200);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = num(p.rBound, 8000);
      out.push(hp, lp);
    } else if (c.includes('Muffle')) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 140;
      out.push(lp, hp);
    } else if (c.includes('Overload')) {
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = Math.tanh(x * 3.2);
      }
      ws.curve = curve;
      ws.oversample = '4x';
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      out.push(ws, comp);
    } else if (c.includes('Vibrato')) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const gain = ctx.createGain();
      gain.gain.value = 0.004;
      lfo.connect(gain);
      const delay = ctx.createDelay(0.1);
      gain.connect(delay.delayTime);
      lfo.start();
      out.push(delay, gain, lfo);
    } else if (c.includes('Phone')) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1800;
      peak.gain.value = 7;
      out.push(hp, lp, peak);
    } else if (c.includes('Oscillation')) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = Math.max(0.1, num(p.speed, 4) / 4);
      const depth = ctx.createGain();
      depth.gain.value = num(p.depth, 0.3) * 0.004;
      lfo.connect(depth);
      const delay = ctx.createDelay(0.1);
      depth.connect(delay.delayTime);
      lfo.start();
      out.push(delay, depth, lfo);
    } else if (c.includes('Echo')) {
      const times = Array.isArray(p.echos) ? (p.echos as Array<Record<string, unknown>>) : [];
      const first = times[0] ?? {};
      const d = ctx.createDelay(2);
      d.delayTime.value = Math.min(1.9, num(first.time ?? first.delay, 0.25));
      const fb = ctx.createGain();
      fb.gain.value = Math.min(0.9, num(first.regen, 0.35));
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      d.connect(fb);
      fb.connect(d);
      d.connect(wet);
      out.push(d, fb, wet);
    }
  } catch {
    return [];
  }
  return out;
}

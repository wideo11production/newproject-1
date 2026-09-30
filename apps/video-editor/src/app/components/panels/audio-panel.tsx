'use client';

// ============================================================================
// Audio panel
// ============================================================================
//
// Three things, all real:
//
//   * AUDIO EFFECTS - the stock effect list, each one a genuine Web Audio node
//     graph built from the values in its own resource file (see
//     `lib/engine/audio-graph.ts`).
//   * SILENCE REMOVAL - signal processing in the browser. No model, no upload,
//     no cost. 0% removed is a legitimate answer and the panel says so.
//   * LEVEL MATCHING - normalises a clip to a target peak with a single gain
//     value. That is what a compressor does, and it is the honest way to say
//     "make it as loud as that" without pretending to be a mastering suite.

import { useState } from 'react';
import { AudioWaveform, Gauge, Wand2, Mic, Check } from 'lucide-react';
import { PanelSection, Tile, TileGrid, Field, Slider, Button, EmptyState } from './panel-kit';
import { stockAudioEffects } from '../../lib/engine/resources.generated';
import { removeSilence } from '../../lib/audio/silence';
import type { TimelineClip } from '../../lib/engine/types';

export function AudioPanel({
  clip,
  audioUrl,
  onToggleEffect,
  onClearEffects,
  onClipVolume,
  onClipFade,
  onMatchLevel,
  onSilenceRemoved,
  onRecord,
}: {
  clip: TimelineClip | null;
  /** Blob URL of the most recent recording, so it can be processed. */
  audioUrl: string | null;
  onToggleEffect: (id: string) => void;
  onClearEffects: () => void;
  onClipVolume: (v: number) => void;
  onClipFade: (edge: 'in' | 'out', v: number) => void;
  onMatchLevel: (targetDb: number) => void;
  onSilenceRemoved: (blob: Blob) => void;
  onRecord: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.0056);
  const [minSilence, setMinSilence] = useState(0.35);

  const run = async () => {
    if (!audioUrl) return;
    setBusy('Analysing audio…');
    setResult(null);
    try {
      const res = await fetch(audioUrl);
      const { blob, result: r } = await removeSilence(await res.blob(), {
        threshold,
        minSilence,
      });
      const pct = r.originalSeconds ? Math.round((r.removedSeconds / r.originalSeconds) * 100) : 0;
      setResult(
        r.removedSeconds < 0.05
          ? `No silence found — ${r.originalSeconds.toFixed(1)}s unchanged. The threshold is ${(
              20 * Math.log10(threshold)
            ).toFixed(1)} dBFS; raise it to cut more.`
          : `Removed ${r.removedSeconds.toFixed(1)}s of ${r.originalSeconds.toFixed(1)}s (${pct}%) in your browser — nothing uploaded.`
      );
      onSilenceRemoved(blob);
    } catch (e) {
      setResult(e instanceof Error ? `Failed: ${e.message}` : 'Silence removal failed');
    } finally {
      setBusy(null);
    }
  };

  const canProcess = Boolean(audioUrl);

  return (
    <div className="space-y-3">
      <PanelSection
        title="Audio effects"
        hint="Each one is a real Web Audio graph built from the values in the effect's own resource file."
        action={
          clip?.effects.length ? (
            <Button variant="outline" onClick={onClearEffects}>
              Clear
            </Button>
          ) : undefined
        }
      >
        {clip ? (
          <>
            <TileGrid>
              {stockAudioEffects.map((e) => {
                const on = clip.effects.includes(e.id);
                return (
                  <Tile
                    key={e.id}
                    label={e.label}
                    hint={e.group === 'enhance' ? 'Cleanup' : e.nodeClass.split('::').pop()}
                    swatch={e.group === 'enhance' ? 'from-emerald-500/40 to-slate-900/20' : 'from-violet-500/40 to-slate-900/20'}
                    active={on}
                    onClick={() => onToggleEffect(e.id)}
                    ariaLabel={`${on ? 'Remove' : 'Apply'} the ${e.label} effect`}
                  />
                );
              })}
            </TileGrid>
            <p className="mt-2 text-[10px] leading-snug text-fg-muted">
              {stockAudioEffects.length} effects, read out of the stock sample resources. Two that
              touch the same stage of the chain (two pitch shifts, two gates) are applied as the last
              one wins; AutoNoiseRemoval is a chain of three and keeps all three.
            </p>
          </>
        ) : (
          <EmptyState title="Select an audio or video clip" body="Effects apply to one clip at a time, so select the clip you want to change." />
        )}
      </PanelSection>

      {clip && (clip.type === 'audio' || clip.type === 'video') && (
        <PanelSection title="Level">
          <div className="space-y-2">
            <Field label="Clip volume" hint={`${Math.round(clip.volume * 100)}%`}>
              <Slider min={0} max={1} step={0.01} value={clip.volume} ariaLabel="Clip volume" onChange={onClipVolume} />
            </Field>
            <Field label="Fade in" hint={`${clip.fadeIn.toFixed(2)}s`}>
              <Slider
                min={0}
                max={Math.max(0.5, clip.duration / 2)}
                step={0.05}
                value={clip.fadeIn}
                ariaLabel="Fade in"
                onChange={(n) => onClipFade('in', n)}
              />
            </Field>
            <Field label="Fade out" hint={`${clip.fadeOut.toFixed(2)}s`}>
              <Slider
                min={0}
                max={Math.max(0.5, clip.duration / 2)}
                step={0.05}
                value={clip.fadeOut}
                ariaLabel="Fade out"
                onChange={(n) => onClipFade('out', n)}
              />
            </Field>
            <p className="text-[10px] leading-snug text-fg-muted">
              Fades are dragged directly on the clip — the small amber triangles in its top corners —
              or set in the properties dialog.
            </p>
            <Button onClick={() => onMatchLevel(-1)}>
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              Match to -1 dBFS peak
            </Button>
          </div>
        </PanelSection>
      )}

      <PanelSection
        title="Silence removal"
        hint="Measures RMS in 20ms windows, finds runs quieter than the threshold, and closes the gaps. This is arithmetic, not a model — it works offline and costs nothing."
      >
        <div className="space-y-2">
          <Field label="Threshold" hint={`${(20 * Math.log10(Math.max(1e-6, threshold))).toFixed(1)} dBFS`}>
            <Slider min={0.0005} max={0.05} step={0.0001} value={threshold} ariaLabel="Silence threshold" onChange={setThreshold} />
          </Field>
          <Field label="Shortest gap to cut" hint={`${minSilence.toFixed(2)}s`}>
            <Slider min={0.1} max={1.5} step={0.05} value={minSilence} ariaLabel="Minimum silence length" onChange={setMinSilence} />
          </Field>
          <p className="text-[10px] leading-snug text-fg-muted">
            -45 dBFS sits at a decent microphone&rsquo;s noise floor, and 350ms is below the gap
            between words, so cutting shorter makes speech sound clipped.
          </p>
          <div className="flex gap-1.5">
            <Button onClick={() => void run()} disabled={!canProcess || busy !== null}>
              <AudioWaveform className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ?? 'Remove silence'}
            </Button>
            <Button variant="outline" onClick={onRecord}>
              <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              Record
            </Button>
          </div>
          {!canProcess && (
            <p className="text-[10px] text-fg-muted">
              Record something, or import an audio file, and this becomes available.
            </p>
          )}
          {result && (
            <p className="flex items-start gap-1.5 rounded border border-edge bg-surface-raised/70 p-2 text-[10px] leading-snug text-fg">
              {result.startsWith('Removed') ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
              ) : (
                <Wand2 className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden="true" />
              )}
              {result}
            </p>
          )}
        </div>
      </PanelSection>
    </div>
  );
}

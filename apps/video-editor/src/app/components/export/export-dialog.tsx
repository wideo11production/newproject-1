'use client';

// ============================================================================
// Export dialog
// ============================================================================
//
// Renders the timeline to a real file with the browser's own encoder, and says
// plainly what that means:
//
//   * it is WEBM, because that is what `MediaRecorder` produces here
//   * it runs in REAL TIME, so a 60 second timeline takes 60 seconds
//   * the audio is the same mix you are hearing, because it comes out of the
//     same Web Audio graph
//
// Those are not caveats bolted onto a finished feature; they are the deal.
// A progress bar that races to 100% in two seconds for a one minute video
// would be the lie, so the bar tracks the render clock instead.

import { useMemo, useRef, useState } from 'react';
import { X, Download, Film, Clock, Volume2, VolumeX, Loader2, Check } from 'lucide-react';
import { PanelSection, Field, Select, Slider, Button, TextInput } from '../panels/panel-kit';
import {
  EXPORT_PRESETS,
  renderToFile,
  downloadBlob,
  supportedMimeTypes,
  type ExportPreset,
} from '../../lib/engine/exporter';
import type { CompositorState } from '../../lib/engine/compositor';
import type { ProjectSettings } from '../../lib/engine/types';

export function ExportDialog({
  open,
  onClose,
  state,
  settings,
  duration,
  projectName,
  startTime,
  endTime,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  state: CompositorState;
  settings: ProjectSettings;
  duration: number;
  projectName: string;
  startTime: number;
  endTime: number;
  onToast: (msg: string) => void;
}) {
  const [presetId, setPresetId] = useState('youtube-1080p');
  const [fileName, setFileName] = useState(projectName);
  const [quality, setQuality] = useState(6);
  const [whole, setWhole] = useState(true);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ url: string; name: string; size: number; silent: boolean; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef({ aborted: false });

  const mimes = useMemo(() => supportedMimeTypes(), []);
  const preset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? EXPORT_PRESETS[0];
  const from = whole ? 0 : startTime;
  const to = whole ? Math.max(duration, 0.5) : endTime;
  const seconds = Math.max(0.1, to - from);

  if (!open) return null;

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    abort.current = { aborted: false };
    try {
      const res = await renderToFile({
        state,
        settings,
        preset,
        startTime: from,
        endTime: to,
        quality,
        signal: abort.current,
        onProgress: (f, p) => {
          setProgress(f);
          setPhase(p);
        },
      });
      const name = `${(fileName || 'video').replace(/[^\w-]+/g, '_')}-${preset.id}.webm`;
      const url = URL.createObjectURL(res.blob);
      setResult({ url, name, size: res.blob.size, silent: res.silent, seconds: res.seconds });
      onToast(
        `Rendered ${res.seconds.toFixed(1)}s of ${res.width}×${res.height} to ${(res.blob.size / 1024 ** 2).toFixed(1)} MB` +
          (res.silent ? ' — no audio track, nothing in the timeline carries sound' : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The render failed');
    } finally {
      setRunning(false);
      setPhase('');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Export video"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <h2 className="text-[10px] font-medium text-fg">Export video</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close export dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-overlay hover:text-fg disabled:opacity-40"
          >
            <X className="h-2 w-2" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <PanelSection title="Preset" hint="Each one is a real platform's dimensions and bitrate, not a label.">
            <div className="space-y-2">
              <Field label="Target">
                <Select
                  value={presetId}
                  ariaLabel="Export preset"
                  options={EXPORT_PRESETS.map((p) => ({ value: p.id, label: `${p.label} — ${p.hint}` }))}
                  onChange={(v) => setPresetId(v)}
                />
              </Field>
              <div className="flex items-center gap-2 rounded border border-edge bg-surface/60 px-2 py-1.5 text-[8px] text-fg-muted">
                <Film className="h-2 w-2 shrink-0" aria-hidden="true" />
                {preset.width || settings.width}×{preset.height || settings.height} at {preset.fps || settings.fps} fps
                {' · '}
                {preset.videoKbps} kbps video
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Range and quality">
            <div className="space-y-2">
              <Field label="Range">
                <Select
                  value={whole ? 'whole' : 'selection'}
                  ariaLabel="Export range"
                  options={[
                    { value: 'whole', label: `Whole timeline (0 – ${duration.toFixed(1)}s)` },
                    { value: 'selection', label: `Playhead only (${startTime.toFixed(1)}s)` },
                  ]}
                  onChange={(v) => setWhole(v === 'whole')}
                />
              </Field>
              <Field label="Quality" hint={`${quality} / 10`}>
                <Slider min={0} max={10} step={1} value={quality} ariaLabel="Export quality" onChange={setQuality} />
              </Field>
            </div>
          </PanelSection>

          <PanelSection title="What you are getting" hint="Said up front rather than discovered afterwards.">
            <ul className="space-y-1 text-[8px] text-fg-secondary">
              <li className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-2 w-2 shrink-0 text-amber-400" aria-hidden="true" />
                Real-time: {seconds.toFixed(1)}s of video takes about {seconds.toFixed(0)}s to render. The
                progress bar tracks the render clock, not a fake timer.
              </li>
              <li className="flex items-start gap-1.5">
                <Film className="mt-0.5 h-2 w-2 shrink-0 text-amber-400" aria-hidden="true" />
                {mimes.length ? (
                  <>Container: {mimes[0].replace('video/', '').toUpperCase()} — the only thing this browser's encoder produces.</>
                ) : (
                  <span className="text-rose-300">This browser has no MediaRecorder, so there is no encoder to render with.</span>
                )}
              </li>
              <li className="flex items-start gap-1.5">
                {result?.silent || !state.tracks.some((t) => t.clips.length > 0) ? (
                  <>
                    <VolumeX className="mt-0.5 h-2 w-2 shrink-0 text-amber-400" aria-hidden="true" />
                    No clip on the timeline carries sound, so the file will be silent.
                  </>
                ) : (
                  <>
                    <Volume2 className="mt-0.5 h-2 w-2 shrink-0 text-emerald-400" aria-hidden="true" />
                    Audio is the mix you are hearing — same gain graph, same fades, same track faders.
                  </>
                )}
              </li>
            </ul>
          </PanelSection>

          {running && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-overlay">
                <div className="h-full rounded-full bg-[#ff6500] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[8px] text-fg-secondary">
                <Loader2 className="h-2 w-2 animate-spin" aria-hidden="true" />
                {phase} · {Math.round(progress * 100)}%
              </p>
            </div>
          )}

          {error && <p className="rounded border border-rose-900 bg-rose-950/30 p-2 text-[8px] text-rose-300">{error}</p>}

          {result && (
            <div className="rounded border border-emerald-900 bg-emerald-950/20 p-2">
              <p className="flex items-center gap-1.5 text-[8px] text-emerald-300">
                <Check className="h-2 w-2" aria-hidden="true" />
                {result.name} · {(result.size / 1024 ** 2).toFixed(1)} MB
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  onClick={() => {
                    fetch(result.url)
                      .then((r) => r.blob())
                      .then((b) => downloadBlob(b, result.name));
                  }}
                >
                  <Download className="h-2 w-2" aria-hidden="true" />
                  Download again
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-edge px-4 py-2.5">
          <TextInput value={fileName} ariaLabel="Output file name" onChange={setFileName} placeholder="video" />
          <div className="flex gap-1.5">
            {running ? (
              <Button variant="danger" onClick={() => (abort.current.aborted = true)}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
            <Button onClick={() => void run()} disabled={running || mimes.length === 0}>
              {running ? 'Rendering…' : 'Render'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export type { ExportPreset };

'use client';

// ============================================================================
// AURA Auto-Subtitles - timeline speech -> caption cues
// ============================================================================
//
// Hinglish: ye panel teen chizon ko jodta hai. Kis bhi ek ke bina feature adhura
// reh jata, isliye teeno saaf-saaf alag hain:
//
//   1. AUDIO (100% local, 100% asli, verifiable)
//      lib/audio/timeline-audio.ts - SAARE audio-bearing clips ko ek hi 16kHz
//      mono buffer me mix karta hai, unke timeline positions pe. Ye decoder
//      lib/audio/silence.ts ka decodeToMono() REUSE karta hai (jo pehle se kisi
//      bhi rate pe resample kar leta hai). Koi model, koi upload nahi.
//
//   2. TRANSCRIPTION (server side, subtitle-service)
//      Buffer WAV bana ke /api/subtitles/generate pe jata hai. Wo route PEHLE
//      auth-service se plan check karta hai (lifetime_aura) - AURA plan ke bina
//      402. Phir subtitle-service ke /subtitles/transcribe ko forward karta
//      hai, jo whisper (faster-whisper-server) ko hit karta hai aur timed
//      segments laata hai.
//
//   3. CUES (100% local, 100% asli, verifiable)
//      lib/subtitles/cues.ts - segments ko readable captions banata hai: chhote
//      cues merge, lambe cues word-boundary pe tod do, overlap fix.
//
// ---- KYUN SERVER PE, NA KI BROWSER ME ----
//
// Browser me Whisper chalana sunne me achha hai: 40MB model download, phir free
// forever. Chalne me:
//
//   * @huggingface/transformers (ya koi bhi wasm ONNX runtime) add karna padega,
//     aur uske .wasm assets next build ke bundle me aane se build config chhedna
//     padta.
//   * 1 min audio = 1-2 minute (WASM) ya 20-30s (WebGPU, agar ho). Firefox me
//     AudioWorklet + SIMD + SharedArrayBuffer headers teen alag problems hain.
//   * Is environment me wo dependency install/verify nahi ho sakta.
//
// Isliye seedhi baat: ye feature server-side whisper pe chalta hai.
//
// ---- KYUN YE FILE FAIL HONE PE SAAF BOLTI HAI ----
//
// subtitle-service ka purana AutoGenerate() FFmpeg arguments use karta tha jo
// transcription ka kaam karte hi nahi the, phir DB me Source: "whisper" likh
// deta tha. Yaani wo "subtitles ban gayi" claim karti thi jabki kuch nahi banta
// tha. Ye panel us pattern ko follow NAHI karta: har failure case (401, 402,
// 413, 503, 504, no-speech) ka apna saaf message hai, aur button tab tak
// "kaam kar raha hai" jaisa nahi dikhta jab tak asli mein na ho raha ho.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  Captions,
  Check,
  Loader2,
  AlertTriangle,
  Sparkles,
  Languages,
} from 'lucide-react';
import { PanelSection, Field, Slider, Button, EmptyState } from '../panels/panel-kit';
import { extractTimelineAudio, WHISPER_SAMPLE_RATE, peakOf } from '../../lib/audio/timeline-audio';
import { normaliseCues, totalCueSeconds, type SubtitleCue } from '../../lib/subtitles/cues';
import type { TimelineTrack } from '../../lib/engine/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Har ek language jo Whisper jaisa model reliably karta hai. */
const LANGUAGES = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi (Hinglish)' },
  { code: 'es', label: 'Espanol' },
  { code: 'pt', label: 'Portugues' },
  { code: 'fr', label: 'Francais' },
  { code: 'de', label: 'Deutsch' },
] as const;

export interface AuraSubtitlesProps {
  tracks: TimelineTrack[];
  /** Poora project kitne second ka hai. */
  duration: number;
  onInsertCues: (cues: SubtitleCue[]) => void;
  /** AURA plan gate - caller pehle hi check kar chuka hai. */
  isAura: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuraSubtitlesPanel({ tracks, duration, onInsertCues, isAura }: AuraSubtitlesProps) {
  // Kitne cues bane, aur kahan tak processing pahunchi.
  const [status, setStatus] = useState<'idle' | 'audio' | 'captions' | 'cues' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [language, setLanguage] = useState<string>('auto');
  const [minCue, setMinCue] = useState(0.6);
  const [maxCue, setMaxCue] = useState(4);
  const [maxChars, setMaxChars] = useState(42);

  // Captions service ko batana hai ki ASLI audio kahan hai. Abhi ke liye yeh
  // timeline se nikala hua 16kHz buffer hai jo extract karte waqt server pe
  // upload kiya jayega. Upload ke liye ek revokable URL, taaki cleanup na bhoolen.
  const audioUrlRef = useRef<string | null>(null);

  // Cleanup: blob URL revoke karna mat bhoolna, warna memory leak.
  useEffect(
    () => () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setMessage('');
    setCues([]);
  }, []);

  const generate = useCallback(async () => {
    reset();
    // Audio-bearing clips: audio ya video (video ka audio bhi chahiye).
    const sources = tracks
      .flatMap((t) => t.clips)
      .filter((c) => (c.type === 'audio' || c.type === 'video') && c.url)
      .map((c) => ({
        url: c.url as string,
        startTime: c.startTime,
        duration: c.duration,
        sourceIn: c.sourceIn,
        speed: c.speed,
        volume: c.volume,
        muted: c.muted,
      }));

    if (sources.length === 0) {
      setStatus('error');
      setMessage('No audio-bearing clips on the timeline. Import a video or record something first.');
      return;
    }

    // ---- Step 1: AUDIO - 100% asli, 100% local, koi model nahi ----
    setStatus('audio');
    setMessage('Extracting timeline audio.');
    try {
      const audio = await extractTimelineAudio(sources, duration, {
        onProgress: (done, total) =>
          setMessage(`Extracting timeline audio - clip ${done} of ${total}.`),
      });

      const peak = peakOf(audio.samples);
      if (audio.mixedClipCount === 0 || peak < 1e-4) {
        setStatus('error');
        setMessage(
          audio.failedClipCount > 0
            ? `Could not read ${audio.failedClipCount} clip(s). Re-import the media and try again.`
            : 'The timeline has no audible audio (all clips are muted, silent, or at 0% volume).'
        );
        return;
      }

      // WAV banate hain kyunki server-side engines wahi expect karte hain -
      // WebM/Opus ko decode karne ke liye unke paas ffmpeg hona chahiye.
      const wav = new Blob([encodeWav(audio.samples, WHISPER_SAMPLE_RATE)], { type: 'audio/wav' });
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(wav);

      if (audio.truncated) {
        setMessage(
          `Audio is longer than the 20-minute limit - only the first 20 minutes will be captioned.`
        );
      }

      // ---- Step 2: CAPTIONS - AURA-gated server call ----
      setStatus('captions');
      setMessage(
        language === 'auto'
          ? 'Detecting language and transcribing. (AURA cloud)'
          : `Transcribing in ${LANGUAGES.find((l) => l.code === language)?.label ?? language}. (AURA cloud)`
      );

      const form = new FormData();
      form.append('audio', wav, 'timeline.wav');
      form.append('language', language);

      const res = await fetch('/api/subtitles/generate', { method: 'POST', body: form });

      // Proxy ka contract:
      //   200 -> segments (ya 200 + khaali segments = koi speech nahi)
      //   401 -> session nahi
      //   402 -> AURA plan nahi
      //   413 -> audio bahut bada
      //   502 -> transcription fail hui (retry kar sakte hain)
      //   503 -> subtitle service / whisper reachable nahi
      //   504 -> timeout
      if (res.status === 401 || res.status === 402) {
        setStatus('error');
        setMessage('AURA subscription required for auto-subtitles.');
        return;
      }

      const detail = await res.text().catch(() => '');

      if (!res.ok) {
        setStatus('error');
        if (res.status === 413) {
          setMessage(detail || 'The timeline audio is too long to caption in one pass.');
        } else if (res.status === 503) {
          setMessage(
            detail ||
              'Captions service is not configured yet - no speech-to-text server is reachable.'
          );
        } else if (res.status === 504) {
          setMessage(detail || 'Transcription timed out. Try a shorter section of the timeline.');
        } else {
          setMessage(detail ? `Captions failed: ${detail}` : `Captions failed (${res.status}).`);
        }
        return;
      }

      const payload = (await res.json().catch(() => null)) as {
        segments?: Array<{ start: number; end: number; text: string }>;
      } | null;

      if (!payload?.segments?.length) {
        setStatus('error');
        setMessage('No speech was found in the timeline audio.');
        return;
      }

      // ---- Step 3: CUES - normalise + insert ----
      setStatus('cues');
      setMessage('Timing cues.');
      const generated = normaliseCues(payload.segments, { minDuration: minCue, maxDuration: maxCue, maxChars });
      setCues(generated);
      setStatus('done');
      setMessage(
        `${generated.length} cues, ${totalCueSeconds(generated).toFixed(1)}s of speech - ready to insert.`
      );
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }, [duration, language, maxCue, maxChars, minCue, reset, tracks]);

  const running = status === 'audio' || status === 'captions' || status === 'cues';

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (!isAura) {
    return (
      <PanelSection
        title="Auto subtitles"
        hint="Turn speech into captions, timed to the frame."
      >
        <EmptyState
          title="AURA subscription required"
          body="Automatic subtitles are part of the AURA plan. Upgrade to AURA and this panel unlocks."
        />
      </PanelSection>
    );
  }

  return (
    <PanelSection
      title="Auto subtitles"
      hint="Transcribes the timeline audio and drops the words on a text track, timed to the frame. Runs on the AURA cloud - the audio extraction is local."
      action={<Captions className="h-2.5 w-2.5 text-[#ff6500]" aria-hidden="true" />}
    >
      <div className="space-y-2.5">
        <Field label="Language" hint={language === 'auto' ? 'Detected from the audio' : 'Fixed - faster and more accurate'}>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Caption language"
            className="h-7 w-full rounded-md border-0 bg-surface-raised px-2 text-[10px] text-fg outline-none transition-colors duration-150 hover:text-[#ff6500] focus:text-[#ff6500]"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Minimum cue" hint={`${minCue.toFixed(2)}s - shorter gets merged`}>
          <Slider min={0.3} max={1.5} step={0.05} value={minCue} ariaLabel="Minimum cue duration" onChange={setMinCue} />
        </Field>
        <Field label="Maximum cue" hint={`${maxCue.toFixed(1)}s - longer splits on a word boundary`}>
          <Slider min={2} max={8} step={0.5} value={maxCue} ariaLabel="Maximum cue duration" onChange={setMaxCue} />
        </Field>
        <Field label="Line width" hint={`${maxChars} characters per line`}>
          <Slider min={24} max={60} step={1} value={maxChars} ariaLabel="Characters per line" onChange={setMaxChars} />
        </Field>

        <div className="flex gap-1.5">
          <Button onClick={() => void generate()} disabled={running}>
            {running ? (
              <Loader2 className="h-2 w-2 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-2 w-2" aria-hidden="true" />
            )}
            {running ? 'Working.' : 'Generate subtitles'}
          </Button>
          {cues.length > 0 && (
            <Button variant="outline" onClick={() => onInsertCues(cues)}>
              <Captions className="h-2 w-2" aria-hidden="true" />
              Insert {cues.length} cues
            </Button>
          )}
        </div>

        {message && (
          <p
            className={`flex items-start gap-1.5 rounded-edge p-2 text-[8px] leading-snug ${
              status === 'error'
                ? 'bg-rose-500/10 text-rose-200'
                : status === 'done'
                  ? 'bg-emerald-500/10 text-emerald-200'
                  : 'bg-surface-raised/70 text-fg'
            }`}
          >
            {status === 'error' ? (
              <AlertTriangle className="mt-0.5 h-2 w-2 shrink-0" aria-hidden="true" />
            ) : status === 'done' ? (
              <Check className="mt-0.5 h-2 w-2 shrink-0" aria-hidden="true" />
            ) : (
              <AudioWaveform className="mt-0.5 h-2 w-2 shrink-0" aria-hidden="true" />
            )}
            {message}
          </p>
        )}

        {cues.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-edge bg-surface-raised/50 p-2">
            <ol className="space-y-0.5">
              {cues.slice(0, 40).map((c) => (
                <li key={c.id} className="flex gap-2 font-mono text-[8px] tabular-nums text-fg-muted">
                  <span className="shrink-0 text-[#ff6500]/80">
                    {c.start.toFixed(2)}-{c.end.toFixed(2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">{c.text}</span>
                </li>
              ))}
              {cues.length > 40 && (
                <li className="pt-0.5 text-[8px] text-fg-muted">+{cues.length - 40} more.</li>
              )}
            </ol>
          </div>
        )}

        <p className="text-[8px] leading-snug text-fg-muted">
          {tracks.length === 0
            ? 'Import media first.'
            : 'Cues become text clips on a subtitles track. They can be edited like any other clip afterwards.'}
        </p>

        <p className="flex items-start gap-1.5 text-[8px] leading-snug text-fg-muted">
          <Languages className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          Timing is normalised locally: cues shorter than the minimum are merged, and anything longer than
          the maximum is split on a word boundary, so no caption flickers or runs off screen.
        </p>
      </div>
    </PanelSection>
  );
}

/**
 * 16-bit PCM WAV from f32 samples. WAV kyunki:
 *   - zero dependencies,
 *   - har server-side engine isse decode kar sakta hai bina ffmpeg ke,
 *   - browser khud bhi baja sakta hai (preview ke liye).
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export default AuraSubtitlesPanel;

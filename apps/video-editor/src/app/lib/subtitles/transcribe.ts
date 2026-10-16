// ============================================================================
// TRANSCRIBERS - speech -> timed {start,end,text} segments
// ============================================================================
//
// Hinglish: subtitles banane ka pehla hissa speech nikalna hai - blob mein
// baat pade to uska start/end/text mil jaye. Ye module ek hi `Transcriber`
// interface pe do "personalities" provide karta hai:
//
//   1. ServerTranscriber    -> /api/subtitles/generate proxy pe POST karta hai.
//      Ye hi hai jo aura-subtitles-panel.tsx ab tak seedha kar raha hai - buffer
//      WAV banana, form bana kar bhejna, error cases handle karna. Isse baahar
//      nikal kar panel ko bas `transcriber.transcribe(blob, lang)` call karna
//      padta hai - WAF (wrong amount of fetch) sab yahi.
//
//   2. WebSpeechTranscriber -> browser ka native SpeechRecognition. Koi upload
//      nahi, koi key nahi, offline-friendly. Lekin ek BADI technical reality:
//
//      Web Speech API MICROPHONE sunta hai, FILE nahi. File sey transcription
//      ke liye asli tarika hai file ko ek hidden Audio() element mein baajna
//      jabtak recognition chal raha ho, taaki mic use sun sake. Iska matlab:
//        * audio volume > 0 hona chahiye (headphones best hote hain - no
//          speaker->mic loopback),
//        * timestamps APPROXIMATE hain (recognition result aane me 0.5-2s ka
//          lag hota hai, to jab result aata hai to playback currentTime thoda
//          aage badh chuka hota hai),
//        * koi guarantee nahi microphone available/mute nahi hai.
//
//      Isliye ye BEST-EFFORT hai - normaliseCues() (cues.ts) timecodes ko
//      monotonic/bounded banata hai, isliye chhote timing errors downstream
//      adjust ho jaate hain.
//
// ---- TRANSCRIPTIONSEGMENT ----
//
// `TranscriptionSegment` yahan define nahi kiya gaya - cues.ts mein hai
// (normaliseCues usko seedha accept karta hai), isliye WAHI se re-export.
// Shape: { start: number; end: number; text: string } - ek jagah pe type =
// ek jagah pe edit karna padta.

import { type TranscriptionSegment } from './cues';

/**
 * `TranscriptionSegment` is owned by `./cues.ts` - re-exported so the
 * transcriber's public surface is self-contained. Shape exactly what
 * `normaliseCues` accepts (see cues.ts): `{ start; end; text }`.
 */
export type { TranscriptionSegment };

// ---------------------------------------------------------------------------
// Transcriber interface
// ---------------------------------------------------------------------------

/**
 * Ek transcriber: audio blob in, timed segments out.
 *
 * Dono backends isi interface pe aate hain (cloud Whisper vs local Web Speech),
 * isliye caller `getTranscriber` se ek chun leta hai bina apne call-site logic
 * badhe. `cues.ts` ke `normaliseCues()` usi `TranscriptionSegment[]` ko seedha
 * consume karta hai.
 */
export interface Transcriber {
  /**
   * Transcribe the audio blob into timed `{ start, end, text }` segments.
   *
   * @param blob     Audio blob. Server path 16kHz mono WAV expect karta hai
   *                 (dekho timeline-audio.ts `WHISPER_SAMPLE_RATE` - timeline
   *                 audio ussi rate par mix hoti hai); browser path apna format
   *                 samajh leta hai.
   * @param language BCP-47 tag ('en-US', 'hi-IN') ya 'auto'. Undefined = engine
   *                 default. Web Speech 'auto' nahi maanta, isliye skip karo.
   * @param onProgress 0..100. Server path pe yeh ASAL stream progress nahi hai
   *                 (Whisper proxy ek baar mein laata hai), bas "kaam chal
   *                 raha hai" dikhata hai. Web Speech pe yeh actual playback
   *                 progress (currentTime/duration) ka 0..100 hai.
   */
  transcribe(
    blob: Blob,
    language?: string,
    onProgress?: (pct: number) => void
  ): Promise<TranscriptionSegment[]>;

  /**
   * Kya yeh transcriber is environment mein chal sakta hai?
   * - ServerTranscriber: hamesha (bas network chahiye).
   * - WebSpeechTranscriber: sirf jab browser SpeechRecognition expose kare.
   */
  readonly available: boolean;

  /** UI label - jaise "Whisper (cloud)" ya "Web Speech (browser)".
   *  User ko pata chal jaye ki free wala ya paid chal raha hai. */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// ServerTranscriber - cloud Whisper via /api/subtitles/generate
// ---------------------------------------------------------------------------

/**
 * Proxy response contract (dekho aura-subtitles-panel.tsx + route.ts):
 *   200 -> { segments: [{start,end,text}] }     (empty = koi speech nahi)
 *   401 -> session cookie nahi / expire
 *   402 -> AURA plan nahi
 *   413 -> audio 100MB cap se badi
 *   502 -> transcription fail hui (retry-able)
 *   503 -> subtitle-service / whisper reachable nahi
 *   504 -> timeout
 *
 * Error messages YAHIN centrally rakhi gayi hain taaki caller (panel) ko bas
 * catch karna pade - wahi messaging jo panel pehle bhi dikhata tha.
 */
const SERVER_ERROR_MESSAGES: Record<number, (detail: string) => string> = {
  // 401 bhi 402 jaise hi treat karo - panel dono ko ek hi message deta tha.
  401: () => 'AURA subscription required for auto-subtitles.',
  402: () => 'AURA subscription required for auto-subtitles.',
  413: (d) => d || 'The timeline audio is too long to caption in one pass.',
  502: (d) => d || 'Captions failed (transcription service error).',
  503: (d) => d || 'Captions service is not configured yet - no speech-to-text server is reachable.',
  504: (d) => d || 'Transcription timed out. Try a shorter section of the timeline.',
};

/** Cloud Whisper backend - server-side, AURA-gated, needs only a network path. */
export class ServerTranscriber implements Transcriber {
  /** ServerTranscriber ko sirf network chahiye - proxy khud auth/plan gate
   *  karega. Server par bhi `true` return karo kyunki request toh proxy tak
   *  pahunchega hi (response phir 401/402 dega agar gate fail ho). */
  get available(): boolean {
    return true;
  }

  get label(): string {
    return 'Whisper (cloud)';
  }

  async transcribe(
    blob: Blob,
    language?: string,
    onProgress?: (pct: number) => void
  ): Promise<TranscriptionSegment[]> {
    // FormData field NAMES zaroori hain (route.ts: `audio` + `language`).
    // `audio` ek File/Blob hona chahiye; agar blob ek File hai to uska naam le
    // warna default 'timeline.wav'.
    const form = new FormData();
    const name = blob instanceof File && blob.name ? blob.name : 'timeline.wav';
    form.append('audio', blob, name);
    // 'auto'/empty/whitespace -> server ko 'auto' bhejna hai (whisper khud detect
    // karega). Short code 'en' jaise rakh do - server usse samajh jata hai.
    const lang = language && language.trim() ? language.trim() : 'auto';
    form.append('language', lang);

    onProgress?.(5);

    let res: Response;
    try {
      // 10 min - server proxy bhi 10 min ke timeout pe chalta hai (route.ts).
      // AbortSignal.timeout modern browsers mein hai; isliye client bhi 10 min
      // tak intezaar karega bina hang kiye.
      res = await fetch('/api/subtitles/generate', {
        method: 'POST',
        body: form,
        cache: 'no-store',
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch (e) {
      // Network failure / CORS / abort -> panel ka `Captions failed` pattern.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Captions failed: ${msg}`);
    }

    onProgress?.(85);

    // Body as text pehle - 4xx/5xx ke saath bhi body pasand aayegi (proxy
    // usse as-is forward karta hai, route.ts POST dekho).
    const detail = await res.text().catch(() => '');

    if (!res.ok) {
      const handler = SERVER_ERROR_MESSAGES[res.status];
      // Known status -> panel ke saath match karo. Unknown -> generic fallback.
      if (handler) throw new Error(handler(detail));
      throw new Error(detail ? `Captions failed: ${detail}` : `Captions failed (${res.status}).`);
    }

    onProgress?.(95);

    // 200 -> parse segments. Body JSON hone chahiye, lekin guard karo - proxy
    // content-type header se nahi pakka hota ki yeh JSON hai.
    let payload: { segments?: unknown } | null = null;
    try {
      payload = JSON.parse(detail) as { segments?: unknown };
    } catch {
      throw new Error('Captions failed: server returned an unreadable response.');
    }

    const segments = payload?.segments;
    if (!Array.isArray(segments)) {
      // segments missing/not-array -> unknown backend state.
      throw new Error(detail || 'No speech was found in the timeline audio.');
    }

    // 200 + empty segments = koi speech nahi. Panel bhi isse error bol raha tha,
    // isliye throw karo - empty array se caller ko pata nahi chalta ki baat
    // toh hai hi nahi.
    if (segments.length === 0) {
      throw new Error(detail || 'No speech was found in the timeline audio.');
    }

    onProgress?.(100);
    // Har segment already {start,end,text} - normaliseCues seedha accept karta.
    return segments as TranscriptionSegment[];
  }
}

// ---------------------------------------------------------------------------
// WebSpeechTranscriber - browser native SpeechRecognition
// ---------------------------------------------------------------------------

/**
 * Web Speech API ke CONTROLLER types.
 *
 * TypeScript lib.dom mein SpeechRecognition *result* types hain
 * (SpeechRecognitionResult, SpeechRecognitionAlternative, SpeechRecognitionResultList)
 * lekin CONTROLLER interface (continuous, onresult, start()) NAHI, aur
 * `webkitSpeechRecognition` (vendor prefix) bilkul bhi nahi. Isliye yeh chhota
 * sa interface define kiya - bas wohi members jo hum use karte hain - aur
 * constructor ko `window` se cast karke nikalte hain (silence.ts ke
 * `webkitAudioContext` waala pattern hi hai).
 */
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionController extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: SpeechRecognitionController, ev: SpeechRecognitionEvent) => unknown) | null;
  onerror: ((this: SpeechRecognitionController, ev: SpeechRecognitionErrorEvent) => unknown) | null;
  onend: ((this: SpeechRecognitionController, ev: Event) => unknown) | null;
  onstart: ((this: SpeechRecognitionController, ev: Event) => unknown) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionController;

/**
 * Safely pluck the SpeechRecognition constructor off `window`.
 * SSR guard (`typeof window === 'undefined'`) zaroori hai - nahi toh `in`/`??`
 * undefined window par crash karenge. `available` false dega agar API missing ho.
 */
function getSpeechCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Web Speech API pe chalne wala transcriber - browser native, offline capable. BEST-EFFORT. */
export class WebSpeechTranscriber implements Transcriber {
  /**
   * SSR-SAFE equivalent of:
   *   `typeof window !== 'undefined' && 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window`
   *
   * Unparenthesised original mein `&&` `||` se tighte precedence ke karan SSR
   * par (`typeof window === 'undefined'`) `||` ka right operand
   * `'webkitSpeechRecognition' in window` evaluate hota hai jab `window`
   * undefined hota hai - toh `in` operator TypeError deta hai. Isliye pehle
   * window existence check, baaki expression seedha (`B || C`). Browser mein
   * dono same result dete hain.
   */
  get available(): boolean {
    if (typeof window === 'undefined') return false;
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  get label(): string {
    return 'Web Speech (browser)';
  }

  async transcribe(
    blob: Blob,
    language?: string,
    onProgress?: (pct: number) => void
  ): Promise<TranscriptionSegment[]> {
    if (!this.available) {
      throw new Error('Web Speech API is not available in this browser.');
    }

    const Ctor = getSpeechCtor();
    if (!Ctor) {
      // `available` ne true diya tha lekin abhi undefined - rare vendor-prefix
      // race. Bina crash ke handle karo.
      throw new Error('Web Speech recognition is supported but could not be constructed.');
    }

    // Web Speech microphone se sunta hai, FILE nahi. Isliye blob ko playback
    // karne wala ek Audio element chahiye, jismein mic audio sun sake. Headphones
    // best hote hain (speaker->mic loopback avoid hoti hai). Timestamps
    // playback ke `audio.currentTime` se nikalete hain - Web Speech events
    // khud koi audio clock nahi dete.
    return new Promise<TranscriptionSegment[]>((resolve, reject) => {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = false;
      // 'auto'/'en' jaisa short code Web Speech ko theek se nahi pata; sirf jab
      // clear BCP-47 ho to set karo.
      if (language && language !== 'auto') rec.lang = language;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = 0.6; // lowish; headphones sunaiye best quality deti hain

      const segments: TranscriptionSegment[] = [];
      let lastEnd = 0; // previous segment end -> agla segment ka `start`
      let processedUpTo = 0; // continuous mode mein results accumulate hote hain;
      // sirf naye (resultIndex/processedUpTo se aage) process karo taaki double
      // na ho.
      let settled = false; // ek baar resolve/reject, kabhi double-nahi
      let timeout: ReturnType<typeof setTimeout> | null = null;

      // Common teardown: recognition abort + audio pause + object URL revoke.
      // Dono resolve/reject paths yehi use karte hain.
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        try {
          audio.pause();
        } catch {
          /* already torn down */
        }
        audio.src = '';
        URL.revokeObjectURL(url);
      };

      const rejectOnce = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const resolveOnce = (result: TranscriptionSegment[]) => {
        if (settled) return;
        settled = true;
        cleanup();
        onProgress?.(100);
        resolve(result);
      };

      // Playback se progress (0..100) - Web Speech ka real "progress clock"
      // yahi playback hai, kyunki recognition result real-time badh raha hai.
      const reportProgress = () => {
        const dur = audio.duration || 0;
        const pct = dur > 0 ? (audio.currentTime / dur) * 100 : 0;
        onProgress?.(Math.max(0, Math.min(100, Math.round(pct))));
      };

      // onresult: final results collect + timestamp by playback position.
      rec.onresult = (ev: SpeechRecognitionEvent) => {
        const results = ev.results;
        // continuous mode mein ev.results accumulate karte hain; sirf naye
        // (resultIndex se aage / processedUpTo se aage) process karo.
        const startAt = Math.max(processedUpTo, ev.resultIndex);
        for (let i = startAt; i < results.length; i++) {
          processedUpTo = i + 1;
          const result = results[i];
          if (!result.isFinal) continue; // interimResults=false so sab final hona chahiye
          const alt = result[0];
          const text = alt?.transcript?.trim();
          if (!text) continue;

          // Timestamp: playback result aane se agle badh chuka hota hai, isliye
          // `audio.currentTime` se END nikaala - APPROXIMATE. START = previous
          // end (monotonic; normaliseCues bhi theek rakhega).
          const end = Math.max(audio.currentTime, lastEnd + 0.001);
          const start = lastEnd;
          segments.push({ start, end, text });
          lastEnd = end;
        }
        reportProgress();
      };

      // onerror: graceful reject with browser ka diya error string.
      rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
        const err = ev.error || 'unknown';
        rejectOnce(
          new Error(`Web Speech recognition failed: ${err}${ev.message ? ` - ${ev.message}` : ''}`)
        );
      };

      // onend: recognition band - jitne segments mil gaye wahi. Agar audio abhi
      // bhi chal raha ho toh (best-effort) tab bhi settle karo.
      rec.onend = () => {
        resolveOnce(segments);
      };

      // Playback khatam -> recognition band karo. onend resolve karega.
      audio.onended = () => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      };

      audio.onerror = () => {
        rejectOnce(new Error('Audio playback failed while feeding Web Speech recognition.'));
      };

      // Timeout setter - duration ke hisaab se, nahi toh fixed 5 min cap.
      const armTimeout = () => {
        const ms =
          audio.duration && Number.isFinite(audio.duration)
            ? audio.duration * 1000 + 20_000
            : 5 * 60 * 1000;
        timeout = setTimeout(() => {
          rejectOnce(new Error('Web Speech recognition timed out before the audio finished.'));
        }, ms);
      };

      // Kick: play() user gesture ke andar call hota hai (transcribe caller
      // button click se aayega), isliye autoplay policies se bacha. Metadata
      // load hone se pehle play() call karenge - browser auto-seek karega.
      void audio
        .play()
        .then(() => {
          if (settled) return;
          armTimeout();
          reportProgress();
          try {
            rec.start();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            rejectOnce(new Error(`Could not start recognition: ${msg}`));
          }
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          rejectOnce(new Error(`Could not play audio for recognition: ${msg}`));
        });
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `getTranscriber` - ek transcriber lao.
 *
 * Hinglish: caller dhyan mein rakhe - 'whisper' wala `available` hamesha true
 * dikhata hai, lekin asli mein /api/subtitles/generate pe bharosa karta hai -
 * agar auth nahi ya AURA plan nahi toh 401/402 aayega. 'web-speech' browser
 * native hai, offline capable, lekin microphone-only constraint ke kaaran
 * BEST-EFFORT hai.
 */
export function getTranscriber(preferred: 'whisper' | 'web-speech'): Transcriber {
  return preferred === 'whisper' ? new ServerTranscriber() : new WebSpeechTranscriber();
}
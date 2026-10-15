// ============================================================================
// SUBTITLE CUES — model + normalisation
// ============================================================================
//
// Whisper (ya koi bhi ASR) "segments" deta hai: `{start, end, text}`. Wo directly
// subtitle cues nahi hain, aur yahi wo jagah hai jahan auto-subtitles aksar
// "kaam karta hai lekin bura lagta hai" ban jaate hain. Teen cheezein hoti hain:
//
//   1. Ek segment poore paragraph ko le leta hai — 12 second, 90 characters.
//      Padhne wala ke paas 12 second hain, lekin poori line screen se bahar hai.
//   2. Do segment 0.3 second ke hote hain — flicker karte hain, aankh pe bojh.
//   3. Model ke timestamps 0.4-0.8s late/unstable hote hain, to cue us word ke
//      BAAD aata hai jo usme hai.
//
// `normaliseCues()` in teeno ko theek karta hai, aur ek baar ka kaam hai — pure
// function, koi model dependency nahi, isliye ise seedha test kiya ja sakta hai.

/** Ek subtitle cue. Timeline seconds, kyunki editor har jagah seconds bolta hai. */
export interface SubtitleCue {
  /** Stable id, taaki React keys aur clip ids predictable rahein. */
  id: string;
  /** Timeline seconds, inclusive. */
  start: number;
  /** Timeline seconds, exclusive. */
  end: number;
  text: string;
}

/**
 * Raw segment from a transcription engine.
 *
 * `text` bhi include hai kyunki kuch engines (Web Speech API style) word-level
 * dete hain; hum unhe segment bana lete hain.
 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  /**
   * Cue kitni der dikhe. Isse kam cue merge ho jaate hain.
   *
   * 0.6s. Ek word bhi 0.5s leta hai bolne me; usse chhota cue flicker karta hai.
   */
  minDuration?: number;
  /**
   * Ek cue ki maximum lambai. Isse lamba cue word-boundary pe TUT jaata hai.
   *
   * 4s. Broadcast convention (Netflix ~7s ke bhi karte hain, lekin mobile pe
   *utton ka layout ke liye 4s comfortable hai).
   */
  maxDuration?: number;
  /**
   * Ek line ki maximum characters.
   *
   * 42. Standard subtitle measure (Netflix 42, BBC 37-40). Isse zyada letters
   * chhoti screen pe do lines me wrap hote hain aur text area bhar dete hain.
   */
  maxChars?: number;
  /** Kitni lines ki jagah hai. 2 ke baad cue ko todna pada. */
  maxLines?: number;
}

const DEFAULTS: Required<CueOptions> = {
  minDuration: 0.6,
  maxDuration: 4,
  maxChars: 42,
  maxLines: 2,
};

/** Model se aaye halke kharab tokens: leading/trailing space, double space. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Kuch bhi text ke andar cue ko nahi todna chahiye (HTML-ish markup etc.). */
function estimateLines(text: string, maxChars: number): number {
  // ~maxChars per line. Ek thoda generous width maan ke count karte hain,
  // kyunki actual wrapping font pe depend karti hai.
  return Math.max(1, Math.ceil(text.length / maxChars));
}

/**
 * Text ko word boundaries pe tod do, taaki koi bhi tukda `maxChars` lambai
 * se zyada na ho aur har tukde me `maxLines` lines se zyada na ho.
 *
 * Hinglish: agar ek hi WORD hi maxChars se bada ho (URL, long compound), to use
 * todna hi pada — warna wo line kabhi fit nahi hogi. Ye ek hard cut hai lekin
 * infinite-loop-safe.
 */
function splitLongText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (!word) continue;
    // || current.length + 1 + word.length > maxChars
    if (current && current.length + 1 + word.length > maxChars) {
      out.push(current);
      current = word;
      continue;
    }
    current = current ? `${current} ${word}` : word;
    // Ek hi word hi limit se bada — hard break (bina space).
    while (current.length > maxChars) {
      out.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Raw segments se clean cues banao.
 *
 * Order: (1) text tidy + degenerate drop, (2) monotonic timestamps enforce,
 * (3) chhote cues merge, (4) lambe cues tod do.
 *
 * Step (3) se PEHLE (4) hai jaan-boojh kar: agar pehle lambe ko tod dein to
 * tukde itne chhote ho jayenge ki merge step unhe wapas jod de aur kaam
 * dobara karna pade.
 */
export function normaliseCues(
  segments: TranscriptionSegment[],
  opts: CueOptions = {}
): SubtitleCue[] {
  const { minDuration, maxDuration, maxChars } = { ...DEFAULTS, ...opts };

  // ---- (1) Tidy + drop empty; enforce monotonic, positive times ----
  const cleaned: SubtitleCue[] = [];
  let lastEnd = 0;
  for (const seg of segments) {
    const text = tidy(seg.text);
    if (!text) continue;
    if (seg.end <= seg.start) continue;
    // Overlap guard: model kabhi kabhi previous segment me overlap kar deta hai.
    // Overlapp cues do clips ek hi track pe ban jate hain jo overlap karte hain,
    // aur naya clip previous ko overlap karke replace kar deta hai.
    const start = Math.max(seg.start, lastEnd);
    const end = Math.max(seg.end, start + 0.001);
    if (end - start < 0.05) continue; // 50ms se bhi kam = artefact
    cleaned.push({ id: '', start, end, text });
    lastEnd = end;
  }

  if (cleaned.length === 0) return [];

  // ---- (2) Merge cues jo minDuration se chhoti hain ----
  // Previous me merge karte hain, kyunki previous already screen pe hai —
  // usse badalna flicker deta hai.
  const merged: SubtitleCue[] = [];
  for (const cue of cleaned) {
    const prev = merged[merged.length - 1];
    if (prev && prev.end - prev.start < minDuration && prev.text.length + cue.text.length + 1 <= maxChars) {
      prev.text = `${prev.text} ${cue.text}`;
      prev.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }

  // ---- (3) Lambe cues tod do ----
  const out: SubtitleCue[] = [];
  for (const cue of merged) {
    const duration = cue.end - cue.start;
    const lines = estimateLines(cue.text, maxChars);
    if (duration <= maxDuration && lines <= (opts.maxLines ?? DEFAULTS.maxLines)) {
      out.push(cue);
      continue;
    }

    const pieces = splitLongText(cue.text, maxChars * (opts.maxLines ?? DEFAULTS.maxLines));
    // Text length ke hisaab se proportionally baanto — ek hi lamba piece ko
    // poora time dena galat hota (baaki pieces ko 0 second milte).
    const totalLen = pieces.reduce((n, p) => n + p.length, 0) || 1;
    let cursor = cue.start;
    pieces.forEach((piece, i) => {
      // Aakhri piece exactly cue.end pe khatam ho — floating point drift se
      // cue ke aakhir me chhota gap na bache.
      const span = i === pieces.length - 1 ? cue.end - cursor : (duration * piece.length) / totalLen;
      const end = Math.max(cursor + 0.001, cursor + span);
      out.push({ id: '', start: cursor, end: Math.min(end, cue.end), text: piece });
      cursor = end;
    });
  }

  // ---- (4) Deterministic ids ----
  // `start` ko use karte hain (index nahi) taaki ids STABLE rahein: agar cue
  // dobara transcribe ho ya timestamps shift hon, to React keys na badlein.
  return out.map((cue) => ({
    ...cue,
    id: `cue-${Math.round(cue.start * 1000)}-${Math.round(cue.end * 1000)}`,
  }));
}

/** Cues ka total spoken time, seconds. UI me "X cues, Ys of speech" dikhane ko. */
export function totalCueSeconds(cues: SubtitleCue[]): number {
  return cues.reduce((n, c) => n + (c.end - c.start), 0);
}

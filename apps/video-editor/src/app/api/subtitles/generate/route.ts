// ============================================================================
// SUBTITLES / GENERATE - editor -> subtitle-service proxy
// ============================================================================
//
// Hinglish: iska poora kaam ek file forward karna hai — browser se aaya WAV
// audio subtitle-service ko, aur uske segments wapas. Ye do wajah se:
//
//   1. CORS: agar editor seedha subtitle-service ko hit kare, to uska browser
//      preflight + CORS allow-list manage karna padega. Same-origin proxy se ye
//      problem khatam.
//   2. AUTH: proxy pe session cookie check kar sakte hain, aur AURA plan gate
//      laga sakte hain — matlab bina plan wale seedha audio bhej hi nahi sakte.
//      Ye gate SERVER pe hai, browser pe nahi, isliye inspect karke bypass nahi
//      ho sakta.
//
// ---- PLAN GATING (asli) ----
//
// AURA = `lifetime_aura` plan (billing me wahi tier jo `AURA=true` aur
// `FpsCeiling=240` rakhta hai). Proxy auth-service se entitlements maangta hai
// aur plan check karta hai. Ye `/api/session` route ka `readPlan` bilkul same
// pattern use karta hai.
//
// Gate NAHI hai sirf UI ka dikhawa — bina AURA plan ke request 402 leta hai.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  'http://localhost:8085';

/** subtitle-service ka internal address (docker network me service name). */
const SUBTITLE_INTERNAL_URL =
  process.env.SUBTITLE_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_SUBTITLE_API_URL ??
  'http://localhost:8090';

const SESSION_COOKIE = 'wideo11_session';

/** Plan code that unlocks AURA features. Must match billing's AURA tier. */
const AURA_PLAN_CODE = 'lifetime_aura';

export const dynamic = 'force-dynamic';

/** 100MB — subtitle-service ka cap. Isse zyada front-end hi pe reject. */
const MAX_AUDIO_BYTES = 100 << 20;

/** Proxy ka apna timeout. Whisper slow hai, isliye 10 min (service ke barabar). */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

interface Entitlements {
  plan: string;
}

/**
 * auth-service se plan padho. Fail hone par khaali plan — matlab GATE BAND
 * (fail closed). Ye jaan-boojh kar: agar auth-service down ho, to AURA feature
 * band hona chahiye, khulna nahi.
 */
async function readPlan(token: string): Promise<Entitlements> {
  try {
    const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/me/entitlements`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { plan: '' };
    const body = (await res.json().catch(() => null)) as { plan?: unknown } | null;
    return { plan: typeof body?.plan === 'string' ? body.plan : '' };
  } catch {
    return { plan: '' };
  }
}

/** Whisper reachable hai? UI "Generate" se PEHLE ye poochti hai. */
export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'not authenticated' }, { status: 401 });
  }
  const { plan } = await readPlan(token);
  if (plan !== AURA_PLAN_CODE) {
    return NextResponse.json({ ok: false, error: 'AURA subscription required' }, { status: 402 });
  }

  try {
    const res = await fetch(`${SUBTITLE_INTERNAL_URL}/subtitles/transcribe/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text().catch(() => '');
    return NextResponse.json(
      { ok: res.ok, error: res.ok ? undefined : body || `health returned ${res.status}` },
      { status: res.ok ? 200 : 503 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'subtitle service unreachable' },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  // ---- 1. Auth ----
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  // ---- 2. AURA plan gate (server side, bypass-proof) ----
  const { plan } = await readPlan(token);
  if (plan !== AURA_PLAN_CODE) {
    return NextResponse.json(
      { error: 'AURA subscription required for auto-subtitles.' },
      { status: 402 }
    );
  }

  // ---- 3. Body ----
  const form = await request.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "missing 'audio' file" }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'empty audio' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `audio too large (max ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB)` },
      { status: 413 }
    );
  }

  // Front-end se aaya language parameter. `auto` ko aage bhejte hain — service
  // khud detect karega.
  const rawLang = form.get('language');
  const language = typeof rawLang === 'string' && rawLang.trim() ? rawLang.trim() : 'auto';

  // ---- 4. Forward ----
  const upstream = new FormData();
  upstream.append('audio', audio, audio.name || 'timeline.wav');
  upstream.append('language', language);

  try {
    const res = await fetch(`${SUBTITLE_INTERNAL_URL}/subtitles/transcribe`, {
      method: 'POST',
      body: upstream,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    // Upstream ka status jaisa hai waisa aage (503 = whisper not configured,
    // 502 = transcription fail, 200 = segments). Body as-is pass karte hain
    // taaki service ka asli message UI tak pahunche.
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return NextResponse.json(
      {
        error: timedOut
          ? 'Transcription timed out. The audio may be too long.'
          : e instanceof Error
            ? e.message
            : 'subtitle service unreachable',
      },
      { status: 504 }
    );
  }
}

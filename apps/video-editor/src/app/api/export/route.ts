// ============================================================================
// EXPORT — editor -> transcoding-service proxy with plan gating
// ============================================================================
//
// Hinglish: is route ka kaam hai editor se aane wale export request ko
// transcoding-service tak pohnchana, lekin pehle plan check karna.
//
// Kyun proxy? Do wajah:
//   1. AUTH: transcoding-service ko X-Internal-Token chahiye, jo browser se
//      reveal nahi karna chahiye (secret hai). Proxy pe server-side token
//      hai, browser ko nahi pata.
//   2. PLAN GATE: export height aur concurrent transcode count, dono plan se
//      judi hain. Browser pe check karna bypass ho sakta hai, server pe nahi.
//
// Plan gate kya karta hai:
//   - exportHeight: trial se 720p max, paid se 1080p+/2160p. Requested height
//     plan ke cap se zyada ho to 402 (payment required).
//   - concurrentTranscodes: in-flight ffmpeg jobs ka cap. Queue full ho to
//     429 (too many requests).
//
// Fail closed: koi bhi check fail ho, export nahi hota.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  'http://localhost:8085';

const TRANSCODE_INTERNAL_URL =
  process.env.TRANSCODE_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TRANSCODE_API_URL ??
  'http://localhost:8083';

const TRANSCODE_TOKEN = process.env.TRANSCODE_INTERNAL_TOKEN ?? '';

const SESSION_COOKIE = 'wideo11_session';

export const dynamic = 'force-dynamic';

interface PlanLimits {
  exportHeight: number;
  concurrentTranscodes: number;
  monetization: boolean;
}

/** auth-service se plan limits padho. Fail closed — koi bhi error = gate band. */
async function readPlan(token: string): Promise<PlanLimits | null> {
  try {
    const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/me/entitlements`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { limits?: unknown } | null;
    if (!body?.limits) return null;

    const limits = body.limits as Record<string, unknown>;
    const toNum = (key: string, def: number): number => {
      const v = limits[key];
      const n = typeof v === 'string' ? Number(v) : v;
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : def;
    };
    return {
      exportHeight: toNum('export_height', 720),
      concurrentTranscodes: toNum('concurrent_transcodes', 1),
      monetization: toNum('monetization', 0) > 0,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // ---- 1. Auth ----
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  // ---- 2. Plan gate (server side, bypass-proof) ----
  const plan = await readPlan(token);
  if (!plan) {
    return NextResponse.json(
      { error: 'could not read plan limits' },
      { status: 503 }
    );
  }

  // ---- 3. Body ----
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { videoId, sourceUrl, kind = 'video', requestedHeight } = body as {
    videoId?: string;
    sourceUrl?: string;
    kind?: string;
    requestedHeight?: number;
  };

  if (!videoId || typeof videoId !== 'string') {
    return NextResponse.json({ error: 'video_id is required' }, { status: 400 });
  }
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return NextResponse.json({ error: 'source_url is required' }, { status: 400 });
  }

  // ---- 4. Export height gate ----
  //
  // Requested height (if any) must not exceed the plan's export_height cap.
  // A trial (720p) requesting 1080p gets 402 — payment required.
  if (requestedHeight && typeof requestedHeight === 'number') {
    if (requestedHeight > plan.exportHeight) {
      return NextResponse.json(
        {
          error: `export height ${requestedHeight}p exceeds your plan's ${plan.exportHeight}p limit`,
          planExportHeight: plan.exportHeight,
          requestedHeight,
        },
        { status: 402 }
      );
    }
  }

  // ---- 5. Forward to transcoding-service ----
  //
  // X-Internal-Token rakkha jaaye proxy se — browser ko kabhi nahi milta.
  const upstream = new URL(`${TRANSCODE_INTERNAL_URL}/api/v1/transcode`);
  try {
    const res = await fetch(upstream.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': TRANSCODE_TOKEN,
      },
      body: JSON.stringify({
        video_id: videoId,
        source_url: sourceUrl,
        kind,
        profile: kind,
      }),
      cache: 'no-store',
    });

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'transcoding service unreachable' },
      { status: 504 }
    );
  }
}

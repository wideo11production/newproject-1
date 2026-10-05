// The alert-acknowledgement history.
//
// Superadmin-only relay to auth-service. Same reasoning as
// `api/alerts/acknowledge/route.ts`: the session credential is an httpOnly cookie,
// so the browser cannot call auth-service directly and this reads it server-side.
//
// The `limit` is passed through rather than clamped here — auth-service owns the
// bound (and rejects anything outside 1..500 with a default), so having a second
// clamp in two places is a second number to keep in step.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = cookies().get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: 'sign_in_required', message: 'Sign in to view acknowledgements.' },
      { status: 401 }
    );
  }

  const limit = new URL(request.url).searchParams.get('limit') ?? '200';

  try {
    const res = await fetch(
      `${AUTH_INTERNAL}/api/v1/auth/admin/security/alerts/acknowledgements?limit=${encodeURIComponent(limit)}`,
      {
        headers: { Authorization: `Bearer ${session}` },
        cache: 'no-store',
      }
    );

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // Normalise the list to `[]` rather than `null` even on an error shape.
    //
    // The UI does `body.acknowledgements ?? []` too, so this is belt and braces —
    // but a client that forgets the `??` throws on `null.length`, and the crash
    // surfaces as a broken dashboard rather than as an empty list.
    const list = Array.isArray(payload.acknowledgements) ? payload.acknowledgements : [];

    return NextResponse.json({ ...payload, acknowledgements: list }, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        error: 'upstream_unavailable',
        message: 'Cannot reach the authentication service.',
        acknowledgements: [],
      },
      { status: 503 }
    );
  }
}

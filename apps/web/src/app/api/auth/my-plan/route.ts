// The caller's own plan, allowance and expiry.
//
// Same-origin relay to auth-service's `/me/entitlements`.
//
// -----------------------------------------------------------------------------
// WHY THE TOKEN IS NOT IN THE BODY
// -----------------------------------------------------------------------------
//
// The caller's identity is the httpOnly `wideo11_session` cookie, read here on the
// server and turned into the bearer header. The browser cannot attach it by hand -
// that is what `httpOnly` is for - and it must not be read in JavaScript and sent
// explicitly, because then any script on the page could read it too.
//
// Which is also why there is no `user_id` anywhere in this route, in the request,
// or in the response contract: the upstream resolves the caller from the token, and
// this relay adds nothing that could aim the request at somebody else.
//
// -----------------------------------------------------------------------------
// NO CACHE
// -----------------------------------------------------------------------------
//
// The whole point of the response is a countdown, and a cached copy of a countdown
// is a countdown that lies. `no-store` on both the fetch and the response.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = cookies().get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: 'sign_in_required', has_plan: false, limits: {} },
      { status: 401 }
    );
  }

  try {
    const res = await fetch(`${AUTH_INTERNAL}/api/v1/auth/me/entitlements`, {
      headers: { Authorization: `Bearer ${session}` },
      cache: 'no-store',
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    return NextResponse.json(payload, {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Upstream unreachable. `has_plan: false` rather than a 5xx, so the dashboard
    // renders WITHOUT a plan banner instead of erroring — the banner is additive
    // and its absence is a truthful statement, whereas a thrown error takes the
    // whole page down for something the user cannot act on.
    return NextResponse.json(
      {
        error: 'upstream_unavailable',
        has_plan: false,
        limits: {},
        trial_expiring_soon: false,
        expires_in_seconds: -1,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

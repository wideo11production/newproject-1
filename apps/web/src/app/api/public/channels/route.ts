// /api/public/channels  -  public channel discovery (no session required)
//
// Forwards to the Go service's PUBLIC route prefix (`/api/v1/public/*`),
// which is intentionally outside the `/api/v1/auth` group and has no auth
// middleware. That separation exists because a static `/public` segment
// cannot be registered next to the `/channels/:id` wildcard in gin - it
// panics on route conflict.
//
// The upstream only returns channels that are `is_public AND is_active`, and
// a private channel returns the SAME 404 as a non-existent one, so this
// endpoint cannot be used to enumerate private handles.
//
// The session cookie is deliberately NOT forwarded here. If a visitor happens
// to be logged in, the public payload is still the same reduced one - no
// user_id, no is_active - so there is no way to get a richer response by
// being logged in.
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  // 8085, NOT 8080 - 8080 is the Bot service. This must match
  // `auth-proxy.ts`, otherwise the public channel list silently hits the
  // wrong service and returns an empty body.
  'http://localhost:8085';

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') ?? '20';
  try {
    const upstream = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/public/channels?limit=${encodeURIComponent(limit)}`,
      { cache: 'no-store' }
    );
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(payload, { status: upstream.status });
  } catch {
    return Response.json(
      {
        error: 'service_unavailable',
        message: 'Could not reach the channel service.',
      },
      { status: 503 }
    );
  }
}

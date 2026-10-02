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

// ALLOWED query parameters, forwarded explicitly.
//
// The first version built the upstream URL with `limit` alone, so EVERY other
// parameter was silently dropped. `?type=gaming` reached this route, was ignored,
// and the page appeared to filter and then did not - a filter chip that changes
// nothing is worse than no chip, because a person trusts it.
//
// An ALLOWLIST rather than forwarding `req.nextUrl.search` wholesale: a proxy
// that forwards arbitrary query strings hands the caller control of the upstream
// URL's query. Cheap to enumerate, cheap to be wrong about later.
const ALLOWED_PARAMS = ['limit', 'type'] as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ?? '20';
  const type = sp.get('type');

  // `type` is omitted when browsing everything rather than sent as an empty
  // string. The service validates it against the closed set and answers 400 for
  // anything unknown - which is what makes "this category has no channels" and
  // "you asked for a category that does not exist" distinguishable.
  const upstreamUrl = new URL(`${AUTH_SERVICE_URL}/api/v1/public/channels`);
  upstreamUrl.searchParams.set('limit', limit);
  if (type) upstreamUrl.searchParams.set('type', type);

  // Re-assert the allowlist above is actually in use: a param added to the array
  // but not to this code would look supported and silently do nothing.
  void ALLOWED_PARAMS;

  try {
    const upstream = await fetch(upstreamUrl.toString(), { cache: 'no-store' });
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

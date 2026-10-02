// /api/public/channels/[handle]/media  -  a channel's published videos and reels
//
// NEW, and the reason it had to be its own route rather than a field on the
// channel: the page has separate Videos and Shorts tabs, so it asks twice with
// `?kind=`. One request that returns everything would mean the Shorts tab
// downloads the full back catalogue to discard most of it.
//
// Same reduced-payload rules as the sibling route: only `ready` media, only the
// channel's own, and a private channel answers 404 exactly like a missing one.
//
// `kind` is passed through rather than interpreted here. The service validates it
// against the closed set and answers 400 for anything else, and that status is
// forwarded unchanged - a proxy that turned it into a 404 would make "you asked
// for a kind that does not exist" indistinguishable from "no such channel".
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  // 8085, NOT 8080 - 8080 is the Bot service. Must match `auth-proxy.ts`.
  'http://localhost:8085';

type Ctx = { params: { handle: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  const limit = sp.get('limit') ?? '24';
  const offset = sp.get('offset') ?? '0';

  const upstreamUrl = new URL(
    `${AUTH_SERVICE_URL}/api/v1/public/channels/${encodeURIComponent(params.handle)}/media`
  );
  upstreamUrl.searchParams.set('limit', limit);
  upstreamUrl.searchParams.set('offset', offset);
  if (kind) upstreamUrl.searchParams.set('kind', kind);

  try {
    const upstream = await fetch(upstreamUrl.toString(), { cache: 'no-store' });
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(payload, { status: upstream.status });
  } catch {
    return Response.json(
      { error: 'service_unavailable', message: 'Could not reach the channel service.' },
      { status: 503 }
    );
  }
}

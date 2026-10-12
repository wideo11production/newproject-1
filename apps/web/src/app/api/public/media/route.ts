// /api/public/media  -  public media discovery (no session required)
//
// Forwards to auth-service's public media endpoint. Returns only `ready` media
// that is public. Used for related videos on watch page.
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ?? '20';
  const kind = sp.get('kind');
  const offset = sp.get('offset') ?? '0';
  const exclude = sp.get('exclude');

  const upstreamUrl = new URL(`${AUTH_SERVICE_URL}/api/v1/public/media`);
  upstreamUrl.searchParams.set('limit', limit);
  upstreamUrl.searchParams.set('offset', offset);
  if (kind) upstreamUrl.searchParams.set('kind', kind);
  if (exclude) upstreamUrl.searchParams.set('exclude', exclude);

  try {
    const upstream = await fetch(upstreamUrl.toString(), { cache: 'no-store' });
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(payload, { status: upstream.status });
  } catch {
    return Response.json(
      { error: 'service_unavailable', message: 'Could not reach the media service.' },
      { status: 503 }
    );
  }
}
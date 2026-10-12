// /api/media/[id]/comments  -  the comment thread under a clip
//
// A pass-through. The gate, the link ban and the pagination all live in
// auth-service; this route exists so the session cookie never leaves this origin
// and so a client cannot reach the backend with someone else's token.
//
// Note which side LIST and CREATE sit on: the list is PUBLIC while creating needs
// a session. Same resource, different authority - and this file keeps that split
// rather than hiding it, because a route that is sometimes-public is a route whose
// authorisation nobody can reason about.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

type Ctx = { params: { id: string } };

/** Public read: no session required. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const limit = req.nextUrl.searchParams.get('limit') ?? '20';
  const offset = req.nextUrl.searchParams.get('offset') ?? '0';

  const upstream = new URL(
    `${AUTH_SERVICE_URL}/api/v1/public/media/${encodeURIComponent(params.id)}/comments`
  );
  upstream.searchParams.set('limit', limit);
  upstream.searchParams.set('offset', offset);

  try {
    const res = await fetch(upstream.toString(), { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    return Response.json(payload, { status: res.status });
  } catch {
    return Response.json(
      { error: 'service_unavailable', message: 'Could not reach the comment service.' },
      { status: 503 }
    );
  }
}

/** Authenticated write: a session is required, and `forwardAuth` enforces it. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}/comments`, 'POST');
}

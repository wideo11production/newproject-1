// /api/public/media/[id]/comments  -  the public comment list under a clip
//
// WHY THIS EXISTS SEPARATELY FROM `/api/media/[id]/comments`
//
// The list is PUBLIC and the write is not. Those are two different authorities on
// one resource, and a route that served both would have to decide per-request
// whether it is the public one or the authenticated one - which is exactly the
// shape that leads to the wrong check on one of the two paths.
//
// So: this route forwards WITHOUT a session, and its sibling under
// `/api/media/[id]/comments` forwards WITH one. The backend already splits them
// the same way (`/api/v1/public/media/:id/comments` for the list,
// `/api/v1/auth/media/:id/comments` for the write).
//
// This file was missing, which is why the list request returned an HTML 404 page
// instead of JSON: the URL simply did not exist on this side.
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

type Ctx = { params: { id: string } };

/** GET: the thread, read without a session. */
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

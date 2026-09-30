// /api/public/channels/[handle]  -  public channel page data (no session)
//
// Returns a reduced payload: id, handle, display_name, description, image_url,
// cover_url, timestamps. Deliberately NOT user_id / is_active / deleted_at -
// internal identifiers have no business in a public response.
//
// A private channel and a non-existent handle both return 404 upstream, so
// this route cannot be used to discover which handles exist.
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  // 8085, NOT 8080 - 8080 is the Bot service. Must match `auth-proxy.ts`.
  'http://localhost:8085';

type Ctx = { params: { handle: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const upstream = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/public/channels/${encodeURIComponent(params.handle)}`,
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

// /api/media/[id]/stream  -  owner playback proxy (session required)
//
// The owner-facing twin of `/api/public/media/[id]/stream`, and it exists for the
// same reason: the browser must stay same-origin for HLS's RELATIVE segment paths
// to resolve, so the bytes are proxied rather than redirected to a URL the browser
// cannot use.
//
// WHY A SEPARATE ROUTE FROM THE PUBLIC ONE
//
// The authority is different. This one forwards the caller's session, so
// auth-service answers the OWNER question - "is this your asset" - and an owner
// can watch their own draft that no one else may see. The public route asks
// "may a stranger see this", and answers no. One route trying to do both would
// have to decide which question it was answering, and that decision is exactly
// what must not be ambiguous.
//
// THE BINARY RULE
//
// Exactly one response type is treated as text: an HLS playlist, and only after
// its content type says so. Posters, segments and filmstrips are piped as
// `res.body` and never buffered into a string - the public twin learned that the
// hard way, when reading every response as text silently re-encoded every poster
// from FF D8 FF to EF BB BF and every thumbnail on the platform broke.
import { forwardAuthRaw } from '@/lib/auth-proxy';
import { rewriteHlsPlaylist, needsPlaylistRewrite } from '@/lib/hls-rewrite';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!path) {
    return Response.json(
      { error: 'missing_path', message: 'path is required.' },
      { status: 400 }
    );
  }

  const headers = new Headers();
  // Forwarded, not synthesised: the browser's own Range is what keeps a seek
  // cheap, and inventing one would make every request a full-object download.
  const range = req.headers.get('range');
  if (range) headers.set('range', range);

  // `forwardAuthRaw` carries the session and streams the body, so a 404 means
  // "not yours, or not there" - both of which are the same answer by design.
  const res = await forwardAuthRaw(
    req,
    `/media/${encodeURIComponent(params.id)}/stream?path=${encodeURIComponent(path)}`,
    'GET',
    headers
  );

  const contentType = res.headers.get('content-type') ?? '';

  if (!res.ok && res.status !== 206) {
    // A refusal is JSON, so reading it as text is safe.
    return res;
  }

  const streamPrefix = `/api/media/${encodeURIComponent(params.id)}/stream`;
  const baseHeaders = () => {
    const h = new Headers();
    if (contentType) h.set('content-type', contentType);
    // Private, per-owner content: never a shared cache. The gate is re-evaluated
    // on every request, so a cached response would outlive its authorisation.
    h.set('cache-control', 'private, no-store');
    h.set('accept-ranges', 'bytes');
    for (const name of ['content-range', 'content-length', 'etag']) {
      const v = res.headers.get(name);
      if (v) h.set(name, v);
    }
    return h;
  };

  // ---- the ONE text case: an HLS playlist ----
  if (needsPlaylistRewrite(contentType, '', path)) {
    const playlist = await res.text();
    const rewritten = rewriteHlsPlaylist(playlist, params.id, path, streamPrefix);
    return new Response(rewritten, { status: res.status, headers: baseHeaders() });
  }

  // ---- everything else is BINARY and is piped, never buffered ----
  return new Response(res.body, { status: res.status, headers: baseHeaders() });
}

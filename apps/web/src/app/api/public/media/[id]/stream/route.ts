// /api/public/media/[id]/stream  -  public playback proxy (no session)
//
// A pass-through with ONE exception: the HLS playlist text is rewritten. Everything
// else - posters, segments, filmstrips - is BINARY and must never pass through a
// string.
//
// =============================================================================
// THE BUG THIS FILE FIXED
// =============================================================================
//
// This route used to call `await res.text()` on EVERY response so it could inspect
// the playlist, and then hand that string back via `new Response(bodyText)`. For a
// JPEG that is corruption, not a copy:
//
//   `res.text()` decodes the body as UTF-8. A poster is binary, so most of its
//   byte sequences are invalid UTF-8 and become U+FFFD (the replacement
//   character). `new Response(string)` then encodes each of those as EF BF BD.
//
//   The result keeps the right status, the right content-type and the right
//   length - and the first three bytes are EF BB BF instead of a JPEG's FF D8 FF.
//   So the browser refuses to decode it and every thumbnail on the platform
//   renders as a broken image, while `curl -o /dev/null -w %{http_code}` happily
//   reports 200.
//
// That is why this was invisible to a status-code check: the failure is in the
// BYTES, not the response line. The rule now is that a binary body is never
// buffered into a string at all - it is piped with `res.body`, and the one text
// case (the playlist) is decided by content type BEFORE anything is read.
//
// The playlist rewrite itself is in `lib/hls-rewrite.ts`, and the reason it is
// needed at all is there: HLS names its segments RELATIVELY, and a browser
// resolves those against the playlist's PATH, dropping the query string.
import type { NextRequest } from 'next/server';
import { rewriteHlsPlaylist, needsPlaylistRewrite } from '@/lib/hls-rewrite';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const sp = req.nextUrl.searchParams;
  const path = sp.get('path');

  if (!path) {
    return Response.json(
      { error: 'missing_path', message: 'path is required.' },
      { status: 400 }
    );
  }

  const upstream = new URL(
    `${AUTH_SERVICE_URL}/api/v1/public/media/${encodeURIComponent(params.id)}/stream`
  );
  upstream.searchParams.set('path', path);

  const headers = new Headers();
  // Forwarded, not synthesised: the browser's own Range is what keeps a seek
  // cheap, and inventing one would make every request a full-object download.
  const range = req.headers.get('range');
  if (range) headers.set('range', range);

  try {
    const res = await fetch(upstream.toString(), { headers });
    const contentType = res.headers.get('content-type') ?? '';

    if (!res.ok && res.status !== 206) {
      // A refusal is JSON by construction, so reading it as text is safe here.
      const refusal = await res.text();
      return new Response(refusal, {
        status: res.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    const streamPrefix = `/api/public/media/${encodeURIComponent(params.id)}/stream`;
    const baseHeaders = () => {
      const h = new Headers();
      if (contentType) h.set('content-type', contentType);
      // No-store: the visibility gate is evaluated on every request, and caching a
      // 404 for a video that becomes approved a minute later is a bug.
      h.set('cache-control', 'no-store');
      h.set('accept-ranges', 'bytes');
      for (const name of ['content-range', 'content-length', 'etag']) {
        const v = res.headers.get(name);
        if (v) h.set(name, v);
      }
      return h;
    };

    // ---- the ONE text case: an HLS playlist ----
    //
    // Gated on the content type, not on the path, so a misconfigured bucket cannot
    // make a `.jpg` be rewritten. And it reads the body as text ONLY once it is
    // known to be a playlist, which is what keeps every other response binary.
    if (needsPlaylistRewrite(contentType, '', path)) {
      // A playlist is a few hundred bytes of text. Buffering it costs nothing and
      // `text()` is correct for it - it IS UTF-8 by specification.
      const playlist = await res.text();
      const rewritten = rewriteHlsPlaylist(playlist, params.id, path, streamPrefix);
      return new Response(rewritten, { status: res.status, headers: baseHeaders() });
    }

    // ---- everything else is BINARY and is piped, not buffered ----
    //
    // `res.body` is a stream, so a 4 GB rendition never becomes a 4 GB string and
    // a byte is never round-tripped through a decoder. This single line is the fix
    // for the corrupted posters.
    return new Response(res.body, { status: res.status, headers: baseHeaders() });
  } catch {
    return Response.json(
      { error: 'service_unavailable', message: 'Could not reach the media service.' },
      { status: 503 }
    );
  }
}

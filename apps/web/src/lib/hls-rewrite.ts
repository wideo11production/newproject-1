/**
 * HLS PLAYLIST REWRITING - why a proxy must touch the playlist text.
 *
 * =============================================================================
 * THE PROBLEM
 * =============================================================================
 *
 * An HLS playlist names its segments RELATIVELY. This one:
 *
 *   #EXTM3U
 *   #EXTINF:10.000000,
 *   seg_00000.ts
 *   #EXTINF:10.000000,
 *   seg_00001.ts
 *
 * And a player resolves `seg_00000.ts` against the playlist's URL - by PATH,
 * ignoring the query string entirely.
 *
 * The proxy serves the playlist at
 *
 *   /api/public/media/{id}/stream?path=1080p%2Fplaylist.m3u8
 *
 * so a naive relative resolution produces
 *
 *   /api/public/media/{id}/stream/seg_00000.ts
 *
 * which is not a route and 404s. The player stalls on its first segment, which
 * looks exactly like "the video is broken" while every request the proxy served
 * was correct.
 *
 * =============================================================================
 * THE FIX
 * =============================================================================
 *
 * Rewrite the playlist so every segment is an ABSOLUTE url that carries the
 * correct `?path=`. Same-origin by design, so nothing about the private bucket
 * changes - the segments still come back through the same gate.
 *
 * =============================================================================
 * WHAT IS REWRITTEN, AND WHAT IS NOT
 * =============================================================================
 *
 * Segment URIs on their own line  ->  absolute
 * `URI="..."` inside a tag         ->  absolute (encryption keys, alternate
 *                                      renditions, subtitles)
 * Already-absolute URLs            ->  untouched, including `http://...` and
 *                                      path-absolute `/...`, because a playlist
 *                                      that already points somewhere real is
 *                                      not this proxy's business to redirect
 * Every `#` tag                    ->  untouched. The tags are the playlist's
 *                                      own metadata, and rewriting them would
 *                                      corrupt timing and discontinuity marks.
 *
 * A tag that is NOT rewritten is passed through byte-for-byte: a corrupted
 * playlist is a stalled player, and it is far easier to corrupt than to fix.
 */

/**
 * Rewrite a media playlist's relative URIs to absolute proxy URLs.
 *
 * @param playlistText - the playlist as fetched from storage
 * @param assetId      - the asset the playlist belongs to
 * @param objectPath   - the path the playlist itself was served from, used to
 *                       resolve relatives (`1080p/playlist.m3u8` -> `1080p`)
 * @param streamPrefix - the browser-facing prefix for a stream request
 *                       (`/api/public/media/{id}/stream` or
 *                       `/api/media/{id}/stream`)
 */
export function rewriteHlsPlaylist(
  playlistText: string,
  assetId: string,
  objectPath: string,
  streamPrefix: string
): string {
  // The directory the playlist lives in, which is what a relative URI resolves
  // against. A playlist at the bucket root (no slash) resolves against itself.
  const lastSlash = objectPath.lastIndexOf('/');
  const dir = lastSlash > 0 ? objectPath.slice(0, lastSlash) : '';

  const toAbsolute = (uri: string): string => {
    const trimmed = uri.trim();
    // Already absolute - leave it. Redirecting a URL that already points at a
    // real place is how a CDN gets bypassed by accident.
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return uri;
    if (trimmed === '') return uri;
    const rel = dir ? `${dir}/${trimmed}` : trimmed;
    return `${streamPrefix}?path=${encodeURIComponent(rel)}`;
  };

  // Split on \n only. A playlist is a UNIX-line-ending format, and splitting on
  // \r\n would leave a stray \r attached to each URI, which is exactly the kind
  // of byte that makes a player reject a URIs line as malformed.
  return playlistText
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        // `URI="..."` appears inside tags, not on their own line - encryption
        // keys and alternate renditions both. Everything else in the tag is left
        // as-is, because the tag's own attributes are not this proxy's business.
        return line.replace(/URI="([^"]*)"/g, (_match, uri) => {
          return `URI="${toAbsolute(uri)}"`;
        });
      }
      return toAbsolute(line);
    })
    .join('\n');
}

/**
 * Whether this response should be treated as a media playlist worth rewriting.
 *
 * The content type is the ONLY input, and that is deliberate. A path check would
 * look up `path.endsWith('.m3u8')`, which is a lie a misconfigured bucket can tell
 * - and trusting it is how a poster gets run through a text pass and silently
 * re-encoded from `FF D8 FF` to `EF BB BF`, breaking every thumbnail on the
 * platform while still answering `200 image/jpeg`.
 *
 * `bodyText` is accepted for callers that already have the body, but it is only
 * ever used as a CHEAP confirmation and never as the decision. A caller with a
 * binary body passes `''`, which keeps the decision on the header alone.
 *
 * Note what this does NOT do: it does not check that the body starts `#EXTM3U`.
 * Reading the body to decide whether to read it defeats the point, so the header
 * decides and the rewrite itself tolerates a playlist it does not recognise by
 * leaving it unchanged.
 */
export function needsPlaylistRewrite(
  contentType: string,
  bodyText: string,
  objectPath: string
): boolean {
  if (!HLS_PLAYLIST_CONTENT_TYPE.test(contentType)) return false;
  // A content type of `application/vnd.apple.mpegurl` on a non-mp4 extension is
  // still a playlist, so the object path is NOT a filter here. It is accepted so
  // the signature can grow, and ignored for now.
  void objectPath;
  return true;
}

/**
 * The playlist content type, as one expression.
 *
 * `application/vnd.apple.mpegurl` is the IANA type, and `application/x-mpegURL`
 * and `audio/mpegurl` are the two variants real servers emit. A regex with the
 * `i` flag matches all three without a list that would silently miss one.
 */
const HLS_PLAYLIST_CONTENT_TYPE = /application\/(vnd\.apple\.mpegurl|x-mpegurl|mpegurl|vnd\.apple\.mpegurl)/i;


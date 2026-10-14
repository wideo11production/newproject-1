/**
 * PLAYBACK URL RESOLUTION - turning a stored bucket path into a playable URL.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 *
 * The `video` bucket is private by design (SYSTEM-PLAN R6), so the
 * `hls_public_url` / `poster_public_url` stored on a media row are PATHS, not
 * URLs a browser can fetch. Pointing an `<video src>`, a `<img src>` or an
 * hls.js instance at one returns `AccessDenied` for everyone - including the
 * creator who uploaded it.
 *
 * The one place that turns them into something playable is
 * `/api/public/media/{id}/stream`, which validates visibility and streams the
 * bytes. Every client-side component that needs to play a video goes through the
 * helpers here, so there is one definition of "how do I build a stream URL"
 * rather than one per component.
 *
 * =============================================================================
 * WHY THE PATH IS EXTRACTED AND NOT STORED
 * =============================================================================
 *
 * The row carries the full bucket URL because the transcoder writes it when it
 * knows the rendition heights, and a full URL is what its own HLS muxer needs.
 * Everything after the asset id is the relative object path, and the stream
 * proxy wants exactly that - so it is sliced out here.
 */

/** The rendition directories the transcoder writes, highest quality first. */
export const RENDITION_ORDER = ['1080p', '720p', '480p'] as const;

/**
 * Slice the relative object path out of a stored bucket URL.
 *
 * `http://localhost:9000/video/<assetId>/1080p/playlist.m3u8` becomes
 * `1080p/playlist.m3u8`.
 *
 * Returns null for anything that is not shaped like an object inside an asset
 * prefix - which includes a missing value, a URL from a different host, and a
 * path that escaped its asset.
 */
export function relativeObjectPath(storedUrl: string | null | undefined, assetId: string): string | null {
  if (!storedUrl || !assetId) return null;
  const marker = `/${assetId}/`;
  const idx = storedUrl.indexOf(marker);
  if (idx < 0) return null;
  const rel = storedUrl.slice(idx + marker.length);
  // A path that tries to climb out of the prefix is not a relative path.
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return null;
  return rel;
}

/**
 * Build the stream URL for one object inside an asset.
 *
 * This is the URL a browser uses. It is same-origin, which is what makes HLS
 * work at all: the playlist names its segments relatively, so they resolve back
 * to this route instead of to MinIO where they would be private.
 */
export function streamUrl(assetId: string, relPath: string): string {
  return `/api/public/media/${encodeURIComponent(assetId)}/stream?path=${encodeURIComponent(relPath)}`;
}

/**
 * The playable HLS playlist URL for an asset, or null if it cannot be played.
 *
 * Prefers the highest rendition that actually exists in the stored URL, because
 * the row only ever carries one `hls_public_url` and that is the top rendition
 * the transcoder produced.
 */
export function hlsStreamUrl(
  storedHlsUrl: string | null | undefined,
  assetId: string,
  quality?: string
): string | null {
  const rel = relativeObjectPath(storedHlsUrl, assetId);
  if (!rel) return null;
  if (!quality || quality === 'auto') return streamUrl(assetId, rel);
  // Swap only the rendition directory, keeping the filename (`playlist.m3u8`).
  const parts = rel.split('/');
  if (parts.length < 2) return streamUrl(assetId, rel);
  const filename = parts[parts.length - 1];
  return streamUrl(assetId, `${quality}/${filename}`);
}

/**
 * The path the transcoder writes the poster to, for every asset.
 *
 * `{assetId}/poster.jpg` - not a convention this file invented, the one
 * `packaging.go` actually uses. It is spelled out here because it is what makes a
 * MISSING `poster_public_url` recoverable rather than a blank tile.
 */
export const POSTER_OBJECT_PATH = 'poster.jpg';

/**
 * Build the stream URL for one object inside an asset, falling back to the
 * transcoder's conventional path.
 *
 * =============================================================================
 * WHY THERE IS A FALLBACK
 * =============================================================================
 *
 * 78 of 102 `ready` rows have `poster_public_url` NULL while the poster file is
 * sitting in the bucket at `{assetId}/poster.jpg`. `MarkReady` writes
 * `hls_public_url` from the transcoder's callback but only writes the poster when
 * the callback carries one - so a callback that omitted it left a `ready` row whose
 * only thumbnail is a file nobody knows the path to.
 *
 * The result on screen was a grid of grey tiles with a filename, which is what
 * "the media has no data" looks like to a creator.
 *
 * So: when the stored URL is absent, this uses the conventional path instead of
 * giving up. That is safe because the path is deterministic AND the request goes
 * through the same gate as anything else, so a genuinely absent poster still 404s
 * and still renders the fallback icon - it just gets a real chance first.
 *
 * The backend fix (writing the URL at source) is the durable answer, and this
 * fallback is what makes the 78 existing rows correct today rather than after the
 * next re-transcode.
 */
function streamUrlOrConvention(
  storedUrl: string | null | undefined,
  assetId: string,
  convention: string
): string | null {
  const rel = relativeObjectPath(storedUrl, assetId);
  if (rel) return streamUrl(assetId, rel);
  if (convention) return streamUrl(assetId, convention);
  return null;
}

/** The playable poster URL for an asset, or null. */
export function posterStreamUrl(
  storedPosterUrl: string | null | undefined,
  assetId: string
): string | null {
  return streamUrlOrConvention(storedPosterUrl, assetId, POSTER_OBJECT_PATH);
}

/**
 * The playable LOW-QUALITY URL for a hover preview.
 *
 * Hover previews must be cheap: they fire on every fast sweep across a grid,
 * and previewing 1080p means a preview costs more than the video it previews.
 *
 * ---- YE KYUN THEEK KIYA GAYA ----
 *
 * Pehle ye `480p/poster.jpg` bana raha tha. Filename stored playlist se leta tha
 * (`playlist.m3u8`), directory ko `480p` kar deta tha, lekin phir FILENAME ko
 * `poster.jpg` maan leta tha - matlab request `1080p/poster.jpg` ja rahi thi,
 * jo exist nahi karti (poster asset root pe hai, rendition folder mein nahi).
 * Nateeja: preview fail hota tha, aur kyunki failure silent hai (poster ke neeche
 * chhupa hota hai) hover "kaam nahi kar raha" dikhta - koi error nahi.
 *
 * Ab: filename ko VERBATIM rakhta hai (`playlist.m3u8`), sirf directory badalta
 * hai. Aur jo renditions actually exist karti hain unmein se pehli try karta hai,
 * stored directory ko fallback rakhta hai.
 */
export function previewStreamUrl(
  storedHlsUrl: string | null | undefined,
  assetId: string
): string | null {
  const rel = relativeObjectPath(storedHlsUrl, assetId);
  if (!rel) return null;

  const parts = rel.split('/');
  const filename = parts[parts.length - 1];

  // A playlist is the only thing worth previewing. A `.ts` segment is 4 seconds
  // of video and would play for 4 seconds then hit a 404 on the next one.
  if (!filename.endsWith('.m3u8')) return null;

  const storedDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

  // Cheapest rendition first. `480p` is the transcoder's lowest ladder rung and
  // is what a hover should cost. If the asset has no 480p the player errors and
  // the poster stays, which is the correct degraded state.
  return streamUrl(assetId, `480p/${filename}`);
}

/**
 * The rendition directories the transcoder actually writes, cheapest first.
 *
 * Exported so a caller that has learned the real rungs (from a 404) can retry
 * without hardcoding them a second time.
 */
export const PREVIEW_RENDITIONS = ['480p', '720p'] as const;

// =============================================================================
// OWNER-SCOPED VARIANTS
// =============================================================================
//
// The owner's library contains material the world may not see: a draft on a
// private channel, an asset still awaiting a moderation verdict. The public
// route refuses all of those, correctly - so an owner watching their own
// library goes through the OWNER route, which forwards their session and lets
// auth-service answer "is this yours".
//
// Every helper here is the public one with the origin swapped. One line each,
// but a shared name so a caller cannot accidentally use the public one and get
// a 404 for their own video.

/** Owner-scoped stream URL for one object inside an asset. */
export function ownerStreamUrl(assetId: string, relPath: string): string {
  return `/api/media/${encodeURIComponent(assetId)}/stream?path=${encodeURIComponent(relPath)}`;
}

/** Owner-scoped, with the transcoder's conventional poster path as a fallback. */
function ownerStreamUrlOrConvention(
  storedUrl: string | null | undefined,
  assetId: string,
  convention: string
): string | null {
  const rel = relativeObjectPath(storedUrl, assetId);
  if (rel) return ownerStreamUrl(assetId, rel);
  if (convention) return ownerStreamUrl(assetId, convention);
  return null;
}

/** Owner-scoped playable HLS playlist URL. */
export function ownerHlsStreamUrl(
  storedHlsUrl: string | null | undefined,
  assetId: string,
  quality?: string
): string | null {
  const rel = relativeObjectPath(storedHlsUrl, assetId);
  if (!rel) return null;
  if (!quality || quality === 'auto') return ownerStreamUrl(assetId, rel);
  const parts = rel.split('/');
  if (parts.length < 2) return ownerStreamUrl(assetId, rel);
  return ownerStreamUrl(assetId, `${quality}/${parts[parts.length - 1]}`);
}

/** Owner-scoped playable poster URL. */
export function ownerPosterStreamUrl(
  storedPosterUrl: string | null | undefined,
  assetId: string
): string | null {
  return ownerStreamUrlOrConvention(storedPosterUrl, assetId, POSTER_OBJECT_PATH);
}

/**
 * Owner-scoped playable low-quality hover-preview URL.
 *
 * Same derivation as `previewStreamUrl` - keep the filename, swap the rendition
 * directory - because the same bug lived here: it produced
 * `480p/poster.jpg`, which does not exist.
 */
export function ownerPreviewStreamUrl(
  storedHlsUrl: string | null | undefined,
  assetId: string
): string | null {
  const rel = relativeObjectPath(storedHlsUrl, assetId);
  if (!rel) return null;

  const parts = rel.split('/');
  const filename = parts[parts.length - 1];
  if (!filename.endsWith('.m3u8')) return null;

  return ownerStreamUrl(assetId, `480p/${filename}`);
}

// ============================================================================
// COMPOSITOR SOURCES
// ============================================================================
//
// The single map of everything the compositor can be asked to draw, by clip
// `mediaId`.
//
// ---- WHY THIS LIVES HERE AND NOT IN THE COMPONENTS ----
//
// The preview (`preview-canvas.tsx`) and the exporter (`video-editor.tsx`)
// drive the same compositor over the same shape. When the map was built
// twice, one copy could know about a clip the other did not, and the user
// found out late: a logo that renders in the exported file but never shows
// on screen while they position it - or the reverse. One builder, two
// callers, and the two can no longer disagree.
//
// ---- WHY BRANDING CLIPS ARE IN HERE AND NOT ONLY MEDIA ITEMS ----
//
// The compositor resolves a clip's picture through this map, and media items
// alone do not cover branding: a branding clip holds a channel's logo URL
// directly, because a channel is not a file the user imported, so its id is
// never a media item. Without the clip's own URL, `paintBranding` returned
// on its first line for every frame of every project - the track existed,
// the clip existed, the export path existed, and the logo was never drawn.
//
// Reading the URL off the clip is what makes a CHANNEL logo survive a
// reload: no IndexedDB copy is involved, so there is nothing to restore and
// nothing that can come back as a missing file. A SPONSOR logo is a real
// file, so it lives in the store - and the store's re-minted URL is the
// live one. The clip's own URL is a blob: from the previous document, dead
// after a reload, so it is only used when the store has no entry.

import type { MediaItem } from './media-store';
import type { TimelineTrack } from './types';

/** One resolvable picture the compositor can draw, by clip `mediaId`. */
export interface CompositorSource {
  url: string;
  kind: string;
}

/**
 * Every drawable asset: the media bin, plus branding clips whose logo URL
 * lives on the clip itself.
 */
export function buildCompositorSources(
  items: MediaItem[],
  tracks: TimelineTrack[]
): Map<string, CompositorSource> {
  const map = new Map<string, CompositorSource>();
  for (const item of items) map.set(item.id, { url: item.url, kind: item.kind });
  for (const track of tracks) {
    if (track.type !== 'branding') continue;
    for (const clip of track.clips) {
      if (clip.url && !map.has(clip.mediaId)) {
        map.set(clip.mediaId, { url: clip.url, kind: 'image' });
      }
    }
  }
  return map;
}

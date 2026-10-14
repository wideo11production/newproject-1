'use client';

/**
 * DISCOVER - the video page, everyone's media in one place.
 *
 * =============================================================================
 * THE LAYOUT
 * ===========================================================================
 *
 *   heading   - "Discover the Global Community", because the page is a catalogue
 *               and not a personal library
 *   body      - tab rail  |  the split workspace
 *
 *   split     - nothing playing: the gallery spans the full width
 *               something playing: 2/5 gallery | 3/5 active player
 *
 * =============================================================================
 * WHAT MAKES THIS DIFFERENT FROM THE STUDIO PAGES
 * ===========================================================================
 *
 * The studio pages (upload, channel) are about ONE owner's clips. This one is every
 * creator's, so:
 *
 *   * the source is `/api/public/media` rather than an owner-scoped endpoint
 *   * there is no upload box, no publish control, and no "Go Live"
 *   * playback goes through the PUBLIC stream route, not the owner one
 *
 * Those are three separate authorities, and mixing them is how a stranger ends up
 * watching someone else's draft - so this page uses the public one for all of them.
 *
 * ===========================================================================
 * WHY THE TABS ARE CLIENT-SIDE
 * ===========================================================================
 *
 * Every tab is a predicate over rows already in memory. A round trip per click
 * would put a spinner between the viewer and the thing they clicked, to answer a
 * question the data on screen can answer - and it would also mean the counts are
 * wrong until the second response lands.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DiscoverSidebar, matchesTab, type DiscoverTab } from '@/components/studio/DiscoverSidebar';
import { StudioMediaCard } from '@/components/studio/StudioMediaCard';
import { MediaLibraryPane } from '@/components/studio/MediaLibraryPane';
import { ActivePlayerPane } from '@/components/studio/ActivePlayerPane';
import {
  InlinePlayerProvider,
  useInlinePlayer,
  type InlinePlayerAsset,
} from '@/components/InlinePlayerProvider';
import { hlsStreamUrl, posterStreamUrl, previewStreamUrl, relativeObjectPath } from '@/lib/playback';

import {
  productHeroGradientText,
  productSunken,
  productTextMuted,
} from '@wideo11/ui/design-system';

/** One item from the public media list. */
type PublicMedia = {
  id: string;
  kind: 'video' | 'reel' | 'audio';
  filename: string;
  duration_seconds: number;
  width: number;
  height: number;
  poster_url?: string | null;
  hls_url?: string | null;
  created_at?: string;
  channel_handle?: string;
  channel_name?: string;
};

function toPlayerAsset(m: PublicMedia): InlinePlayerAsset {
  return {
    id: m.id,
    filename: m.filename,
    kind: m.kind,
    duration_seconds: m.duration_seconds,
    width: m.width,
    height: m.height,
    // The PUBLIC stream route. A stranger has no session, so the owner-scoped
    // route would 401 - and the public one is correctly gated by the service.
    hls_url: hlsStreamUrl(m.hls_url, m.id),
    poster_url: posterStreamUrl(m.poster_url, m.id),
    subtitle: m.channel_name ? `@${m.channel_handle || m.channel_name}` : null,
    watch_href: `/watch/${m.id}`,
  };
}

/** The split. Owns the player context read, so it lives inside the provider. */
function DiscoverSplit({
  shown,
  loading,
}: {
  shown: PublicMedia[];
  loading: boolean;
}) {
  const { play, current, close, navigate, index, total } = useInlinePlayer();

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5" data-discover-split="">
      {/* Gallery - 2 of 5 */}
      <div className="min-w-0 xl:col-span-2">
        <MediaLibraryPane
          count={shown.length}
          loading={loading}
          searchPlaceholder="Search all media"
          emptyMessage="Nothing published yet. Be the first to upload."
        >
          {shown.map((m) => {
            const urls = {
              poster: posterStreamUrl(m.poster_url, m.id),
              preview: previewStreamUrl(m.hls_url, m.id),
              play: hlsStreamUrl(m.hls_url, m.id),
            };
            return (
              <StudioMediaCard
                key={m.id}
                id={m.id}
                kind={m.kind}
                filename={m.filename}
                durationSeconds={m.duration_seconds}
                width={m.width}
                height={m.height}
                posterUrl={urls.poster}
                previewUrl={urls.preview}
                playUrl={urls.play}
                subtitle={m.channel_name ?? undefined}
                watchHref={`/watch/${m.id}`}
                sortKey={m.created_at ?? ''}
                matchKey={`${m.filename} ${m.channel_name ?? ``} ${m.channel_handle ?? ``}`}
                // No publish affordance and no owner controls: these are other
                // people's clips, and the library pane has no authority over them.
                eligibleForPublish={false}
              />
            );
          })}
        </MediaLibraryPane>
      </div>

      {/* Active player - 3 of 5 */}
      {current ? (
        <div className="min-w-0 xl:col-span-3 xl:sticky xl:top-5 xl:self-start">
          <ActivePlayerPane
            asset={current}
            onClose={close}
            onNavigate={navigate}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < total - 1}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function DiscoverPage() {
  const [tab, setTab] = useState<DiscoverTab>('all');
  const [items, setItems] = useState<PublicMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/public/media?limit=60', { cache: 'no-store' });
      if (!res.ok) {
        setLoadError('Could not load media. Try again shortly.');
        setItems([]);
        return;
      }
      const body = (await res.json()) as { media?: PublicMedia[] };
      setItems(body.media ?? []);
    } catch {
      setLoadError('Could not reach the media service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only clips that can actually play reach the gallery. A row with no rendition
  // path is not a card, it is a promise of one - and clicking it would open a
  // player that immediately errors.
  const playable = useMemo(
    () => items.filter((m) => relativeObjectPath(m.hls_url, m.id) !== null),
    [items]
  );

  const counts = useMemo(() => {
    const out: Partial<Record<DiscoverTab, number>> = { all: playable.length };
    for (const t of ['videos', 'reels', 'short-reels', 'long-reels', 'vertical', 'horizontal', 'audio'] as DiscoverTab[]) {
      out[t] = playable.filter((m) => matchesTab(m, t)).length;
    }
    return out;
  }, [playable]);

  const shown = useMemo(() => playable.filter((m) => matchesTab(m, tab)), [playable, tab]);
  const playlist = useMemo(() => shown.map(toPlayerAsset), [shown]);

  return (
    <div className={`min-h-screen ${productSunken} text-white`}>
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6">
        {/* ---- heading ---- */}
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Discover the{' '}
            <span className={`${productHeroGradientText}`}>
              Global Community
            </span>
          </h1>
          <p className={`mt-1 text-xs ${productTextMuted}`}>
            Every clip published on the platform, from every creator.
          </p>
        </header>

        {loadError ? (
          <p className="mb-4 rounded-2xl bg-red-500/5 px-3 py-2 text-xs text-red-300">{loadError}</p>
        ) : null}

        {/* ---- body ---- */}
        <div className="flex gap-3">
          <DiscoverSidebar active={tab} onSelect={setTab} counts={counts} />

          <div className="min-w-0 flex-1">
            {/* Section heading, matching the mockup's "All User Media Library". */}
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-medium text-white">
                {tab === 'all' ? 'All User Media Library' : labelForTab(tab)}
              </h2>
              <span className={`text-[11px] ${productTextMuted}`}>{shown.length} clips</span>
            </div>

            <InlinePlayerProvider playlist={playlist}>
              <DiscoverSplit shown={shown} loading={loading} />
            </InlinePlayerProvider>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The section heading for a tab, matching the mockup's phrasing. */
function labelForTab(tab: DiscoverTab): string {
  switch (tab) {
    case 'videos':
      return 'All User Videos';
    case 'reels':
      return 'All User Reels';
    case 'short-reels':
      return 'Short Reels Library';
    case 'long-reels':
      return 'Long Reels Library';
    case 'vertical':
      return 'Vertical Media Library';
    case 'horizontal':
      return 'Horizontal Media Library';
    case 'audio':
      return 'All User Audio Files';
    default:
      return 'All User Media Library';
  }
}

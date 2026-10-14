'use client';

// A channel's page: its banner, identity, and its published videos and reels.
//
// A Client Component because it has tabs and fetches per tab.
//
// =============================================================================
// LAYOUT
// =============================================================================
//
//   UPPER   - cover banner, avatar, subscriber counts, actions. Full width.
//   TABS    - Videos / Shorts / Reels / Audio / Live / Playlists.
//   LOWER   - split workspace. Nothing playing: the gallery spans 100%.
//             Something playing: 50/50, gallery left / player right.
//
// The split is below the header on purpose: the banner and the channel identity
// are what the viewer came for.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Bell, MoreHorizontal, Share2, UserPlus, Users, Loader2 } from 'lucide-react';
import {
  StudioSidebar,
  matchesCategory,
  type MediaCategory,
} from '@/components/studio/StudioSidebar';
import {
  ChannelHeaderCard,
  formatSubscribers,
  formatJoined,
} from '@/components/studio/ChannelHeaderCard';
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
  productAccentBg,
  productAccentHoverBg,
  productPanel,
  productPanelHover,
  productSunken,
  productTextMuted,
} from '@wideo11/ui/design-system';



type Media = {
  id: string;
  kind: 'video' | 'reel' | 'audio';
  filename: string;
  duration_seconds: number;
  width: number;
  height: number;
  poster_url?: string | null;
  // The stored rendition URL. It points at the private `video` bucket, so it is a
  // PATH rather than something playable - `lib/playback` turns it into the proxy
  // URL that is.
  hls_url?: string | null;
  created_at?: string;
};

type Channel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string | null;
  cover_url: string | null;
  subscriber_count: number;
  channel_type: string | null;
  // Step 2 branding (migration 022). Public by design: a logo and a colour are
  // the creator's own content, and they are the entire point of a channel page.
  logo_url?: string | null;
  brand_hue?: number | null;
  // When the channel was created, for the header's "Joined" cell. Absent on rows
  // that predate the field, and the header says "Unknown" rather than guessing.
  created_at?: string;
};

// ---------------------------------------------------------------------------
// RESOLVING A ROW INTO SOMETHING A BROWSER CAN PLAY
// ---------------------------------------------------------------------------
//
// The stored URLs are bucket paths and every one of them 403s. Each field is
// resolved independently, because they resolve independently: a poster may exist
// for an asset whose playlist has not been written yet.
//
// Built as one function so a card, the preview and the player all agree on what
// URL they are using - three separate resolutions is how a thumbnail ends up
// previewing a different video than the one that plays.
function resolveMediaUrls(m: Media) {
  const hlsRel = relativeObjectPath(m.hls_url, m.id);
  return {
    poster: posterStreamUrl(m.poster_url, m.id),
    preview: previewStreamUrl(m.hls_url, m.id),
    play: hlsStreamUrl(m.hls_url, m.id),
    // `null` when the row carries no rendition path at all, which is the honest
    // "not playable" signal rather than a guess at a height.
    hasHls: hlsRel !== null,
  };
}

/** Build the playlist asset the player drawer consumes. */
function toPlayerAsset(m: Media, handle: string): InlinePlayerAsset {
  const urls = resolveMediaUrls(m);
  return {
    id: m.id,
    filename: m.filename,
    kind: m.kind,
    duration_seconds: m.duration_seconds,
    width: m.width,
    height: m.height,
    hls_url: urls.play,
    poster_url: urls.poster,
    subtitle: `@${handle}`,
    watch_href: `/watch/${m.id}`,
  };
}

export default function ChannelPageClient({ handle }: { handle: string }) {
  const [tab, setTab] = useState<'video' | 'reel' | 'audio'>('video');
  const [category, setCategory] = useState<MediaCategory>('all');
  const [channel, setChannel] = useState<Channel | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [is_subscribed, setIsSubscribed] = useState(false);


  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const chanRes = await fetch(
          `/api/public/channels/${encodeURIComponent(handle)}`,
          { cache: 'no-store' }
        );

        if (!chanRes.ok || !alive) {
          if (alive) setError('That channel could not be found.');
          setLoading(false);
          return;
        }

        const chan = (await chanRes.json()) as { channel?: Channel } | Channel;
        const ch =
          (chan as { channel?: Channel }).channel ?? (chan as Channel | null);
        if (alive) setChannel(ch ?? null);

        // Only the tabs the service can answer ask for media. Asking for the
        // other ones anyway would 400, and a 400 is not an "empty tab", it is a
        // bug.
        if (tab === 'video' || tab === 'reel' || tab === 'audio') {
          const mediaRes = await fetch(
            `/api/public/channels/${encodeURIComponent(handle)}/media?kind=${tab}&limit=48`,
            { cache: 'no-store' }
          );
          if (mediaRes.ok && alive) {
            const body = (await mediaRes.json()) as { media?: Media[] };
            setMedia(body.media ?? []);
          } else if (alive) {
            setMedia([]);
          }
        } else {
          if (alive) setMedia([]);
        }
      } catch {
        if (alive) setError('Could not reach the channel service.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [handle, tab]);

  if (error) {
    return (
      <div className={`min-h-screen ${productSunken} p-6`}>
        <div className={`mx-auto mt-16 max-w-md rounded-2xl ${productPanel} p-6 text-center`}>
          <AlertCircle className="mx-auto mb-3 h-7 w-7 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium text-white">{error}</p>
          <Link
            href="/channels"
            className={`mt-4 inline-block rounded-lg ${productAccentBg} px-4 py-2 text-xs font-medium text-white transition-colors ${productAccentHoverBg}`}
          >
            Browse channels
          </Link>
        </div>
      </div>
    );
  }


  // Only clips with a playlist can be played, and only they are worth showing in
  // the library - a card that cannot play is a card that lies.
  const playable = useMemo(() => media.filter((m) => resolveMediaUrls(m).hasHls), [media]);

  const categoryCounts = useMemo(() => {
    const out: Partial<Record<MediaCategory, number>> = { all: playable.length };
    for (const c of ['video', 'reel-long', 'reel-short', 'horizontal', 'vertical', 'audio'] as MediaCategory[]) {
      out[c] = playable.filter((m) => matchesCategory(m, c)).length;
    }
    return out;
  }, [playable]);

  const shown = useMemo(
    () => playable.filter((m) => matchesCategory(m, category)),
    [playable, category]
  );


  if (error) {
    return (
      <div className={`min-h-screen ${productSunken} p-6`}>
        <div className={`mx-auto mt-16 max-w-md rounded-2xl ${productPanel} p-6 text-center`}>
          <AlertCircle className="mx-auto mb-3 h-7 w-7 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium text-white">{error}</p>
          <Link
            href="/channels"
            className={`mt-4 inline-block rounded-lg ${productAccentBg} px-4 py-2 text-xs font-medium text-white transition-colors ${productAccentHoverBg}`}
          >
            Browse channels
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen ${productSunken} text-white`}>
      {/* ============ SIDEBAR: media categories ============ */}
      <StudioSidebar active={category} onSelect={setCategory} counts={categoryCounts} />

      <div className="min-w-0 flex-1">
        <main className="space-y-4 p-4 sm:p-5">
          {/* ============ UPPER: channel header card ============ */}
          <ChannelHeaderCard
            displayName={channel?.display_name ?? handle}
            handle={handle}
            creator={channel?.display_name}
            subscribers={formatSubscribers(channel?.subscriber_count ?? 0)}
            joined={formatJoined(channel?.created_at)}
            coverUrl={channel?.cover_url}
            avatarUrl={channel?.logo_url || channel?.image_url}
            brandHue={channel?.brand_hue}
            channelType={channel?.channel_type}
            actions={
              <>
                <button
                  onClick={() => setIsSubscribed((v) => !v)}
                  aria-pressed={is_subscribed}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                    is_subscribed
                      ? `${productSunken} ${productTextMuted} ${productPanelHover} hover:text-white`
                      : `${productAccentBg} text-white ${productAccentHoverBg}`
                  }`}
                >
                  {is_subscribed ? (
                    <>
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      Subscribed
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Subscribe
                    </>
                  )}
                </button>
                <button
                  className={`rounded-full ${productSunken} p-2 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                  aria-label="Notifications"
                  title="Notifications"
                >
                  <Bell className="h-3.5 w-3.5" />
                </button>
                <button
                  className={`rounded-full ${productSunken} p-2 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                  aria-label="Share channel"
                  title="Share"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
                <button
                  className={`rounded-full ${productSunken} p-2 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
                  aria-label="More"
                  title="More"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </>
            }
          />

          {channel?.description ? (
            <p className={`max-w-3xl whitespace-pre-wrap px-1 text-xs leading-relaxed ${productTextMuted}`}>
              {channel.description}
            </p>
          ) : null}

          {/* ============ LOWER: the split workspace ============ */}
          {/* The provider wraps ChannelSplit rather than living inside it: a hook
              is called during its own component's render, so the provider has to
              be an ANCESTOR of the caller, not something the caller returns. */}
          <InlinePlayerProvider playlist={shown.map((m) => toPlayerAsset(m, handle))}>
            <ChannelSplit
              shown={shown}
              loading={loading}
              handle={handle}
              meta={{
                creator: channel?.display_name,
                channel: handle,
                creatorAvatar: channel?.logo_url || channel?.image_url,
              }}
            />
          </InlinePlayerProvider>
        </main>
      </div>
    </div>
  );
}

/**
 * The channel's split workspace.
 *
 * A separate component because it READS the player context, and a component that
 * reads it has to live INSIDE the provider. Calling the hook at the top of
 * `ChannelPageClient` would put it outside one, which throws during the build's
 * static generation - and throws at runtime in any deployment where the route
 * does not happen to wrap it first.
 *
 * That is the right split on its own terms too: the header and the actions above
 * do not care what is playing, and only this part does.
 */
function ChannelSplit({
  shown,
  loading,
  handle,
  meta,
}: {
  shown: Media[];
  loading: boolean;
  handle: string;
  meta: { creator?: string; channel?: string; creatorAvatar?: string | null };
}) {
  const { current, close, navigate, index, total } = useInlinePlayer();


  return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Media Library - 2 of 5 */}
        <div className="min-w-0 xl:col-span-2">
          <MediaLibraryPane
            count={shown.length}
            loading={loading}
            searchPlaceholder="Search media"
            emptyMessage="No media in this category yet."
          >
            {shown.map((m) => {
              const urls = resolveMediaUrls(m);
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
                  watchHref={`/watch/${m.id}`}
                  sortKey={m.created_at ?? ''}
                  matchKey={m.filename}
                />
              );
            })}
          </MediaLibraryPane>
        </div>

        {/* Active Player - 3 of 5 */}
        {current ? (
          <div className="min-w-0 xl:col-span-3 xl:sticky xl:top-5 xl:self-start">
            <ActivePlayerPane
              asset={current}
              meta={meta}
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

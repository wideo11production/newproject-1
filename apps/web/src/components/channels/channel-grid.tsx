'use client';

/**
 * PUBLIC CHANNEL GALLERY
 *
 * ---- WHY THIS USES THE API NOW ----
 * This component used to render 9 hardcoded channels ("DevOps Weekly",
 * "1.2M subscribers", placeholder avatars). That is exactly the kind of fake
 * data that makes a product look finished when it is not: a visitor browses
 * channels, sees a populated grid, clicks through, and hits a 404 because
 * none of it exists. updatedtodo.md lists "no dummy or seeded data anywhere
 * in main" as a project goal - this was a live counterexample.
 *
 * It now reads the real public endpoint. The Go service only returns
 * channels that are `is_public AND is_active`, so a private channel cannot
 * appear here even if the user viewing it is logged in (the public proxy
 * deliberately does not forward the session cookie).
 *
 * ---- EMPTY AND ERROR STATES ARE BOTH REAL ----
 * When nobody has published yet, the grid says so instead of inventing
 * channels to fill the space. A truthful empty state is the whole point.
 *
 * =============================================================================
 * THE GALLERY, AND WHY THE GRID LIVES HERE RATHER THAN IN `browse-client.tsx`
 * =============================================================================
 *
 * The grid was `dynamic(..., { ssr: false })` and the grid element sat in
 * `browse-client.tsx`, so the page's column count and the component that fills
 * those columns were in different files. Changing the rhythm meant editing two
 * places and hoping they agreed.
 *
 * They are together now: one file owns the container, the columns and the gap.
 * `browse-client.tsx` owns the filter state and nothing else.
 *
 * =============================================================================
 * THE RHYTHM, AND WHY IT IS AS GENEROUS AS IT IS
 * =============================================================================
 *
 *   columns   1 / 2 / 3 / 4
 *   gap-x-8   the horizontal gap is WIDER than the vertical one (gap-y-14)
 *
 * A gallery reads as a set of objects when each one has room around it. Equal
 * gaps make the rows bind together into bands, and the eye stops seeing separate
 * cards - which is what "grid of boxes" looks like.
 *
 * The column ceiling is 4. Five columns of a card with an image, a name and three
 * numbers puts the name at roughly 180px, and a truncated name on every single
 * card is worse than fewer, readable cards.
 */

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import {
  ChannelCard,
  formatCount,
  type PublicChannel,
  type PublicChannelStats,
} from './channel-card';

/**
 * The container and the rhythm. One source, so the columns and the cards cannot
 * disagree about how wide a card is.
 */
const GRID =
  'grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

export default function ChannelGrid({
  type,
  onTypeChange: _onTypeChange,
}: {
  /** Active category filter, or '' for all. */
  type?: string;
  /** Accepted and ignored: the grid no longer renders its own filter row. */
  onTypeChange?: (next: string) => void;
}) {
  const [channels, setChannels] = useState<PublicChannel[] | null>(null);
  const [stats, setStats] = useState<PublicChannelStats[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Every filter change gets a fresh request, and the previous one is
    // irrelevant now. Without this, switching categories quickly leaves the LAST
    // response to arrive winning - which on a slow connection is the first
    // category you asked for, rendered under the second category's heading.
    setChannels(null);
    setError(null);

    (async () => {
      try {
        // `?type=` is omitted entirely when browsing everything, so the common
        // case stays a single unfiltered query rather than `type=` matching
        // nothing.
        const q = type ? `?limit=24&type=${encodeURIComponent(type)}` : '?limit=24';
        const res = await fetch(`/api/public/channels${q}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.message ?? 'Could not load channels.');
          return;
        }
        setChannels(Array.isArray(data.channels) ? data.channels : []);
        setStats(Array.isArray(data.stats) ? data.stats : []);
      } catch {
        if (!cancelled) {
          setError('Network error. Could not load channels.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [type]);

  // ---- Loading ----
  //
  // Skeletons in the GALLERY's shape, not the old card's shape. A skeleton is a
  // promise about what is coming; a skeleton in a different layout than the real
  // thing is a broken promise with a shimmer on it.
  if (channels === null && !error) {
    return (
      <div className={GRID}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl bg-white/[0.022]">
            <div className="aspect-[16/10] w-full animate-pulse bg-white/[0.04]" />
            <div className="px-5 pb-5 pt-4">
              <div className="flex items-center gap-3">
                <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.04]" />
                <div className="h-2.5 w-4/5 animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="mt-4 flex justify-between">
                <div className="h-2 w-16 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-2 w-20 animate-pulse rounded bg-white/[0.03]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="rounded-md border-0 bg-red-950/20 px-5 py-4 text-[13px] text-red-200/80">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // ---- Genuine empty state ----
  //
  // Said plainly and without an icon. The old one put a YouTube glyph above "No
  // public channels yet", which is a logo standing in for content - and on a page
  // with no channels, the emptiest possible presentation is the right one.
  if (!channels || channels.length === 0) {
    return (
      <div className="rounded-md border-dashed/10 px-8 py-20 text-center">
        <p className="text-[13px] uppercase tracking-[0.16em] text-white/30">
          {type ? 'Nothing in this category' : 'No public channels yet'}
        </p>
        <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-white/40">
          {type
            ? 'Try another category, or browse everything.'
            : 'Channels appear here once their owner makes them public.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
        The count, set as a quiet line above the grid rather than in the page
        heading. It changes with the filter, so it belongs to the results, not to
        the page - and putting it here means the heading does not have to lie by
        omission when someone is looking at a filtered view.
      */}
      <p className="mb-6 text-[11px] uppercase tracking-[0.16em] text-white/25">
        {channels.length}
        {channels.length === 1 ? ' channel' : ' channels'}
        {type ? ' in this category' : ''}
      </p>

      <div className={GRID}>
        {channels.map((channel, i) => {
          // Counts come back as a PARALLEL array, matched by index, rather than
          // nested per channel. The server builds both in one statement, so the two
          // always describe the same moment - whereas nesting them would invite a
          // second request per card, which is how a grid of 24 turns into 73 round
          // trips and a set of cards that disagree with each other.
          return (
            <ChannelCard
              key={channel.id}
              channel={channel}
              stats={stats[i]}
              // The first eight are the ones above the fold at every breakpoint
              // this grid reaches, so they earn eager loading and priority hints.
              priority={i < 8}
            />
          );
        })}
      </div>
    </>
  );
}

export { formatCount };

'use client';

/**
 * CHANNEL CARD - one card in the public gallery.
 *
 * Extracted from `channel-grid.tsx`, where it was inlined. Not a refactor for its
 * own sake: a 277-line grid with a 100-line card inside it cannot be restyled
 * without reading the card, and it cannot be checked without a browser.
 *
 * =============================================================================
 * THE DESIGN BRIEF: "MINIMAL GALLERY"
 * =============================================================================
 *
 * The old card was a bordered box with seven competing elements: banner, avatar,
 * name, handle, a bordered category chip, a description, and a row of counts. On a
 * grid of twenty-four that is a hundred and sixty-eight things all insisting on
 * attention, and the eye finds none of them.
 *
 * A gallery works the other way round. One element per card dominates; everything
 * else is subordinate. The rules followed here:
 *
 *  1. THE IMAGE IS THE CARD. Everything below it is caption, not content.
 *  2. NO BOXES. Cards are separated by WHITESPACE and a barely-there surface
 *     tint. A 1px around twenty-four cards is a grid drawn around the
 *     content, which is the opposite of letting the content be the thing you see.
 *  3. ONE ACCENT, AND IT IS THE CREATOR'S. The brand colour is the only saturated
 *     pixel in the card, and it is a 2px rule at the top - not a glow, not a
 *, not a filled button. Restraint is what makes an accent read as
 *     chosen rather than applied.
 *  4. TYPE DOES THE HIERARCHY. Uppercase micro-type with wide tracking for the
 *     category, tight tracking for the name. A category used to be a bordered
 *     chip, repeated twenty-four times, which made the least important thing on
 *     the card the loudest.
 *  5. NOTHING IS ADDED ON HOVER. The card does not gain an outline or lift. It
 *     reveals: the image scales a hair and the surface warms slightly. Hover that
 *     ADDS elements makes a calm page twitch.
 *  6. ZEROS ARE SHOWN. A channel with nothing published should look new, not
 *     broken. Hiding the counts would leave a card with no numbers at all, which
 *     reads as missing data.
 *
 * =============================================================================
 * WHY THE TAGLINE IS THE PROMOTED LINE
 * =============================================================================
 *
 * It did not exist before step 2 of channel creation. It is the one piece of text
 * a creator wrote ON PURPOSE to describe their channel, which makes it the most
 * honest thing on the card - and the reason a gallery of channels can be scanned
 * rather than merely looked at.
 *
 * Where there is no tagline, the handle takes the slot. The row is never left
 * blank: a gap reads as a loading failure, and a handle is always there.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { brandColor } from '@/lib/channel-brand';
import { channelTypeLabel } from '@/lib/channel-types';

export type PublicChannel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string;
  cover_url: string;
  logo_url?: string;
  tagline?: string;
  /** A NUMBER 0-359, never a colour string - see `lib/channel-brand.ts`. */
  brand_hue?: number | null;
  /** Absent for a channel created before the wizard existed. */
  channel_type?: string | null;
  created_at: string;
};

export type PublicChannelStats = {
  subscriber_count: number;
  video_count: number;
  reel_count: number;
  latest_thumbnail?: string | null;
  latest_upload_at?: string | null;
};

/** 1200 -> "1.2K", 1_500_000 -> "1.5M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function ChannelCard({
  channel,
  stats,
  priority,
}: {
  channel: PublicChannel;
  stats?: PublicChannelStats;
  /**
   * Set on the first few cards so the visible ones load eagerly.
   *
   * `loading="lazy"` on the first card means a visitor sees empty boxes while the
   * images they are actually looking at load. Only the ones above the fold earn
   * the bandwidth.
   */
  priority?: boolean;
}) {
  // The banner, else the newest published video's poster.
  //
  // That fallback is load-bearing: a creator who uploaded but never set a cover
  // was showing an empty grey box on their own channel, which reads as broken
  // rather than new. Their newest poster is the picture people recognise.
  const artwork = channel.cover_url || (stats?.latest_thumbnail as string | undefined);

  /*
    A URL that EXISTS IN THE DATABASE IS NOT A URL THAT LOADS.
    ========================================================

    Screenshotting the gallery showed a card rendering Chrome's broken-image glyph:
    the row said "2 uploads", so `latest_thumbnail` held a poster URL, and that
    object was not in storage. The card was displaying a torn-page icon at 16:10
    with a around it - which looks like a bug in the gallery, and is one.

    The cause is a real gap rather than bad data: `media_assets.poster_url` is a
    string with no guarantee that the object behind it still exists. An upload can
    be deleted from storage, a migration can rename a bucket, a restore can come
    back without blobs.

    So ANY image here can fail, and the fallback has to be unconditional - not
    "no URL" but "no URL OR the URL failed". `artworkFailed` is what turns the
    second case into the first, and the quiet field below is the answer.

    Without it, one dead poster on one channel is the most visually prominent thing
    on the whole page.
  */
  const [artworkFailed, setArtworkFailed] = useState(false);
  const showArtwork = Boolean(artwork) && !artworkFailed;

  // A card whose identity changes (React reuses the DOM node by key) must not keep
  // the previous card's failure. Resetting on the URL is the whole fix.
  useEffect(() => {
    setArtworkFailed(false);
  }, [artwork]);

  const accent = brandColor(channel.brand_hue);

  // Logo, else the legacy avatar, else initials.
  const mark = channel.logo_url || channel.image_url;

  // Same dead-URL problem as the artwork, and worse here: the mark is small and
  // sits beside the name, so a broken glyph lands directly in the most-read part of
  // the card. Falls back to the initial, which is what a channel without a picture
  // would have shown anyway.
  const [markFailed, setMarkFailed] = useState(false);
  useEffect(() => {
    setMarkFailed(false);
  }, [mark]);
  const showMark = Boolean(mark) && !markFailed;

  const category = channelTypeLabel(channel.channel_type ?? undefined);

  return (
    <Link
      href={`/channel/@${channel.handle}`}
      data-track={`gallery-card-${channel.handle}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset rounded-2xl"
    >
      <article className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-white/[0.022] transition-colors duration-500 group-hover:bg-white/[0.045]">
        {/*
          THE ACCENT: a 2px rule in the creator's own colour.

          Two pixels, at the very top, unmissable and unarguable. It is the only
          saturated thing in the card, which is why it works - an accent loses all
          its force the moment everything around it is also coloured.
        */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-10 h-[2px]"
          style={{ backgroundColor: accent }}
        />

        {/* ---- artwork ---- */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-white/[0.028]">
          {showArtwork ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artwork}
              alt=""
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              // A failed image falls back to the quiet field rather than showing a
              // broken-image glyph. See `artworkFailed` above for why this is not
              // an edge case.
              onError={() => setArtworkFailed(true)}
              className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.03]"
            />
          ) : (
            /*
              NO IMAGE, AND DELIBERATELY ALMOST NOTHING.
              ==========================================================

              The first version tinted the whole field with the creator's colour at
              14%. Screenshotting it was the argument against: a gallery where most
              channels have no cover became a wall of saturated blue, purple and
              magenta blocks - which is the opposite of minimal, and it made the ONE
              card with a real photograph (a night shot of the Eiffel Tower) the only
              quiet thing on screen. The accent had won by being everywhere.

              So the field is neutral, with the brand colour present only as a
              7% wash from the top - the same direction as the 2px rule, so the
              channel's colour reads as coming from above and the two accents are
              visibly one decision.

              An icon was tried and removed too: a glyph repeated in every empty
              slot turns a young gallery into a page of placeholders, and the point
              of a gallery is the work.

              `color-mix` needs a literal colour on the left, so `brandColor` is
              called here rather than reused from the `accent` variable above - which
              is a `backgroundColor` value, not a colour.
            */
            <div
              aria-hidden="true"
              className="h-full w-full"
              style={{
                backgroundImage: `linear-gradient(to bottom, ${brandColor(
                  channel.brand_hue
                )}14, transparent 62%)`,
              }}
            />
          )}
        </div>

        {/* ---- caption ---- */}
        <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
          <div className="flex items-start gap-3">
            {/*
              The mark is 28px and quiet.

              It was 40px inside a bordered avatar - a second focal point on a card
              whose focal point should be the artwork. Small, unbordered, and
              carrying the brand colour as a ring, it identifies without competing.
            */}
            {showMark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mark}
                alt=""
                loading={priority ? 'eager' : 'lazy'}
                decoding="async"
                onError={() => setMarkFailed(true)}
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                style={{ boxShadow: `0 0 0 1px ${accent}55` }}
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tracking-wide text-white/70"
                style={{ backgroundColor: accent }}
              >
                {channel.display_name.charAt(0).toUpperCase()}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-medium leading-snug tracking-tight text-white/95">
                {channel.display_name}
              </h3>
              <p className="truncate text-[12px] leading-snug text-white/35">
                @{channel.handle}
              </p>
            </div>
          </div>

          {/*
            Tagline, else description. NEVER the handle.

            The handle is already directly above this line, and the first version
            repeated it here whenever there was no tagline - so half the cards in the
            screenshot read:

                Cover Probe
                @btnp94fa
                @binp94fa          <- the same string, twice

            which looks like a rendering bug to anybody who spots it and like
            sloppiness to everybody who does not. Dropping the fallback is the whole
            fix; the "never leave a hole" reasoning that caused it was wrong,
            because a missing line reads as "this channel says nothing about itself"
            - which is TRUE, and is not the same as a failed load.

            Cards are equal height (`h-full` plus an `mt-auto` footer), so rows
            still align whether or not every card has a line here.
          */}
          {channel.tagline || channel.description ? (
            <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-white/45">
              {channel.tagline || channel.description}
            </p>
          ) : null}

          {/* ---- footer ---- */}
          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            {/*
              The category, as uppercase micro-type with wide tracking.

              It was a bordered chip, and a chip repeated twenty-four times is the
              loudest thing on the page - the category is the least useful fact
              about a channel once you are already looking at it. Setting it in small
              tracked-out caps makes it scannable instead of shouty.
            */}
            <span
              className={`min-w-0 truncate text-[10px] uppercase tracking-[0.14em] ${
                category ? 'text-white/40' : 'text-white/20'
              }`}
            >
              {category ?? 'Uncategorized'}
            </span>

            {/*
              Counts, always present.

              `tabular-nums` so a row of them lines up vertically down the grid.
              Proportional digits make "1.2K" wider than "820" and the column of
              numbers ends up ragged - which is the kind of thing that makes a
              considered layout look unconsidered.
            */}
            <span className="shrink-0 tabular-nums text-[11px] text-white/30">
              {formatCount(stats?.subscriber_count ?? 0)}
              <span className="text-white/20"> subs</span>
              {'  ·  '}
              {(stats?.video_count ?? 0) + (stats?.reel_count ?? 0)}
              <span className="text-white/20"> uploads</span>
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

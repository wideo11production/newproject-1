'use client';

/**
 * CHANNEL HEADER CARD - the full-width identity band.
 *
 * =============================================================================
 * THE SHAPE, FROM THE MOCKUP
 * =============================================================================
 *
 * A single rounded card. Inside it, one row of four LABELLED values:
 *
 *     Creator | Channel | Subscribers | Joined
 *     Alex Chen | Studio Creative | 1.2M | Jan 2024
 *
 * with the avatar on the left, overlapping the cover.
 *
 * =============================================================================
 * WHY THE VALUES ARE A GRID AND NOT A RUN OF TEXT
 * =============================================================================
 *
 * A run of text has to be read to be parsed. A grid of label-over-value cells can
 * be SCANNED: the eye jumps to the label it wants and reads one value, which is
 * the entire point of putting four facts side by side.
 *
 * Each label is also the only thing disambiguating its value - "Studio Creative"
 * on its own could be a channel, a creator or a title. That is why the label is
 * always rendered, even when the value is missing.
 *
 * =============================================================================
 * WHY A MISSING VALUE SAYS SO
 * =============================================================================
 *
 * "Unknown" rather than a dash or a blank: a blank cell reads as a rendering bug,
 * and a dash reads as "none". "Unknown" reads as "we do not know", which is the
 * truth, and it keeps the row's height stable while the data loads.
 */

import { Users } from 'lucide-react';
import { brandHsl } from '@/lib/channel-brand';

import {
  productCoverFade,
  productPanel,
  productSunken,
  productTextMuted,
  productTextSubtle,
} from '@wideo11/ui/design-system';

export interface ChannelHeaderCardProps {
  /** Channel display name, shown as the Channel value. */
  displayName?: string;
  /** @handle. */
  handle?: string;
  /** The creator behind it. Falls back to the channel name. */
  creator?: string;
  /** Formatted subscriber count; formatted by the caller. */
  subscribers?: string;
  /** Already-formatted date string, e.g. "Jan 2024". */
  joined?: string;
  /** Cover image URL. */
  coverUrl?: string | null;
  /** Avatar / logo URL. Logo first, legacy avatar second. */
  avatarUrl?: string | null;
  /** Step-2 brand hue, for the gradient fallback when there is no cover. */
  brandHue?: number | null;
  /** Channel type chip. */
  channelType?: string | null;
  /** Right-side actions, e.g. the subscribe button. */
  actions?: React.ReactNode;
}

/** A missing fact, said plainly. */
const UNKNOWN = 'Unknown';

/**
 * The one locale and one timezone every date in the product renders in.
 *
 * Server and client MUST agree, or React throws a hydration mismatch (#300) and
 * unmounts the whole tree. Pinned to UTC so the value does not depend on where
 * the code happens to run, and to en-US so month names do not vary by browser.
 *
 * Any component that formats a date for display uses these two, never
 * `undefined`. That is the bug this file exists to prevent.
 */
const FIXED_LOCALE = 'en-US';
const FIXED_TIMEZONE = 'UTC';

export function ChannelHeaderCard({
  displayName,
  handle,
  creator,
  subscribers,
  joined,
  coverUrl,
  avatarUrl,
  brandHue,
  channelType,
  actions,
}: ChannelHeaderCardProps) {
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Creator', value: creator || displayName || UNKNOWN },
    { label: 'Channel', value: displayName || UNKNOWN },
    { label: 'Subscribers', value: subscribers || '0' },
    { label: 'Joined', value: joined || UNKNOWN },
  ];

  return (
    <section
      className={`relative overflow-hidden rounded-2xl ${productPanel} shadow-lg shadow-black/30`}
      data-channel-header=""
    >
      {/* cover - a shorter band than a banner, because it sits inside a card that
          also carries the identity row below it */}
      <div className="relative h-28 w-full sm:h-36">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: `linear-gradient(120deg, ${brandHsl(brandHue)}, transparent 70%)`,
            }}
          />
        )}
        {/* Fades the cover into the card so the identity row is not a hard seam */}
        <div className={`absolute inset-0 ${productCoverFade}`} />
      </div>

      {/* identity row */}
      <div className="relative -mt-10 flex flex-wrap items-end gap-4 px-4 pb-4 sm:-mt-12 sm:px-5">
        {/* avatar, overlapping the cover */}
        <div className={`h-16 w-16 shrink-0 overflow-hidden rounded-2xl ${productSunken} ring-4 ring-[#16181d] sm:h-20 sm:w-20`}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className={`flex h-full w-full items-center justify-center text-xl font-semibold ${productTextSubtle} sm:text-2xl`}>
              {(displayName ?? '?').slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        {/* The four labelled values. Equal columns, not auto width, so the row
            stays aligned when one value is long and another is a single digit. */}
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className={`text-[9px] font-semibold uppercase tracking-wider ${productTextMuted}`}>
                {s.label}
              </dt>
              <dd className="mt-0.5 truncate text-xs font-medium text-white sm:text-sm" title={s.value}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        {handle ? (
          <span className={`hidden text-[11px] ${productTextMuted} lg:inline`}>@{handle}</span>
        ) : null}

        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

/** Formats a subscriber count the way the mockup shows it: 1.2M, 12K, 340. */
export function formatSubscribers(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

/**
 * "Jan 2024" - the mockup's own granularity, without a day nobody needs.
 *
 * ---- YE HYDRATION MATCH HOTA THA ----
 *
 * `toLocaleDateString(undefined, ...)` lets each side pick its OWN locale, and
 * the server (a UTC container) and the client (a viewer's local timezone) can
 * then disagree about which month a date falls in. React reports that as error
 * #300 and tears down the whole tree - so a date in a header took the entire
 * upload page's client runtime with it.
 *
 * Fixed by pinning the locale and the timezone. The month/year pair is now
 * computed identically everywhere, so server and client agree byte for byte.
 */
export function formatJoined(date: string | Date | null | undefined): string {
  if (!date) return UNKNOWN;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  return d.toLocaleDateString(FIXED_LOCALE, {
    month: 'short',
    year: 'numeric',
    timeZone: FIXED_TIMEZONE,
  });
}

/** The subscribers cell's icon, exported so a caller can render it beside the row. */
export function SubscribersIcon() {
  return <Users className="h-3 w-3" aria-hidden="true" />;
}

'use client';

// A channel's page: its banner, identity, and its published videos and reels.
//
// A Client Component because it has tabs and fetches per tab. The route file
// stays a server component, so the shell renders on the server.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Play } from 'lucide-react';
import { channelTypeLabel } from '@/lib/channel-types';
import { brandHsl } from '@/lib/channel-brand';

type Channel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string;
  cover_url: string;
  channel_type?: string | null;

  // ---- Step 2 branding (migration 022) ----
  //
  // PUBLIC by design, and returned by `PublicChannelResponse` deliberately: a
  // tagline, a logo and a colour are the creator's own content, and they are the
  // entire point of a channel page.
  //
  // `brand_hue` is a NUMBER and not a colour string, so this component cannot
  // build arbitrary CSS from it - it indexes a palette. See `channel-brand.ts`.
  logo_url?: string;
  tagline?: string;
  brand_hue?: number | null;
};

type Media = {
  id: string;
  kind: 'video' | 'reel';
  filename: string;
  duration_seconds: number;
  width: number;
  height: number;
  poster_url?: string | null;
};

// `CATEGORY_LABELS` used to live here, as a FOURTH copy of the closed set.
//
// It is replaced by `channelTypeLabel` from `@/lib/channel-types`, and the reason
// is concrete rather than tidy: this copy contained
//
//     other: 'Other'
//
// which is NOT in `model.ValidChannelType`, not in migration 018's CHECK
// constraint, and not in the wizard's picker. So it was a label for a category
// that cannot exist, invented by a file that never checked.
//
// That is exactly the failure that happens when a closed set is copied N times:
// each copy is individually reasonable, and the set quietly diverges. The list now
// has one file, and `tools/check-channel-lists.mjs` compares it against the
// Go map and the SQL constraint.

/** 95 -> "1:35", 3725 -> "1:02:05" */
function duration(s: number): string {
  if (!s || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

type Tab = { key: '' | 'video' | 'reel'; label: string };

export default function ChannelPageClient({ handle }: { handle: string }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  // TWO errors, not one, and the split matters.
  //
  // The first version shared a single `loadError` and let the MEDIA fetch write
  // to it. So a failure to list videos replaced the whole page with an error box
  // and the channel's name, banner and description all disappeared - because a
  // list request 404'd. The channel is the page; the media is a panel on it, and
  // a broken panel must not take the page with it.
  const [channelError, setChannelError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [media, setMedia] = useState<Media[] | null>(null);
  const [tab, setTab] = useState<'' | 'video' | 'reel'>('');

  // ---- the channel itself ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/channels/${encodeURIComponent(handle)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          // The same message for "no such channel" and "private channel",
          // because the service already answers both with one status, and
          // distinguishing them here would undo that.
          setChannelError(data?.message ?? 'Channel not found.');
          return;
        }
        setChannel(data.channel ?? null);
      } catch {
        if (!cancelled) setChannelError('Network error. Could not load this channel.');
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  // ---- the media, refetched per tab ----
  useEffect(() => {
    let cancelled = false;
    setMedia(null);
    setMediaError(null);
    (async () => {
      try {
        const kind = tab ? `?kind=${tab}` : '';
        const res = await fetch(
          `/api/public/channels/${encodeURIComponent(handle)}/media${kind}`,
          { cache: 'no-store' }
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setMediaError(data?.message ?? 'Could not load this channel\'s videos.');
          return;
        }
        setMedia(Array.isArray(data.media) ? data.media : []);
      } catch {
        if (!cancelled) setMediaError('Network error.');
      }
    })();
    return () => { cancelled = true; };
  }, [handle, tab]);

  if (channelError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{channelError}</span>
        <Link href="/channels" className="ml-2 underline underline-offset-2">
          Browse all channels
        </Link>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="space-y-4">
        <div className="h-40 w-full animate-pulse rounded-lg bg-gray-900/60" />
        <div className="h-6 w-48 animate-pulse rounded-md bg-gray-900/60" />
      </div>
    );
  }

  const tabs: Tab[] = [
    { key: '', label: 'Home' },
    { key: 'video', label: 'Videos' },
    { key: 'reel', label: 'Shorts' },
  ];

  // The resolved colour, once, so every use on this page agrees.
  const brand = brandHsl(channel.brand_hue);
  // Logo first, legacy avatar second. `image_url` predates step 2 and is still
  // what most channels have, so falling back to it means adding a logo is an
  // upgrade rather than a requirement.
  const avatar = channel.logo_url || channel.image_url;

  return (
    <div>
      {/* ---- banner ----
          The brand colour is painted UNDERNEATH the cover, so a channel with a
          dark or empty banner still reads as having an identity rather than as a
          grey gap. That is the reason the colour is here and not only on the
          avatar ring. */}
      <div
        className="h-32 w-full overflow-hidden rounded-lg sm:h-40"
        style={{ backgroundColor: `hsl(${brand})` }}
      >
        {channel.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.cover_url}
            alt=""
            data-track="channel-cover"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="mt-4 flex items-start gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            data-track="channel-avatar"
            className="h-16 w-16 shrink-0 rounded-full border-2 object-cover"
            style={{ borderColor: `hsl(${brand})` }}
          />
        ) : (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-xl font-semibold text-white"
            style={{ backgroundColor: `hsl(${brand})`, borderColor: `hsl(${brand})` }}
          >
            {channel.display_name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-ink">
            {channel.display_name}
          </h1>
          {/* Tagline OR handle, never both stacked.

              A tagline is a tagline: one line that says what the channel is. Putting
              "@handle" underneath it as well makes the tagline a subtitle of a
              subtitle, and the tagline is the part a visitor came for. */}
          <p className="text-sm text-gray-400">
            {channel.tagline ? channel.tagline : `@${channel.handle}`}
          </p>
          {channel.channel_type ? (
            <span className="mt-1 inline-block rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
              {channelTypeLabel(channel.channel_type) ?? channel.channel_type}
            </span>
          ) : null}
          {channel.description ? (
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              {channel.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* ---- tabs ---- */}
      <div role="tablist" aria-label="Channel content" className="mt-6 flex gap-1 border-b border-gray-800">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key || 'home'}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2 text-sm transition-colors ${
                active
                  ? 'border-blue-500 text-ink'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ---- the grid ---- */}
      <div className="mt-5">
        {mediaError ? (
          // Shown HERE, inside the panel, so the channel's own identity stays on
          // screen. A list that failed to load is not a broken page.
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 p-4 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{mediaError}</span>
          </div>
        ) : media === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-900/60" />
            ))}
          </div>
        ) : media.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 p-10 text-center">
            <Play className="mx-auto h-6 w-6 text-gray-500" aria-hidden="true" />
            <p className="mt-3 text-sm text-ink">
              {tab === 'reel' ? 'No shorts yet' : tab === 'video' ? 'No videos yet' : 'Nothing published yet'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Uploads appear here once they finish processing.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {media.map((m) => (
              <div key={m.id} className="group">
                <div className="relative overflow-hidden rounded-lg bg-gray-900/60">
                  {m.poster_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.poster_url}
                      alt=""
                      className="aspect-video w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center">
                      <Play className="h-6 w-6 text-gray-600" aria-hidden="true" />
                    </div>
                  )}
                  {m.duration_seconds > 0 ? (
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] text-white">
                      {duration(m.duration_seconds)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs text-gray-300">{m.filename}</p>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  {m.kind === 'reel' ? 'Short' : 'Video'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

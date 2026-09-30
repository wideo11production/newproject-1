'use client';

/**
 * PUBLIC CHANNEL GRID
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
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@wideo11/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@wideo11/ui/avatar';
import { Skeleton } from '@wideo11/ui/skeleton';
import { AlertCircle, Youtube } from 'lucide-react';

type PublicChannel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string;
  cover_url: string;
  created_at: string;
};

export default function ChannelGrid() {
  const [channels, setChannels] = useState<PublicChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/public/channels?limit=24', {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.message ?? 'Could not load channels.');
          return;
        }
        setChannels(Array.isArray(data.channels) ? data.channels : []);
      } catch {
        if (!cancelled) {
          setError('Network error. Could not load channels.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Loading ----
  if (channels === null && !error) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="border-gray-800 bg-gray-900/50">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center space-x-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  // ---- Genuine empty state ----
  if (!channels || channels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 p-10 text-center">
        <Youtube className="mx-auto h-7 w-7 text-gray-500" aria-hidden="true" />
        <p className="mt-3 text-sm text-ink">No public channels yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Channels appear here once their owner makes them public.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {channels.map((channel) => (
        <Card
          key={channel.id}
          className="overflow-hidden border-gray-800 bg-gray-900/50"
        >
          {/* 16:9 cover banner */}
          {channel.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={channel.cover_url}
              alt=""
              className="aspect-video w-full object-cover"
            />
          ) : null}

          <CardContent className="p-4">
            <div className="mb-3 flex items-center space-x-3">
              <Avatar className="h-10 w-10">
                {channel.image_url ? (
                  <AvatarImage src={channel.image_url} alt="" />
                ) : null}
                <AvatarFallback>
                  {channel.display_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="truncate font-medium text-ink">
                  {channel.display_name}
                </h3>
                <p className="truncate text-xs text-gray-500">@{channel.handle}</p>
              </div>
            </div>
            {channel.description ? (
              <p className="line-clamp-2 text-sm text-gray-400">
                {channel.description}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

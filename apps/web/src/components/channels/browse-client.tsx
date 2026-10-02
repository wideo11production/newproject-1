'use client';

// The interactive half of the browse page: the filter row, and the state that
// decides what the grid shows.
//
// A separate Client Component so `page.tsx` stays a SERVER component and keeps
// server-rendering its heading. `tsc --noEmit` does NOT catch a hook used in a
// server component - only `next build` does - so the first attempt failed at
// build time pointing at an import rather than at the missing `'use client'`.
//
// =============================================================================
// WHAT THIS OWNS, AND WHAT IT DOES NOT
// =============================================================================
//
// It owns the FILTER STATE and nothing else.
//
// It used to also own the grid element - the columns and the gap - while the grid
// component owned the cards. So changing the gallery's rhythm meant editing this
// file and `channel-grid.tsx` and hoping the two agreed about how wide a card is.
// The grid container now lives with the grid.
//
// The grid stays `dynamic(..., { ssr: false })`, deliberately: the browse page is
// PUBLIC and this app's login wall would otherwise be the first thing an
// anonymous visitor meets on a page whose whole job is to be shareable. That is a
// genuine trade - it costs a flash of the skeleton - and the alternative is a
// public API behind a page nobody can reach without an account.

import { useState } from 'react';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import ChannelFilter from './channel-filter';

const LazyChannelGrid = dynamic(() => import('./channel-grid'), { ssr: false });

export default function BrowseClient() {
  // A plain state filter, not a router query. Every chip click becoming a
  // navigation is a worse trade than a filtered view not being shareable - and a
  // shared link that silently drops the filter is worse than no link.
  const [type, setType] = useState('');

  return (
    <>
      <ChannelFilter value={type} onChange={setType} />

      {/*
        The gap below the filter is 12 (3rem), not the grid's own `gap-y-14`.

        The filter's own hairline already separates it from what follows, so the
        vertical space here is doing a second, quieter job: it lets the eye register
        "these are the controls, that is the result". Too little and the row reads
        as a caption for the grid; too much and the page opens like a slide.
      */}
      <div className="mt-12">
        <Suspense fallback={null}>
          <LazyChannelGrid type={type} />
        </Suspense>
      </div>
    </>
  );
}

'use client';

/**
 * DISCOVER SIDEBAR - the vertical tab rail on the video page.
 *
 * =============================================================================
 * WHY IT IS TABS AND NOT A DROPDOWN
 * ===========================================================================
 *
 * The mockup shows a vertical rail of icons, and there is a reason beyond looks:
 * the tabs are how someone answers "show me only the vertical clips". A dropdown
 * hides all but one option at a time, which means the viewer has to open it to
 * learn what exists, and it closes on selection - so switching between two tabs is
 * two clicks and a menu animation every time.
 *
 * A rail shows every category at once, one click each.
 *
 * =============================================================================
 * WHAT EACH TAB ACTUALLY FILTERS
 * ===========================================================================
 *
 * Every tab is a predicate over the rows the page already has. None of them is a
 * separate endpoint call, and none of them needs to be: the public media list is
 * loaded once, and the tabs are views over it.
 *
 * The four that are cuts of the same material:
 *
 *	VERTICAL / HORIZONTAL - orientation, from the stored width and height. This is
 *	    the question a creator actually asks, and a reel and a portrait video are the
 *	    same pixels.
 *	SHORT / LONG REELS    - both `reel`, split on duration. The platform's reel
 *	    budget is 90 s, so 60 s is the boundary that separates "a reel" from "a long
 *	    one" without being arbitrary.
 *
 * ===========================================================================
 * WHY THE COUNTS ARE ON THE SERVER
 * ======================================================================
 *
 * A count is what makes a tab worth clicking. It is computed by the page from the
 * rows it already holds, so it is exact for what the viewer is looking at rather
 * than an estimate from a second query.
 */

import { LayoutGrid, Video, Film, Smartphone, Monitor, Music, Clapperboard } from 'lucide-react';

import {
  productAccent,
  productBrandGradient,
  productPanel,
  productPanelHover,
  productTextMuted,
  productTextSubtle,
} from '@wideo11/ui/design-system';

export type DiscoverTab =
  | 'all'
  | 'videos'
  | 'reels'
  | 'short-reels'
  | 'long-reels'
  | 'vertical'
  | 'horizontal'
  | 'audio';

interface TabDef {
  id: DiscoverTab;
  label: string;
  icon: typeof LayoutGrid;
  /** Short label for the icon-only tooltip. */
  hint: string;
}

const TABS: TabDef[] = [
  { id: 'all', label: 'All', icon: LayoutGrid, hint: 'All media' },
  { id: 'videos', label: 'Videos', icon: Video, hint: 'Long-form videos' },
  { id: 'reels', label: 'Reels', icon: Film, hint: 'All reels' },
  { id: 'short-reels', label: 'Short Reels', icon: Clapperboard, hint: 'Reels under a minute' },
  { id: 'long-reels', label: 'Long Reels', icon: Film, hint: 'Reels a minute or longer' },
  { id: 'vertical', label: 'Vertical', icon: Smartphone, hint: 'Portrait clips' },
  { id: 'horizontal', label: 'Horizontal', icon: Monitor, hint: 'Landscape clips' },
  { id: 'audio', label: 'Audio', icon: Music, hint: 'Audio tracks' },
];

/** The 60 s boundary between a short reel and a long one. */
export const REEL_LONG_SECONDS = 60;

/** A media row, reduced to what the tabs need to decide. */
export interface DiscoverMedia {
  kind?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
}

export function matchesTab(item: DiscoverMedia, tab: DiscoverTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'videos':
      return item.kind === 'video';
    case 'reels':
      return item.kind === 'reel';
    case 'audio':
      return item.kind === 'audio';
    case 'short-reels':
      return item.kind === 'reel' && (item.duration_seconds ?? 0) < REEL_LONG_SECONDS;
    case 'long-reels':
      return item.kind === 'reel' && (item.duration_seconds ?? 0) >= REEL_LONG_SECONDS;
    case 'vertical':
      return item.kind !== 'audio' && (item.height ?? 0) > (item.width ?? 0);
    case 'horizontal':
      return item.kind !== 'audio' && (item.width ?? 0) > (item.height ?? 0);
    default:
      return false;
  }
}

interface DiscoverSidebarProps {
  active: DiscoverTab;
  onSelect: (tab: DiscoverTab) => void;
  /** Per-tab counts, exact for the loaded page. */
  counts?: Partial<Record<DiscoverTab, number>>;
}

export function DiscoverSidebar({ active, onSelect, counts }: DiscoverSidebarProps) {
  return (
    <nav
      aria-label="Media categories"
      className="hidden w-[72px] shrink-0 flex-col gap-1 lg:flex"
      data-discover-sidebar=""
    >
      {TABS.map(({ id, label, icon: Icon, hint }) => {
        const on = active === id;
        const count = counts?.[id];
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            aria-label={hint}
            title={count === undefined ? hint : `${hint} — ${count}`}
            className="group flex flex-col items-center gap-1 rounded-xl py-2 transition-colors"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                on
                  ? `${productBrandGradient}`
                  : `${productPanel} ${productTextMuted} group-${productPanelHover} group-hover:text-white`
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span
              className={`text-[9px] font-medium leading-none ${
                on ? `${productAccent}` : `${productTextMuted} group-hover:text-white`
              }`}
            >
              {label}
            </span>
            {typeof count === 'number' ? (
              <span className={`text-[8px] tabular-nums ${productTextSubtle}`}>{count}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

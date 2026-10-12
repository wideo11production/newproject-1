'use client';

/**
 * STUDIO SIDEBAR - the full media-category rail.
 *
 * =============================================================================
 * WHY IT IS A SIDEBAR AND NOT A THIN RAIL
 * =============================================================================
 *
 * A thin rail of icons needs the viewer to already know what each icon means. This
 * one has seven destinations and they are NOT all media-like - LONG REELS, SHORT
 * REELS, HORIZONTAL and VERTICAL are four different cuts of the same clips, and
 * no icon can say that. Labels can.
 *
 * So: icon + label, and the active item is a filled pill in the accent colour. That
 * makes "what am I looking at" answerable by a glance rather than by a click.
 *
 * =============================================================================
 * WHAT THE CATEGORIES ACTUALLY FILTER
 * =============================================================================
 *
 * Every item maps to a predicate over the CLIPS, not to a separate endpoint. Four of
 * them are cuts of the same material:
 *
 *   LONG / SHORT REELS  - both `reel`, split on duration. The platform's reel
 *                         budget is 90 s, so 60 s is the line that separates
 *                         "a reel" from "a long one" without being arbitrary.
 *   HORIZONTAL / VERTICAL- orientation, from the stored width and height. This is
 *                         the question a creator actually asks ("what do I have in
 *                         portrait?") and it needs no catalogue endpoint to answer.
 *
 * That is also why the filter runs client-side: a category that is a predicate over
 * rows the page already has does not need a round trip, and a round trip per click
 * is a spinner between the viewer and the thing they clicked.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Video,
  Film,
  RectangleHorizontal,
  RectangleVertical,
  Music,
  type LucideIcon,
} from 'lucide-react';

export type MediaCategory =
  | 'all'
  | 'video'
  | 'reel-long'
  | 'reel-short'
  | 'horizontal'
  | 'vertical'
  | 'audio';

interface CategoryDef {
  id: MediaCategory;
  label: string;
  icon: LucideIcon;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'all', label: 'All Media', icon: LayoutGrid },
  { id: 'video', label: 'Videos', icon: Video },
  { id: 'reel-long', label: 'Long Reels', icon: Film },
  { id: 'reel-short', label: 'Short Reels', icon: Film },
  { id: 'horizontal', label: 'Horizontal', icon: RectangleHorizontal },
  { id: 'vertical', label: 'Vertical', icon: RectangleVertical },
  { id: 'audio', label: 'Audio Files', icon: Music },
];

/** The 60 s line between a reel and a long one. */
export const REEL_LONG_SECONDS = 60;

/** A media row, reduced to what the categories need to decide. */
export interface MediaCategoryInput {
  kind?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
}

/**
 * Does this clip belong in this category?
 *
 * The two orientation categories are the only ones that can both apply to the
 * same clip, so they are checked against the REAL dimensions rather than against
 * `kind` - a reel stored as 9:16 and a portrait video are the same pixels.
 */
export function matchesCategory(clip: MediaCategoryInput, category: MediaCategory): boolean {
  switch (category) {
    case 'all':
      return true;
    case 'video':
      return clip.kind === 'video';
    case 'audio':
      return clip.kind === 'audio';
    case 'reel-long':
      return clip.kind === 'reel' && (clip.duration_seconds ?? 0) >= REEL_LONG_SECONDS;
    case 'reel-short':
      return clip.kind === 'reel' && (clip.duration_seconds ?? 0) < REEL_LONG_SECONDS;
    case 'horizontal':
      return (clip.width ?? 0) > (clip.height ?? 0) && clip.kind !== 'audio';
    case 'vertical':
      return (clip.height ?? 0) > (clip.width ?? 0) && clip.kind !== 'audio';
    default:
      return false;
  }
}

interface StudioSidebarProps {
  active: MediaCategory;
  onSelect: (category: MediaCategory) => void;
  /** Per-category counts, so a category can show how much is in it. */
  counts?: Partial<Record<MediaCategory, number>>;
  homeHref?: string;
}

export function StudioSidebar({ active, onSelect, counts, homeHref = '/dashboard' }: StudioSidebarProps) {
  const pathname = usePathname();
  const isHome = pathname === homeHref || pathname.startsWith(`${homeHref}/`);

  return (
    <nav
      aria-label="Media categories"
      className="hidden w-[132px] shrink-0 flex-col gap-0.5 lg:flex"
      data-studio-sidebar=""
    >
      {/* brand tile */}
      <Link
        href={homeHref}
        aria-label="Wideo11 home"
        aria-current={isHome ? 'page' : undefined}
        className={`mb-2 flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-lg transition-transform hover:scale-105 ${
          isHome ? 'bg-gradient-to-br from-[#ff6500] to-[#c2410c] shadow-[#ff6500]/30' : 'bg-[#16181d] shadow-black/30'
        }`}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
      </Link>

      {CATEGORIES.map(({ id, label, icon: Icon }) => {
        const on = active === id;
        const count = counts?.[id];
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            title={label}
            className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
              on
                ? 'bg-gradient-to-r from-[#ff6500]/25 to-[#ff6500]/5 text-[#ff6500]'
                : 'text-[#8b949e] hover:bg-[#16181d] hover:text-white'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                on ? 'bg-[#ff6500]/20' : 'bg-[#16181d] group-hover:bg-[#1f2227]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[9px] font-semibold uppercase leading-tight tracking-wide">
                {label}
              </span>
            </span>
            {typeof count === 'number' ? (
              <span className="shrink-0 text-[9px] tabular-nums text-[#5a6066]">{count}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * ============================================================================
 * CONTENT ROW - horizontal scrollable tile row (Prime Video style)
 * ============================================================================
 *
 * PURPOSE:
 *   "Trending Wideos", "Highest Earnings Today", "New Creator Channels" - teen
 *   horizontal rows, jaise Amazon Prime Video ka browse page dikhata hai.
 *
 * SCROLL BEHAVIOUR:
 *   - Horizontal scroll with snap (Prime Video jaisa)
 *   - Scrollbar hidden visually (custom thumb nahin - native smooth scroll
 *     + snap points kaafi hain)
 *   - Prev/Next arrow buttons - smooth `scrollBy` se ek "page" move karte hain
 *   - Mobile pe swipe, desktop pe arrows dono kaam karte hain
 *
 * RESPONSIVE (twMerge discipline):
 *   - Tile width: chhote screen pe chhota, bade pe bada
 *   - `min-w` + `max-w` + `shrink-0` ensure karta hai ki tiles kabhi
 *     squeeze na ho (Prime Video tiles kabhi stretch nahi hote, scroll hote hain)
 *   - Row wrapper `w-full` + `overflow-x-auto` - kabhi parent se overflow na ho
 *
 * NO EXTERNAL ASSETS:
 *   - Thumbnails MINIO se (`thumbUrl`) - optional
 *   - Agar thumbnail na ho to branded gradient fallback (in-house colors)
 *   - Koi CDN, koi remote image nahi
 *
 * Hinglish comments: har block ka arth
 */

'use client';

import { useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, TrendingUp, Wallet, Users } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';
import type { PoolRow, PoolTile } from '@/lib/landing/ad-pool';

/**
 * Row ke liye icon map - title se match karke.
 * NOTE: Exact title match (case-insensitive). Agar title change ho to
 * fallback `null` hoga aur generic icon dikhega.
 */
function rowIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes('trending')) return TrendingUp;
  if (t.includes('earning')) return Wallet;
  if (t.includes('channel') || t.includes('creator')) return Users;
  return null;
}

export interface ContentRowProps {
  row: PoolRow;
  className?: string;
}

export default function ContentRow({ row, className }: ContentRowProps) {
  // Scroll container ka ref - scrollBy karne ke liye
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Row icon (title-based) - null ho sakta hai
  const Icon = rowIcon(row.title);

  /**
   * scrollBy wrapper - ek "viewport" ka move.
   *
   * `behavior: 'smooth'` - animated scroll (Prime Video jaisa feel).
   * Amount = container ka 80% width - isse ek saath ~4-5 tiles move hote
   * hain, jo user-friendly hai (ek tile nahi, poora page shift).
   */
  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    // 80% width ka move karo
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  }, []);

  return (
    <section className={cn('w-full', className)} aria-label={row.title}>
      {/* ---- ROW HEADER (title + optional subtitle) ---- */}
      <div className="mb-3 flex items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#d8d9da]">
            {/* Row icon - title-based, optional */}
            {Icon ? <Icon className="h-5 w-5 text-[#5794f2]" aria-hidden="true" /> : null}
            {row.title}
          </h3>
          {/* Optional subtitle */}
          {row.subtitle ? (
            <p className="mt-0.5 text-xs text-[#9fa7b3]">{row.subtitle}</p>
          ) : null}
        </div>

        {/* ---- NAV ARROWS (desktop only) ----
            Mobile pe swipe kaafi hai, arrows chhote screens me redundant
            hain - isliye `hidden sm:flex`. */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <button
            type="button"
            onClick={() => scrollByPage(-1)}
            aria-label={`Scroll ${row.title} left`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2c3235] text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            aria-label={`Scroll ${row.title} right`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2c3235] text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ---- TILE SCROLL STRIP ----
          `overflow-x-auto` + `snap-x` + `snap-mandatory` = Prime Video
          snap feel. `pb-2` scrollbar ke liye thoda gap (scrollbar hidden
          hai visually par space chhodte hain taaki clip na ho).

          Scrollbar hide: `[scrollbar-width:none]` (Firefox) +
          `[&::-webkit-scrollbar]:hidden` (WebKit) via arbitrary variants. */}
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {row.tiles.map((tile) => (
          <ContentTile key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  );
}

/**
 * CONTENT TILE - ek video/channel card.
 *
 * SEPARATE component (HeroCarousel ke andar nahi) taaki:
 *   - Reusable ho (future me aur jagah use)
 *   - Apna memoization le sake (performance)
 *
 * RESPONSIVE WIDTH:
 *   `w-[160px] sm:w-[200px] lg:w-[240px]` - Prime Video tile proportions
 *   (roughly 1.6:1 poster ratio). `shrink-0` zaroori hai - colori flex me
 *   tile squeeze ho jayegi, scroll nahi hoga.
 */
function ContentTile({ tile }: { tile: PoolTile }) {
  // ---- SHARED PRESENTATION ----
  // Poster area + text body ek hi layout hai, chahe tile link ho ya na ho.
  // Isliye inhe ek inner fragment me rakhte hain aur dono branches me reuse
  // karte hain - isse duplication nahi hoti.
  //
  // NOTE (twMerge discipline): `cn()` har branch me call hota hai, taaki
  // hover/transition classes consistent rahein aur koi duplicate utility
  // na bane jab future me extra classes pass kiye jaayein.
  const poster = (
    <div className="relative w-full pb-[56.25%] overflow-hidden">
      {/* Thumbnail (MinIO) - agar available */}
      {tile.thumbUrl ? (
        <img
          src={tile.thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        /* Branded gradient fallback - thumb nahi ho to ye. Accent color
           se banaya, in-house only. */
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${tile.accent ?? '#5794f2'}40 0%, #111217 100%)`,
          }}
        />
      )}

      {/* Highlight badge (e.g. "₹3,180" for earnings row) - top-left */}
      {tile.highlight ? (
        <span className="absolute left-1.5 top-1.5 rounded bg-[#111217]/85 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#73bf69] backdrop-blur">
          {tile.highlight}
        </span>
      ) : null}
    </div>
  );

  // Tile text block - title (2-line clamp) + optional meta
  const body = (
    <div className="p-2.5">
      <p className="line-clamp-2 text-xs font-medium leading-snug text-[#d8d9da]">
        {tile.title}
      </p>
      {/* Optional meta (views / channel type) */}
      {tile.meta ? <p className="mt-1 text-[10px] text-[#9fa7b3]">{tile.meta}</p> : null}
    </div>
  );

  // Shared tile shell classes - dono branches identical
  const shellClass = cn(
    'group relative block w-[160px] shrink-0 snap-start overflow-hidden rounded-lg border border-[#2c3235] bg-[#181b1f] transition-colors hover:border-[#5794f2]/50 sm:w-[200px] lg:w-[240px]'
  );

  // ---- BRANCH A: tile has an internal route -> render a <Link> ----
  // NOTE: pehle maine ek polymorphic `Wrapper` variable try kiya tha
  // (`const Wrapper = tile.href ? Link : 'div'`), lekin TS us union pe
  // `href?: undefined` vs `href: Url` ka mismatch de raha tha (Link ka
  // `href` required hai). Isliye ab explicit branches hain - type-safe
  // AUR markup identical rahta hai. 500 lines ka polymorphic-wrapper
  // gymnastics se behtar hai.
  if (tile.href) {
    return (
      <Link
        href={tile.href}
        className={cn(shellClass, 'cursor-pointer')}
      >
        {poster}
        {body}
      </Link>
    );
  }

  // ---- BRANCH B: no route -> render a plain <div> ----
  return (
    <div className={shellClass}>
      {poster}
      {body}
    </div>
  );
}

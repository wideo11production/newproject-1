/**
 * ============================================================================
 * LANDING SHELL - client boundary wrapper (hero + content rows)
 * ============================================================================
 *
 * WHY A SEPARATE CLIENT COMPONENT:
 *   `page.tsx` ek SERVER Component hai (zero client JS for static parts). Lekin
 *   do cheezein client-side chahiye:
 *     1. Autoplay carousel (state + timers) - must be client
 *     2. localStorage overlay read (in-house ad pool) - must be client
 *   Isliye ye wrapper alag hai: page.tsx server rehta hai, sirf ye subtree
 *   client JS leta hai.
 *
 * HYDRATION STRATEGY (no-mismatch guarantee - important):
 *   Server pe `initialPool` (SEED_POOL) prop se render hota hai.
 *   Client pe bhi PEHLE render `initialPool` hi hota hai (state initialized
 *   from prop). LocalStorage overlay `useEffect` me - jo hydration ke BAAD
 *   chalta hai - merge hota hai.
 *
 *   Iska matlab: server HTML aur first client render BYTE-IDENTICAL hain
 *   (koi hydration mismatch warning nahi). Phir effect chalta hai aur appended
 *   in-house creatives appear ho jaate hain.
 *
 * LOCAL STORAGE SAFETY:
 *   `mergePool()` already SSR-guarded hai (server pe null return). Par hum yahan
 *   `useEffect` me hi call karte hain - to browser-only guarantee bhi mil jata
 *   hai aur koi edge case me crash nahi hoga.
 *
 * Hinglish comments: har block ka arth
 */

'use client';

import { useEffect, useState } from 'react';
import { cn } from '@wideo11/ui/lib/utils';
import HeroCarousel from '@/components/landing/hero-carousel';
import ContentRow from '@/components/landing/content-row';
import { mergePool, type AdPool } from '@/lib/landing/ad-pool';

export interface LandingShellProps {
  /**
   * Server-resolved initial pool (SEED_POOL).
   * Ye first render ka source hai - server aur client dono same use karte
   * hain, isliye hydration safe hai.
   */
  initialPool: AdPool;
  className?: string;
}

export default function LandingShell({ initialPool, className }: LandingShellProps) {
  // ---- Pool state ----
  // Initialized from prop (= seed). Overlay BAAD me apply hota hai.
  const [pool, setPool] = useState<AdPool>(initialPool);

  /**
   * Local storage overlay merge - browser me, hydration ke baad.
   *
   * Ye `useEffect` chalta hai client-side, isliye:
   *   - Server render safe hai (effect server pe nahi chalta)
   *   - Pehle client render = initialPool (matches server) = no mismatch
   *   - Phir effect chalta hai -> appended creatives load hote hain
   *
   * `mergePool()` internally seed + overlay combine karta hai aur duplicates
   * filter karta hai (see ad-pool.ts).
   */
  useEffect(() => {
    // Browser me overlay read + merge
    const merged = mergePool();
    // Sirf tab state update karo jab actually kuch badla ho -
    // unnecessary re-render avoid (referential check).
    // `mergePool()` returns SEED_POOL object reference jab koi overlay nahi,
    // to `!==` check naturally false ho jayega.
    setPool((prev) => (prev === merged ? prev : merged));
  }, []);

  return (
    <div className={cn('w-full', className)}>
      {/* ---- HERO CAROUSEL ----
          Full-width autoplay layer. Slides in-house Wino/Rino promos,
          playlist MinIO se. */}
      <HeroCarousel slides={pool.hero} />

      {/* ---- CONTENT ROWS ----
          Teen horizontal rows: Trending Wideos, Highest Earnings Today,
          New Creator Channels. Vertical stack me, gap ke saath.
          NOTE: `space-y-8` se rows spaced out - Prime Video browse feel. */}
      <div className="w-full space-y-8 py-10">
        {pool.rows.map((row) => (
          <ContentRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

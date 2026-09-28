/**
 * ============================================================================
 * IN-HOUSE AD POOL - landing page content source
 * ============================================================================
 *
 * COST / NETWORK POSITION (hard rule, zero exceptions):
 *   - Koi third-party ad network NAHI (no AdSense/Taboola/DAP/GAM)
 *   - Koi external CDN NAHI (no CloudFront/Cloudflare/Bunny/YouTube/Vimeo)
 *   - Koi remote fetch NAHI - sab data LOCAL storage se
 *   - Video/playlist segments SIRF apne MinIO se (`MINIO_PUBLIC_HOST`)
 *   Iska matlab: platform scale par bhi per-impression cost ZERO.
 *
 * STORAGE LAYER - kahan se data aata hai:
 *   1. SEED (neeche `SEED_POOL`) - code me static defined. First paint me
 *      turant dikhta hai, koi network wait nahi.
 *   2. LOCAL STORAGE OVERLAY - `wideo11.landing.pool.v1` key. Jab in-house ad
 *      engine naya Wino/Rino creative complete karta hai, wo `appendToPool()`
 *      se yahan append kar deta hai. Landing page agle render me automatically
 *      pick kar leta hai - "straight to this landing layout array", koi
 *      redeploy nahi.
 *
 *   Merge rule: SEED pehle, LOCAL OVERLAY uske BAAD append hota hai.
 *   Isliye naya creative seed ko kabhi override nahi karta, sirf add hota hai.
 *   Overlay me duplicate ID ho to wo entry SKIP ho jaati hai (last-write-wins
 *   nahi - first-wins, taaki user ka pehle se appended creative na ude).
 *
 * SSR SAFETY:
 *   Ye file Server Component aur Client Component dono import kar sakte hain.
 *   - `readLocalPool()` `typeof window === 'undefined'` guard karta hai
 *   - Server pe sirf `SEED_POOL` return hota hai
 *   - Client pe hydration ke BAAD overlay merge hota hai
 *   Isliye koi hydration mismatch nahi hota (server aur client ka first render
 *   identical hota hai - overlay sirf useEffect me lagta hai).
 *
 * MINIO PLAYLIST RESOLUTION (requirement: `.m3u8` from OUR buckets):
 *   Base = `NEXT_PUBLIC_MINIO_PUBLIC_HOST` (compose me `localhost:9000`),
 *   bucket = `NEXT_PUBLIC_MINIO_VIDEO_BUCKET` (compose me `video`).
 *   Isse playlist URL hamesha apne hi MinIO se banti hai. Koi hardcoded
 *   remote host nahi.
 *
 * Hinglish comments: har block ka arth
 */

/**
 * MinIO public host - apna hi storage.
 *
 * NOTE: `NEXT_PUBLIC_` prefix zaroori hai taaki value browser bundle me
 * available ho. Compose `web` service me ye env set hota hai. Agar na mile
 * to local compose default (`localhost:9000`) use hoga.
 */
const MINIO_PUBLIC_HOST =
  process.env['NEXT_PUBLIC_MINIO_PUBLIC_HOST'] || 'http://localhost:9000';

/** MinIO video bucket name - HLS playlists aur segments yahan rehte hain */
const MINIO_VIDEO_BUCKET = process.env['NEXT_PUBLIC_MINIO_VIDEO_BUCKET'] || 'video';

/** Local storage key - versioned taaki future schema change safe rahe */
const POOL_STORAGE_KEY = 'wideo11.landing.pool.v1';

/**
 * buildPlaylistUrl - MinIO se HLS playlist URL banata hai.
 *
 * @param slug - video ka folder/prefix inside the bucket (e.g. `wino-launch`)
 * @param filename - playlist filename, default `index.m3u8`
 * @returns full URL - ALWAYS our MinIO, never external
 *
 * SECURITY/COST NOTE: ye function kisi bhi external host ko accept nahi
 * karta - base hardcoded apna MinIO hai. Isse koi galti se remote CDN URL
 * inject nahi kar sakta.
 */
export function buildPlaylistUrl(slug: string, filename = 'index.m3u8'): string {
  // `encodeURIComponent` - slug me space/special char ho to safe URL bane
  const safeSlug = encodeURIComponent(slug);
  return `${MINIO_PUBLIC_HOST}/${MINIO_VIDEO_BUCKET}/${safeSlug}/${filename}`;
}

/** MinIO thumbnail/poster image URL (same bucket, separate image path) */
export function buildPosterUrl(slug: string, filename = 'poster.jpg'): string {
  const safeSlug = encodeURIComponent(slug);
  return `${MINIO_PUBLIC_HOST}/${MINIO_VIDEO_BUCKET}/${safeSlug}/${filename}`;
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Ek hero carousel slide ka shape */
export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  /** CTA label - optional */
  ctaLabel?: string;
  /** Internal route ONLY (no external href) */
  ctaHref?: string;
  /**
   * MinIO HLS playlist URL (already built via `buildPlaylistUrl`).
   * Native HLS sirf Safari me chalega - baaki browsers me animated
   * fallback layer dikhega (see hero-carousel.tsx).
   */
  playlistUrl: string;
  /** MinIO poster image (video load hone se pehle dikhta hai) */
  posterUrl: string;
  /** Kaunsa character feature ho - ad creative metadata */
  characterId: 'Wino' | 'Rino';
  /** Character accent color (from manifest) - glow/border tint */
  accent: string;
}

/** Ek content row ke andar ka tile (video/channel) */
export interface PoolTile {
  id: string;
  title: string;
  /** Optional short meta line (views / earnings / channel) */
  meta?: string;
  /** Optional numeric highlight - "Highest Earnings" row me INR dikhata hai */
  highlight?: string;
  /** Optional accent for badge - uses brand colors only */
  accent?: string;
  /** MinIO thumbnail URL (optional - agar na ho to gradient fallback) */
  thumbUrl?: string;
  /** Optional internal route */
  href?: string;
}

/** Ek horizontal content row - "Trending Wideos" etc. */
export interface PoolRow {
  id: string;
  /** Row heading - exactly the three required categories */
  title: string;
  /** Optional row subtitle */
  subtitle?: string;
  tiles: PoolTile[];
}

/** Poora pool - hero slides + content rows */
export interface AdPool {
  hero: HeroSlide[];
  rows: PoolRow[];
}

// ---------------------------------------------------------------------------
// SEED POOL - static, in-house, Wino/Rino promos
// ---------------------------------------------------------------------------

/**
 * SEED_POOL - code me static defined starter content.
 *
 * Ye SEED hai, iska matlab: ye hamesha render hota hai (network ki zaroorat
 * nahi). In-house creative complete hone par `appendToPool()` se upar aata
 * hai, iske neeche nahi - seed kabhi hat-ta nahi.
 *
 * NOTE: Playlist URLs `buildPlaylistUrl` se bani hain, yaani sab apne hi
 * MinIO `video` bucket se. Koi external URL nahi.
 *
 * NOTE (video existence): Ye slugs (`wino-*`, `rino-*`) ek CONTRACT hain -
 * in files ko transcoding-service se MinIO me daalna hoga (HLS segments +
 * poster). Jab tak wo files nahi hain, hero-carousel ka animated fallback
 * layer dikhata hai (video `onError` par). Yaani page kabhi toota nahi
 * dikhega, bas video placeholder chala jayega.
 */
export const SEED_POOL: AdPool = {
  // ---- Hero carousel: Wino & Rino launch promos ----
  hero: [
    {
      id: 'hero-wino-velocity',
      title: 'Wino: Ship faster, keep every rupee',
      subtitle:
        'Wino walks you through edge publishing in under two minutes. Your catalog, your ledger, your rules.',
      ctaLabel: 'Create your account',
      ctaHref: '/auth/register',
      playlistUrl: buildPlaylistUrl('wino-velocity', 'index.m3u8'),
      posterUrl: buildPosterUrl('wino-velocity'),
      characterId: 'Wino',
      accent: '#60a5fa',
    },
    {
      id: 'hero-rino-autopilot',
      title: 'Rino: Let automation handle the boring parts',
      subtitle:
        'Rino watches retention, transcode queues and payout thresholds so you only make the good stuff.',
      ctaLabel: 'See how it works',
      ctaHref: '/auth/login',
      playlistUrl: buildPlaylistUrl('rino-autopilot', 'index.m3u8'),
      posterUrl: buildPosterUrl('rino-autopilot'),
      characterId: 'Rino',
      accent: '#a78bfa',
    },
    {
      id: 'hero-wino-rino-duet',
      title: 'Wino & Rino: The full creator toolkit',
      subtitle:
        'Upload once, transcode to adaptive HLS, stream from the edge, settle payouts daily. No paid tools.',
      ctaLabel: 'Start publishing',
      ctaHref: '/auth/register',
      playlistUrl: buildPlaylistUrl('wino-rino-duet', 'index.m3u8'),
      posterUrl: buildPosterUrl('wino-rino-duet'),
      characterId: 'Rino',
      accent: '#8ab8ff',
    },
  ],

  // ---- Row 1: Trending Wideos ----
  rows: [
    {
      id: 'row-trending',
      title: 'Trending Wideos',
      subtitle: 'What creators are publishing right now',
      tiles: [
        {
          id: 'trend-1',
          title: 'Edge delivery deep dive: HLS on your own bucket',
          meta: '18K views',
          accent: '#60a5fa',
        },
        {
          id: 'trend-2',
          title: 'I replaced my CDN bill with MinIO + a small VPS',
          meta: '14K views',
          accent: '#a78bfa',
        },
        {
          id: 'trend-3',
          title: 'Reading your own revenue ledger (yes, you can export it)',
          meta: '11K views',
          accent: '#73bf69',
        },
        {
          id: 'trend-4',
          title: 'Why 4-second HLS segments changed my upload flow',
          meta: '9.2K views',
          accent: '#f2cc0c',
        },
        {
          id: 'trend-5',
          title: 'Transcoding 200 uploads without breaking a sweat',
          meta: '8.1K views',
          accent: '#f2495c',
        },
        {
          id: 'trend-6',
          title: 'Rino set up my retention dashboard automatically',
          meta: '7.4K views',
          accent: '#8ab8ff',
        },
      ],
    },

    // ---- Row 2: Highest Earnings Today ----
    {
      id: 'row-earnings',
      title: 'Highest Earnings Today',
      subtitle: 'Settled from the ledger, not a guess',
      tiles: [
        {
          id: 'earn-1',
          title: 'Silent loop study (ambient focus)',
          meta: 'Top earner today',
          highlight: '₹3,180',
          accent: '#73bf69',
        },
        {
          id: 'earn-2',
          title: 'Kitchen vlog, no voice, zero gear',
          meta: 'Rising fast',
          highlight: '₹2,640',
          accent: '#60a5fa',
        },
        {
          id: 'earn-3',
          title: 'Study-along timer animations',
          meta: 'Consistent',
          highlight: '₹2,210',
          accent: '#a78bfa',
        },
        {
          id: 'earn-4',
          title: 'Desk setup loops (5 min, 1M views)',
          meta: 'Breakout',
          highlight: '₹1,980',
          accent: '#f2cc0c',
        },
        {
          id: 'earn-5',
          title: 'Recipe shorts with on-screen ingredients',
          meta: 'Steady',
          highlight: '₹1,540',
          accent: '#8ab8ff',
        },
      ],
    },

    // ---- Row 3: New Creator Channels ----
    {
      id: 'row-channels',
      title: 'New Creator Channels',
      subtitle: 'Fresh accounts joining this week',
      tiles: [
        {
          id: 'chan-1',
          title: '@quietloops',
          meta: 'Ambient focus content',
          accent: '#60a5fa',
        },
        {
          id: 'chan-2',
          title: '@minimaldesk',
          meta: 'Desk setups + loops',
          accent: '#a78bfa',
        },
        {
          id: 'chan-3',
          title: '@studywithsana',
          meta: 'Study-along timers',
          accent: '#73bf69',
        },
        {
          id: 'chan-4',
          title: '@quickbites',
          meta: 'Recipe shorts',
          accent: '#f2cc0c',
        },
        {
          id: 'chan-5',
          title: '@studiolight',
          meta: 'Lighting experiments',
          accent: '#f2495c',
        },
        {
          id: 'chan-6',
          title: '@looplab',
          meta: 'Motion design loops',
          accent: '#8ab8ff',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// LOCAL STORAGE OVERLAY - appending in-house creatives
// ---------------------------------------------------------------------------

/**
 * readLocalPool - browser local storage se appended creatives padhta hai.
 *
 * SSR GUARD: `typeof window === 'undefined'` pe `null` return - server pe
 * koi storage access nahi (Next.js me `localStorage` server pe exist hi nahi
 * karta, access karne se crash ho jayega).
 *
 * ERROR TOLERANCE: JSON parse fail ho ya data corrupt ho to `null` return
 * karta hai - landing page SEED pe fallback kar jaata hai. Corrupt storage se
 * poori site white-screen nahi hogi.
 */
export function readLocalPool(): AdPool | null {
  // Server-side: storage exist nahi karta
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(POOL_STORAGE_KEY);
    // Kuch nahi stored abhi
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdPool>;
    // Basic shape validation - hero/rows arrays hone chahiye
    if (!Array.isArray(parsed.hero) || !Array.isArray(parsed.rows)) {
      return null;
    }
    return {
      hero: parsed.hero,
      rows: parsed.rows,
    };
  } catch {
    // JSON corrupt ya storage blocked (private mode) - gracefully degrade
    return null;
  }
}

/**
 * writeLocalPool - local storage me overlay persist karta hai.
 *
 * Ye internal hai - consumers ko `appendToPool()` use karna chahiye, direct
 * write nahi. Isse validation ek jagah rehti hai.
 */
function writeLocalPool(pool: AdPool): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(pool));
    return true;
  } catch {
    // Quota exceeded ya storage disabled - silently fail
    // (landing page seed pe hi chalegi, bas append nahi hoga)
    return false;
  }
}

/**
 * appendHeroSlide - naya hero creative pool me append karta hai.
 *
 * @returns true agar successfully append/persist hua
 *
 * DUPLICATE RULE: agar `slide.id` already pool me hai, append NAHI hota
 * (first-wins). Isse same creative double-append nahi ho sakta - jo ad
 * engine ke retry logic me common hai.
 */
export function appendHeroSlide(slide: HeroSlide): boolean {
  if (typeof window === 'undefined') return false;
  // Current overlay (seed nahi) padho - sirf overlay append hota hai
  const current = readLocalPool() ?? { hero: [], rows: [] };
  // Duplicate ID check - overlay + seed dono me
  const existsInOverlay = current.hero.some((s) => s.id === slide.id);
  const existsInSeed = SEED_POOL.hero.some((s) => s.id === slide.id);
  if (existsInOverlay || existsInSeed) return false;
  // Append
  current.hero.push(slide);
  return writeLocalPool(current);
}

/**
 * appendRowTile - ek tile existing row me append karta hai.
 *
 * @param rowId - kis row me daalna hai (e.g. `row-trending`)
 * @param tile - naya tile
 * @returns true agar append hua
 *
 * BEHAVIOR: agar `rowId` exist nahi karta to naya row bana deta hai
 * (title = rowId). Isliye ad engine ko pehle se row create karne ki zaroorat
 * nahi - naya category seed karna ho to seed file me add karo, ya ye auto-create
 * kar dega.
 */
export function appendRowTile(rowId: string, tile: PoolTile): boolean {
  if (typeof window === 'undefined') return false;
  const current = readLocalPool() ?? { hero: [], rows: [] };
  // Row dhundho (overlay me)
  let row = current.rows.find((r) => r.id === rowId);
  if (!row) {
    // Row nahi mila - naya bana do
    row = { id: rowId, title: rowId, tiles: [] };
    current.rows.push(row);
  }
  // Duplicate tile check
  if (row.tiles.some((t) => t.id === tile.id)) return false;
  row.tiles.push(tile);
  return writeLocalPool(current);
}

/**
 * mergePool - SEED + LOCAL OVERLAY ko ek array me merge karta hai.
 *
 * ORDER: seed items PEHLE, overlay items BAAD me. Isse naya creative
 * "append" hota hai (top pe nahi aata), jaise user ne kaha - "straight to
 * this landing layout array append ho jaaye".
 *
 * DEDUPE: same ID ho to pehla (seed) jeetta - overlay ka duplicate skip.
 * Isse baar-baar append karne se duplicate na bane.
 *
 * SSR: server pe overlay `null` hota hai, so seed-only return - jisse
 * server/client first render match kare (no hydration mismatch).
 */
export function mergePool(): AdPool {
  const overlay = readLocalPool();
  // Server ya koi overlay nahi - seed return
  if (!overlay) return SEED_POOL;

  // Hero merge: seed + overlay (overlay me se duplicates hata kar)
  const heroIds = new Set(SEED_POOL.hero.map((s) => s.id));
  const mergedHero = [
    ...SEED_POOL.hero,
    ...overlay.hero.filter((s) => !heroIds.has(s.id)),
  ];

  // Rows merge: har row ke tiles combine karo
  const mergedRows: PoolRow[] = SEED_POOL.rows.map((seedRow) => {
    const overlayRow = overlay.rows.find((r) => r.id === seedRow.id);
    if (!overlayRow) return seedRow;
    // Is row ke tile IDs collect karo (dedupe ke liye)
    const seedTileIds = new Set(seedRow.tiles.map((t) => t.id));
    // Overlay tiles append karo, duplicates filter karke
    const newTiles = overlayRow.tiles.filter((t) => !seedTileIds.has(t.id));
    return { ...seedRow, tiles: [...seedRow.tiles, ...newTiles] };
  });

  // Overlay me NAYI rows bhi add karo (jo seed me nahi hain - auto-created)
  const seedRowIds = new Set(SEED_POOL.rows.map((r) => r.id));
  const brandNewRows = overlay.rows.filter((r) => !seedRowIds.has(r.id));
  mergedRows.push(...brandNewRows);

  return { hero: mergedHero, rows: mergedRows };
}

/**
 * clearLocalPool - overlay reset (debug/reset ke liye).
 * Poora landing page seed pe wapas aa jata hai. User-facing action nahi -
 * console/dev-tools me use hota hai.
 */
export function clearLocalPool(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(POOL_STORAGE_KEY);
  } catch {
    // noop - storage blocked
  }
}

/** Storage key export (dev tools me inspect karne ke liye) */
export const POOL_KEY = POOL_STORAGE_KEY;

/** MinIO config export (debug/diagnostics) */
export const MINIO_CONFIG = Object.freeze({
  publicHost: MINIO_PUBLIC_HOST,
  videoBucket: MINIO_VIDEO_BUCKET,
});

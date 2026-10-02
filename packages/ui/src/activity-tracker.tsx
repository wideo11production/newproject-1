// Global activity capture - poori app me click/activity logging
//
// YE "BACKGROUND AUDIT PREPARATION" hai (Awareness grid se PEHLE):
// Har user interaction (click, navigation) silently capture hota hai aur
// `analytics-service` ke `ui_click_events` table me persist hota hai
// (90-day retention, `SYSTEM-PLAN.md` §3.3).
//
// ~~Ye pehle auth-service ke `click_events` table me jaata tha.~~ Wahan se
// hataya gaya, kyunki "kaunsa button daba" koi auth concern nahi hai - usi
// service ka ek unrelated table tha, sirf isliye ki auth-service ka database
// pehle se wired tha. Ab analytics-service own karta hai, wahi service jo
// clicks model karta hai.
//
// Superadmin Awareness grid isi data ko dikhayega - isliye ye component
// MONOREPO WIDE lagana zaroori hai, warna grid khaali rahegi. Aaj ye 8 apps me
// mounted hai aur `tools/check-surfaces.mjs` verify karta hai ki har ek actually
// likh raha hai.
//
// DESIGN CHOICES:
// - Capture phase me listen (document.addEventListener(..., true)) taaki
//   koi component apna tracking bypass na kar sake
// - Batched (har click turant network call nahi - 10 clicks ya 5s me flush)
//   taaki performance degrade na ho
// - pagehide/unload par flush (data loss na ho)
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useRef } from 'react';

/** Flush interval (ms) - iske baad queued events bhej diye jate hain */
const FLUSH_INTERVAL_MS = 5000;

/** Batch size - itne clicks ke baad turant flush */
const BATCH_SIZE = 10;

/** Audit endpoint - same-origin proxy (auth-service tak forward karta hai) */
// Audit endpoint - same-origin proxy.
// NOTE: har app ka apna /api/audit route hona chahiye jo auth-service tak forward kare.
// App specific URL chahiye to env se override kar sakte ho (NEXT_PUBLIC_AUDIT_ENDPOINT).
// NOTE: bracket access `['NEXT_PUBLIC_AUDIT_ENDPOINT']` (dot nahi) isliye ki
// `packages/ui` ka tsconfig me `noPropertyAccessFromIndexSignature` ON hai.
// `process.env` index signature hai, isliye dot notation par TS4111 aata hai
// aur package ka `tsc` build fail ho jata tha.
const AUDIT_ENDPOINT =
  process.env['NEXT_PUBLIC_AUDIT_ENDPOINT'] ?? '/api/audit';

interface QueuedEvent {
  timestamp: string;
  page: string;
  /**
   * WHICH APP this click came from - `web`, `editor`, `admin`, `monitor`, ...
   *
   * ---- YE KYON ZAROORI HAI ----
   *
   * `page` sirf `location.pathname` hai, aur ye KAAFI NAHI HAI. Video editor
   * ka apna koi route nahi hai - woh `/` par hi serve hota hai - aur web app
   * ka landing page bhi `/` hai. Matlab dono ke clicks `page = '/'` me jaate
   * hain aur bilkul alag nahi kiye ja sakte.
   *
   * Ye sirf ek reporting chhoti baat nahi. Editor ke timeline toolbar ke 66
   * clicks aur web landing ke 66 clicks ek hi bucket me gujarte hain - matlab
   * "users ne export button kitni baar dabaya" jaisa sawaal ka jawab hi nahi
   * milta. Aur aage `/settings`, `/export` jaise routes dono apps me aaye to
   * collision ho jayega, jise baad me nikaalna mushkil hoga kyunki purane
   * rows ka matlab badal jayega.
   *
   * Isliye har app apna `NEXT_PUBLIC_APP_SURFACE` env set karta hai. Value
   * env se aati hai, isliye ek package har app me chalti hai aur koi app-specific
   * code duplicate nahi hota.
   */
  surface: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  referrer: string;
}

/**
 * Kaunsa app hai - env se, warna origin se.
 *
 * The env var is the honest answer. Falling back to `location.port` is only a
 * safety net so an app that forgets to set it still produces *some* distinction
 * rather than silently landing in `unknown` alongside the others.
 */
function resolveSurface(): string {
  const fromEnv = process.env['NEXT_PUBLIC_APP_SURFACE'];
  if (fromEnv) return fromEnv;
  if (typeof window === 'undefined') return 'unknown';
  return window.location.port ? `port-${window.location.port}` : window.location.hostname;
}

/**
 * Page name ko ek canonical form me lao - hamesha leading slash ke saath.
 *
 * Ye asli me do form me aa raha tha: 480 rows `/auth/login` aur 53 rows
 * `auth/login`. Wahi page, do spellings. Koi bhi `GROUP BY page` ya funnel
 * isse silently kam count karega - aisa bug jo dikhta hi nahi, sirf number
 * galat hota hai.
 */
function normalizePage(raw: string): string {
  if (!raw) return '/';
  // `location.pathname` already starts with `/`, but this value also arrives
  // from non-window callers, so do not assume it.
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * buildSelector - element ka readable selector banata hai
 *
 * ---- TEHREE TIER, PEHLE WALA SABSE IMPORTANT ----
 *
 * 1. `data-track` - explicit, stable, survives any CSS change. Use this for
 *    anything you intend to query later.
 * 2. `aria-label` - the editor already puts one on every control (that is how
 *    the whole UI is navigable by keyboard), so it is a free, meaningful,
 *    stable name. Before this, targets looked like `button.flex.h-7.w-7` - a
 *    record of the CSS at the moment of the click, which is worthless a week
 *    later once anyone touches a class.
 * 3. tag + short class list - last resort only.
 */
function buildSelector(el: Element | null): { selector: string; id: string } {
  if (!el) return { selector: 'unknown', id: '' };

  const id = el.id || '';

  // 1. explicit opt-in
  const explicit = el.getAttribute('data-track');
  if (explicit) return { selector: `track:${explicit}`, id };

  // 2. accessible name - the editor's control surface is already named
  const aria = el.getAttribute('aria-label');
  if (aria) return { selector: `aria:${aria.trim().slice(0, 60)}`, id };

  // 3. tag + classes. Class names are CSS implementation detail, so keep this
  //    short and never let it be the only handle on something that matters.
  let selector = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    // Design-system classnames filter - bohot lambe hote hain, noise dete hain
    .filter((c) => c.length < 24 && !c.startsWith('tw-'))
    .slice(0, 3);
  if (classes.length) selector += `.${classes.join('.')}`;

  return { selector, id };
}

/**
 * GlobalActivityTracker - har page par mount karo
 *
 * USAGE (app layout me):
 *   import { GlobalActivityTracker } from '@/components/activity-tracker';
 *   <GlobalActivityTracker />
 *
 * Ye har click, change event aur visibility change capture karta hai.
 */
export function GlobalActivityTracker() {
  const queue = useRef<QueuedEvent[]>([]);
  // Resolved once per mount, not per click: it cannot change without a reload,
  // and reading env on every event would be pointless work in a hot path.
  const surface = useRef(resolveSurface());

  useEffect(() => {
    const flush = () => {
      if (queue.current.length === 0) return;
      const batch = [...queue.current];
      queue.current = [];

      // Fire-and-forget: user ko wait nahi karna chahiye tracking ke liye.
      // keepalive true taaki page unload hone par bhi request complete ho.
      fetch(AUDIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      }).catch(() => {
        // Network fail - silently drop. Click tracking critical nahi hai,
        // user ka flow kabhi break nahi hona chahiye iske liye.
      });
    };

    /**
     * onClick - har click capture (CAPTURE phase)
     *
     * NOTE: third arg `true` = capture phase. Iska matlab ye app ke apne
     * onClick handlers se PEHLE fire hota hai - koi component isse
     * bypass nahi kar sakta.
     */
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      const { selector, id } = buildSelector(target);

      queue.current.push({
        // Microsecond precision timestamp (ISO 8601)
        timestamp: new Date().toISOString(),
        page: normalizePage(
          typeof window !== 'undefined' ? window.location.pathname : 'unknown'
        ),
        surface: surface.current,
        target: selector,
        label: (target.textContent ?? '').trim().slice(0, 60),
        element_id: id,
        x: e.clientX,
        y: e.clientY,
        referrer: typeof document !== 'undefined' ? document.referrer : '',
      });

      // Batch full -> turant flush
      if (queue.current.length >= BATCH_SIZE) flush();
    };

    /** onChange - form interactions bhi capture karte hain */
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target) return;

      const { selector, id } = buildSelector(target);
      queue.current.push({
        timestamp: new Date().toISOString(),
        page: normalizePage(
          typeof window !== 'undefined' ? window.location.pathname : 'unknown'
        ),
        surface: surface.current,
        target: `${selector}:change`,
        label: `${target.type || 'field'}${target.name ? ` (${target.name})` : ''}`,
        element_id: id,
        x: 0,
        y: 0,
        referrer: typeof document !== 'undefined' ? document.referrer : '',
      });
    };

    // ---- Listeners ----
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);

    // Periodic flush - batch full na bhi hua to bhi bhej do
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    // Page chhodte waqt flush (data loss na ho)
    const onPageHide = () => flush();
    window.addEventListener('pagehide', onPageHide);

    // ---- Cleanup (memory leak na ho) ----
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      clearInterval(interval);
      window.removeEventListener('pagehide', onPageHide);
      flush(); // pending events bhej do
    };
  }, []);

  // Ye component visually kuch render nahi karta - sirf tracking karta hai
  return null;
}

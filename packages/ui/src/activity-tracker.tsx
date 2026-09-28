// Global activity capture - poori app me click/activity logging
//
// YE "BACKGROUND AUDIT PREPARATION" hai (Awareness grid se PEHLE):
// Har user interaction (click, navigation) silently capture hota hai aur
// auth-service ke `click_events` table me persist hota hai (30-day retention).
//
// Superadmin Awareness grid isi data ko dikhayega - isliye ye component
// MONOREPO WIDE lagana zaroori hai, warna grid khaali rahegi.
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
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  referrer: string;
}

/**
 * buildSelector - element ka readable selector banata hai
 * (superadmin dashboard me click trace karna ho to ye ID use hota hai)
 */
function buildSelector(el: Element | null): { selector: string; id: string } {
  if (!el) return { selector: 'unknown', id: '' };

  let selector = el.tagName.toLowerCase();
  const id = el.id || '';
  if (id) selector += `#${id}`;

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
        page: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
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
        page: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
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

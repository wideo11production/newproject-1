// Click tracker for the video editor.
//
// Sends ClickEvents to the app's own /api/audit route, which forwards them to
// the analytics-service (NATS JetStream TELEMETRY stream). The server re-derives
// identity, surface, and timestamp - the browser only reports what it clicked.
//
// Design:
//   - Bounded batch (max 50 events per flush)
//   - Flush every 5 seconds or on pagehide, whichever comes first
//   - Never throws - tracking failures are silently dropped
//   - Deduplicates rapid-fire clicks on the same target within 500ms
//
// Usage:
//
//   import { trackClick } from '@/lib/click-tracker';
//
//   <button onClick={() => trackClick('export_btn', 'Export video', 'export-btn')}>
//     Export
//   </button>

const AUDIT_URL = '/api/audit';
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 50;
const DEDUP_WINDOW_MS = 500;

interface PendingClick {
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  page: string;
  surface?: string;
  referrer?: string;
}

let pending: PendingClick[] = [];
let lastClick: { target: string; element_id: string; time: number } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Record a click event. Call from onClick handlers. */
export function trackClick(
  target: string,
  label: string,
  elementId: string,
  opts?: { x?: number; y?: number; page?: string; surface?: string; referrer?: string },
) {
  // Dedup: ignore rapid repeat clicks on same target+element
  const now = Date.now();
  if (
    lastClick &&
    lastClick.target === target &&
    lastClick.element_id === elementId &&
    now - lastClick.time < DEDUP_WINDOW_MS
  ) {
    return;
  }
  lastClick = { target, element_id: elementId, time: now };

  pending.push({
    target: clean(target),
    label: clean(label),
    element_id: clean(elementId),
    x: coord(opts?.x ?? 0),
    y: coord(opts?.y ?? 0),
    page: opts?.page ?? typeof window !== 'undefined' ? window.location.pathname : '/',
    surface: opts?.surface,
    referrer: opts?.referrer,
  });

  // Cap batch size
  if (pending.length > MAX_BATCH) {
    pending = pending.slice(-MAX_BATCH);
  }

  scheduleFlush();
}

function clean(raw: string, max = 200): string {
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, max);
}

function coord(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return 0;
  return Math.round(n);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (pending.length === 0) return;

  const batch = pending.splice(0, pending.length);
  try {
    await fetch(AUDIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      cache: 'no-store',
      // keepalive so the request survives page navigation
      keepalive: true,
    });
  } catch {
    // Tracking failures are silently dropped - never break the page
    // Put events back at the front so they can be retried
    pending.unshift(...batch);
  }
}

/** Start the tracker (call once at app root). */
export function startClickTracking() {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Flush on pagehide (covers navigation, refresh, close)
  window.addEventListener('pagehide', () => {
    flushTimer && clearTimeout(flushTimer);
    flush();
  });

  // Periodic flush
  setInterval(flush, FLUSH_INTERVAL_MS);
}

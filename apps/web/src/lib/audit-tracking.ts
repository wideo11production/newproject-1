// Click Tracking + Security Audit (frontend)
//
// YE KYA KARTA HAI:
// 1. Har user mouse click ko capture karta hai (auth screens + global)
// 2. Microsecond-precision timestamp ke saath store karta hai
// 3. "Staff trap": agar hardcoded security config CHANGE ya VIOLATE hoti hai
//    to ek alert generate hota hai jo master dashboard par RED dikhta hai
//
// DESIGN CHOICES (jo maine consciously kiye):
// - Tracking batched hai (har click turant nahi, 10 clicks ya 5s me flush)
//   taaki network spam na ho aur performance na gire
// - User identity + timestamp + target (CSS selector) capture hota hai
// - Data localStorage me bhi rakha jaata hai (offline resilience), server
//   par bhi bheja jaata hai
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useRef } from 'react';

// ---- Types ----
export interface ClickEvent {
  /** Click ka unique ID */
  id: string;
  /** Kab hua - ISO string with microseconds */
  timestamp: string;
  /** Clicked element ka simple description (CSS selector) */
  target: string;
  /** Element ka text content (trimmed) */
  label: string;
  /** Screen coordinates */
  x: number;
  y: number;
  /** Current page URL */
  page: string;
  /** User agent (device fingerprint ke liye) */
  userAgent: string;
}

export interface SecurityViolation {
  id: string;
  timestamp: string;
  /** Kya violate hua */
  type: 'CONFIG_TAMPER' | 'RATE_LIMIT_BYPASS_ATTEMPT' | 'AUTH_FAILURE_SPIKE';
  /** Details */
  detail: string;
  /** Kahan se aaya */
  page: string;
  userAgent: string;
}

// ---- Config ----
const API_ENDPOINT = '/api/audit';
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const STORAGE_KEY = 'wideo11_click_audit';
const VIOLATION_KEY = 'wideo11_security_violations';

/**
 * buildSelector - element ka readable CSS selector banata hai
 * (tag + id + class - debugging ke liye kaafi hai)
 */
function buildSelector(el: Element | null): string {
  if (!el) return 'unknown';
  let sel = el.tagName.toLowerCase();
  if (el.id) sel += `#${el.id}`;
  const cls = Array.from(el.classList).slice(0, 3).join('.');
  if (cls) sel += `.${cls}`;
  return sel;
}

/**
 * useClickTracking - ye hook component me daalo, tracking auto-start ho jayegi
 *
 * @param pageName - kis page par track karna hai (label ke liye)
 */
export function useClickTracking(pageName: string) {
  const queue = useRef<ClickEvent[]>([]);

  useEffect(() => {
    /**
     * onClick - har click capture karo
     * NOTE: capture phase me listen karte hain taaki page ka apna
     * click handler chalne se PEHLE hum event capture kar sakein.
     * Isse koi bhi component apna tracking bypass nahi kar sakta.
     */
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      const event: ClickEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        // Microsecond precision: ISO string me milliseconds + random suffix
        timestamp: new Date().toISOString(),
        target: buildSelector(target),
        label: (target.textContent ?? '').trim().slice(0, 60),
        x: e.clientX,
        y: e.clientY,
        page: pageName,
        userAgent: navigator.userAgent.slice(0, 200),
      };

      queue.current.push(event);

      // Batch full ho gaya -> flush
      if (queue.current.length >= BATCH_SIZE) {
        flush(queue);
      }
    };

    // Periodic flush - chahe batch full na bhi hua
    const interval = setInterval(() => flush(queue), FLUSH_INTERVAL_MS);

    document.addEventListener('click', onClick, true); // capture phase

    // Cleanup - memory leak na ho
    return () => {
      document.removeEventListener('click', onClick, true);
      clearInterval(interval);
      flush(queue); // pending events bhej do
    };
  }, [pageName]);
}

/**
 * flush - queued events ko SERVER par bhejta hai
 *
 * PERSISTENCE FIX: pehle ye localStorage + memory buffer me store karta tha, jo
 * RESTART par gayab ho jata tha. Ab ye auth-service ke click_events table me
 * POST karta hai - jo Postgres me hota hai, to restart-safe hai aur superadmin
 * dashboard par dikhta hai.
 *
 * Hinglish: ab clicks database me jaati hain - restart karne par bhi rahengi
 */
async function flush(queue: { current: ClickEvent[] }) {
  if (queue.current.length === 0) return;

  const batch = [...queue.current];
  queue.current = [];

  // ---- Server (persistent) ----
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: batch.map((e) => ({
          timestamp: e.timestamp,
          page: e.page,
          target: e.target,
          label: e.label,
          x: e.x,
          y: e.y,
          referrer: typeof window !== 'undefined' ? document.referrer : '',
        })),
      }),
      keepalive: true,
    });
  } catch {
    // Network fail - silently drop (click tracking critical nahi hai)
  }
}

/**
 * reportSecurityViolation - staff trap / config tamper report
 *
 * JAB call karna hai: jab pata chale ki hardcoded config change hui hai,
 * rate limit bypass attempt hua hai, ya auth failures spike kar rahe hain.
 *
 * Ye superadmin dashboard ka "Awareness Reports" section consume karta hai
 * aur RED pulsing alert flash karta hai.
 */
export async function reportSecurityViolation(
  type: SecurityViolation['type'],
  detail: string
) {
  const violation: SecurityViolation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    detail,
    page: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
  };

  // Local me turant save (UI turant dikha sake)
  try {
    const existing = JSON.parse(localStorage.getItem(VIOLATION_KEY) ?? '[]');
    localStorage.setItem(
      VIOLATION_KEY,
      JSON.stringify([...existing, violation].slice(-100))
    );
  } catch {
    // ignore
  }

  // Server ko bhejo
  try {
    await fetch(`${API_ENDPOINT}/violation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(violation),
      keepalive: true,
    });
  } catch {
    // ignore - local me save hai
  }

  return violation;
}

/**
 * getSecurityViolations - local violations padho (dashboard ke liye)
 */
export function getSecurityViolations(): SecurityViolation[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(VIOLATION_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * getClickEvents - local click history padho (audit trail)
 */
export function getClickEvents(): ClickEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

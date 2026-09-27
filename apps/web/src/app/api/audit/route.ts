// Click audit API - forwards clicks to auth-service for PERSISTENT storage
//
// PERSISTENCE FIX: pehle ye in-memory store + localStorage use karta tha,
// jo RESTART par gayab ho jata tha. Ab ye auth-service (8085) ke
// click_events table me forward karta hai:
//   - Postgres backed (restart-safe)
//   - 30-day automatic retention (DB garbage se nahi bharta)
//
// Superadmin dashboard (apps/superadmin) yahi data read karta hai.
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

interface ClickEventInput {
  timestamp: string;
  target: string;
  label: string;
  x: number;
  y: number;
  page: string;
  referrer?: string;
}

/**
 * POST - click events receive karke auth-service par bhejta hai
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const events: ClickEventInput[] = Array.isArray(body?.events) ? body.events : [];

    if (events.length === 0) {
      return NextResponse.json({ saved: 0 });
    }

    // Batch limit - abuse protection
    const capped = events.slice(0, 200);

    // Auth service (persistent store) par forward
    const res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/click-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: capped }),
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => ({}));

    if (res.ok) {
      return NextResponse.json({ saved: payload.saved ?? capped.length });
    }

    // Auth service down hai - click tracking critical nahi, drop kar do.
    // User ka flow kabhi break nahi hona chahiye tracking failure se.
    return NextResponse.json({ saved: 0, warning: 'audit store unavailable' });
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
}

/**
 * GET - local view (superadmin app proper persistent store se padhta hai,
 * ye sirf connectivity check ke liye hai)
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/audit',
    method: 'POST',
    storage: 'auth-service click_events table (Postgres, 30-day retention)',
  });
}

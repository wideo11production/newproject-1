// Audit proxy - click/activity capture ko auth-service tak forward karta hai
//
// YE ROUTE HAR APP ME SAME HAI (7 apps). Iska reason: activity-tracker
// same-origin endpoint pe POST karta hai (CORS avoid + consistent).
// Asal persistence auth-service ke `click_events` table me hoti hai
// (Postgres, 30-day retention) - superadmin Awareness grid wahin se padhta hai.
//
// NOTE: auth-service ka internal URL har app ke compose env me AUTH_INTERNAL_URL
// ke through aata hai (SSOT).
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

interface ClickEventInput {
  timestamp: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  page: string;
  referrer?: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const events: ClickEventInput[] = Array.isArray(body?.events)
      ? body.events
      : [];

    if (events.length === 0) {
      return NextResponse.json({ saved: 0 });
    }

    // Batch cap - abuse protection
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

    // Auth service down ho to drop kar do - user ka flow break nahi hona chahiye
    // tracking failure se.
    return NextResponse.json({ saved: 0, warning: 'audit store unavailable' });
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
}

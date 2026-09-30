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
  // ---- STEP 1: parse the request ----
  //
  // A body we cannot parse is genuinely the client's fault, and 400 is the
  // honest status for it.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const events: ClickEventInput[] = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: ClickEventInput[] }).events)
    : [];

  if (events.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  // Batch cap - abuse protection
  const capped = events.slice(0, 200);

  // ---- STEP 2: forward, and NEVER let the upstream break the flow ----
  //
  // This is the bug the step boundary exists to fix. `fetch` THROWS when the
  // host is unreachable - a refused connection inside a container is not a
  // response, it is an exception - and a thrown fetch used to land in the same
  // catch as a malformed body. So an audit service that was simply DOWN
  // surfaced to the browser as "400 Bad Request", five times per session, and
  // the browser logged it as an application error. The user did nothing wrong
  // and the editor was fine; the console was lying about why.
  //
  // An unreachable store is a degraded success here, exactly as the comment
  // above the original call always intended.
  try {
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

    // Auth service ne 4xx/5xx diya - drop kar do, user ka flow nahi tootna
    // chahiye tracking failure se.
    return NextResponse.json({ saved: 0, warning: `audit store returned ${res.status}` });
  } catch (e) {
    // Store unreachable (DNS, refused connection, timeout). Same answer, and
    // deliberately a 200: nothing was wrong with the request.
    return NextResponse.json({
      saved: 0,
      warning: 'audit store unavailable',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

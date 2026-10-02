// Shared click-capture endpoint for every app in the monorepo.
//
// WHY THIS IS A LIBRARY AND NOT A FILE IN EACH APP
// -------------------------------------------------
//
// This handler used to be copy-pasted into all seven apps, and it had already
// drifted into THREE different variants. Five of the copies still carried the
// original bug, described below. Copy-paste across a monorepo guarantees drift:
// the moment one copy is fixed, the other six are silently wrong, and nothing
// fails - the bug just persists in five places.
//
// So: one implementation, and each app's route is a three-line re-export. A fix
// now lands in all of them or nowhere.
//
// ----------------------------------------------------------------------------
// THE BUG THE HARDENED VERSION FIXES
// ----------------------------------------------------------------------------
//
// The old shape wrapped body parsing AND the upstream fetch in one try/catch:
//
//     try {
//       const body = await request.json();     // throws on malformed body
//       ...
//       const res = await fetch(AUTH_URL);     // ALSO throws when unreachable
//     } catch {
//       return 400                              // <- wrong for the second case
//     }
//
// `fetch` THROWS rather than returns when the host is unreachable - a refused
// connection inside a container is an exception, not a response. So an audit
// store that was simply DOWN surfaced to the browser as `400 Bad Request`, five
// times per session, and the browser logged it as an application error.
//
// The user did nothing wrong and the app was fine. The console was lying about
// why, which is worse than silence: it sends you looking for a client bug.
//
// Two failures, two honest answers:
//   - body we cannot parse -> 400, that genuinely is the caller's fault
//   - store unreachable     -> 200 with `saved: 0`, a degraded success
//
// Tracking must never be able to break the page it is measuring.

import { NextResponse } from 'next/server';
import { identityHeaders, jwtPayload } from './jwt-payload';

/**
 * Resolve the telemetry service's URL from the server-side env.
 *
 * `ANALYTICS_INTERNAL_URL` is the compose-network name, which is correct here
 * because this code runs IN a container. It must never be a `NEXT_PUBLIC_*` var
 * - the browser cannot resolve a compose hostname, and the whole family of
 * `NEXT_PUBLIC_*` values that were silently dead is documented in
 * `updatedtodo.md` Session 16.
 */
const ANALYTICS_URL =
  process.env.ANALYTICS_INTERNAL_URL ?? 'http://analytics-service:8091';

/**
 * Shared secret for the telemetry service.
 *
 * Read server-side only. It is never exposed to the browser and never appears in
 * a response: the browser's job is to POST events to THIS route, and this route
 * is the one that authenticates onwards.
 *
 * A missing token is a hard error rather than a silent drop. Silently dropping
 * would look identical to "nobody is clicking", which is the one conclusion you
 * must never be able to draw from a tracking outage.
 */
const INTERNAL_TOKEN = process.env.ANALYTICS_INTERNAL_TOKEN ?? '';

/** Canonical form of the session cookie, same name the web app sets. */
const SESSION_COOKIE = 'wideo11_session';

interface ClickEventInput {
  timestamp: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  page: string;
  surface: string;
  referrer?: string;
}

/**
 * POST a batch of click events into the durable ledger.
 *
 * Pass the raw `Request` through from the app's route handler.
 */
export async function handleClickEvents(request: Request): Promise<Response> {
  // ---- STEP 1: parse the request ----
  //
  // A body we cannot parse is genuinely the client's fault, and 400 is the
  // honest status for it. Kept OUT of the try that wraps the upstream call, on
  // purpose - see the header comment.
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

  // Batch cap - abuse protection. A caller must not be able to make one request
  // write ten thousand rows.
  const capped = events.slice(0, 200);

  // ---- STEP 2: forward, and NEVER let the upstream break the flow ----
  //
  // A MISSING token is treated differently from an unreachable service, on
  // purpose. An unreachable store is a degraded success: the page is fine, and
  // dropping clicks is the lesser evil. A missing token is a CONFIGURATION
  // error - this handler would be forwarding unauthenticated to a service that
  // rejects that - and silently succeeding would make a misdeployment look like
  // healthy tracking. So it is loud.
  if (!INTERNAL_TOKEN) {
    return NextResponse.json(
      {
        saved: 0,
        warning: 'audit not configured',
        detail:
          'ANALYTICS_INTERNAL_TOKEN is not set on this app, so events cannot be forwarded. ' +
          'Tracking is OFF, not broken - fix the env var on this service.',
      },
      { status: 500 }
    );
  }

  // Identity for attribution only. See `jwt-payload.ts`: this is a DECODED, not
  // a VERIFIED, payload. It labels the row; it authorises nothing. The browser
  // never sees these values.
  //
  // The cookie is httpOnly, so this must happen here on the server. The browser
  // cannot read it, which is the entire reason the attribute cannot be forged by
  // the client - though the value itself is still not trustworthy, hence the
  // caveat above.
  const identity = identityHeaders(readSessionCookie(request));

  try {
    const res = await fetch(`${ANALYTICS_URL}/ui-clicks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': INTERNAL_TOKEN,
        ...identity,
      },
      body: JSON.stringify({ events: capped }),
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => ({}));

    if (res.ok) {
      return NextResponse.json({ saved: payload.saved ?? capped.length });
    }

    // Upstream answered with an error status. Still a degraded success here.
    return NextResponse.json({ saved: 0, warning: `telemetry returned ${res.status}` });
  } catch (e) {
    // Unreachable: DNS, refused connection, timeout.
    return NextResponse.json({
      saved: 0,
      warning: 'telemetry unavailable',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Read the session cookie off a server-side request.
 *
 * No `next/headers` import: this handler is shared by eight Next apps that may
 * be on different Next versions, and a version-specific import here would make
 * the package the thing that breaks. `Request.headers.get('cookie')` is stable
 * everywhere.
 */
function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
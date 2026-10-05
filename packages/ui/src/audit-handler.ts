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
//
// ----------------------------------------------------------------------------
// WHAT THIS FILE DECIDES, AND WHY THE SERVER HAS TO BE THE ONE DECIDING
// ----------------------------------------------------------------------------
//
// This is the trust boundary for the click ledger. The browser is an UNTRUSTED
// caller that happens to be describing its own behaviour, so three fields in the
// payload cannot be taken at face value - and all three used to be:
//
//   `identity`  - WHO clicked.
//   `surface`   - WHICH APP it came from.
//   `timestamp` - WHEN it happened.
//
// The rule applied here, and it is the whole design: **the browser is allowed to
// say what it clicked and where on screen. It is not allowed to say who it is,
// which app it is, or when.** Each of those is re-derived here from something the
// caller cannot choose.
//
//   identity   <- the session cookie's signature, VERIFIED with `jose`. The old
//                 code used `jwtPayload()`, an UNVERIFIED base64 decode, and
//                 shipped the result as `X-Internal-User-Email`. Anyone could
//                 POST that header's worth of data with a hand-made cookie and
//                 have a click attributed to a victim. Attribution is the one
//                 thing in this table that a person might be harmed by, so it is
//                 the one field that gets a real signature check.
//   surface    <- the server's own build-time value. A client sending
//                 `surface: "admin"` could poison every admin-vs-editor
//                 breakdown in the product.
//   timestamp  <- the server's clock, at arrival. A client sending
//                 `timestamp: "2020-01-01"` games the 90-day retention window
//                 (write old rows that never purge, or future rows that purge
//                 immediately).
//
// Every row records HOW it was attributed, in `attribution`. An analytics query
// can therefore separate "a real user clicked export" from "someone POSTed a
// forged cookie", which is the difference between a number and evidence.

import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { identityHeaders } from './jwt-payload';

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

/** Hard cap on one request's batch. Abuse protection: one POST, many rows. */
const MAX_BATCH = 200;

// -----------------------------------------------------------------------------
// Field bounds
// -----------------------------------------------------------------------------
//
// The browser is submitting free text that becomes database rows, and every one
// of these is attacker-controlled. The old handler forwarded `target`, `label`
// and `referrer` at whatever length the client sent.
//
// Control characters are stripped, not just truncated: a NUL or a newline in a
// field that later gets exported to CSV, printed to a terminal or rendered in a
// dashboard is a way to forge a row boundary or reformat whatever reads it.
const LIMITS = {
  target: 200,
  label: 300,
  page: 300,
  elementId: 120,
  referrer: 500,
} as const;

/** Coordinates come from a mouse. A number outside this is not a mouse. */
const MAX_COORD = 100_000;

/**
 * How identity was established for a row.
 *
 * `verified`  - the cookie's signature checked against the real secret. Trust it.
 * `anonymous` - no cookie at all. A real visitor who is not signed in produces
 *               exactly this, so it is NOT itself suspicious and must not be
 *               treated as evidence of anything.
 * `forged`    - a cookie WAS presented and it failed verification. Nobody
 *               browsing normally produces this: the browser holds an httpOnly
 *               cookie that JavaScript cannot rewrite, so the only way to send an
 *               invalid one is to build the request by hand.
 *
 * The third value is the one that makes click fraud visible. Without it, a forged
 * cookie produces a row indistinguishable from a real one and "how many users
 * pressed export" is a number anybody can manufacture with curl.
 */
export type Attribution = 'verified' | 'anonymous' | 'forged';

/** Trim to a bound, drop control characters, and never throw on a non-string. */
function clean(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, max);
}

/** A coordinate that is a finite number inside a plausible screen box. */
function coord(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COORD) return 0;
  return Math.round(n);
}

/** Canonical page path: leading slash, no scheme, no host, bounded. */
function normalizePage(raw: unknown): string {
  const v = clean(raw, LIMITS.page);
  if (!v) return '/';
  // `location.pathname` already starts with `/`, but this value also arrives from
  // non-window callers, so do not assume it. Two spellings of one page (`/auth/login`
  // and `auth/login`) silently undercount every GROUP BY - that was a real bug.
  return v.startsWith('/') ? v : `/${v}`;
}

/**
 * The server's own surface, resolved once.
 *
 * Read from the BUILD-TIME value the app was compiled with. That is still
 * client-visible by construction - `NEXT_PUBLIC_*` is inlined into the bundle -
 * but it is inlined at build, so a caller cannot change it per request. The
 * difference matters: a per-request value is chosen by whoever makes the request,
 * and a build-time value is chosen by whoever built the image.
 *
 * `SERVER_SURFACE` is preferred because it is genuinely server-only. The fallback
 * exists for apps that have not set it; the plan file records a session in which
 * `NEXT_PUBLIC_APP_SURFACE` was dead in every app and the hardcoded fallback
 * `port-3002` was silently labelling every editor click.
 */
const SERVER_SURFACE =
  process.env.SERVER_SURFACE ?? process.env.NEXT_PUBLIC_APP_SURFACE ?? 'unknown';

// -----------------------------------------------------------------------------
// Abuse control
// -----------------------------------------------------------------------------
//
// `POST /api/audit` is deliberately PUBLIC - the tracker has to run for signed-out
// visitors, or the earliest and most interesting clicks are the ones never
// recorded. Public plus writable plus no limit is a free data-generation service
// for whoever finds the port: flood `ui_click_events`, fill the disk, and drown
// the real signal in noise so that "how many users pressed export" stops being
// answerable.
//
// This is the cheapest layer that is not already owned elsewhere: a fixed window
// per client IP, in this process. It is not the rate limiter - Redis-backed
// per-route limiting lives in `auth-service` for the credential endpoints, which
// are the ones worth attacking. This stops a flood and costs one Map.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const RATE_MAX_ROWS = 3_000;

const rateBuckets = new Map<string, { windowStart: number; requests: number; rows: number }>();

/**
 * Fixed-window limiter, pruned on read.
 *
 * The Map is bounded because the key is a client IP: an attacker with a botnet
 * would otherwise grow it one entry per source address and turn a rate limiter
 * into a memory-exhaustion vector. Pruning on every read means the map only ever
 * holds addresses seen inside the current window, not every address ever seen.
 */
function rateLimited(ip: string): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { windowStart: now, requests: 1, rows: 0 });
    return { limited: false, retryAfter: 0 };
  }

  bucket.requests += 1;
  if (bucket.requests > RATE_MAX_REQUESTS || bucket.rows > RATE_MAX_ROWS) {
    const retryAfter = Math.ceil((bucket.windowStart + RATE_WINDOW_MS - now) / 1000);
    return { limited: true, retryAfter: Math.max(retryAfter, 1) };
  }
  return { limited: false, retryAfter: 0 };
}

/** Account the rows a request wants, so a single large batch is bounded too. */
function chargeRows(ip: string, rows: number): void {
  const bucket = rateBuckets.get(ip);
  if (bucket) bucket.rows += rows;
}

/**
 * Best-effort client address.
 *
 * `X-Forwarded-For` is trivially spoofable, and it is not treated as an identity
 * here - it only splits buckets, so spoofing buys an attacker more buckets rather
 * than a verified session. A real deployment behind a proxy should overwrite this
 * header at the edge; if it does not, the limiter is weaker, not wrong.
 */
function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim().slice(0, 64) || 'unknown';
  return request.headers.get('x-real-ip')?.slice(0, 64) || 'unknown';
}

interface ClickEventInput {
  timestamp: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  page: string;
  surface?: string;
  referrer?: string;
}

/** A row as this handler authorises it. Client values have already been replaced. */
interface SanitisedEvent {
  timestamp: string;
  page: string;
  surface: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  referrer: string;
}

/**
 * POST a batch of click events into the durable ledger.
 *
 * Pass the raw `Request` through from the app's route handler.
 */
export async function handleClickEvents(request: Request): Promise<Response> {
  // ---- STEP 0: abuse control, before parsing anything ----
  //
  // Before the body is read, so a flood never costs a JSON parse. The rate
  // limiter answers 429 and a tracking failure is never worth failing a page
  // over - the browser drops the batch and moves on, which is the correct
  // outcome for a flood.
  const ip = clientIp(request);
  const gate = rateLimited(ip);
  if (gate.limited) {
    return NextResponse.json(
      { saved: 0, warning: 'audit rate limited' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } }
    );
  }

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

  const raw: ClickEventInput[] = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: ClickEventInput[] }).events)
    : [];

  if (raw.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  // Batch cap - abuse protection. A caller must not be able to make one request
  // write ten thousand rows.
  chargeRows(ip, Math.min(raw.length, MAX_BATCH));
  const capped = raw.slice(0, MAX_BATCH);

  // ---- STEP 2: who is this, actually? ----
  //
  // The cookie is httpOnly, so the browser cannot read it - which is why this
  // has to happen here. But httpOnly only stops SCRIPT from reading it; a caller
  // using curl can send any string they like. So httpOnly is not an identity
  // check, and it is treated here as exactly what it is: a place to FIND a token,
  // which then has to survive a signature check like any other bearer credential.
  const token = readSessionCookie(request);
  const identity = await resolveIdentity(token);

  // ---- STEP 3: server clock, and re-derive what the client is not trusted with ----
  //
  // One `now` for the whole batch, so every row from one flush shares a timestamp
  // and the batch cannot be sorted into an order the caller chose.
  const now = new Date().toISOString();

  const events: SanitisedEvent[] = capped.map((e) => ({
    // Server clock. The client's value is discarded, not trusted-with-a-cap.
    timestamp: now,
    page: normalizePage(e.page),
    // Server's surface. The client's is not even read.
    surface: SERVER_SURFACE,
    target: clean(e.target, LIMITS.target),
    label: clean(e.label, LIMITS.label),
    element_id: clean(e.element_id, LIMITS.elementId),
    x: coord(e.x),
    y: coord(e.y),
    referrer: clean(e.referrer, LIMITS.referrer),
  }));

  // ---- STEP 4: forward, and NEVER let the upstream break the flow ----
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

  try {
    const res = await fetch(`${ANALYTICS_URL}/ui-clicks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': INTERNAL_TOKEN,
        // `identity` is verified. `jwtPayload` below is the UNVERIFIED decode,
        // used only when verification fails, and it is the difference between
        // "signed in" and "presented a cookie we could not confirm" - never
        // between two claims about who did something.
        ...identityHeaders(identity.token ?? token),
        'X-Internal-Attribution': identity.attribution,
      },
      body: JSON.stringify({ events }),
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => ({}));

    if (res.ok) {
      return NextResponse.json({ saved: payload.saved ?? events.length });
    }

    // Upstream answered with an error status. Still a degraded success here.
    return NextResponse.json({ saved: 0, warning: `telemetry returned ${res.status}` });
  } catch {
    // Unreachable: DNS, refused connection, timeout.
    //
    // NO error message in the response. `e.message` from a failed fetch embeds
    // the host it could not reach - `http://analytics-service:8091` is internal
    // topology, and this route is public. The old handler returned it verbatim.
    return NextResponse.json({ saved: 0, warning: 'telemetry unavailable' });
  }
}

/**
 * Verify a session token's signature.
 *
 * Fails CLOSED, and distinguishes "no token" from "bad token". The distinction is
 * the whole value: a visitor who is not signed in is normal traffic, while a
 * visitor presenting a cookie that does not verify is the only thing an attacker
 * with curl produces.
 *
 * `SECURITY_JWT_SECRET_KEY` is deliberately NOT consulted here. When a key is
 * rotated, the old one stays valid for the remainder of a session's lifetime, and
 * a key that is quietly accepted for longer than intended is the failure mode that
 * turns "we rotated" into "we did not". This handler attributes a click; it does
 * not authorise a request, so there is nothing to gain by accepting a wider set of
 * keys than the auth gate accepts.
 */
async function resolveIdentity(token: string | null): Promise<{ token: string | null; attribution: Attribution }> {
  if (!token) return { token: null, attribution: 'anonymous' };

  // Fail closed: with no secret configured NOTHING can be verified, so nothing is
  // claimed to be. A gate that authorises with no key is not a gate; the same rule
  // applies to a label that says "trust this row's user id".
  const secret = process.env.JWT_SECRET_KEY;
  if (!secret) return { token: null, attribution: 'anonymous' };

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      audience: 'wideo11-api',
    });
    const userId = String(payload.user_id ?? payload.sub ?? '');
    if (!userId) return { token: null, attribution: 'forged' };
    return { token, attribution: 'verified' };
  } catch {
    return { token: null, attribution: 'forged' };
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
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // A malformed percent-escape is a malformed cookie, not a crash.
        return null;
      }
    }
  }
  return null;
}
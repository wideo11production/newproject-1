// Relay to the telemetry service (analytics-service).
//
// =============================================================================
// WHY THIS IS NOT JUST ANOTHER `forward()`
// =============================================================================
//
// `forward()` in `proxy.ts` relays to auth-service with the CALLER's bearer
// token, and auth-service does the superadmin check itself. That works because
// auth-service knows how to verify a token.
//
// analytics-service knows nothing about users. It authenticates peers with one
// shared token and would accept a request from anything holding it. So if the
// superadmin app simply attached its own internal token and let the caller's
// identity ride along unchecked:
//
//     ANY logged-in user who can reach :3008 could read the entire click ledger.
//
// That ledger is a full record of every interface interaction in the product -
// every surface, every target, every user id and email attached to it. It is not
// public information, and "you are logged in" is not authorisation.
//
// =============================================================================
// THE ORDER, AND WHY IT IS THIS ORDER
// =============================================================================
//
//   1. Require an Authorization header.   -> 401 without it
//   2. Verify it against auth-service.    -> the token must actually be valid
//   3. Check the resulting ROLE.           -> superadmin or recovery only
//   4. Only then call analytics-service    -> with the internal token
//
// Steps 2 and 3 are the ones that matter. A forged or expired token fails at 2.
// A valid token belonging to an ordinary user passes 2 and is refused at 3 - which
// is the whole point: authentication is not authorisation.
//
// The internal token never leaves the server and never appears in a response.

import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

const ANALYTICS_URL =
  process.env.ANALYTICS_INTERNAL_URL ?? 'http://analytics-service:8091';

/**
 * The shared token. Server-side only.
 *
 * An empty value is a hard error rather than a warning: forwarding with no token
 * to a service that would accept one anyway is precisely the failure this file
 * exists to prevent.
 */
const INTERNAL_TOKEN = process.env.ANALYTICS_INTERNAL_TOKEN ?? '';

/** Roles permitted to read the ledger. */
const SUPERADMIN_ROLES = new Set(['superadmin', 'recovery']);

type Guard =
  | { ok: true; role: string }
  | { ok: false; status: number; body: Record<string, string> };

/**
 * Authenticate the caller and check they are allowed to read the ledger.
 *
 * Returns a RESULT rather than writing a response. An earlier version wrote a
 * `NextResponse` here and returned null, which meant the written response was
 * discarded and the status had to be recomputed by a second, duplicated check -
 * two copies of one rule that could disagree. Returning the decision keeps a
 * single source of truth for "who may read this".
 */
async function requireSuperadmin(authHeader: string | null): Promise<Guard> {
  // 1. A credential must be present at all.
  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Unauthorized', message: 'Superadmin access token required' },
    };
  }

  // 2. Prove it is real. auth-service holds the signing key and verifies; this
  //    app deliberately does not, so there is one verifier rather than two that
  //    could disagree.
  let res: Response;
  try {
    res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/profile`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'Service Unavailable',
        message: 'Cannot reach authentication service',
        detail: err instanceof Error ? err.message : 'unknown',
      },
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Unauthorized', message: 'Invalid or expired token' },
    };
  }
  if (!res.ok) {
    // 5xx from auth-service. Not a 403: we do not know who this is, and
    // reporting "forbidden" would be a guess dressed as an answer.
    return {
      ok: false,
      status: 503,
      body: { error: 'Service Unavailable', message: 'Cannot verify your token' },
    };
  }

  // 3. Authorisation. A perfectly valid token for an ordinary user lands here.
  const role = (await res.json().catch(() => ({})))?.role ?? '';
  if (!SUPERADMIN_ROLES.has(role)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Forbidden',
        message: 'Superadmin or recovery access required',
      },
    };
  }

  return { ok: true, role };
}

/**
 * forwardTelemetry relays a request to the telemetry service, after checking that
 * the caller is a superadmin.
 *
 * The caller's Authorization header is READ but never forwarded. The upstream is
 * authenticated with the internal token instead, so a caller's token cannot be
 * replayed against a service that has no concept of it.
 *
 * @param path    path on analytics-service, e.g. "/ui-clicks/stats"
 * @param request the incoming request; query string and Authorization are read
 * @param method  forwarded verbatim. GET for reads, POST for the purge.
 */
export async function forwardTelemetry(
  path: string,
  request: Request,
  method: 'GET' | 'POST' = 'GET'
) {
  // Misconfiguration first: a missing token would otherwise produce a confusing
  // upstream failure instead of naming the actual problem.
  if (!INTERNAL_TOKEN) {
    return NextResponse.json(
      {
        error: 'Service Misconfigured',
        message:
          'ANALYTICS_INTERNAL_TOKEN is not set on the superadmin app, so telemetry cannot be read.',
      },
      { status: 500 }
    );
  }

  const guard = await requireSuperadmin(request.headers.get('authorization'));
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  try {
    const qs = new URL(request.url).search;
    const res = await fetch(`${ANALYTICS_URL}${path}${qs}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': INTERNAL_TOKEN,
      },
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Service Unavailable',
        message: 'Cannot reach the telemetry service',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 }
    );
  }
}
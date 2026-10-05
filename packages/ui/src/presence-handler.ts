// Same-origin relay for the presence endpoints.
//
// -----------------------------------------------------------------------------
// WHY A SHARED HANDLER AND NOT EIGHT COPIES
// -----------------------------------------------------------------------------
//
// All eight apps need `/api/auth/presence/{start,heartbeat,end}`. That is eight
// routes, and the temptation is to write them eight times.
//
// This repository has already paid for that lesson four separate times: five
// copies of `/api/health-check` (two of which leaked internal topology), seven of
// `/api/audit` (which drifted into three variants, one of which double-counted
// every click on three pages), three Dockerfiles disagreeing with compose about a
// healthcheck, and `SuperadminService.StartSession` existing correctly with zero
// callers.
//
// So: one implementation, eight three-line re-exports. Same shape as
// `audit-handler.ts` and `health-handler.ts`, and for the same reason.
//
// -----------------------------------------------------------------------------
// WHY THE CLIENT CANNOT CALL auth-service DIRECTLY
// ------------------------------------------------------------------------------
//
// Because `NEXT_PUBLIC_AUTH_API_URL` points at the browser-visible auth host and
// that origin does not send CORS headers for these routes. A `POST` with
// credentials from eight different origins would need
// `Access-Control-Allow-Origin` per origin and `Allow-Credentials`, which is a
// wider CORS surface than a same-origin relay needs.
//
// The relay also means the browser never handles the auth-service address for
// presence at all, so a misconfigured `NEXT_PUBLIC_*` cannot point presence
// traffic somewhere unexpected.
//
// -----------------------------------------------------------------------------
// WHY THE COOKIE IS FORWARDED RATHER THAN A HEADER
// -----------------------------------------------------------------------------
//
// The browser sends an httpOnly session cookie and cannot attach a bearer header
// by hand - that is the property `httpOnly` exists for. So the cookie is read here,
// on the server, and turned into the header auth-service expects.
//
// The presence cookie is forwarded too, unchanged. auth-service SETS it (httpOnly,
// so the browser cannot write it) and the relay must pass it back or every
// heartbeat after the first would arrive with no session and be rejected.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

/** Session cookie, set by the apps' own `/api/auth/login`. */
const SESSION_COOKIE = 'wideo11_session';

/**
 * Presence cookie, set by auth-service. Forwarded verbatim.
 *
 * Not named here as a second constant to keep in sync - it is passed through
 * without interpretation, so there is nothing to sync. This comment records why
 * the name is absent, because "why isn't this in the list" is a fair question and
 * the answer is that the relay never parses it.
 */
const PRESENCE_COOKIE = 'wideo11_presence';

/**
 * Relay one presence call.
 *
 * `subpath` is constrained to the three known endpoints rather than taken from the
 * caller. A relay that forwarded an arbitrary path would be an open proxy into
 * auth-service: `GET /api/auth/presence/../../../admin/ledger` is the shape of that
 * bug, and "the client told us the path" is how it gets there.
 */
export async function forwardPresence(
  request: Request,
  subpath: 'start' | 'heartbeat' | 'end'
): Promise<NextResponse> {
  const jar = cookies();

  const session = jar.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: 'sign_in_required', message: 'Sign in to be shown as online.' },
      { status: 401 }
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session}`,
  };

  // ---- Forward the presence cookie INBOUND ----
  //
  // The response path has always forwarded this cookie back to the browser. The
  // request path never sent it TO auth-service, which is where it is actually
  // needed: `presence.Heartbeat` resolves the row with `c.Cookie(PresenceCookie)`,
  // and with no cookie in the request it answers 428.
  //
  // The visible result was confusing in a specific way: `/start` worked, so
  // presence appeared to be functioning and `user_sessions` filled up and Online Now
  // went to 1 — while every subsequent heartbeat returned 428. A feature that half
  // works reads as a flaky feature, so the next person would go looking for a race
  // in the server rather than a missing header in the relay.
  //
  // Only the presence cookie is forwarded. The session cookie is NOT, because it has
  // already been converted into the `Authorization` header above; sending both
  // would leave auth-service with two credentials for one identity.
  const presenceCookie = jar.get(PRESENCE_COOKIE)?.value;
  if (presenceCookie) {
    headers.Cookie = `${PRESENCE_COOKIE}=${presenceCookie}`;
  }

  // ---- Device identity ----
  //
  // Read from the REQUEST HEADER, not from a cookie.
  //
  // The first version read `jar.get('wideo11_fingerprint')`, and a search of the
  // repo found exactly one reference to that cookie: the line reading it. Nothing
  // ever SET it. So every request arrived with no device, `distinct_devices`
  // counted zero, and the panel looked broken while actually being unanswered.
  //
  // The client now sends `X-Device-Id` on every presence call - a random per-browser
  // id in localStorage, minted by `PresenceTracker`. The cookie lookup is kept as a
  // fallback for a caller that established one by some other route, but it is not
  // the primary path any more because the primary path had no writer.
  //
  // This is the same lesson as the seven copies of `/api/audit` and the four
  // unwired presence writers: a value read from somewhere nothing writes is not a
  // value, it is a shape that compiles.
  const deviceId =
    request.headers.get('x-device-id')?.trim() ||
    jar.get('wideo11_device_id')?.value?.trim() ||
    '';

  if (deviceId) {
    // Sent as `X-Fingerprint` because that is the header auth-service already reads
    // on every auth call. Renaming the server-side header for one caller would
    // give the same concept two names, and the next reader would not know which is
    // authoritative.
    headers['X-Fingerprint'] = deviceId;
    headers['X-Device-Name'] = request.headers.get('x-device-name') ?? 'browser';
    headers['X-Platform'] = request.headers.get('x-platform') ?? '';
  }

  try {
    const res = await fetch(`${AUTH_INTERNAL}/api/v1/auth/presence/${subpath}`, {
      method: 'POST',
      headers,
      cache: 'no-store',
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const out = NextResponse.json(payload, { status: res.status });

    // Pass the presence cookie through on EVERY response, not only on `/start`.
    //
    // auth-service sets it with an eight-hour lifetime, so it survives across
    // tabs and reloads without re-establishing. But if it ever rotates or is
    // cleared, `/start` is the only call that would set it again - so forwarding
    // it unconditionally is what makes the flow self-healing. Forwarding only on
    // `/start` works right up until the cookie expires, and then every heartbeat
    // fails with 428 until a full page reload happens to call start.
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      for (const raw of splitSetCookie(setCookie)) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();

        if (name === PRESENCE_COOKIE) {
          const isClear = /(^|;\s*)max-age=0/i.test(raw);
          out.cookies.set({
            name,
            value,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: isClear ? 0 : 8 * 60 * 60,
          });
        } else if (name === SESSION_COOKIE) {
          // Never re-issue the session cookie from here. It is auth-service's to
          // set and the apps' `/api/auth/login` to establish; a relay that
          // resurrected it could extend a session that was deliberately cleared.
          continue;
        }
      }
    }

    return out;
  } catch {
    // Upstream unreachable. Deliberately NOT 401: a presence beat that cannot
    // reach auth-service is an infrastructure problem, and reporting it as "not
    // signed in" would have the client tear down a valid session.
    return NextResponse.json(
      { error: 'upstream_unavailable', message: 'Cannot reach the authentication service.' },
      { status: 503 }
    );
  }
}

/**
 * Split a `Set-Cookie` header into individual cookies.
 *
 * A `Set-Cookie` value can legally contain a comma inside `Expires`, so splitting
 * on "," corrupts it. Splitting on a comma that is followed by `token=` is the
 * reliable approximation and is what every framework does.
 */
function splitSetCookie(header: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < header.length; i++) {
    if (header[i] === ',' && /token\s*=/.test(header.slice(i + 1, i + 40))) {
      parts.push(current.trim());
      current = '';
    } else {
      current += header[i];
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

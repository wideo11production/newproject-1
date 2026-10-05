// Exchange a refresh token for a new session.
//
// ----------------------------------------------------------------------------
// WHY THIS ROUTE IS THE WHOLE POINT OF A 7-DAY LOGIN
// ----------------------------------------------------------------------------
//
// The access token is a 15-minute JWT. auth-service ALSO issues a refresh token
// with a 7-day TTL. Until this route existed, every app in the stack kept the
// access token and threw the refresh token away - so every user was logged out
// every 15 minutes, and the longest-lived credential in the system had zero
// readers.
//
// This route is what a client calls to renew. The cookie carries the refresh
// token, so the browser never handles it.
//
// ---- WHY NOT JUST MAKE THE ACCESS TOKEN LAST 7 DAYS ----
//
// Because that is the worse trade and it is the one you reach for first:
//
//   access token = 7 days  ->  a single leaked token is a 7-day takeover, and
//                              nothing short of the denylist revokes it early.
//   access token = 15 min  ->  a leaked token is worthless inside a quarter of
//                              an hour, and the session still feels permanent
//                              because this route mints a replacement silently.
//
// The user-visible result is the same. The difference only shows up on the day
// something leaks.
//
// ---- ROTATION ----
//
// auth-service returns a NEW refresh token with every call, and this route
// overwrites the cookie with it. That is deliberate on the server's side and this
// route must not cache the old one: a refresh token that is never replaced after
// use is a replayable credential.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

// NOT exported.
//
// A `route.ts` file may only export the HTTP methods plus Next's own config keys
// (`dynamic`, `revalidate`, `runtime`, ...). Exporting an arbitrary constant
// fails the typed-routes check at build time with:
//
//   Type error: Route "src/app/api/auth/refresh/route.ts" does not match the
//   required types of a Next.js Route.
//
// Which is a good error, actually - it is the build refusing a file whose exports
// do not describe a route. Nothing outside this file needs the name, so it is a
// plain `const`.
const REFRESH_COOKIE = 'wideo11_refresh';
const SESSION_COOKIE = 'wideo11_session';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

// The `request` parameter is unused, and that is deliberate.
//
// Next.js's typed-routes check rejects a zero-argument `POST`. The signature has
// to match what a Route is allowed to be, so the parameter exists to satisfy the
// type - and the cookie is read from `cookies()` rather than from the argument
// because `cookies()` is the API that works in a Route Handler at all.
//
// The alternative, `POST(request: Request)` and then
// `request.headers.get('cookie')`, is the pattern used in
// `packages/ui/src/audit-handler.ts` and it avoids this question entirely. It is
// not used here only for consistency with the sibling login/logout routes in
// this app, which already use `cookies()`.
export async function POST(_request: Request) {
  const refreshToken = cookies().get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    // No refresh token is not an error worth dressing up. It means "this browser
    // has nothing to renew with", which is the signed-out case.
    return NextResponse.json(
      { error: 'no_refresh_token', message: 'No refresh token. Sign in again.' },
      { status: 401 }
    );
  }

  let payload: { tokens?: Record<string, unknown> };

  try {
    const res = await fetch(`${AUTH_SERVICE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });

    // 401 here means the refresh token is expired, revoked, or already used.
    // All three mean the same thing to the caller: this session is over, start
    // again. So the refresh cookie is CLEARED rather than left in place - a dead
    // refresh token retried on every request is a guaranteed 401 forever, and the
    // user sees a sign-in loop with no explanation.
    if (res.status === 401) {
      const out = NextResponse.json(
        { error: 'refresh_rejected', message: 'Your session has expired. Sign in again.' },
        { status: 401 }
      );
      clearAuthCookies(out);
      return out;
    }

    if (!res.ok) {
      // Upstream problem, NOT a dead session. 5xx must not clear the cookies,
      // because doing so logs the user out during an auth-service blip - and
      // then their 7-day session really is gone because of a transient error.
      return NextResponse.json(
        { error: 'refresh_unavailable', message: 'Cannot reach the authentication service.' },
        { status: 503 }
      );
    }

    payload = (await res.json()) as { tokens?: Record<string, unknown> };
  } catch {
    // Same reasoning as the 5xx above: unreachable is not "your session ended".
    return NextResponse.json(
      { error: 'refresh_unavailable', message: 'Cannot reach the authentication service.' },
      { status: 503 }
    );
  }

  const accessToken = payload.tokens?.access_token;
  const newRefresh = payload.tokens?.refresh_token;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'refresh_failed', message: 'Authentication returned no session token.' },
      { status: 502 }
    );
  }

  const out = NextResponse.json({ refreshed: true });
  const secure = process.env.NODE_ENV === 'production';
  const expiresInSec = Number(payload.tokens?.expires_in) || 900;

  out.cookies.set({
    name: SESSION_COOKIE,
    value: String(accessToken),
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: expiresInSec,
  });

  // ---- Rotation ----
  //
  // auth-service issues a new refresh token each time. It MUST replace the old
  // one; keeping the previous value would leave a replayable credential in the
  // browser for the rest of its 7-day life.
  if (newRefresh) {
    out.cookies.set({
      name: REFRESH_COOKIE,
      value: String(newRefresh),
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: maxAgeFor(String(newRefresh)),
    });
  }

  return out;
}

/** Clear both cookies. `maxAge: 0` is what deletes a cookie in a response. */
function clearAuthCookies(res: NextResponse) {
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    res.cookies.set({
      name,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
  }
}

/**
 * Seconds until the refresh token's own expiry, capped at 7 days.
 *
 * Decoding is sufficient and safe HERE SPECIFICALLY: this sizes a cookie, it does
 * not authorise anything. The signature is checked by auth-service on every real
 * use. An unreadable token falls back to 7 days, the configured TTL.
 */
function maxAgeFor(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as { exp?: number };

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return SEVEN_DAYS;

    const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
    // A `maxAge` of 0 DELETES the cookie, so never return one for a token that is
    // merely close to expiry - that would turn "about to expire" into "already
    // gone" and log the user out a minute early, every time.
    if (secondsLeft <= 60) return SEVEN_DAYS;
    return Math.min(secondsLeft, SEVEN_DAYS);
  } catch {
    return SEVEN_DAYS;
  }
}

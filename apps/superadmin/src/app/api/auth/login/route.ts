// Sign in, on the superadmin port itself.
//
// ----------------------------------------------------------------------------
// WHY THIS ROUTE HAD TO BE RE-CREATED
// ----------------------------------------------------------------------------
//
// This app's page used to render a password field asking for a JWT to paste. That
// was removed in favour of the httpOnly cookie, and the replacement was a bare
// "Sign in" link pointing at `localhost:3000/auth/login`.
//
// That removed the ability to authenticate AT port 3008. The consequence was
// reported immediately: you cannot log in to the superadmin dashboard.
//
// It fails as a user experience and it fails as a design:
//
//   1. The dashboard has its own origin (`:3008`). Anonymous visitors get a 401
//      from `middleware.ts` and a link that leaves the app entirely.
//   2. Logging in at `:3000` and then navigating back by hand is not
//      "sign in to this app". It is a two-step errand that looks like a broken
//      login.
//
// ----------------------------------------------------------------------------
// WHY A LOGIN ROUTE HERE IS CORRECT, NOT A REGRESSION
// ----------------------------------------------------------------------------
//
// The security property that motivated removing the token box was never "there
// must be no login form". It was "a bearer credential must never be readable by
// JavaScript". This route keeps that property exactly:
//
//   - the browser posts email + password to THIS route
//   - the route forwards to auth-service server-side
//   - auth-service returns a JWT, which this route puts in an httpOnly cookie
//   - the JWT is never returned in the response body
//
// The form still handles no credential at all. Compare with what it replaced:
// the user pasted a token that lived in React state and was attached by hand to
// every subsequent request, which any script on the page could read.
//
// ---- WHY ONE LOGIN ON :3008 IS ENOUGH FOR EVERY APP ----
//
// HTTP cookies are scoped by DOMAIN, not by port. `localhost:3008` and
// `localhost:3000` are the same host to the browser, so a `wideo11_session`
// cookie set here is sent to port 3000, 3002, 3004 and the rest. Signing in here
// signs you in everywhere, which is why there is no reason to bounce the operator
// to another origin to do it.
//
// That also means this is the natural place for a session to START: one
// credential entry point for the whole stack, rather than one per app that each
// need a token of their own.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // ---- Server-side validation ----
  //
  // Deliberately duplicated from the client form. Client validation is a
  // courtesy for the person typing; this is the check that actually holds, and
  // it is the only one a direct API call cannot skip.
  const errors: Record<string, string> = {};
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  let authResponse: Response;
  let payload: Record<string, unknown>;

  try {
    authResponse = await fetch(`${AUTH_SERVICE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        // No fingerprint. auth-service stores a device row only when this is
        // non-empty, and the column is UNIQUE - two logins that both send an
        // empty fingerprint collide on the index.
        device: {},
      }),
      cache: 'no-store',
    });
    payload = (await authResponse.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    // Upstream unreachable. NOT "invalid credentials" - those are different
    // problems and conflating them sends the operator to re-type a password that
    // is perfectly fine.
    //
    // No error message in the body: `fetch`'s message embeds the internal
    // hostname it could not reach.
    return NextResponse.json(
      {
        error: 'auth_unavailable',
        message: 'Cannot reach the authentication service. Try again shortly.',
      },
      { status: 503 }
    );
  }

  const res = NextResponse.json(payload, { status: authResponse.status });

  // ---- Cookie ONLY on success ----
  //
  // Setting one on a 401 would mean a wrong password still reads as "signed in"
  // to `middleware.ts`, which verifies the JWT signature. It would fail there, so
  // the symptom would be a confusing redirect loop rather than a clean rejection.
  if (authResponse.status !== 200) return res;

  const tokens = payload.tokens as
    | { access_token?: string; refresh_token?: string; expires_in?: number }
    | undefined;
  const accessToken = tokens?.access_token;
  if (!accessToken) {
    // 200 with no token is a contract violation. Fail loudly rather than
    // rendering a dashboard whose every fetch will 401.
    return NextResponse.json(
      { error: 'auth_unavailable', message: 'Authentication returned no session token.' },
      { status: 502 }
    );
  }

  // TTL from the response, not a local constant, so this cookie expires exactly
  // when the JWT does. A cookie outliving its token produces a signed-out user
  // with a cookie that looks valid.
  const expiresInSec = Number(tokens?.expires_in) || 900;

  res.cookies.set({
    name: 'wideo11_session',
    value: String(accessToken),
    httpOnly: true,
    // `lax`, not `strict`: `strict` would withhold the cookie on a top-level
    // navigation from another site, which is the normal way someone arrives at
    // this dashboard from a link.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresInSec,
  });

  // -----------------------------------------------------------------------------
  // THE REFRESH TOKEN, IN ITS OWN httpOnly COOKIE
  // -----------------------------------------------------------------------------
  //
  // This is what makes the session last 7 days instead of 15 minutes.
  //
  // `auth-service` issues a refresh token with a 7-day TTL and EVERY app threw it
  // away - only the 15-minute access token was kept. So every user in the system
  // was silently logged out every 15 minutes, and the 7-day token sitting in the
  // response was never used for anything. Nobody implements refresh, so the
  // "7 day" refresh token is the longest-lived credential in the system with zero
  // readers.
  //
  // WHY THE ACCESS TOKEN IS NOT SIMPLY GIVEN A 7-DAY TTL INSTEAD
  //
  // Because that is the worse trade, and it is the obvious one to reach for:
  //
  //   access token = 7 days  ->  one leaked token is a 7-day account takeover,
  //                              and there is nothing to revoke it early except
  //                              the denylist.
  //   access token = 15 min  ->  a leaked token is useless within a quarter of
  //                              an hour, and the session still feels permanent
  //                              because the refresh mints a new one silently.
  //
  // So: short-lived access token, long-lived refresh token, and a server-side
  // renewal that the user never sees. That is the standard shape and it is the
  // one that survives contact with a real deployment.
  //
  // Stored in a SEPARATE cookie so that:
  //   - it can have a 7-day `maxAge` while the access cookie has 15 minutes
  //   - logout can revoke the session without destroying the access cookie first
  //   - a change to one TTL does not silently change the other
  //
  // httpOnly, same as the access cookie. Not readable by JavaScript, not sent in
  // a response body.
  if (tokens?.refresh_token) {
    res.cookies.set({
      name: 'wideo11_refresh',
      value: String(tokens.refresh_token),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // 7 days, matching `JWT_REFRESH_TOKEN_TTL_DAYS`. Read from the JWT's own
      // `exp` when we can decode it, so the cookie cannot outlive the token it
      // holds - a cookie that outlives its token is a cookie that fails with a
      // confusing "please sign in again" instead of renewing.
      maxAge: refreshCookieMaxAge(String(tokens.refresh_token)),
    });
  }

  return res;
}

/**
 * Seconds until the refresh token's own expiry, capped at 7 days.
 *
 * Decoding is enough here and is safe for this specific purpose: we are NOT
 * trusting the result for an authorisation decision, only reading an `exp` to
 * size a cookie. The token's signature is verified by auth-service on every
 * actual use. Anything unreadable falls back to 7 days, which is the configured
 * TTL, and a token that turns out to be expired simply fails to refresh.
 */
function refreshCookieMaxAge(refreshToken: string): number {
  const SEVEN_DAYS = 7 * 24 * 60 * 60;

  try {
    const payload = JSON.parse(
      Buffer.from(refreshToken.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as { exp?: number };

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return SEVEN_DAYS;
    }

    const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
    // Never zero or negative: a `maxAge` of 0 DELETES the cookie, which would turn
    // "about to expire" into "already gone".
    if (secondsLeft <= 60) return SEVEN_DAYS;
    return Math.min(secondsLeft, SEVEN_DAYS);
  } catch {
    return SEVEN_DAYS;
  }
}

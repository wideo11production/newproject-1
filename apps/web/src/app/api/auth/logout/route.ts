// POST /api/auth/logout - end the session on THIS device.
//
// =============================================================================
// WHY THIS EXISTS AT ALL
// =============================================================================
//
// The web app had a login route that SET the session cookie and no route that
// cleared it. The user menu's "Sign out" button therefore had nothing to call,
// and a signed-in user could only sign out by clearing cookies by hand.
//
// A logout that does not exist is not a missing feature, it is a security
// feature that is absent: on a shared machine, "I signed out" has to actually
// mean the next person is not the one who was here before.
//
// =============================================================================
// ORDER MATTERS, AND THE OBVIOUS ORDER IS WRONG
// =============================================================================
//
//   1. Revoke the session SERVER-SIDE, at auth-service.
//   2. Only then clear the cookie.
//
// Clearing the cookie first looks tidier and is a real bug: if step 1 then fails
// (auth-service down, network blip), the browser no longer has a token - so the
// user believes they signed out - but the session row is still live, and any
// copy of that token still works. The user is told they are safe while a live
// credential exists.
//
// Reversing it means a failed revoke leaves the user still signed IN, which is
// an honest and recoverable failure. A failed revoke that told them they were
// signed out is not.
//
// =============================================================================
// LOGOUT MUST CLEAR BOTH COOKIES
// =============================================================================
//
// Logout that only clears `wideo11_session` leaves `wideo11_refresh` alive.
// The next login then finds a stale refresh token and the user is effectively
// still signed in. Clear BOTH so logout means logout.
//
// =============================================================================

import { NextResponse } from 'next/server';

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

const SESSION_COOKIE = 'wideo11_session';
const REFRESH_COOKIE = 'wideo11_refresh';

/**
 * Should the session cookie be marked Secure?
 *
 * Same rule as login: was THIS request encrypted, never "are we a production
 * build". If login set `secure: false` (plain http), logout must also use
 * `secure: false` or the browser keeps two cookies with different scopes and
 * the user stays "signed in" after logout.
 */
function shouldBeSecure(req: Request, nextUrl: URL): boolean {
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return nextUrl.protocol === 'https:';
}

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  let token = '';

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      token = decodeURIComponent(part.slice(eq + 1).trim());
      break;
    }
  }

  let revoked = false;
  let detail = 'no session cookie present';

  if (token) {
    try {
      const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      revoked = res.ok;
      detail = res.ok ? 'session revoked' : `auth-service returned ${res.status}`;
    } catch (e) {
      detail = `auth-service unreachable: ${e instanceof Error ? e.message : 'unknown'}`;
    }
  }

  const res = NextResponse.json({ ok: true, revoked, detail });

  const nextUrl = new URL(request.url);
  const secure = shouldBeSecure(request, nextUrl);

  // Clear BOTH session AND refresh cookies. Logout that only clears the session
  // leaves the refresh token alive, so the user is still "logged in" on the next
  // page load and cannot truly sign out.
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });

  res.cookies.set({
    name: REFRESH_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });

  return res;
}

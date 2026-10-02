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

import { NextResponse } from 'next/server';

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

const SESSION_COOKIE = 'wideo11_session';

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
      // The session is DEVICE-scoped: this revokes the token the browser is
      // holding, and nothing else. A person signed in on their phone stays
      // signed in there, which is why the user menu says so in plain words.
      const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      revoked = res.ok;
      detail = res.ok ? 'session revoked' : `auth-service returned ${res.status}`;
    } catch (e) {
      // NOT fatal, and the cookie is still cleared below.
      //
      // The alternative is the worst outcome available: the user cannot sign out
      // at all because a dependency is down. Clearing the cookie locally still
      // stops THIS browser from sending it, which is the part the user asked
      // for; the server-side row is left to expire.
      detail = `auth-service unreachable: ${e instanceof Error ? e.message : 'unknown'}`;
    }
  }

  const res = NextResponse.json({ ok: true, revoked, detail });

  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    // The flags MUST match the ones login used, or the browser keeps a second
    // cookie with the same name and a different scope - and the user stays
    // "signed in" to a route that never sees the new one.
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // dev is plain http; login uses shouldBeSecure()
    path: '/',
    maxAge: 0,
  });

  return res;
}

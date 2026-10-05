// Sign out, for real.
//
// WHY THIS ROUTE IS NECESSARY
//
// The dashboard's "Sign out" button used to be `setToken('')` - a React state
// change that cleared a text field and nothing else. No server call, no
// revocation. The JWT the operator had pasted stayed valid until it expired on
// its own, which for a superadmin credential is minutes-to-hours of continued
// access to every user's data after somebody believed they had signed out.
//
// That is not a cosmetic bug. A control labelled "Sign out" is a claim the
// product makes about its own state, and this one was false. The worst case is
// specific: an operator signs out on a shared machine, hands it to the next
// person, and the session cookie - which the dashboard now uses instead of a
// pasted token - is still there.
//
// WHAT IT DOES
//
//   1. Calls auth-service `/logout`, which revokes the session server-side and
//      adds the session id to the Redis denylist. That denylist is what
//      `CheckRevoked` reads on every subsequent request, so revocation takes
//      effect immediately rather than at token expiry.
//
//   2. Clears the cookie in the response, using the same attributes it was set
//      with. A cookie cleared with the wrong `Path` or `Domain` is not cleared -
//      it simply survives, and the operator is signed straight back in.
//
// `keepalive: true` on the client call so this survives the navigation that
// usually follows a sign-out.
//
// Not a hard dependency: if auth-service is unreachable, the cookie is cleared
// anyway and the client drops its state. A user pressing "Sign out" on a broken
// network should end up signed out locally, not staring at an error while their
// session lives on.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';
const REFRESH_COOKIE = 'wideo11_refresh';

export async function POST() {
  const token = cookies().get(SESSION_COOKIE)?.value;

  // Revoke server-side first. Best-effort: an unreachable auth-service must not
  // leave the operator stuck on a dashboard they have asked to leave.
  if (token) {
    try {
      await fetch(`${AUTH_INTERNAL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch {
      // Deliberately swallowed. The cookie is cleared below either way, and the
      // denylist entry will be absent - which means the token would still verify
      // if it were somehow replayed. That is worth logging on the server side,
      // and this route has no logger, so it is noted here instead of pretended
      // away.
    }
  }

  const res = NextResponse.json({ ok: true });

  // BOTH cookies, each with `path: '/'`.
  //
  // `path` matters more than it looks: the cookie is set at the root so every app
  // on the domain can see it, and clearing one scoped to a narrower path leaves
  // the original intact - so the operator clicks "Sign in" and is straight back
  // in, with no way to tell that sign-out did not work.
  //
  // Clearing the REFRESH cookie is what makes the sign-out STICK. With a 7-day
  // session, revoking only the access token leaves a valid 7-day credential in
  // the browser, and the next silent refresh signs the user straight back in.
  //
  // `maxAge: 0` is what deletes a cookie in a response - setting an empty value
  // alone does not.
  const secure = process.env.NODE_ENV === 'production';
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    res.cookies.set({
      name,
      value: '',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  return res;
}

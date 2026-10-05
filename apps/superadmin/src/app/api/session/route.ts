// Is this browser signed in as a superadmin?
//
// WHY THIS ROUTE EXISTS
//
// `src/middleware.ts` already gates every page and API route in this app behind a
// real session with `requireRole: ['superadmin']`. The page component had no way
// to ASK that question, so it asked the user instead: it rendered a password
// field and asked for a JWT to paste.
//
// That produced the contradiction the middleware's own comment described - "this
// file makes the pages require a real session, it does NOT remove the paste-a-
// bearer-token UI" - meaning the dashboard demanded two credentials at once, and
// the token half quietly undid the protections of the cookie half.
//
// So the answer to "am I signed in?" is a route. It reads the same httpOnly
// cookie the middleware reads, and answers yes or no. The browser never handles a
// token, which is what makes the cookie approach worth having.
//
// WHY IT VERIFIES, AND DOES NOT JUST DECODE
//
// Reading the cookie and decoding its payload would tell you a role. It would
// also tell you a role to ANYONE who pastes any string into a cookie jar, because
// an unverified base64 decode reads whatever the bytes claim. So this calls
// auth-service, which holds the signing key and actually checks the signature,
// then checks the role from the PROFILE rather than from the token's own claim.
//
// The distinction is the whole reason `packages/ui/jwt-payload.ts` warns so
// loudly about its own `jwtPayload()` helper: that helper is fine for labelling a
// log row and useless as an authorisation input.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json(
      { authenticated: false, reason: 'no_session' },
      { status: 401 }
    );
  }

  let profile: Record<string, unknown>;
  try {
    const res = await fetch(`${AUTH_INTERNAL}/api/v1/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      // A real answer, not an error to display. The UI's job is to show the
      // signed-out screen here; anything else and it shows a failure instead of
      // an invitation to sign in.
      return NextResponse.json(
        { authenticated: false, reason: 'session_rejected' },
        { status: 401 }
      );
    }

    if (!res.ok) {
      // 5xx from auth-service is NOT "not signed in". Saying so would show a
      // sign-in prompt during an auth-service outage, which sends the operator
      // to re-enter credentials that are perfectly fine.
      //
      // No error message: it embeds the internal hostname.
      return NextResponse.json(
        { authenticated: false, reason: 'auth_unavailable' },
        { status: 503 }
      );
    }

    profile = (await res.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { authenticated: false, reason: 'auth_unavailable' },
      { status: 503 }
    );
  }

  const role = String(profile.role ?? '');
  const isSuperadmin = role === 'superadmin' || role === 'recovery';

  // `authState` on the client distinguishes these, so the UI can say
  // "sign in as a superadmin" rather than the useless "forbidden".
  return NextResponse.json(
    {
      authenticated: isSuperadmin,
      role,
      email: String(profile.email ?? ''),
      reason: isSuperadmin ? 'ok' : 'wrong_role',
    },
    { status: isSuperadmin ? 200 : 403 }
  );
}

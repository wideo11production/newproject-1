// GET /api/session - who is this browser?
//
// =============================================================================
// WHY THE WEB APP NEEDED THIS
// =============================================================================
//
// The web app's root page rendered hardcoded "Log in" and "Register" links and
// never read the session. So a signed-in user landed on the home page and was
// told they were signed out.
//
// The editor already had this route, and it worked. The web app did not have one
// at all. So this is the SAME contract, not a new idea - the shared
// `SessionUserMenu` in `@wideo11/ui` reads whichever app it is rendered in, and
// both apps answer it identically.
//
// =============================================================================
// WHAT THE COOKIE IS AND IS NOT USED FOR
// =============================================================================
//
// The session cookie is `httpOnly`. This is deliberate and this route is why
// that is workable: the browser's JavaScript can never read the token, but a
// SERVER route can. The browser learns only the answer to "is somebody signed
// in, and what is their email" - never the credential.
//
// That is the whole design. A client-side `document.cookie` read would be a
// regression in the security model, and it would also not work.
//
// Identity here is for ATTRIBUTION - an avatar, a name, a "you cannot do this"
// message. It authorises nothing. Every real permission check goes to
// auth-service with the token itself.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

const SESSION_COOKIE = 'wideo11_session';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Never cached. A cached "signed out" is exactly the bug this route exists to
  // remove, and a cached "signed in" would show one person's identity to another.
  const noStore = { 'Cache-Control': 'no-store' };

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ state: 'out', email: '', role: '' }, { headers: noStore });
  }

  try {
    // A 401 or 403 means the token is expired, revoked or forged. All three
    // answer the same way, and deliberately so: a caller that could tell
    // "expired" from "revoked" would be able to probe session state.
    const res = await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ state: 'out', email: '', role: '' }, { headers: noStore });
    }
    if (!res.ok) {
      // Auth-service is down or erroring. Answer "out".
      //
      // This is the fail-CLOSED direction, and it is the same reason the
      // permission lookup fails closed: a permission check that fails open is a
      // privilege escalation, and a session check that fails open tells a
      // stranger they are signed in.
      return NextResponse.json({ state: 'out', email: '', role: '' }, { headers: noStore });
    }

    const profile = (await res.json()) as {
      email?: string;
      is_verified?: boolean;
      is_active?: boolean;
      avatar_url?: string;
    };

    if (profile.is_active === false) {
      return NextResponse.json({ state: 'out', email: '', role: '' }, { headers: noStore });
    }

    // The ordered states, matching the editor exactly. A user who has not
    // verified is still a real signed-in identity, so they get an avatar with an
    // AMBER ring rather than being told they are logged out - they are not.
    const state = profile.is_verified === true ? 'ready' : 'needs_verification';

    return NextResponse.json(
      {
        state,
        email: profile.email ?? '',
        role: 'user',
        // The one image the user uploaded, so the SAME avatar appears everywhere.
        //
        // Before this, the account menu and the editor's account menu both drew
        // INITIALS while the profile page drew the real image - so the same
        // person had two different faces depending on the page.
        //
        // CAMEL CASE ON PURPOSE, and it cost a round of debugging to notice: this
        // route originally returned `avatar_url`, matching auth-service's
        // `/profile`, while every TypeScript consumer reads `avatarUrl`. The
        // component therefore saw `undefined` and drew initials - with no error
        // anywhere, because an empty string is a perfectly valid answer.
        //
        // The auth-service field keeps its snake_case (it is a Go JSON
        // convention and used by four other clients); THIS route is the
        // TypeScript-facing edge, so it converts once, here, instead of leaving
        // every caller to guess which spelling they got.
        avatarUrl: profile.avatar_url ?? '',
      },
      { headers: noStore }
    );
  } catch {
    return NextResponse.json({ state: 'out', email: '', role: '' }, { headers: noStore });
  }
}

// ============================================================================
// Session / gate state - server-side session probe
// ============================================================================
//
// WHY THIS ROUTE EXISTS (and why the browser cannot do this job itself)
//
// The session lives in an httpOnly cookie (`wideo11_session`) that the WEB app
// sets. Client JS cannot read it - which is the point of httpOnly - so the
// browser cannot turn it into an `Authorization: Bearer` header. And auth-service
// accepts ONLY that header: verified here, a cookie-only request to
// `/api/v1/auth/profile` returns `401 {"error":"missing authorization header"}`.
//
// That is why this is a SERVER route and not a `fetch` from a component. The
// server can read the cookie (`next/headers`) and attach the header.
//
// It also means the editor's existing `auth-nav.tsx`, which probes
// `/api/v1/auth/profile` straight from the browser, was ALWAYS getting 401 and
// therefore always rendering the signed-out state - even with a perfectly valid
// session. The editor's own middleware used to hide that: it never let an
// anonymous visitor reach the UI at all. Now that the gate is in-app (see
// `components/chrome/access-gate.tsx`), that latent bug becomes visible, so the
// gate reads its state from THIS route instead.
//
// ----------------------------------------------------------------------------
// WHAT IT RETURNS
// ----------------------------------------------------------------------------
//
// One shape, four states, in the order the user must satisfy them:
//
//   out               - no session at all            -> show Sign up / Log in
//   needs_verification- session, email not verified  -> "check your email"
//   needs_setup       - verified, security setup due -> mandatory setup
//   ready             - verified + setup complete    -> render the editor
//
// The order is the whole point. Security setup (6-digit PIN) is a real
// credential, and letting someone set one up on an account whose email address
// has not been proven is how you get an account takeover. Verify first.
//
// FAIL-CLOSED: any auth-service error resolves to the most restrictive state
// that still lets the user make progress. We never return `ready` on an error.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Server-side reachable auth-service. Inside compose the docker-network name
// resolves; from the host it is the published port. Both are in the env block.
const AUTH_INTERNAL_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  'http://localhost:8085';

const SESSION_COOKIE = 'wideo11_session';

/** Force this route to run per request - never serve a cached session state. */
export const dynamic = 'force-dynamic';

export type GateState =
  | { state: 'out' }
  | { state: 'needs_verification'; email: string; avatarUrl: string }
  | { state: 'needs_setup'; email: string; avatarUrl: string }
  | { state: 'ready'; email: string; role: string; avatarUrl: string };
// `{ state: 'out' }` carries no avatar - there is nobody to draw.

export async function GET() {
  const noStore = { 'Cache-Control': 'no-store' } as const;

  // ---- 1. Session cookie present? ----
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ state: 'out' }, { headers: noStore });
  }

  // ---- 2. Ask auth-service about this user ----
  //
  // Both calls need the cookie's VALUE as a bearer token; the cookie value IS
  // the JWT, so nothing is parsed or trusted here - auth-service verifies the
  // signature. A forged or expired token comes back 401 and we degrade to
  // `out`, which is exactly right.
  const authHeaders = { Authorization: `Bearer ${token}` };

  let profile: { email?: string; is_verified?: boolean; is_active?: boolean; avatar_url?: string } | null = null;
  let setupComplete = false;

  try {
    // Both requests are independent, and this runs on every gate render, so
    // they go in parallel rather than one after the other.
    const [profileRes, setupRes] = await Promise.all([
      fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/profile`, {
        headers: authHeaders,
        cache: 'no-store',
      }),
      fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/security/setup-status`, {
        headers: authHeaders,
        cache: 'no-store',
      }),
    ]);

    if (profileRes.status === 401 || setupRes.status === 401) {
      // Token rejected: expired, tampered with, or session revoked server-side.
      return NextResponse.json({ state: 'out' }, { headers: noStore });
    }

    if (profileRes.ok) {
      profile = await profileRes.json().catch(() => null);
    }
    if (setupRes.ok) {
      const setup = await setupRes.json().catch(() => null);
      setupComplete = setup?.setup_complete === true;
    }
  } catch {
    // auth-service unreachable. We do NOT know the user's state, and
    // "unknown" must never become "allowed".
    return NextResponse.json(
      { state: 'out', error: 'auth service unreachable' },
      { headers: noStore }
    );
  }

  // ---- 3. Fold the answers into one ordered state ----
  //
  // No usable profile means we could not identify the user. Fail closed.
  if (!profile?.email) {
    return NextResponse.json({ state: 'out' }, { headers: noStore });
  }

  const email = profile.email;

  // A deactivated account is treated as signed out rather than as a special
  // state, so the client has one fewer branch to handle and the user gets the
  // sign-in affordance rather than an error screen.
  if (profile.is_active === false) {
    return NextResponse.json({ state: 'out' }, { headers: noStore });
  }

  // ORDER MATTERS. Email verification is checked FIRST, so an unverified
  // account is never told to set up a 6-digit PIN.
  if (profile.is_verified !== true) {
    return NextResponse.json(
      { state: 'needs_verification', email, avatarUrl: profile.avatar_url ?? '' },
      { headers: noStore }
    );
  }

  if (!setupComplete) {
    return NextResponse.json({ state: 'needs_setup', email, avatarUrl: profile.avatar_url ?? '' }, { headers: noStore });
  }

  return NextResponse.json(
    { state: 'ready', email, role: 'user', avatarUrl: profile.avatar_url ?? '' },
    { headers: noStore }
  );
}

/**
 * DELETE /api/session - log out of this device.
 *
 * The same Bearer problem as the GET, in reverse: the editor's client cannot
 * build the auth-service logout call itself, so it cannot log the user out.
 * It also cannot clear the cookie - `httpOnly` means the browser hides it from
 * JavaScript by design, which is the same property that stops XSS from stealing
 * it.
 *
 * So the revocation happens here, server side, with the cookie's value used as
 * the bearer token. auth-service hard-deletes the session row, which is what
 * actually ends the session.
 *
 * We deliberately do NOT try to expire the cookie from here. The cookie belongs
 * to the `localhost` host and both apps share it, and the web app already owns
 * the code that clears it. Once the row is gone the cookie is inert - every
 * request with it fails auth - so leaving it in place costs nothing and avoids
 * two apps fighting over one cookie.
 */
export async function DELETE() {
  const noStore = { 'Cache-Control': 'no-store' } as const;
  const token = cookies().get(SESSION_COOKIE)?.value;

  // No cookie: already logged out. Report success rather than an error, because
  // from the caller's side the desired end state is the one that already holds.
  if (!token) return NextResponse.json({ ok: true }, { headers: noStore });

  try {
    await fetch(`${AUTH_INTERNAL_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    // Best effort. An unreachable auth-service cannot be allowed to strand the
    // user in a signed-in-looking UI, so the caller refreshes regardless and
    // sees the truth.
  }

  return NextResponse.json({ ok: true }, { headers: noStore });
}

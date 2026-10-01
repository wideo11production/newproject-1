// Shared helper: put the browser harness into "signed in" state.
//
// ============================================================================
// WHY THIS LOGS IN FOR REAL
// ============================================================================
//
// This used to set a hand-rolled, unsigned, JWT-SHAPED cookie. That was enough
// when the editor's gate lived in `src/middleware.ts`, because that middleware
// only decoded the payload and trusted its `exp` - it never verified a
// signature.
//
// The gate is now in-app (`components/chrome/access-gate.tsx`) and reads its
// state from `/api/session`, which forwards the cookie to auth-service as a
// bearer token. auth-service verifies the signature, so a fake token now comes
// back 401 and the harness would be shown the sign-in screen - every check in
// every browser tool would fail for a reason that has nothing to do with what it
// is testing.
//
// So this performs an actual HTTP login against the web app and lifts the
// session cookie out of the response. Same path a person takes.
//
// The account must exist and must be past BOTH gates, because the gate enforces
// an order rather than just "is there a session":
//
//   signed out -> email not verified -> security setup -> ready
//
// Run `node tools/provision-harness.mjs` once to create it.
//
// The credentials are local test fixtures with a known password. They are not
// secrets, and a real deployment would not ship an account like this.

import { execFileSync } from 'node:child_process';

const HARNESS_EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const HARNESS_PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

export const SESSION_COOKIE = 'wideo11_session';

/**
 * Log in over HTTP and return the raw `wideo11_session` cookie value.
 *
 * Throws with the response body on failure: a harness that silently continues
 * without a cookie produces a wall of unrelated check failures, and the real
 * cause (bad fixture, unverified account, rate limit) is the one thing worth
 * seeing.
 */
export async function login() {
  const res = await fetch(`${WEB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: HARNESS_EMAIL, password: HARNESS_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(
      `harness login failed: ${res.status} ${await res.text()}\n` +
        `If the account is missing or blocked, run: node tools/provision-harness.mjs`
    );
  }

  // `getSetCookie()` is the supported way to read repeated Set-Cookie headers;
  // `get('set-cookie')` would glue them together and corrupt the value.
  const cookies = res.headers.getSetCookie?.() ?? [];
  const hit = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!hit) {
    throw new Error(
      `harness login returned no ${SESSION_COOKIE} cookie (got: ${cookies.join(' | ') || 'none'})`
    );
  }

  return hit.slice(`${SESSION_COOKIE}=`.length).split(';')[0];
}

/**
 * Log in for real, then set the cookie on a CDP session before first navigation.
 *
 * `Network.setCookie` needs the page origin to be known, so this is called after
 * `Page.enable` and before `Page.navigate`.
 */
export async function signIn(cdp, sessionId, origin) {
  await cdp('Network.enable', {}, sessionId);
  const token = await login();
  await cdp(
    'Network.setCookie',
    { name: SESSION_COOKIE, value: token, domain: 'localhost', path: '/' },
    sessionId
  );
  void origin;
}

/** Clear it again, so a tool can verify the gate actually blocks. */
export async function signOut(cdp, sessionId) {
  await cdp('Network.deleteCookies', { name: SESSION_COOKIE, domain: 'localhost', path: '/' }, sessionId);
}

/**
 * Make sure the fixture account exists and is past both gates.
 *
 * Called by tools that would otherwise be at the mercy of whatever state the
 * database happens to be in.
 */
export function ensureHarness() {
  execFileSync('node', ['tools/provision-harness.mjs'], { stdio: 'pipe' });
}

import { createGate } from '@wideo11/ui/gate';

/**
 * ANALYTICS - aggregates over user activity. SESSION REQUIRED.
 *
 * =============================================================================
 * WHY THIS NEEDS A GATE MORE THAN MOST, NOT LESS
 * =============================================================================
 *
 * Analytics is the app people are most tempted to leave open, because "it's just
 * numbers" and "the dashboard is internal anyway". Both halves are true and
 * neither is a reason.
 *
 * Aggregates leak by being cross-referenced. A single row of "how many people
 * watched a given video" is harmless; a table of per-user activity joined against
 * per-user geography is a behavioural profile, and that table is exactly what this
 * app serves.
 *
 * There is also a privacy shape to it: `monitor` exposes container topology,
 * `analytics` exposes WHO DID WHAT. Neither belongs to a signed-out visitor.
 *
 * Verified rather than assumed: `GET http://localhost:3005/` answered 200 with no
 * credential before this file existed.
 */
const gate = createGate({
  // A 401 rather than a redirect: no login page on this port.
  loginPath: null,
  publicPages: [],
  publicApiPrefixes: ['/api/live'],
});

export default gate;

/**
 * ---- The matcher: A LITERAL, ON PURPOSE ----
 *
 * Next.js reads `config.matcher` by static analysis and cannot resolve an imported
 * spread - it compiles, lints clean, and is silently ignored, leaving the default
 * `/:path*` matcher, which 401s the stylesheet and leaves every page unstyled
 * with a 200. tools/check-app-gates.mjs asserts this literal is byte-identical to
 * GATE_MATCHER in @wideo11/ui/gate.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
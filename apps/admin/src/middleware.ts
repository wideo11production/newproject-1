import { createGate } from '@wideo11/ui/gate';

/**
 * ADMIN - internal admin surface. SESSION REQUIRED.
 *
 * =============================================================================
 * THIS WAS THE SAME NO-OP AS `apps/monitor`
 * =============================================================================
 *
 * Byte-for-byte the same file, with the same two faults:
 *
 *   1. `publicPaths` contained `'/'` and was tested with `startsWith`, so every
 *      path matched and the redirect never fired.
 *   2. The session was read with `getToken` from `next-auth/jwt`, against a
 *      next-auth cookie this product has never set - so it was always `null`.
 *
 * Two copies of a broken guard is one copy too many. Both are now configuration
 * over one implementation, in `@wideo11/ui/gate`.
 *
 * =============================================================================
 * WHAT IS AND IS NOT PUBLIC
 * =============================================================================
 *
 * `/api/health-check` and `/api/live` stay public, and those are considered
 * choices rather than leftovers: a load balancer or an uptime monitor has no
 * session and must be able to ask "is this up". They return liveness only.
 *
 * The distinction matters because it is exactly where the old file went wrong. It
 * could not express "these two routes are open" - it had one boolean for the whole
 * app, so it either guarded nothing or guarded everything including the probe.
 *
 * `/api/telemetry` and `/api/audit` are NOT public. Telemetry is written by
 * signed-out visitors, but it is received through `apps/web`'s BFF, which is
 * public by design - this port is not the collection endpoint, and leaving it open
 * would let anyone POST arbitrary rows into the click ledger.
 */
const gate = createGate({
  // A 401 rather than a redirect: there is no login page on this port, so a
  // redirect would 404 and read as a broken gate rather than a closed one.
  loginPath: null,

  publicApiPrefixes: ['/api/health-check', '/api/live'],
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
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
 * `/api/live` is public, and that is a considered choice rather than a leftover: a
 * load balancer or an uptime monitor has no session and must be able to ask "is
 * this process serving". It returns `{"status":"ok"}` and nothing else - no
 * database query, no dependency, no version, no hostname, no uptime. Anything that
 * can change makes the probe flap for a reason unrelated to "is this alive".
 *
 * The distinction matters because it is exactly where the old file went wrong. It
 * could not express "these two routes are open" - it had one boolean for the whole
 * app, so it either guarded nothing or guarded everything including the probe.
 *
 * ----------------------------------------------------------------------------
 * `/api/health-check` IS NOT PUBLIC. IT USED TO BE.
 * ----------------------------------------------------------------------------
 *
 * It was listed here alongside `/api/live`, on the belief that both "return
 * liveness only". That was false, and it is the exact claim this comment used to
 * make. `/api/health-check` was a SERVER-SIDE FAN-OUT that answered, with no
 * credential:
 *
 *   - the names of internal services ("Recommendation Service", "Bot Service")
 *   - their internal URLs, twice - once as configured, once again inside
 *     `error.message` when the fetch failed
 *   - the port map of the whole box (8082, 8080) paired with those names
 *   - and a free up/down oracle for services the caller has no right to know about
 *
 * A thing named "health check" reads as harmless by definition. The name is what
 * it does, not what it discloses. The route is now `@wideo11/ui/health-handler`:
 * one implementation, session-gated, a closed list of service names, and stable
 * error CODES in place of raw upstream messages.
 *
 * The honest cost of closing it: an unauthenticated uptime monitor can no longer
 * see dependency status here. That is correct - it can still see `/api/live`, and
 * dependency state is what a signed-in operator is for.
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

  // Enumerated, never a bare '/api' prefix. A prefix is an open grant to every
  // route that exists now AND every route added later, and the decision to expose
  // each new one would never be written down by anybody.
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
import { createGate } from '@wideo11/ui/gate';

/**
 * MONITOR - the operator's own infrastructure dashboard.
 *
 * =============================================================================
 * THIS APP IS OPEN, AND THAT IS A DECISION
 * =============================================================================
 *
 * An earlier version gated monitor completely, because it served host metrics to
 * anyone who could reach the port. That locked the operator out of their own
 * dashboard - reported as "api authentication required band ho raha hai, yeh to
 * bilkul band nahin hona chahiye". The reporter was right, because the gate was
 * treating the SYMPTOM as the problem.
 *
 * The gate could not have worked anyway:
 *
 *   - the page needs `/api/metrics` to render anything at all
 *   - gating the API means the page shows an empty shell
 *   - so "gate the page, allow the API" leaks everything anyway, and
 *     "gate both" means shipping a dashboard nobody can use
 *
 * Neither is security. The disclosure worth fixing is ONE FIELD - the internal
 * Prometheus hostname - and that is fixed where it actually lives, in
 * `lib/prometheus.ts`, which no longer puts `prometheusUrl` in the response at
 * all. The comment directly above that line used to explain exactly why it must
 * not be sent, and then sent it.
 *
 * What remains is host resource usage and a container count. On an internal port,
 * for the person operating the system, that is the dashboard's entire purpose.
 *
 * =============================================================================
 * WHAT THE OLD NO-OP MIDDLEWARE DID
 * =============================================================================
 *
 *     const publicPaths = ['/', '/login', '/signup', '/api/auth'];
 *     const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
 *
 * `'/'` is a prefix of every path, so `isPublicPath` was always true and the guard
 * never fired. It also read a next-auth cookie this product never sets, so
 * `getToken` returned `null` on every request. Two independent reasons it could
 * never have worked - and it produced no error, because a middleware that allows
 * everything looks exactly like a middleware that is working.
 *
 * The one thing it DID get right was its `matcher`, which kept the gate off
 * `/_next/static`. See the note below, because dropping it is what made this page
 * render unstyled.
 */
const gate = createGate({
  loginPath: null,

  // Everything is open, because everything has to be for the dashboard to render.
  // See the header for why that is the honest answer rather than a gap.
  publicPages: ['/'],
  publicApiPrefixes: ['/api'],
});

export default gate;

/**
 * ---- The matcher: A LITERAL, ON PURPOSE ----
 *
 * Without this, the gate runs on EVERY path - including
 * `/_next/static/css/<hash>.css`, which is a build artifact with no session. The
 * gate answers 401 to it, the browser discards it, and this dashboard renders as
 * unstyled HTML while every status code stays 200.
 *
 * The pattern is written out here rather than imported from `GATE_MATCHER`
 * because **Next.js reads `config.matcher` by static analysis and cannot resolve
 * an imported spread**. That form compiles, type-checks and lints clean, and is
 * then silently ignored - leaving the default `/:path*` matcher and the exact
 * same unstyled page.
 *
 * `tools/check-app-gates.mjs` asserts this literal is byte-identical to
 * `GATE_MATCHER` in `@wideo11/ui/gate`, so the duplication cannot drift.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
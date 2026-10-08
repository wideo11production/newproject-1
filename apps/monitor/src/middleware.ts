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
 * WHY THE PUBLIC LIST IS ENUMERATED, NOT A PREFIX
 * =============================================================================
 *
 * This file used to say `publicApiPrefixes: ['/api']`. That is functionally the
 * same as this file today - and it is the wrong shape, for one reason: a prefix
 * entry is an open grant that nobody has to notice they are making.
 *
 * `publicApiPrefixes` matches on whole path SEGMENTS, so `/api` covers every API
 * route that exists now AND every one added later. Someone writes a new
 * `/api/dump-everything`, ships it, and it is public from the moment it is
 * registered - because the allowlist said `/api`, not the route. The decision to
 * expose it was never written down, because there was no decision to make.
 *
 * This is the same class of error as `1px scrollbar rules that never applied` and
 * `a # comment justifying an omitted COMMENT ON`: the configuration says something
 * is allowed and the code allows something else. Enumerating the exact routes
 * means a new route is CLOSED by default, and opening it is a visible edit here
 * rather than a silent consequence of a prefix.
 *
 * Note the asymmetry that made `/api` survive review so long: `publicPages: ['/']`
 * is matched with `Array.includes`, i.e. EXACTLY, so it matches only the literal
 * path `/`. Same array type, same call site, completely different semantics. A
 * reader has to know that to read the file, which is precisely why this comment
 * exists.
 *
 * The four routes below are what the dashboard genuinely needs:
 *
 *   /                the page itself (`@metrics`, `@telemetry` route groups)
 *   /api/metrics     the current-value snapshot both pages render from
 *   /api/timeseries  the per-panel history behind every chart
 *   /api/audit       click capture. The tracker runs before sign-in on every app,
 *                    so a gate here would silently drop the earliest clicks.
 *   /api/live        the Docker liveness probe. It is the one route that MUST be
 *                    reachable without a session - see the addendum note in
 *                    SESSION 19: a probe that answers 401 makes Docker kill a
 *                    healthy app.
 */
const gate = createGate({
  loginPath: null,

  // `/` is NOT public here. It is role-gated below, so an anonymous visitor
  // gets a 401 rather than the dashboard shell. The old `publicPages: ['/']`
  // let the public check fire first and the role gate never ran.
  publicPages: [],
  publicApiPrefixes: [
    '/api/audit',  // click capture - the tracker runs before sign-in on every app
    '/api/live',   // Docker liveness probe - must be reachable without a session
  ],

  // ---- MONITOR IS SUPERADMIN-ONLY ----
  //
  // Monitor exposes host resource usage, container counts, and per-panel
  // Prometheus history. That is infrastructure data, not public product data.
  // Only the operator should see it. Anyone else gets a 403 (API) or a
  // redirect to the dashboard (page).
  roleGate: {
    paths: ['/', '/api/metrics', '/api/timeseries'],
    roles: ['superadmin'],
    pageRedirect: '/dashboard',
  },
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
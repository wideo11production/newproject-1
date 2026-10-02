import { createGate } from '@wideo11/ui/gate';

/**
 * CURRENCY - FX rates and the pricing page's data source. SESSION REQUIRED.
 *
 * =============================================================================
 * WHY EVERYTHING IS GATED, WHEN THE DATA IS PUBLIC
 * =============================================================================
 *
 * Exchange rates are public market data, so "should this endpoint need a session"
 * is genuinely not always no. The split is by COST, and that is the actual
 * argument:
 *
 *   - `/api/rates` is a READ of cached rows. Cheap. Reasonable to leave open.
 *   - `/api/convert` is the same data as arithmetic. Also cheap.
 *   - `/api/refresh` FORCES a fetch from the upstream provider. That is the one
 *     that costs money and the one that gets this app rate-limited upstream.
 *
 * Leaving `/api/refresh` behind a session is what stops one browser tab from
 * spending the account's upstream quota, or hammering a provider until this app is
 * blocked.
 *
 * So everything is gated, and if a public pricing page later needs `/api/rates`
 * unauthenticated that is a ONE-LINE change here - which is the point of having
 * the list in one visible place instead of spread across a copy-pasted file.
 *
 * =============================================================================
 * WHAT THIS FILE WAS
 * =============================================================================
 *
 * Nothing. `apps/currency` had no middleware at all, so `/` and every API route
 * were reachable with no credential - verified:
 *
 *     GET http://localhost:3007/api/rates   ->  200
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
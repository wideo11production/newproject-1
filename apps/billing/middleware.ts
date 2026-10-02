import { createGate } from '@wideo11/ui/gate';

/**
 * BILLING - invoices, plans, payouts. SESSION REQUIRED.
 *
 * =============================================================================
 * WHY THIS APP HAS NO PAGES AND STILL NEEDS A GATE
 * =============================================================================
 *
 * `apps/billing` renders a single placeholder page and has no `src/app/api` routes
 * of its own - its services are separate containers (`billing-service`). So the
 * only thing this middleware protects today is a placeholder.
 *
 * It is here anyway, and that is the decision worth recording:
 *
 *   - The moment somebody adds `GET /api/invoices` here, it is GATED. A gate that
 *     has to be remembered when the endpoint is added is a gate that will be
 *     forgotten, because adding a working endpoint on an app that "has never needed
 *     auth" feels like it cannot possibly be the thing that leaks.
 *   - Verified rather than assumed: `curl http://localhost:3003/` answered 200 with
 *     no credential BEFORE this file existed.
 *
 * Fifteen lines of configuration is a cheap price for not making the next person's
 * decision under time pressure.
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
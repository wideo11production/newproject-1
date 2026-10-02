import { createGate } from '@wideo11/ui/gate';

/**
 * SUPERADMIN - the privileged surface. SESSION **AND SUPERADMIN** REQUIRED.
 *
 * =============================================================================
 * WHAT THIS APP HAD BEFORE THIS FILE EXISTED
 * =============================================================================
 *
 * No middleware at all, while carrying the most dangerous endpoints in the
 * monorepo:
 *
 *   POST /api/purge-clicks    destroys rows from the click ledger
 *   GET  /api/security        security posture for the whole platform
 *   GET  /api/ledger          who did what
 *   GET  /api/activity        per-user activity
 *
 * The API routes happened to answer 401, because each proxy demands a bearer
 * token by hand. But the PAGES did not: `/` rendered for anyone.
 *
 * More importantly, "paste your bearer token into this box" is not a session. It
 * puts a live JWT into browser-reachable storage so that a human can copy it, and
 * that is a different and larger liability than the missing gate - see the note at
 * the bottom of this file.
 *
 * =============================================================================
 * WHY `requireRole` IS SAFE HERE
 * =============================================================================
 *
 * The role is read from the SIGNED claim, and only after the signature has been
 * checked against the real secret. So this is not "trust a cookie field": a
 * caller cannot promote themselves by editing anything they can reach.
 *
 * That ordering is the whole safety property. A role check placed BEFORE signature
 * verification would be an attacker choosing their own admin - which is the
 * classic way a role gate gets inverted.
 */
const gate = createGate({
  // A 401 rather than a redirect: there is no login page on this port, so a
  // redirect would 404 and read as a broken gate rather than a closed one.
  loginPath: null,

  /**
   * The superadmin role, and only that.
   *
   * Not `['superadmin', 'admin']`: an ordinary `admin` account is an app user with
   * a dashboard, not somebody who should be able to purge the click ledger or read
   * the security posture of the platform. Widening this list is a one-word change
   * and it should feel like one.
   */
  requireRole: ['superadmin'],

  // Nothing else is public. A superadmin surface with a public corner is a surface
  // somebody will find with a link. `/api/live` is the container probe.
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

/**
 * ============================================================================
 * THE PASTED-TOKEN PROBLEM - STILL OPEN, AND DELIBERATELY NOT FIXED HERE
 * ============================================================================
 *
 * This file makes the pages require a real session. It does NOT remove the
 * "paste a bearer token" UI, and it should not be changed until the session cookie
 * is actually delivered to this origin.
 *
 * Why that matters: a bearer token in a text box is a token in JavaScript
 * reachable storage. `httpOnly` exists precisely so that a single XSS cannot read
 * it, and pasting one deliberately gives that up. Any user who does it has the
 * live JWT in their DOM.
 *
 * The correct end state is one login path for all eight apps, cookie-based, with
 * the token never entering JavaScript. That needs a shared `/api/auth/login` in
 * this app that sets `wideo11_session` as `httpOnly`, which is the same change
 * `apps/web` already has. It is worth doing and it is a separate piece of work -
 * doing it half-way, by removing the box before the cookie exists, would lock
 * every superadmin out of the platform.
 */
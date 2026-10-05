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
  /**
   * A 401 rather than a redirect - and that is CORRECT, because there IS now a
   * login page on this port, rendered by this app.
   *
   * `loginPath` is what a GATED app redirects to when the visitor has no session.
   * Setting it to null means "401, do not redirect", which was right when this app
   * had no login UI at all: a redirect would have sent people to a 404. It is still
   * right now, because the sign-in form is rendered by the app's own page, and the
   * page decides what to show based on `/api/session`. A redirect would be a
   * round trip to learn something the page already knows.
   */
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

  // -----------------------------------------------------------------------------
  // `/` IS PUBLIC. THAT IS NOT THE DASHBOARD BEING OPEN.
  // -----------------------------------------------------------------------------
  //
  // With `publicPages: []`, an anonymous visitor to `http://localhost:3008/` got a
  // bare `{"error":"unauthorized"}` JSON body instead of the sign-in form. Verified
  // in a real browser, not inferred: the page never rendered, so there was nothing
  // to type a password into. "Cannot log in to 3008" was literally true - the
  // login form was unreachable.
  //
  // The fix is one entry, and it is the difference between a login page and a
  // locked door with no keyhole. What `/` returns anonymously is the React shell:
  //
  //   - signed out -> the sign-in FORM, which posts to `/api/auth/login`
  //   - signed in  -> the dashboard, which fetches its data from `/api/*`
  //
  // NO DATA IS EXPOSED BY RENDERING THE SHELL. Every number on that dashboard comes
  // from a gated API route: `/api/stats`, `/api/clicks`, `/api/targets`,
  // `/api/security`, `/api/activity`, `/api/ledger`. All six stay gated. A visitor
  // who is not signed in gets a form and six 401s.
  //
  // The thing this actually replaces is the token box, which was ALSO reachable
  // anonymously and was strictly worse: it put a live JWT into browser-readable
  // storage so a human could copy it.

  // -----------------------------------------------------------------------------
  // `/api/auth/login` AND `/api/auth/refresh` HAVE TO BE HERE. THIS IS NOT A HOLE.
  // -----------------------------------------------------------------------------
  //
  // A gate that blocks its own login route is a gate nobody can get through, and
  // that is exactly what happened: `POST /api/auth/login` answered
  //
  //     {"error":"unauthorized","message":"A valid session is required."}
  //
  // which is a correct answer to the wrong question. The middleware was asked "is
  // this person signed in?" about a request whose entire purpose is to sign them
  // in. A pre-authentication endpoint cannot require a session - that is what
  // "pre-authentication" means.
  //
  // WHAT MAKES THIS SAFE, AND WHY IT IS NOT THE SAME AS AN OPEN DASHBOARD
  //
  //   - The route forwards to auth-service, which does the credential check. This
  //     middleware does not authenticate anybody; it stands aside.
  //   - A JWT never comes back in the response BODY. It is set as an httpOnly
  //     cookie, so no script on this origin can read it. That is the property
  //     `httpOnly` exists for.
  //   - The alternative that WAS here - "paste a bearer token" - did the opposite:
  //     it put a live JWT into React state so a human could copy it, which is a
  //     strictly larger liability than the one removed.
  //   - `/api/auth/refresh` trades an httpOnly 7-day refresh cookie for a new
  //     access token, and does nothing at all for a caller holding neither.
  //
  // ENUMERATED, NOT A PREFIX, so that `/api/auth/logout` stays private and any
  // future route under this path is closed by default. A bare `/api/auth` entry
  // would open both of those the moment somebody typed them.
  // ENUMERATED, NOT A PREFIX, so that `/api/auth/logout` stays private and any
  // future route under this path is closed by default. A bare `/api/auth` entry
  // would open both of those the moment somebody typed them.
  publicApiPrefixes: ['/api/live', '/api/auth/login', '/api/auth/refresh'],

  // `/login` is public, for the same reason the credential-exchange routes are: a
  // sign-in page that requires a session is not a sign-in page.
  //
  // `/` is public too - it renders the React shell, which is either the dashboard
  // or a redirect to `/login`. Every number on that dashboard comes from a gated
  // `/api/*` route, all of which are listed above.
  publicPages: ['/', '/login'],
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
 * THE PASTED-TOKEN PROBLEM - FIXED. HERE IS THE ORDER IT WAS FIXED IN.
 * ============================================================================
 *
 * This comment used to say the problem was open and that it "should not be changed
 * until the session cookie is actually delivered to this origin". That warning was
 * correct, and the order it describes is the order that was followed - except the
 * first half was done before the second, which is the half the warning was about.
 *
 * WHAT HAPPENED
 *
 *   1. The "paste a bearer token" box was replaced with a link to
 *      `localhost:3000/auth/login`, on the reasoning that the cookie already
 *      worked and so a link was enough.
 *   2. It was not enough. Cookies are scoped by DOMAIN and not by port, so the
 *      cookie did work - but this app now had NO WAY to authenticate AT port 3008.
 *      An anonymous visitor got a 401 from this middleware and a link that left the
 *      app. Reported immediately as "cannot log in to 3008".
 *   3. Worse, that link was then itself replaced by a real form posting to
 *      `/api/auth/login` - a route this middleware was gating. So the login route
 *      answered 401. A gate blocking its own front door.
 *   4. Both credential-exchange routes are now listed in `publicApiPrefixes`
 *      above, with the reasoning for why that is safe.
 *
 * THE LESSON, WHICH IS THE SAME ONE AS EVERYWHERE ELSE IN THIS REPOSITORY
 *
 * "The security problem is fixed" is not the same claim as "the feature works".
 * Removing the token box fixed a real vulnerability - a live JWT in React state is
 * readable by any script on the page, which is precisely what `httpOnly` exists to
 * prevent - and broke the only way to sign in.
 *
 * The warning at the top of this comment was written by whoever got it right the
 * first time, and it was still possible to read it and do the wrong thing, because
 * the instruction "remove the token box" felt obviously safe and the instruction
 * "add a login route and un-gate it" felt like a separate concern.
 *
 * It was not a separate concern. One is useless without the other.
 *
 * WHAT IS HERE NOW
 *
 *   - `/api/auth/login`    posts credentials to a server route, gets a JWT back,
 *                          sets it as an httpOnly cookie. The JWT is never in a
 *                          response body.
 *   - `/api/auth/refresh`  trades an httpOnly 7-day refresh cookie for a new access
 *                          token, so the session lasts 7 days while the access token
 *                          stays at 15 minutes.
 *   - `/api/logout`        revokes server-side and clears BOTH cookies. Clearing
 *                          only the access token would leave a valid 7-day
 *                          credential behind and the next silent refresh would sign
 *                          the user straight back in.
 *
 * Because cookies ignore ports, signing in here signs you in on all eight apps.
 * There is now one credential entry point for the whole stack, which is the end
 * state this comment originally asked for.
 */

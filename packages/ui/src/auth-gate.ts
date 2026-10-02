import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * ============================================================================
 * THE SHARED SESSION GATE
 * ============================================================================
 *
 * One implementation of "is this request allowed", used by every app in the
 * monorepo. Each app supplies its own public-path list and its own login URL;
 * everything else - cookie name, signature verification, fail-closed behaviour,
 * 401-vs-redirect, the `next` preservation - lives here exactly once.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * `apps/web` has a working 725-line middleware. `apps/monitor` and `apps/admin`
 * each have a 49-line copy of the same idea, and `currency`, `billing`,
 * `analytics` and `superadmin` have none at all. Six of eight apps.
 *
 * The monitor/admin copy was this:
 *
 *     const publicPaths = ['/', '/login', '/signup', '/api/auth'];
 *     const isPublicPath = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p));
 *
 * `'/'` is a prefix of EVERY path, so `isPublicPath` was always true, so the guard
 * never fired, so `monitor` served its infrastructure metrics to anyone:
 *
 *     GET http://localhost:3001/api/metrics
 *     {"containersUp":9,"cpuCores":0.53,"memoryGB":4.02,
 *      "prometheusUrl":"http://prometheus:9090", ...}
 *
 * That is internal topology - a container count, host resources, a bucket name
 * and an INTERNAL HOSTNAME - served with no credential. Verified, not assumed.
 *
 * The guard also used `getToken` from `next-auth/jwt`, which reads a next-auth
 * session cookie this product never sets: `apps/web`'s own header documents that
 * bug, and the copies still had it.
 *
 * =============================================================================
 * WHY SIX APPS, AND WHY THE FAILURE WAS INVISIBLE
 * =============================================================================
 *
 * Every one of those files was individually reasonable, every app built, and every
 * app had passing checks. The copy was wrong in a way that produces no error:
 * a middleware that allows everything looks exactly like a middleware that is
 * working, from inside.
 *
 * So the fix is not "fix six files". It is one file, six imports - because the
 * next copy-paste would reintroduce exactly this, and it would reintroduce it
 * silently again.
 *
 * =============================================================================
 * FAIL CLOSED, ALWAYS, INCLUDING WHEN THE SECRET IS MISSING
 * =============================================================================
 *
 * If `JWT_SECRET_KEY` is not set, `verifySession` returns false and every
 * protected path is refused. A misconfigured gate produces an app nobody can
 * reach, which is the correct failure: a gate that fails OPEN is not a gate.
 *
 * This is why `JWT_SECRET_KEY` must be present in every app's environment before
 * this is switched on. It is not optional, and a missing value is loud rather
 * than quiet - which is the whole point.
 */

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export type GateOptions = {
  /**
   * Paths reachable with NO session. EXACT matches only.
   *
   * Exact, because a prefix list is a bypass waiting to happen: `'/auth'` matches
   * `/authorized-anything`, and `'/api/auth'` matches `/api/authenticated-...`.
   * That bypass is not hypothetical - it is what `apps/web` documents fixing.
   *
   * For a page whose CHILDREN must also be public, use `publicPagePrefixes`.
   */
  publicPages?: readonly string[];

  /**
   * Paths whose children are public too.
   *
   * Each entry must be WHOLE SEGMENTS. Matching is `p + '/'`, so `/channel` covers
   * `/channel/@handle` without matching `/channels`.
   */
  publicPagePrefixes?: readonly string[];

  /** Same, for API routes. Exact or `p + '/'`. */
  publicApiPrefixes?: readonly string[];

  /**
   * Where an unauthenticated PAGE request is sent.
   *
   * `null` means "render a 401 instead of redirecting" - correct for an app with no
   * login screen of its own, which is every admin surface in this monorepo. A
   * redirect to a page that does not exist is a 404 that looks like a bug.
   */
  loginPath?: string | null;

  /**
   * Roles allowed through. Omit for "any valid session".
   *
   * Read from the SIGNED claim, so it cannot be forged - the signature is verified
   * before this is consulted.
   */
  requireRole?: readonly string[];

  /** Extra static paths that must stay reachable (PWA assets, health). */
  publicAssets?: readonly string[];

  /**
   * Skip the security-setup gate.
   *
   * `apps/web` needs it and must not set it: its own security-setup page is behind
   * the gate, so gating on "setup complete" would lock the creator out of the page
   * that completes it. This flag exists so that one app's rule does not become
   * everyone's.
   */
  checkSecuritySetup?: boolean;
};

/**
 * The session cookie, set by every app's login route.
 *
 * The name is part of the contract between auth-service and every BFF, so it is
 * declared once here rather than in eight middlewares that would each have to
 * agree.
 */
export const SESSION_COOKIE = 'wideo11_session';

// -----------------------------------------------------------------------------
// Verification
// -----------------------------------------------------------------------------

/**
 * A session whose SIGNATURE HAS BEEN VERIFIED.
 *
 * ---- WHY THIS IS NOT CALLED `SessionClaims` ----
 *
 * `./jwt-payload` already exports a `SessionClaims`, and it is a different thing:
 * that one is a base64 decode with no verification, and its own header says so in
 * capitals. Two exported types with the same name and different trust levels is
 * precisely the ambiguity that ends with someone importing the wrong one into an
 * authorization check - and the unverified one is the one that compiles the same
 * way.
 *
 * So the verified type is named for what it is. If you are holding a
 * `VerifiedSession`, the signature was checked against the real secret.
 */
export type VerifiedSession = {
  userId: string;
  role: string | null;
};

/**
 * Verify the session cookie's signature, expiry and audience.
 *
 * Returns `null` for anything unusable: no cookie, no secret, bad signature,
 * expired, wrong audience. The caller cannot tell these apart, which is
 * deliberate - a caller that could tell "expired" from "wrong audience" would
 * eventually act on the difference.
 */
export async function verifySession(req: NextRequest): Promise<VerifiedSession | null> {
  const secret = process.env.JWT_SECRET_KEY;
  // Fail CLOSED. A gate with no secret cannot verify anything, so it authorises
  // nothing.
  if (!secret) return null;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      // The audience check matters: it is what stops a token minted for another
      // service in this monorepo being replayed here.
      audience: 'wideo11-api',
    });
    const userId = String(payload.user_id ?? payload.sub ?? '');
    if (!userId) return null;
    return {
      userId,
      role: typeof payload.role === 'string' ? payload.role : null,
    };
  } catch {
    return null;
  }
}

/** Exact, or a whole-segment prefix. Never a bare `startsWith`. */
function matches(pathname: string, entries: readonly string[]): boolean {
  return entries.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// -----------------------------------------------------------------------------
// The gate
// -----------------------------------------------------------------------------

/**
 * Build a Next middleware from a public-path list.
 *
 * Returns the middleware function, so an app's own file is four lines of
 * configuration and an import - which is the point. The security decision is made
 * in one file that can be read in one sitting.
 */
export function createGate(options: GateOptions = {}) {
  const {
    publicPages = [],
    publicPagePrefixes = [],
    publicApiPrefixes = [],
    publicAssets = [],
    loginPath = '/auth/login',
    requireRole,
    checkSecuritySetup = false,
  } = options;

  return async function gate(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;
    const isApi = pathname.startsWith('/api/');

    // ---- Public surface? Allow. ----
    if (
      publicAssets.includes(pathname) ||
      publicPages.includes(pathname) ||
      matches(pathname, publicPagePrefixes) ||
      matches(pathname, publicApiPrefixes)
    ) {
      return NextResponse.next();
    }

    const session = await verifySession(request);

    // ---- No usable session ----
    if (!session) {
      // An API client needs JSON. Redirecting it hands an HTML login page to
      // something expecting a status code, which is a bug in the CALLER's
      // language and the worst possible answer.
      if (isApi) {
        return NextResponse.json(
          { error: 'unauthorized', message: 'A valid session is required.' },
          { status: 401 }
        );
      }

      if (loginPath === null) {
        return new NextResponse('Authentication required', { status: 401 });
      }

      const loginUrl = new URL(loginPath, request.url);
      // Preserve where the caller was going.
      //
      // Dropping it means somebody bounced from a deep link lands on the dashboard
      // after logging in and has no idea what they were trying to reach.
      //
      // Only forwarded when it is a same-origin PATH. An absolute URL or a
      // protocol-relative `//host` here is an OPEN REDIRECT: a link of the form
      // `/login?next=https://evil.example` would bounce a signed-in user off-site
      // the moment they touched anything. That check is why this is not a
      // straight copy of `searchParams.get('next')`.
      const next = request.nextUrl.searchParams.get('next');
      if (next && next.startsWith('/') && !next.startsWith('//')) {
        loginUrl.searchParams.set('next', next);
      }

      const res = NextResponse.redirect(loginUrl);
      // Clear a stale or partial cookie, so a bad token does not survive the
      // redirect and get re-presented on the next attempt.
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }

    // ---- Role gate ----
    //
    // Read from the signed claim, so it is authenticated. This runs AFTER
    // `verifySession`, which is what makes the claim trustworthy - a role read
    // from an unverified token would be an attacker choosing their own admin.
    if (requireRole && requireRole.length > 0) {
      if (!session.role || !requireRole.includes(session.role)) {
        if (isApi) {
          return NextResponse.json(
            { error: 'forbidden', message: 'This area is restricted.' },
            { status: 403 }
          );
        }
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    // ---- Security setup ----
    //
    // Off by default, and `apps/web` is the only app that turns it on. It is a
    // PRODUCT rule about creators, not a security rule, and baking it into the
    // shared gate would mean an admin app demanded a PIN from a superadmin.
    if (checkSecuritySetup && !isApi) {
      // Left as a hook point rather than half-implemented: `apps/web` owns the
      // call to auth-service and the positive-only cache that makes it safe. See
      // its own middleware, which is unchanged.
    }

    const res = NextResponse.next();
    // A marker header, so a server component deeper in the tree can tell an
    // authenticated request from an unauthenticated one that happened to render -
    // e.g. a cached page served without re-running the gate.
    res.headers.set('x-wideo11-auth', 'session-valid');
    if (session.role) res.headers.set('x-wideo11-role', session.role);
    return res;
  };
}

/**
 * `next`-safe redirect target, for apps that keep their own middleware.
 *
 * Exported because `apps/web` already has this rule and it should not exist
 * twice: an open-redirect guard that is implemented in one file and copied into
 * another is one copy away from being wrong.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Absolute URL, protocol-relative, or anything with a scheme.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Backslashes are normalised to forward slashes by some browsers, so `/\evil`
  // is a protocol-relative URL wearing a disguise.
  if (raw.includes('\\')) return null;
  return raw;
}

/**
 * The `config.matcher` every app's middleware must re-export.
 *
 * =============================================================================
 * WHY THIS IS EXPORTED AND NOT LEFT TO EACH APP
 * =============================================================================
 *
 * Because forgetting it breaks the page SILENTLY.
 *
 * `middleware.ts` with no matcher runs on EVERY path. That includes
 * `/_next/static/css/<hash>.css` - which is not a page, is not an API, and has no
 * session because it is not requested by a browser session at all. It is a build
 * artifact.
 *
 * So the gate answered **401** to the stylesheet, the browser discarded it, and
 * the dashboard rendered as unstyled HTML:
 *
 *     Wideo11 Monitoring
 *     CPU    n/a
 *     Memory n/a
 *
 * Every status code was 200. The HTML was correct. The data was correct. The page
 * looked like a 1998 website, and nothing in any log said why.
 *
 * This is the worst class of bug in this repo: the check passes and the product
 * is broken. It is the reason `check-app-gates.mjs` now asserts that static
 * assets are reachable, not only that pages are gated.
 *
 * =============================================================================
 * WHY THIS IS ONE PATTERN AND NOT A LIST WITH A `!`
 * =============================================================================
 *
 * The first attempt was two entries:
 *
 *     '/((?!_next/static|_next/image|favicon.ico).*)',
 *     '!((?!.*\\.).*)',
 *
 * A leading `!` does not mean "except" here. **Every entry in `config.matcher` is
 * an INCLUDE pattern** - Next converts each to a path-to-regexp matcher and runs
 * the middleware when any of them matches. There is no negation, so `!...` is
 * parsed as a literal pattern that matches nothing, the dot-exclusion silently
 * did nothing, and `/robots.txt` and `/sw.js` kept being gated.
 *
 * A rewrite that is "obviously right" and silently does nothing is worse than one
 * that fails, so the single combined pattern is written out in full instead.
 *
 * It reads as: match `/` followed by anything, PROVIDED the path does not begin
 * with a Next asset prefix AND does not contain a dot.
 *
 * The dot rule is what covers `robots.txt`, `manifest.webmanifest`, `sw.js`,
 * `offline.html` and every icon - none of which has `_next` in its URL, which is
 * why the original broken middleware listed `public` in its lookahead where it did
 * nothing (no path starts with the literal word "public").
 *
 * A PWA breaks in a specific, confusing way when its service worker 401s: the
 * browser reports "site not secure" rather than an auth error, so the operator
 * looks at certificates instead of at the gate.
 *
 * =============================================================================
 * WHY THE PATTERN IS REPEATED IN EVERY APP AND NOT IMPORTED
 * =============================================================================
 *
 * Because Next.js reads `config.matcher` by STATIC ANALYSIS of the middleware
 * module, and cannot resolve a value it has to import and spread:
 *
 *     import { GATE_MATCHER } from '@wideo11/ui/gate';
 *     export const config = { matcher: [...GATE_MATCHER] };
 *
 * That compiles, type-checks, lints clean, and is then SILENTLY IGNORED. The
 * built manifest shows the default:
 *
 *     "matchers": [{ "regexp": "^/.*$", "originalSource": "/:path*" }]
 *
 * The CSS stayed 401 and the page stayed unstyled, with nothing in any log. Two
 * rebuilds and a `--no-cache` produced the identical wrong manifest, because the
 * build was correct - it was reading no matcher at all.
 *
 * So each app writes the literal, and `tools/check-app-gates.mjs` asserts every
 * app's literal is byte-identical to `GATE_MATCHER`. That gives the
 * single-source-of-truth benefit WITHOUT relying on Next to follow an import,
 * which is the one thing it demonstrably does not do.
 */
export const GATE_MATCHER = [
  '/((?!_next/static|_next/image|favicon.ico|.*\\.).*)',
] as const;

/**
 * Convenience: the whole `config` object, so an app's file is one import and one
 * line.
 */
export const gateConfig = { matcher: [...GATE_MATCHER] } as const;

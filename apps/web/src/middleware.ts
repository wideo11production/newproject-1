/**
 * ============================================================================
 * GLOBAL SECURITY MIDDLEWARE - application firewall
 * ============================================================================
 *
 * Ye file HAR incoming request par chalti hai (Edge runtime) aur decide karti
 * hai ki request authorized hai ya nahi. Unauthorized request ko ya to redirect
 * karti hai (pages ke liye) ya 401 JSON return karti hai (API ke liye).
 *
 * ============================================================================
 * PEHLE KYUN THA BROKEN (ye zaroori context hai)
 * ============================================================================
 * Pichle version me 3 critical bugs the:
 *
 *  1. `getToken` next-auth/jwt ka tha, lekin ye app next-auth use hi nahi
 *     karta (koi `SessionProvider`/`useSession` nahi, koi next-auth route nahi).
 *     `getToken` ek next-auth SESSION cookie padhta hai jo app kabhi set nahi
 *     karta -> hamesha `null` return karta.
 *
 *  2. `publicPaths` me `'/auth'` aur `'/api/auth'` `startsWith()` se match hote
 *     the. Matlab `/authorized-admin-panel` ya `/api/authenticated-anything`
 *     jaise koi bhi path PREFIX match karke public ho jata. Ye real bypass
 *     vector hai - koi bhi `/auth...` se start hone wala path unauthenticated
 *     render ho jata.
 *
 *  3. `isAuthenticated = !!token` sirf token EXISTENCE check karta tha.
 *     Verified/active status check hi nahi hota tha.
 *
 * Result: `/dashboard` bina login ke 200 de raha tha. Koi protection nahi thi.
 *
 * ============================================================================
 * NAYA DESIGN
 * ============================================================================
 * Token SOURCE: `wideo11_session` httpOnly cookie.
 *   - Login API route (`/api/auth/login`) ye cookie set karti hai.
 *   - httpOnly = browser JS ise nahi padh sakta -> XSS se protect.
 *   - Server-side middleware ise PADH sakta hai (localStorage nahi padh sakta).
 *
 * VERIFICATION: `jose` se HS256 signature verify hoti hai, real
 *   `JWT_SECRET_KEY` (auth-service wahi secret) ke saath. Fake/expired/
 *   tampered token reject ho jata hai.
 *
 * VERIFIED CHECK KAHAN HAI:
 *   JWT claims me `is_verified` nahi hai, aur iski zaroorat bhi nahi -
 *   kyunki auth-service UNVERIFIED user ko login hi nahi deta
 *   (`403 "please verify your email"`). Matlab token mil hi gaya to user
 *   verified hai. Isliye middleware sirf signature + expiry verify karta hai,
 *   aur security-setup gate (client side) mandatory security steps handle
 *   karta hai.
 *
 * Hinglish comments: har block ka arth
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { authRateLimitMiddleware } from '@/lib/rate-limiter';

/**
 * SESSION COOKIE NAME
 * Login route isko set karta hai, ye middleware isko padhta hai.
 * Dono ka naam EXACTLY match hona zaroori hai.
 */
const SESSION_COOKIE = 'wideo11_session';

/**
 * AUTH-SERVICE WALA JWT SECRET
 * `.env.local` me `JWT_SECRET_KEY` hona chahiye, aur wo auth-service ke
 * `JWT_SECRET_KEY` se MATCH karna chahiye. Tabhi signature verify hogi.
 *
 * NOTE: production me ye value env/CI se aani chahiye, hardcoded nahi.
 */
const JWT_SECRET = process.env.JWT_SECRET_KEY ?? '';

/**
 * PUBLIC PATHS - bina login ke render hone wale pages.
 *
 * ---- IMPORTANT: ye EXACT match hain, `startsWith` NAHI ----
 * Pehle prefix matching thi (`/auth`), jo bypass vector thi. Ab har entry
 * poori tarah match hoti hai, aur `/dashboard` jaise protected pages ke
 * liye koi prefix leak nahi hota.
 */
const PUBLIC_PAGES = new Set<string>([
  '/', // landing - Wino/Rino showcase
  '/auth/login', // login zaroori hai - warna koi login hi nahi kar sakta
  '/auth/register', // onboarding
  '/auth/verify', // email verification link target
  '/auth/security-setup', // security gate khud - gate ko redirect karna
  //                          infinite loop bana dega
]);

/**
 * PUBLIC API PATHS - bina session ke callable (exact ya explicit prefix).
 *
 * Ye teen zaroori hain:
 *   - register/login/verify: PRE-auth hote hi to session hoga hi nahi
 *   - webauthn/*: register form biometric enroll karta hai, login se PEHLE
 *   - audit/telemetry/health: public landing page bhi ye beacons bhejti hai
 */
const PUBLIC_API_PREFIXES = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/verify',
  '/api/auth/resend-verification',
  '/api/auth/webauthn',
  '/api/auth/logout', // logout session ke bina bhi callable hona chahiye
  '/api/audit',
  '/api/telemetry',
  '/api/health-check',
  '/api/superadmin/awareness', // master dashboard public health surface
];

/**
 * PUBLIC_ASSETS - PWA ke static files.
 *
 * ---- YE MIDDLEWARE KE BINA SABSE BADI PWA BLOCKING BUG THI ----
 * Ye list pehle MISSING thi, jisse PWA bilkul kaam hi nahi kar raha tha.
 * Har asset `307 -> /auth/login` par redirect ho raha tha, jabki:
 *
 *   - Service worker REGISTRATION hamesha UNAUTHENTICATED hoti hai. Browser
 *     login nahi kar sakta SW register karne se pehle - wo pehle page load
 *     karta hai. Agar /sw.js protected hota to registration FAIL hoti, yaar
 *     Chrome kabhi "Install app" prompt hi nahi dikhata.
 *   - Manifest browser dwara bina kisi session ke padha jaata hai.
 *   - Icons tab bar, bookmarks aur install dialog me bina session load hote
 *     hain - nahi to broken icon dikhta.
 *   - Offline page tab chahiye jab user authenticated NA ho (ya network
 *     chala gaya ho) - tab to login tak pahunch nahi paoge!
 *
 * SECURITY: ye saare static files hain, koi user data nahi. Inhe public
 * rakhna koi risk create nahi karta - inme koi secret nahi hai.
 */
const PUBLIC_ASSETS = new Set<string>([
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  '/icon.svg',
  '/apple-icon.svg',
  '/brand.svg',
  '/placeholder.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
]);

/**
 * SESSION-ONLY API PATHS - valid session chahiye, par COMPLETED SECURITY
 * SETUP nahi chahiye.
 *
 * ---- YE LIST KYUN ZAROORI HAI (deadlock fix) ----
 * Ye woh APIs hain jinke through user apna security setup COMPLETE karta hai
 * (PIN set, questions set, biometric enroll, status check).
 *
 * Pehle in par bhi "setup complete" check lag raha tha, jisse ek DEADLOCK
 * ban gaya:
 *     middleware: "setup complete nahi hai -> block"
 *     proxy:      403 security_setup_required
 *     user:       PIN hi nahi set kar sakta
 *     => kabhi complete nahi hoga, kabhi dashboard nahi milega
 *
 * Ye APIs public nahi hain - unke liye SESSION zaroori hai (proxy khud
 * httpOnly cookie check karta hai aur 401 deta hai bina session ke).
 * Bas "setup complete" check skip hota hai, kyunki in APIs ka kaam hi
 * setup complete karna hai.
 */
const SESSION_ONLY_API_PREFIXES = [
  '/api/auth/security', // PIN / questions / biometric / setup-status
];

/**
 * SECURITY SETUP STATUS CACHE
 *
 * Key   : user_id (JWT se nikalte hain)
 * Value : { complete: boolean, expiresAt: number }
 *
 * ---- KYUN CACHE ZAROORI HAI ----
 * Middleware har protected request pe chalti hai. Bina cache ke har request
 * par auth-service ka `/security/setup-status` call hota - har navigation par
 * ek extra network hop + latency + auth-service load.
 *
 * TTL chhota rakha hai (10s): performance theek rahe, par user ko setup
 * complete karne ke baad 10 second ruke na pade, aur bypass window bhi na
 * khule.
 *
 * NOTE: per-process cache (dev me 1 process, prod me har pod ka apna).
 * Worst case sirf 10s staleness, aur decision conservative side
 * (incomplete = block) rakhte hain.
 */
const setupCache = new Map<string, { complete: boolean; expiresAt: number }>();

/** Cache TTL - milliseconds */
const SETUP_CACHE_TTL_MS = 10_000;

/** Cache ki max entries - unbounded growth rokne ke liye */
const SETUP_CACHE_MAX = 1000;

/**
 * AUTH-SERVICE BASE URL
 *
 * Middleware Edge runtime me chalta hai, aur auth-service ke network me hi
 * hota hai (Next.js se reachable, browser se nahi). Isliye ye server-side
 * call hai - CORS ki zaroorat nahi.
 *
 * NOTE: `.env.local` me `AUTH_SERVICE_URL=...` set hai (main.js ise
 * `AUTH_INTERNAL_URL` naam se bhi padhta hai apne proxies me).
 */
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ??
  process.env.AUTH_INTERNAL_URL ??
  'http://localhost:8085';

/**
 * Token verify karo (signature + expiry + audience).
 *
 * `JWT_SECRET` khaali hua to VERIFY nahi kar sakte - fail CLOSED (secure
 * side), fail OPEN nahi. Yaani misconfigured secret = sab protected pages
 * block. Ye deliberate hai: security config missing hone par app band hona
 * sahi hai, khula hona galat.
 */
async function isValidSession(jwt: string | null): Promise<boolean> {
  if (!jwt) return false;
  if (!JWT_SECRET) return false; // fail closed
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(jwt, secret, {
      // Audience match bhi check karo - koi doosre service ka token
      // accept na ho (e.g. superadmin ka alag token)
      audience: 'wideo11-api',
    });
    return true;
  } catch {
    // Invalid signature / expired / wrong audience
    return false;
  }
}

/**
 * Check whether the user has completed mandatory security setup.
 *
 * Calls auth-service `GET /api/v1/auth/security/setup-status` with the
 * session bearer token and reads `setup_complete`.
 *
 * FAIL-CLOSED: auth-service unreachable ya error de to `false` return hota
 * hai - yaani service down par app BLOCKED rehta hai. Fail-open nahi, kyunki
 * security gate bypass karna hi fail-open hota hai.
 */
async function isSecuritySetupComplete(jwt: string): Promise<boolean> {
  // ---- User id nikalo (cache key) ----
  let userId: string;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret, {
      audience: 'wideo11-api',
    });
    userId = String(payload.user_id ?? payload.sub ?? '');
  } catch {
    return false; // token invalid - pehle wala check pakad lega
  }
  if (!userId) return false;

  // ---- Cache hit? ----
  const now = Date.now();
  const cached = setupCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.complete;
  }

  // ---- Auth-service call ----
  let complete = false;
  try {
    const res = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/auth/security/setup-status`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${jwt}` },
        cache: 'no-store',
      }
    );
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      complete = data?.setup_complete === true;
    }
    // !res.ok -> complete stays false (fail closed)
  } catch {
    complete = false; // unreachable -> fail closed
  }

  // ---- Cache write (bounded) ----
  if (setupCache.size >= SETUP_CACHE_MAX) {
    const oldest = setupCache.keys().next().value;
    if (oldest) setupCache.delete(oldest);
  }
  setupCache.set(userId, { complete, expiresAt: now + SETUP_CACHE_TTL_MS });

  return complete;
}

export async function middleware(request: NextRequest) {
  /**
   * Rate limit - pehle chalta hai taaki auth endpoints bhi covered rahein.
   */
  const rateLimitResponse = authRateLimitMiddleware(request);
  if (rateLimitResponse) return rateLimitResponse;

  // ---- API ya page? Redirect logic alag hai ----
  const { pathname } = request.nextUrl;
  const isApiRequest = pathname.startsWith('/api/');

  // ---- Public API check (exact ya explicit prefix match) ----
  const isPublicApi = PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  // ---- Public page check (EXACT match only) ----
  const isPublicPage = PUBLIC_PAGES.has(pathname);

  // ---- Session-only API check ----
  // Valid session chahiye, par security-setup-complete nahi chahiye (warna
  // user apna setup hi complete nahi kar paayega - deadlock).
  const isSessionOnlyApi = SESSION_ONLY_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  // ---- PWA assets: MUST be public ----
  //
  // Ye pehle MISSING the, jisse PWA bilkul kaam hi nahi kar raha tha:
  // har PWA asset `307 -> /auth/login` par redirect ho raha tha, jabki:
  //   - service worker REGISTRATION hamesha unauthenticated hoti hai
  //     (browser login nahi kar sakta SW register karne se pehle)
  //   - manifest browser ke dwara bina session padha jaata hai
  //   - icons tab bar / install dialog me bina session load hote hain
  //   - offline page tab chahiye jab user ALREADY authenticated ho
  //
  // Isliye in sabko public list me daalna zaroori hai. Ye koi security risk
  // nahi hai - ye static files hain, koi user data nahi.

  // ---- Public surface? Allow ----
  if (isPublicApi || isPublicPage || PUBLIC_ASSETS.has(pathname)) {
    return NextResponse.next();
  }

  // ---- Session cookie se token padho ----
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;

  const authenticated = await isValidSession(token);

// ---- Unauthenticated ----
if (!authenticated) {
  // API request pe redirect NHI - API clients ko HTML nahi chahiye,
  // JSON chahiye (401). Redirect karna proxy clients ke liye bug hai.
  if (isApiRequest) {
    return NextResponse.json(
      {
        error: 'unauthorized',
        message: 'A valid session is required for this endpoint.',
      },
      { status: 401 }
    );
  }

  // Page request: stale cookie saaf karo (agar koi partial/bad hai)
  const res = NextResponse.redirect(new URL('/auth/login', request.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

  // ==========================================================================
  // AUTHENTICATED - ab mandatory security setup check
  // ==========================================================================
  //
  // ---- YE WOHI CHECK THA JISKA MISSING THA ----
  // Pehle middleware sirf JWT validity check karta tha. Matlab: user login
  // karke seedha /dashboard pe ja sakta tha, security setup (PIN + biometric +
  // 3 questions) SKIP karke. Wo sirf login page ke andar client-side gate
  // tha - jise URL badal kar bypass kiya ja sakta tha.
  //
  // Ab: har protected request pe `setup_complete` verify hota hai. Complete
  // nahi hai -> security setup page pe hard redirect.
  //
  // EXCEPTION: session-only APIs (security setup wale) is check se guzarte
  // hain, warna setup complete hi nahi ho paayega (deadlock - upar dekho).

  if (!isSessionOnlyApi) {
    const setupDone = await isSecuritySetupComplete(token!);

    if (!setupDone) {
      // API request pe redirect nahi - JSON chahiye
      if (isApiRequest) {
        return NextResponse.json(
          {
            error: 'security_setup_required',
            message:
              'Complete your mandatory security setup (PIN, biometric, security questions) before using this endpoint.',
          },
          { status: 403 }
        );
      }

      // Page request -> security setup gate page
      return NextResponse.redirect(
        new URL('/auth/security-setup', request.url)
      );
    }
  }

  // ---- Authenticated + security complete: allow ----
  const authed = NextResponse.next();
  authed.headers.set('x-wideo11-auth', 'session-valid');
  authed.headers.set(
    'x-wideo11-security',
    isSessionOnlyApi ? 'session-only' : 'complete'
  );
  return authed;
}

/**
 * MIDDLEWARE MATCHER - kis path par chalaane ke liye.
 *
 * Static assets chhorte hain kyunki wo auth se koi lena-dekena nahi rakhte,
 * aur har image par middleware chalaana performance waste hota.
 */
export const config = {
  matcher: [
    /*
     * Ye Next.js ka standard pattern hai. `_next/static`, `_next/image`,
     * `favicon.ico` aur public files chhote hain.
     *
     * NOTE: `api/auth` yahan se EXCLUDE nahi hai (pichle version me tha,
     * jisse middleware wahan chala hi nahi tha aur rate limiter dead code
     * ban gaya tha). Auth API requests bhi rate limiter ke through jaani
     * chahiye, aur koi bhi auth API pe hard-lock nahi hota kyunki wo
     * `PUBLIC_API_PREFIXES` me hai.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

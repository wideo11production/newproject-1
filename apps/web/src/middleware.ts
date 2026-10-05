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
import { safeNext, DEFAULT_NEXT } from '@/lib/safe-next';

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

  // ---- The public browse pages ----
  //
  // `/channels` and `/channel/<handle>` read the PUBLIC endpoint
  // (`/api/public/channels`, which deliberately does not forward the session
  // cookie), and the page metadata even says "Browse channels on Wideo11".
  //
  // They were still behind the auth gate, so a logged-out visitor got a 307 to
  // the login form and the public endpoint had no way to ever be seen by the
  // people it is public for. A public API behind a private page is a public API
  // nobody can use.
  //
  // Nothing sensitive is exposed: the same data is already readable without a
  // session, and a creator's CHANNELS are meant to be found.
  // `/channels` is a single page and IS in the exact set. Its sibling
  // `/channel/@handle` is a PATH - one per channel, created as people sign up -
  // so it cannot be listed there. It goes in the prefix list below.
  '/channels',

  // The docs explain the product to people deciding whether to sign up, which is
  // the one moment they definitely are not signed in yet.
  '/pricing',
]);

/**
 * PUBLIC PAGE PREFIXES - paths whose CHILDREN are also public.
 *
 * ---- WHY THIS IS SEPARATE AND NOT `startsWith` ON PUBLIC_PAGES ----
 *
 * The set above is EXACT on purpose. An earlier version used `startsWith` here,
 * which made `/auth` a prefix that matched `/authenticated-anything` - a real
 * bypass, fixed by moving to exact matching. The comment at its declaration says
 * so, which is exactly why it is worth not quietly reintroducing.
 *
 * So a page whose CHILDREN must be public gets an entry here instead, where it is
 * visible on its own and reviewed on its own.
 *
 * Every entry is a whole SEGMENT followed by `/`, so `/channel` cannot match
 * `/channels` or `/channelsomething` - the same guard the API prefix list uses.
 */
const PUBLIC_PAGE_PREFIXES = ['/channel'];

/**
 * PUBLIC API PATHS - bina session ke callable (exact ya explicit prefix).
 *
 * Ye teen zaroori hain:
 *   - register/login/verify: PRE-auth hote hi to session hoga hi nahi
 *   - webauthn/*: register form biometric enroll karta hai, login se PEHLE
 *   - audit/telemetry: public landing page bhi ye beacons bhejti hai
 *
 * ---- `/api/health-check` YAHAN SE HATA DAYA GYA HAI (was public) ----
 *
 * Ye pehle is list me tha, is liye koi bhi anonymous caller ise hit kar sakta tha.
 * Ye route server-side fan-out hai, aur wo WITHOUT a credential ye sab leak karta
 * tha:
 *
 *   - internal service ke naam ("Recommendation Service", "Bot Service")
 *   - internal URLs - ek baar config se, aur doosri baar `error.message` ke
 *     andar jab fetch fail ho
 *   - poori box ka port map (8082, 8080), names ke saath
 *   - aur un services ka free up/down oracle jinke baare me caller ko jaanna
 *     nahi chahiye
 *
 * "health check" naam hone se wo harmless lagta hai. Naam ye batata hai ki route
 * KARTA kya hai, ye nahi ki wo BATA kya deta hai.
 *
 * Ab ye `@wideo11/ui/health-handler` hai: ek implementation, session-gated, service
 * names ki closed list, aur raw error message ki jagah stable error CODES.
 *
 * Load balancer ke liye `/api/live` public hai - wo sirf `{"status":"ok"}` deta
 * hai, koi dependency, version, hostname ya uptime nahi.
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
  // ---- Public channel discovery (Phase B1) ----
  //
  // `/api/v1/public/channels` (Go) jaan-boojh kar auth group ke BAHAR hai aur
  // uspe koi auth middleware nahi hai. Ye usi cheez ka web-side counterpart
  // hai, isliye yahan bhi public hona chahiye - warna middleware 401 de kar
  // public channel browse ko BLOCK kar dega.
  //
  // SAFE KYUN: prefix match yahan `pathname === p || pathname.startsWith(p + '/')`
  // se hota hai - yaani trailing `/` jodne se. `/api/publicfoo` ise match
  // NAHI karega. (Ye wahi fix hai jo pehle `/auth` prefix bug me kiya gaya
  // tha - `/api/authenticated-anything` public na ban jaaye.)
  //
  // SECURITY: ye sirf PUBLIC (is_public AND is_active) channels ka data
  // deta hai. Private channel aur unknown handle dono 404 hote hain, to
  // is endpoint se private handles enumerate nahi ho sakte.
  '/api/public',
  // NOTE: `/api/superadmin/awareness` YAHAN SE HATA DAYA GAYA HAI.
  // Ye pehle public list me tha, jisse middleware early-return karta tha aur
  // role gate tak pahunchta hi nahi tha - matlab koi bhi logged-in user
  // superadmin API hit kar sakta tha. Ab ye role-gated hai (upar check).
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
 * ---- WHY NEGATIVE RESULTS ARE *NOT* CACHED ----
 *
 * Ye line security gate ke infinite loop ko rokta hai, isliye poori comment
 * zaroori hai.
 *
 * Pehle cache `false` ko bhi store karta tha. Uska matlab tha:
 *
 *   1. User gate complete karta hai. Backend ab `setup_complete: true`
 *      return karta hai - verified, DB me bhi true.
 *   2. Gate `window.location.href = '/dashboard'` chalata hai.
 *   3. Middleware chalti hai, aur CACHED `false` padhti hai (TTL 10s abhi
 *      expire nahi hua) -> user ko wapas `/auth/security-setup` bhejti hai.
 *   4. Gate remount hota hai, ab `setup_complete: true` dekhta hai, dobara
 *      `/dashboard` jaata hai -> step 3.
 *
 * Yahi wo loop hai jo report hua: "saare steps complete karne ke baad bhi
 * wapas PIN par aa jaata hai." Jitni baar refresh karo, 10 second tak wahi.
 * 10 second baad cache expire hoti hai aur user finally dashboard par pahunch
 * ta hai - isliye bug "kabhi kabhi theek ho jaata hai" lagta hai, jabki
 * asal me ye guaranteed loop hai.
 *
 * ---- THE RULE ----
 *
 * Sirf `true` cache karo. `false` KABHI nahi.
 *
 *   true  - cached: yeh decision expensive thi (network hop), aur
 *           security-upgrade direction me hai. Galat `true` ka matlab hai
 *           "user ko thoda extra time mil gaya", jo accept hai.
 *   false - NEVER cached: yeh decision user ko BLOCK karti hai. Isko cache
 *           karna self-perpetuating trap banata hai - jo bhi stale value thi
 *           wahi re-enforce hoti rehti hai, jab tak TTL na nikle. TTL ke
 *           bajaye ek miss bhi user ko galat tareeke se rok sakta hai.
 *
 * Asli cost: ek incomplete user har navigation par ek call karega. Ye theek
 * hai - wo ek user hai, setup complete karne se uski saari calls band ho
 * jati hain.
 *
 * NOTE: per-process cache (dev me 1 process, prod me har pod ka apna).
 * `true` cache hone se completed users par koi staleness nahi hoti - setup
 * kabhi un-complete nahi hota.
 */
const setupCache = new Map<
  string,
  { complete: boolean; emailVerified: boolean; expiresAt: number }
>();

/** Cache TTL - milliseconds. Sirf `true` entries ke liye maani rakhta hai. */
const SETUP_CACHE_TTL_MS = 60_000;

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
/**
 * Gate state: kya user ne email verify kiya, aur kya security setup poora hai.
 *
 * ---- KYUN EK SAATH DONO CHAHIYE ----
 *
 * Pehle ye function sirf `setup_complete` return karta tha. Usse middleware
 * ko ye PATA HI NAHI CHALTA tha ki user ne email verify ki hai ya nahi.
 *
 * Neeche jo bug report hua - "register karte hi 6-digit PIN form khul jaata
 * hai, email verify kiye bina" - uski wajah yahi thi:
 *
 *   1. Register ke baad auth-service ek valid (future `exp` wala) session
 *      token deta hai. Toh `isValidSession` PASS ho jata hai.
 *   2. `setup_complete` abhi `false` hai (naya account) -> middleware
 *      `/auth/security-setup` par bhej deti thi.
 *   3. Wo page 6-digit PIN wala form render karti hai.
 *
 * Yaani unverified user ko security setup par jaane diya gaya, jabki SPEC order
 * ye hai: EMAIL VERIFY -> SECURITY SETUP -> app. Verification step poora skip.
 *
 * Ab dono ek hi network call se aate hain (auth-service ka `setup-status` dono
 * fields bhejta hai), to extra latency nahi badhti.
 */
interface GateState {
  emailVerified: boolean;
  setupComplete: boolean;
}

async function getGateState(jwt: string): Promise<GateState> {
  // ---- User id nikalo (cache key) ----
  let userId: string;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret, {
      audience: 'wideo11-api',
    });
    userId = String(payload.user_id ?? payload.sub ?? '');
  } catch {
    // Token invalid - pehle wala `isValidSession` check pakad lega.
    // Fail CLOSED: dono false.
    return { emailVerified: false, setupComplete: false };
  }
  if (!userId) return { emailVerified: false, setupComplete: false };

  // ---- Cache hit? ----
  const now = Date.now();
  const cached = setupCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { emailVerified: cached.emailVerified, setupComplete: cached.complete };
  }

  // ---- Auth-service call ----
  let emailVerified = false;
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
      // `email_verified` auth-service se naya aata hai. Purane service par
      // `undefined` milega, aur `=== true` false de dega - yaani fail-closed,
      // jisse ek stale deploy bhi verified user ko gate par nahi chhodega.
      emailVerified = data?.email_verified === true;
    }
    // !res.ok -> dono false (fail closed)
  } catch {
    emailVerified = false; // unreachable -> fail closed
    complete = false;
  }

  // ---- Cache write (SIRF tab jab DONO true ho) ----
  //
  // "Sirf `true` cache karo" wala rule ab tighten hai: cache tabhi likhte hain
  // jab user VERIFIED bhi ho aur setup COMPLETE bhi. Agar hum `email_verified:
  // false` cache kar dete, to user verification link click karne ke turant baad
  // bhi TTL tak `/auth/verify` par atka rehta - yaani bilkul wahi loop jo
  // `setup_complete: false` caching se pehle hota tha, sirf verification step
  // par shifted.
  //
  // Isi liye koi bhi negative result cache NAHI hota, aur stale entry turant
  // delete ho jaati hai.
  if (!emailVerified || !complete) {
    setupCache.delete(userId);
    return { emailVerified, setupComplete: complete };
  }

  if (setupCache.size >= SETUP_CACHE_MAX) {
    const oldest = setupCache.keys().next().value;
    if (oldest) setupCache.delete(oldest);
  }
  setupCache.set(userId, { complete, emailVerified, expiresAt: now + SETUP_CACHE_TTL_MS });

  return { emailVerified, setupComplete: complete };
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

  // ---- Public page check (EXACT match, plus an explicit prefix list) ----
  //
  // Segment-aware: `pathname === p + '/' || pathname.startsWith(p + '/')`, so
  // `/channel` covers `/channel/@handle` without also matching `/channels`.
  const isPublicPage =
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p + '/'));

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
  //
  // ---- `next` PRESERVE KARO ----
  //
  // Pehle yahan plain `new URL('/auth/login', request.url)` tha, jisse query
  // string (aur usme `next`) DROP ho jati thi. Toh video-editor gate se aaya
  // user `/auth/login?next=/` par pahunchta tha jahan `next` gayab tha - login
  // karne ke baad usse apni destination yaad hi nahi rehti thi.
  //
  // Ab destination ko aage `?next=` me bhejte hain. `safeNext()` se guzarte hain
  // taake user-supplied `next` open-redirect na ban sake (absolute URL /
  // protocol-relative `//host` reject).
  const loginUrl = new URL('/auth/login', request.url);
  const wanted = safeNext(request.nextUrl.searchParams.get('next'));
  // Sirf tab set karo jab caller ne kuch bheja tha - warna har redirect par ek
  // bekaar `?next=/dashboard` lag jayega.
  if (request.nextUrl.searchParams.has('next') && wanted !== DEFAULT_NEXT) {
    loginUrl.searchParams.set('next', wanted);
  }

  const res = NextResponse.redirect(loginUrl);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

  // ==========================================================================
  // GATE ORDER: EMAIL VERIFY PEHLE, SECURITY SETUP BAAD ME
  // ==========================================================================
  //
  // ---- YE BUG THA JO REPORT HUA ----
  // "Register form submit karte hi seedha 6-digit PIN form khul jaata hai,
  //  email verify kiye bina."
  //
  // Wajah: register ke baad auth-service ek valid session token deta hai (uska
  // `exp` future me hota hai), to upar ka JWT check PASS ho jata tha. Uske
  // baad middleware sirf `setup_complete` dekhti thi. Naye account par wo
  // `false` hota hai -> user `/auth/security-setup` par bhej diya jaata ->
  // wo page 6-digit PIN form render karti hai. Email verification ka step
  // poora SKIP ho gaya.
  //
  // SPEC order ye hai: EMAIL VERIFY -> SECURITY SETUP -> app.
  //
  // ---- FIX ----
  // Dono signals ek saath maange jaate hain, aur verification ko pehle check
  // kiya jaata hai. Ye check SESSION-ONLY APIs par bhi chalti hai (gate ke
  // neeche wali list), warna unverified user sidha `POST /api/auth/security/pin`
  // call karke PIN set kar sakta tha - yaani API se verification bypass.
  //
  // `/auth/verify` PUBLIC page hai, isliye yahan redirect karne se loop nahi
  // banta (uske baad middleware us request par early-return kar deti hai).

  const gate = await getGateState(token!);

  if (!gate.emailVerified) {
    if (isApiRequest) {
      return NextResponse.json(
        {
          error: 'email_verification_required',
          message:
            'Verify your email address before continuing. Use the link we sent you, or request a new one.',
        },
        { status: 403 }
      );
    }

    // Page request -> verification page, with `next` preserved.
    const verifyUrl = new URL('/auth/verify', request.url);
    const wanted = safeNext(request.nextUrl.searchParams.get('next'));
    if (request.nextUrl.searchParams.has('next') && wanted !== DEFAULT_NEXT) {
      verifyUrl.searchParams.set('next', wanted);
    }
    return NextResponse.redirect(verifyUrl);
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

  if (!isSessionOnlyApi && !gate.setupComplete) {
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

  // ==========================================================================
  // SUPERADMIN ROLE GATE (migration 006)
  // ==========================================================================
  //
  // Reality check (audit): pehle `users` table me ROLE COLUMN HI NAHI THA.
  // Matlab `/superadmin` kisi bhi logged-in user ke liye open tha - koi
  // real authorization nahi thi, sirf UI me chhupana tha (jo security nahi hai).
  //
  // Ab role JWT ke SIGNED claim se aata hai. Token verify ho chuka hai
  // upar (`isValidSession` -> `jwtVerify` with the real secret), isliye role
  // claim bhi authenticated hai - client ise forge nahi kar sakta.
  //
  // SECURITY: ye role claim TABHI trusted hai jab signature verify hua ho.
  // Isliye ye check `!authenticated` ke BAAD hai, pehle nahi - warna
  // unsigned/garbage token se koi admin ban jayega.
  const isAdminRoute =
    pathname === '/superadmin' ||
    pathname.startsWith('/superadmin/') ||
    // ---- API bhi cover hona zaroori hai ----
    // Pehle sirf `/superadmin` match hota tha. Iska matlab
    // `/api/superadmin/*` role check se BACH jata tha - aur wo bhi public
    // API list me tha, yaani middleware early-return kar deta tha. Net: API
    // par koi role enforcement hi nahi thi.
    pathname === '/api/superadmin' ||
    pathname.startsWith('/api/superadmin/');

  if (isAdminRoute) {
    const role = await getRoleFromToken(token!);

    if (role !== 'superadmin') {
      // API pe JSON, page pe redirect - API clients ko HTML nahi chahiye
      if (isApiRequest) {
        return NextResponse.json(
          {
            error: 'forbidden',
            message: 'This area is restricted to superadmins.',
          },
          { status: 403 }
        );
      }
      // Logged-in user ko apne dashboard pe bhejo (403 page nahi - zyada
      // useful hai, aur user ko pata chal jayega ki access nahi mila)
      return NextResponse.redirect(new URL('/dashboard', request.url));
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
 * JWT se ROLE claim padta hai (signature verify karke).
 *
 * SECURITY - ye function KABHI unverified token ka role trust nahi karta:
 *   - `jwtVerify` real HS256 secret ke saath chalta hai
 *   - `audience` bhi match hona zaroori hai
 *   - verify fail -> `null` return (fail CLOSED, fail-open nahi)
 *
 * Isi liye ye `isValidSession` ke BAAD call hota hai - signature verify
 * ho chuka hota hai tabhi role claim padha jaata hai.
 */
async function getRoleFromToken(jwt: string): Promise<string | null> {
  if (!JWT_SECRET) return null; // fail closed
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret, {
      audience: 'wideo11-api',
    });
    const role = payload.role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
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

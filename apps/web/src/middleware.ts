/**
 * ============================================================================
 * WEB - the public creator app, and the only app whose gate carries
 * PRODUCT rules beyond "is there a session"
 * ============================================================================
 *
 * Ye file HAR incoming request par chalti hai (Edge runtime) aur decide
 * karti hai ki request authorized hai ya nahi. Unauthorized request ko ya to
 * redirect karti hai (pages ke liye) ya 401 JSON return karti hai (API ke
 * liye).
 *
 * ============================================================================
 * YE AB EK BINDING HAI, NA KI EK IMPLEMENTATION
 * ============================================================================
 *
 * Pehle ye 746 line ka hand-rolled guard tha - aur wo WORKING tha, jisliye
 * `@wideo11/ui/gate` usi se nikala gaya tha. Ab har security decision -
 * cookie name, HS256 signature verification, audience check, fail-closed
 * behaviour, silent token renewal, open-redirect guard, rate limiting,
 * email-verification gate, security-setup gate, `/superadmin` role gate -
 * `@wideo11/ui/gate` me ek hi jagah live karta hai, aur ye file sirf
 * CONFIGURATION hai: kaun se routes public hain, aur kaun se product
 * rules on hain.
 *
 * Do apps ek hi security rule implement karte hain to do jagah se ek
 * copy-paste error hota hai - aur silently. Ye file ka purana roop isi
 * class ka tha: gate wala logic doosri 7 files me phaila hua tha.
 *
 * ---- COVERAGE DRIFT: ZERO ----
 *
 * Har route safety parameter aur session token behaviour purani file se
 * EXACTLY aaya hai:
 *
 *   - public pages / API prefixes / PWA assets : same lists, same
 *     exact-and-whole-segment matching (koi bare `startsWith` nahi)
 *   - rate limiting               : pehle chalta hai, public routes
 *                                   par bhi (login route public hai)
 *   - unauthenticated             : API -> 401 JSON, page -> `/auth/login`
 *                                   redirect with `next` preserved
 *   - email verification          : 403 JSON / `/auth/verify` redirect,
 *                                   `next` preserved
 *   - security setup              : 403 JSON / `/auth/security-setup`
 *                                   redirect; `/api/auth/security`
 *                                   session-only hai (deadlock fix)
 *   - superadmin role gate        : `/superadmin` + `/api/superadmin`,
 *                                   API -> 403, page -> `/dashboard`
 *   - `x-wideo11-security` header : 'session-only' | 'complete'
 *
 * ---- EK DELIBERATE IMPROVEMENT ----
 *
 * Purani middleware access token verify karti thi aur refresh cookie
 * ko throw kar deti thi - isliye web ke users har 15 minute me silently
 * signed out ho jate the, chahe login route 7-day refresh cookie set
 * karta ho. Gate SILENT RENEWAL karta hai (refresh token se naya access
 * token, 90s window) - wo fix ab web par bhi active hai. Session
 * token ZYADA operational hua hai, kam nahi.
 *
 * Hinglish comments: har block ka arth
 */

import { createGate, GATE_MATCHER } from '@wideo11/ui/gate';
import { authRateLimitMiddleware } from '@/lib/rate-limiter';
import { getSecuritySetupState } from '@/lib/security-gate-state';
import { vpnGate } from '@/lib/vpn-gate';

/**
 * PUBLIC PAGES - bina login ke render hone wale pages.
 *
 * ---- IMPORTANT: ye EXACT match hain, `startsWith` NAHI ----
 * Pehle prefix matching thi (`/auth`), jo bypass vector thi. Ab har entry
 * poori tarah match hoti hai, aur `/dashboard` jaise protected pages ke
 * liye koi prefix leak nahi hota.
 */
const PUBLIC_PAGES = [
  '/', // landing - Wino/Rino showcase
  '/auth/login', // login zaroori hai - warna koi login hi nahi kar sakta
  '/auth/register', // onboarding
  '/auth/verify', // email verification link target
  '/auth/security-setup', // security gate khud - gate ko redirect karna
  //                          infinite loop bana dega

  // ---- The public browse pages ----
  //
  // `/channels` and `/channel/@handle` read the PUBLIC endpoint
  // (`/api/public/channels`, which deliberately does not forward the session
  // cookie), and the page metadata even says "Browse channels on Wideo11".
  //
  // Nothing sensitive is exposed: the same data is already readable without a
  // session, and a creator's CHANNELS are meant to be found.
  '/channels',

  // The docs explain the product to people deciding whether to sign up, which is
  // the one moment they definitely are not signed in yet.
  '/pricing',
];

/**
 * PUBLIC PAGE PREFIXES - paths whose CHILDREN are also public.
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
 * Ye route server-side fan-out hai, aur wo WITHOUT a credential ye sab leak karta
 * tha: internal service ke naam, unke internal URLs, poori box ka port map, aur
 * un services ka free up/down oracle. "health check" naam hone se wo harmless
 * lagta hai. Naam ye batata hai ki route KARTA kya hai, ye nahi ki wo BATA kya
 * deta hai. Ab ye `@wideo11/ui/health-handler` hai: session-gated, service
 * names ki closed list, stable error CODES.
 *
 * Load balancer ke liye `/api/live` public hai - wo sirf `{"status":"ok"}` deta
 * hai, koi dependency, version, hostname ya uptime nahi.
 *
 * `/api/public` (channel discovery) jaan-boojh kar auth group ke BAHAR hai aur
 * uspe koi auth middleware nahi hai - isi counterpart ke liye yahan bhi public
 * hai. SAFE KYUN: prefix match `pathname === p || pathname.startsWith(p + '/')`
 * se hota hai. SECURITY: sirf PUBLIC (is_public AND is_active) channels ka data,
 * to private handles enumerate nahi ho sakte.
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
  '/api/public',
];

/**
 * PUBLIC ASSETS - PWA ke static files.
 *
 * ---- YE GATE KE BINA SABSE BADI PWA BLOCKING BUG THI ----
 * Ye list pehle MISSING thi, jisse PWA bilkul kaam hi nahi kar raha tha.
 * Har asset `307 -> /auth/login` par redirect ho raha tha, jabki:
 *
 *   - Service worker REGISTRATION hamesha UNAUTHENTICATED hoti hai
 *   - Manifest browser dwara bina kisi session ke padha jaata hai
 *   - Icons tab bar, bookmarks aur install dialog me bina session load hote hain
 *   - Offline page tab chahiye jab user authenticated NAHO
 *
 * SECURITY: ye saare static files hain, koi user data nahi.
 */
const PUBLIC_ASSETS = [
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
];

/**
 * SESSION-ONLY API PATHS - valid session chahiye, par COMPLETED SECURITY
 * SETUP nahi chahiye.
 *
 * ---- YE LIST KYUN ZAROORI HAI (deadlock fix) ----
 * Ye woh APIs hain jinke through user apna security setup COMPLETE karta hai
 * (PIN set, questions set, biometric enroll, status check).
 *
 * Pehle in par bhi "setup complete" check lag raha tha, jisse ek DEADLOCK
 * ban gaya: middleware "setup complete nahi hai -> block", proxy 403
 * security_setup_required, user PIN hi nahi set kar sakta, kabhi complete
 * nahi hoga. Ye APIs public nahi hain - unke liye SESSION zaroori hai (proxy
 * khud httpOnly cookie check karta hai). Bas "setup complete" check skip hota
 * hai, kyunki in APIs ka kaam hi setup complete karna hai.
 */
const SESSION_ONLY_API_PREFIXES = ['/api/auth/security'];

/**
 * THE GATE - sab configuration, koi implementation nahi.
 *
 * ---- SECURITY SETUP GATE ----
 * `requireEmailVerified` + `requireSecuritySetup` + `securitySetupStatus`
 * milkar wo purana `getGateState` flow banate hain: auth-service ka
 * `/security/setup-status` call (web ke `lib/security-gate-state.ts` me,
 * positive-only cache ke saath) aur gate us result ko ORDER me enforce
 * karta hai - EMAIL VERIFY pehle, SECURITY SETUP baad me, dono fail-closed.
 *
 * ---- SUPERADMIN ROLE GATE ----
 * Purani file ka path-scoped gate: sirf `/superadmin` aur `/api/superadmin`
 * par `superadmin` role mangti hai (app ka baaki hissa any-session hai).
 * Role SIGNED JWT claim se aati hai - signature verify hone ke BAAD - isliye
 * client se forge nahi ho sakti.
 */
const gate = createGate({
  publicPages: PUBLIC_PAGES,
  publicPagePrefixes: PUBLIC_PAGE_PREFIXES,
  publicApiPrefixes: PUBLIC_API_PREFIXES,
  publicAssets: PUBLIC_ASSETS,

  // Brute-force protection: registration 3/5min, login 8/min, verify
  // 10/min, other auth 20/min - per IP, per route bucket. PUBLIC routes
  // par bhi chalta hai, kyunki login route khud public hai.
  rateLimit: authRateLimitMiddleware,

  // Email verification gate (spec order: VERIFY -> SETUP -> app).
  requireEmailVerified: true,
  verifyPath: '/auth/verify',

  // Mandatory security setup gate (PIN, biometric, questions).
  requireSecuritySetup: true,
  securitySetupPath: '/auth/security-setup',

  // The setup-status lookup web owns (auth-service call + positive-only
  // cache). The gate owns the enforcement.
  securitySetupStatus: getSecuritySetupState,
  sessionOnlyApiPrefixes: SESSION_ONLY_API_PREFIXES,

  // Path-scoped privileged corner inside an any-session app.
  roleGate: {
    paths: ['/superadmin', '/api/superadmin'],
    roles: ['superadmin'],
    // Logged-in non-superadmin ko apne dashboard bhejo (403 page se
    // useful hai, aur user ko pata chal jayega ki access nahi mila).
    pageRedirect: '/dashboard',
  },
});

/**
 * ---- VPN / PROXY GATE (anti-fraud) ----
 *
 * Wrapped AROUND the gate rather than bolted inside it: the gate is shared
 * library code for eight apps, and only web is the product surface a fraudster
 * buys a subscription on. Dev bypasses the check entirely (`ALLOW_VPN=true`),
 * production refuses with a 403 JSON (`ALLOW_VPN=false`) - see
 * `lib/vpn-gate.ts` for the honest scope of the detection.
 *
 * NOTE: `gate` itself is NOT exported any more - every request goes through
 * the fraud check first. The gate's behaviour is unchanged behind it.
 */
const gateWithFraudCheck: typeof gate = async (request) => {
  const blocked = await vpnGate(request);
  // The cast is the one honest join: the fraud gate speaks `Response`, the
  // auth gate speaks `NextResponse`, and Next's middleware contract accepts
  // both at runtime. NextResponse.json on the fraud side keeps it a plain
  // JSON 403 rather than anything a browser would try to render.
  if (blocked) return blocked as Awaited<ReturnType<typeof gate>>;
  return gate(request);
};

export default gateWithFraudCheck;

/**
 * ---- The matcher: A LITERAL, ON PURPOSE ----
 *
 * Next.js reads `config.matcher` by STATIC ANALYSIS and cannot resolve an
 * imported spread - `matcher: [...GATE_MATCHER]` compiles, type-checks and
 * lints clean, and is then SILENTLY IGNORED, leaving the default `/:path*`
 * matcher. So the literal is written out, and `tools/check-app-gates.mjs`
 * asserts every app's literal is byte-identical to `GATE_MATCHER` in
 * `@wideo11/ui/gate`.
 *
 * The dot rule is what keeps the PWA reachable: `robots.txt`,
 * `manifest.webmanifest`, `sw.js`, `offline.html` aur har icon - none of
 * which has `_next` in its URL - bypass the gate entirely, which is the
 * same outcome the old `PUBLIC_ASSETS` allow produced, one hop earlier.
 *
 * NOTE: `api/auth` yahan se EXCLUDE nahi hai. Auth API requests bhi rate
 * limiter ke through jaani chahiye, aur koi bhi auth API pe hard-lock nahi
 * hota kyunki wo `PUBLIC_API_PREFIXES` me hai.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};

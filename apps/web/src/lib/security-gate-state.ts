/**
 * ============================================================================
 * SECURITY SETUP STATE - the auth-service lookup `apps/web` owns
 * ============================================================================
 *
 * The shared gate (`@wideo11/ui/gate`) owns the ORDERING of the
 * email-verification and security-setup gates. It does not own this
 * call, because the endpoint, the fields and the cache are PRODUCT
 * facts about `apps/web`, not facts about authentication.
 *
 * The gate imports this function through `securitySetupStatus` and
 * enforces what it returns. Everything below - the network call, the
 * fail-closed semantics and the cache - is unchanged from the
 * middleware it lived in, because those properties are the safety
 * contract, not implementation detail.
 *
 * Hinglish comments: har block ka arth
 */

// `jose` resolves through the workspace's hoisted node_modules -
// `@wideo11/ui` depends on it and the gate uses it for the same
// verification. The token was ALREADY signature-verified by the
// gate before this function is called; verifying again here is
// defense-in-depth for the cache key, not the authorization.
import { jwtVerify } from 'jose';

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
 * SECURITY SETUP STATUS CACHE
 *
 * Key   : user_id (JWT se nikalte hain)
 * Value : { complete: boolean, emailVerified: boolean, expiresAt: number }
 *
 * ---- KYUN CACHE ZAROORI HAI ----
 * Middleware har protected request pe chalta hai. Bina cache ke har request
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
 * 10 second baad cache expire hota hai aur user finally dashboard par pahunch
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
 *      token deta hai. Toh session check PASS ho jata hai.
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
export interface SecuritySetupGateState {
  emailVerified: boolean;
  setupComplete: boolean;
}

/**
 * Check whether the user has verified their email and completed mandatory
 * security setup.
 *
 * Calls auth-service `GET /api/v1/auth/security/setup-status` with the
 * session bearer token and reads `setup_complete` and `email_verified`.
 *
 * FAIL-CLOSED: auth-service unreachable ya error de to dono `false` return
 * hote hain - yaani service down par app BLOCKED rehta hai. Fail-open nahi,
 * kyunki security gate bypass karna hi fail-open hota hai.
 */
export async function getSecuritySetupState(
  jwt: string
): Promise<SecuritySetupGateState> {
  // ---- User id nikalo (cache key) ----
  let userId: string;
  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET_KEY ?? ''
    );
    const { payload } = await jwtVerify(jwt, secret, {
      // Audience match bhi check karo - koi doosre service ka token
      // is cache key ke liye accept na ho
      audience: 'wideo11-api',
    });
    userId = String(payload.user_id ?? payload.sub ?? '');
  } catch {
    // Token invalid - gate khud fail-closed ho chuka hota hai.
    return { emailVerified: false, setupComplete: false };
  }
  if (!userId) return { emailVerified: false, setupComplete: false };

  // ---- Cache hit? ----
  const now = Date.now();
  const cached = setupCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return {
      emailVerified: cached.emailVerified,
      setupComplete: cached.complete,
    };
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
  setupCache.set(userId, {
    complete,
    emailVerified,
    expiresAt: now + SETUP_CACHE_TTL_MS,
  });

  return { emailVerified, setupComplete: complete };
}

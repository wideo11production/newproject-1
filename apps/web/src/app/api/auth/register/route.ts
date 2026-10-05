// Registration API endpoint - POST /api/auth/register
//
// Ye route auth-service (port 8085) ka PROXY hai. Iska kaam:
//  1. Server side validation (client validation bypass ho sakti hai)
//  2. Real backend tak forward karna, taaki:
//     - Postgres me duplicate email check ho
//     - Password bcrypt se hash ho
//     - Verification token issue ho aur 30-min purge lifecycle start ho
//
// SECURITY: Ye path middleware ke rate limiter ke under aata hai
// (1 request per IP per minute), isliye yahan tak pahunchne ka matlab hai ki
// request ne defense barrier cross kiya hai. 429 pass-through hota hai.
//
// Hinglish comments: har block ka arth samjhne ke liye

import { NextResponse } from 'next/server';

// Auth service ka internal address (compose network me service name se reachable)
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://auth-service:8085';

/**
 * Should the session cookie be marked Secure?
 *
 * The rule is "was THIS request encrypted", never "are we a production build".
 * Those two are not the same thing, and treating them as one is what made the
 * local stack unable to hold a session at all.
 *
 * - Behind a TLS-terminating proxy: `x-forwarded-proto: https` -> secure.
 * - Direct HTTPS: `nextUrl.protocol` is https -> secure.
 * - Everything else: plain http -> NOT secure, because a Secure cookie set
 *   over http is discarded by the browser without a warning.
 */
function shouldBeSecure(req: Request, nextUrl: URL): boolean {
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return nextUrl.protocol === 'https:';
}

export async function POST(request: Request) {
  // Used to decide whether the session cookie may be marked Secure.
  const nextUrl = new URL(request.url);
  let body: Record<string, unknown>;

  // Body parse - malformed JSON par 400
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fields normalize karo
  // NOTE: `fullName` ab OPTIONAL hai. Register form se ye field hata diya
  // gaya hai (600px compact card requirement), to form empty string bhejta
  // hai. Backend `full_name` ko bhi optional kar diya gaya hai, isliye
  // validation yahan enforce nahi hoti.
  // Asar: user ka display name khaali rahega jab tak wo profile/settings me
  // na bhare. Ye jaan-boojh kar maara gaya hai.
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  // `username` NEW (migration 003). Public handle - channel URL me dikhega.
  // Normalize yahi karni hai jo backend karta hai (lowercase + trim), taaki
  // user ko "taken" na lage jab sirf case alag ho.
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const enableBiometric = body.enableBiometric === true;
  // NEW (migration 004): client batata hai device me sensor hai ya nahi.
  // Ye FORWARD hona zaroori hai - warna backend ko pata hi nahi chalega, aur
  // sensor-less users security gate me permanently phas jayenge.
  // `boolean` check karna zaroori hai taaki `undefined` na jaaye (backend
  // `*bool` me nil receive karega aur safe default `true` maan lega).
  const biometricCapable =
    typeof body.biometricCapable === 'boolean' ? body.biometricCapable : null;

  // Mint-or-read. See the note above for why this is server-side and on a cookie.
  const device = resolveDeviceId(request);

// =============================================================================
// THE DEVICE FINGERPRINT — and why the SERVER owns it, not the form
// =============================================================================
//
// This went through three wrong shapes before landing here, and each one failed the
// same way: correct code, correct tests, and nothing on the path that reaches it.
//
//   1. NOT SENT AT ALL. The original comment read "device fingerprint nahi bhejte —
//      auth-service use tabhi store karta hai jab non-empty ho". True, and it made the
//      one-trial-per-browser cap completely inert: `trial_devices` stayed empty
//      through full register/verify cycles.
//
//   2. `deviceId()` INSIDE THIS ROUTE. Reads `localStorage`; `window` is undefined
//      on a server, so it returned `null` every time. Same empty table.
//
//   3. `deviceId()` IN THE REGISTER FORM. That works, and it is what a developer
//      would stop at — but it makes the cap depend on ONE call site remembering.
//      The API route called directly by curl, by a mobile client, or by a future
//      re-auth flow sends nothing, and the cap silently stops applying.
//
// SO: THE SERVER MINTS IT, ON AN httpOnly COOKIE.
//
// The server can set a cookie and read it back. That is the whole trick — a client
// cannot read `httpOnly`, but it does not need to, because the SERVER is the one
// forwarding the header to auth-service.
//
// Consequences, all of them the right way:
//
//   * Works for the form, for curl, for any client, with no cooperation required.
//   * `httpOnly`, so a script cannot read or forge the device id.
//   * Set once, then stable — `localStorage` clearing no longer resets it, which
//     closes the honest limitation in `internal/service/trial_device.go` where a user
//     could mint a fresh fingerprint by clearing site data.
//   * SameSite=Lax, so it rides top-level navigations and nothing else.
//
// It is STILL a per-browser id and not a hardware fingerprint: a random UUID that
// names this browser's install. Deriving one from canvas or screen size would track
// the person across sites, and that is a privacy decision rather than an
// implementation detail.
const DEVICE_COOKIE = 'wideo11_device';

/** Mint-or-read the device id. Always returns a value; never throws. */
/**
 * The device cookie name, declared INSIDE the function that reads it.
 *
 * It was a module-level `const` first, and the production bundle turned every
 * reference into a single minified identifier declared LATER in the output file —
 * so the route threw `ReferenceError: Cannot access 'c' before initialization` and
 * every signup returned 500 with an empty `trial_devices` behind it.
 *
 * Function-local cannot be reordered relative to its use, so the class of bug is
 * gone rather than worked around. The cost is one string literal that appears
 * twice, which is cheaper than a signup route that 500s.
 */
function resolveDeviceId(request: Request): { id: string; isNew: boolean } {
  const COOKIE_NAME = 'wideo11_device';

  const jar = (request as { cookies?: { get(n: string): { value: string } | undefined } })
    .cookies;
  const existing = jar?.get(COOKIE_NAME)?.value;
  if (existing) return { id: existing, isNew: false };

  return { id: mintDeviceId(), isNew: true };
}

/**
 * A random v4 UUID string.
 *
 * Written WITHOUT a local alias for `crypto` on purpose. The first version used
 * `const c = globalThis.crypto as {...}` and referred to `c` from both ternary
 * branches; the production bundle minifier collapsed those references and the
 * route threw `ReferenceError: Cannot access 'c' before initialization` on every
 * signup — a 500 with an empty registration table behind it.
 *
 * Two spellings of the same global in one function is one more thing a bundler has
 * to keep straight. There is now exactly one way the value is obtained, and the
 * fallback is a separate function with its own lookup.
 */
function mintDeviceId(): string {
  // Preferred path. `randomUUID` needs a secure context, so it is genuinely absent
  // on plain http in some runtimes and must not be assumed.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: the same value assembled by hand from `getRandomValues`, which is
  // available in every context that has WebCrypto at all.
  //
  // `Array.from(...)` rather than `for...of`. A `Uint8Array` is iterable at
  // RUNTIME, but this tsconfig targets below es2015, so `for...of` over one is a
  // compile error — and a build failure here takes registration down entirely, which
  // is a worse outcome than the line being slightly longer.
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // No WebCrypto at all. A time-and-counter value rather than a UUID shape, and
  // deliberately NOT presented as a UUID: the column is opaque to auth-service, but
  // a value that looks like a UUID and is not would mislead whoever debugs the
  // registry next.
  return `d${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

  // ---- Server side validation ----
  // Ye client validation se ALAG hai, kyunki koi bhi seedha API call karke
  // client validation bypass kar sakta hai. Server par hi final authority hai.
  const errors: Record<string, string> = {};

  // NOTE: `fullName` required-check HATA diya hai - form se field hata hai,
  // to check rakhne se registration fail hoti.

  // ---- Username validation (mirrors the Go service rules exactly) ----
  // Length 3-30, aur sirf lowercase letters / digits / `_` / `.` / `-`.
  // Backend bhi EXACTLY yehi rules lagata hai (`service.Register`), to dono
  // jagah same rule rakhna zaroori hai - warna user ko client pass ho jaye
  // aur server reject kare (confusing 400).
  if (!username) {
    errors.username = 'Username is required';
  } else if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    errors.username =
      'Username must be 3-30 characters: letters, numbers, underscore, dot or hyphen';
  }

  if (!email) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address';
  }

  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < 12) {
    // 12 character minimum - frontend strength meter se match karta hai
    errors.password = 'Password must be at least 12 characters';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  // ---- Forward to auth-service ----
  try {
    const authResponse = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ---- The header auth-service actually reads ----
        //
        // It is a HEADER and not part of the `device` object, which is why the
        // original comment ("auth-service use tabhi store karta hai jab non-empty
        // ho") was true and still left the cap doing nothing.
        'X-Fingerprint': device.id,
      },
      body: JSON.stringify({
        email,
        password,
        // Snake_case me bhejte hain kyunki Go model ke json tags
        // `full_name` / `username` hain (camelCase me unmarshal nahi hoga).
        full_name: fullName,
        username,
        // NEW (migration 004): device capability forward karo taaki backend
        // decide kar sake biometric enrollment mandatory hai ya nahi.
        biometric_capable: biometricCapable,
        device: {},
      }),
      // Verification email browser ko nahi, auth-service ke console/SMTP ko jaani chahiye
      cache: 'no-store',
    });

    const payload = await authResponse.json().catch(() => ({}));

    // Backend ka status pass-through karte hain (201 success, 409 duplicate, etc.)
    // Taaki frontend ko accurate signal mile
    const res = NextResponse.json(payload, { status: authResponse.status });

    // First time only. Set unconditionally-but-harmlessly would also be fine; this
    // avoids a Set-Cookie on every signup.
    if (device.isNew) {
      res.cookies.set({
        name: DEVICE_COOKIE,
        value: device.id,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        // Long enough to outlive the trial it caps. A year means an honest user who
        // re-registers after clearing cookies is recognised, and the cost of a stale
        // id is one refused trial for one person, not a security hole.
        maxAge: 365 * 24 * 60 * 60,
      });
    }

    // ---- SESSION COOKIE after registration ----
    // Registration bhi successful login ke barabar hota hai - backend tokens
    // bhejta hai. Pehle ye cookie nahi set hoti thi, jisse:
    //   1. user ko turant login nahi milta tha (dobara login karna padta)
    //   2. WORSE: registration ke baad biometric enroll karna IMPOSSIBLE tha,
    //      kyunki WebAuthn endpoints authenticated hain aur koi session hi
    //      nahi tha. Isliye register form par "Enable biometric" checkbox
    //      tick karne par "Could not start biometric registration" aata tha -
    //      kyunki `register/begin` par 401 mil raha tha.
    //
    // Ab cookie set hone se:
    //   - user logged-in ho jata hai
    //   - webauthn-proxy cookie se token uthata hai -> enrollment kaam karta hai
    if (authResponse.status === 201 && payload?.tokens?.access_token) {
      const expiresInSec = Number(payload?.tokens?.expires_in) || 900;
      res.cookies.set({
        name: 'wideo11_session',
        value: String(payload.tokens.access_token),
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldBeSecure(request, nextUrl),
        path: '/',
        maxAge: expiresInSec,
      });
    }

    return res;
  } catch {
    // Auth service reachable nahi - clear error
    return NextResponse.json(
      {
        error: 'Authentication service unavailable',
        message: 'Could not reach the authentication service. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}

// GET allowed nahi
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

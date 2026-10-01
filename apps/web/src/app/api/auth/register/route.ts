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
      headers: { 'Content-Type': 'application/json' },
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
        // Device fingerprint nahi bhejte - auth-service use tabhi store karta hai
        // jab non-empty ho (unique index protection)
        device: {},
      }),
      // Verification email browser ko nahi, auth-service ke console/SMTP ko jaani chahiye
      cache: 'no-store',
    });

    const payload = await authResponse.json().catch(() => ({}));

    // Backend ka status pass-through karte hain (201 success, 409 duplicate, etc.)
    // Taaki frontend ko accurate signal mile
    const res = NextResponse.json(payload, { status: authResponse.status });

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

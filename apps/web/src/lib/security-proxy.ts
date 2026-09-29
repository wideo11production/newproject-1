// ============================================================================
// Security API proxy helper
// ============================================================================
//
// auth-service ke security endpoints ke liye SAME-ORIGIN proxy.
//
// ---- KYUN YE ZAROORI HAI ----
// 1. CORS: browser seedha `localhost:8085` (different origin) par call karta
//    to CORS block ho jata. Same-origin proxy se ye bypass hota hai.
// 2. HTTPONLY TOKEN: session cookie `wideo11_session` httpOnly hai - browser
//    JS use nahi padh sakta. Isliye token SERVER-SIDE attach hota hai, aur
//    client ko token ki zaroorat hi nahi.
//
// Ye pattern pehle sirf `pin/verify` ke liye tha (`pin/verify/route.ts`).
// Ab isse bana diya gaya taaki baaki security endpoints bhi same tarike se
// proxy ho sakein, aur har route file patla (thin) rahe.
//
// NOTE: ye deliberately `[...path]` catch-all NAHI hai. Catch-all ek hi
// tree me specific static routes (`pin/verify`) ke saath conflict karta hai
// aur runtime par 404 deta hai (route compile hoti hai, match nahi karti).
// Explicit route files predictible hain aur debug karna aasan.
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

const SESSION_COOKIE = 'wideo11_session';

/**
 * Read the httpOnly session cookie.
 *
 * Returns null when absent OR when cookies are not available on the object -
 * it never throws (fail safe).
 */
function readSessionCookie(req: NextRequest): string | null {
  try {
    return req.cookies?.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Forward an authenticated request to auth-service.
 *
 * @param req     - incoming request (cookie read karne ke liye)
 * @param apiPath - path AFTER `/api/v1/auth` (e.g. `/security/pin`)
 * @param method  - HTTP method
 * @param opts.requireBody - true ho to empty body bhi forward hoga
 *   (kuch endpoints jaise `biometric/complete` empty body accept karte hain)
 */
export async function forwardSecurity(
  req: NextRequest,
  apiPath: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  opts: { requireBody?: boolean } = {}
) {
  const token = readSessionCookie(req);

  // ---- No session -> 401, fail closed ----
  if (!token) {
    return NextResponse.json(
      {
        error: 'unauthorized',
        message: 'No active session. Please log in.',
      },
      { status: 401 }
    );
  }

  // ---- Body sirf wahi methods ke liye jo body lete hain ----
  let bodyText: string | undefined;
  if (method === 'POST' || method === 'PUT') {
    const raw = await req.text();
    if (raw && raw.length > 0) {
      bodyText = raw;
    } else if (opts.requireBody) {
      bodyText = undefined; // empty body allowed
    }
  }

  try {
    const upstream = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth${apiPath}`, {
      method,
      headers: {
        // ---- Token yahan, server-side, attach hota hai ----
        Authorization: `Bearer ${token}`,
        ...(bodyText ? { 'Content-Type': 'application/json' } : {}),
      },
      body: bodyText,
      cache: 'no-store',
    });

    const payload = await upstream.json().catch(() => ({}));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      {
        error: 'service_unavailable',
        message:
          'Could not reach the authentication service. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}

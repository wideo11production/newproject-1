// WebAuthn proxy helper - auth-service tak request forward karta hai
//
// Ye helper app router ke andar nahi, src/lib me rakha hai - isse Next.js
// routing quirks se bach jaata hai aur import path simple rehta hai.
//
// SECURITY: Body bilkul as-is forward hoti hai - koi parsing/modification nahi,
// warna go-webauthn ka credential parsing fail ho jayega.
// Hinglish: body ko jaisa hai waisa hi forward karte hain

import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://auth-service:8085';

// forward auth-service ke kisi bhi path tak request bhejta hai
export async function forwardToAuth(
  path: string,
  request: Request,
  method: 'POST' | 'GET' = 'POST'
) {
  // Raw body as-is padho (parse NAHI karna - credential JSON strict hai)
  const body = await request.text();

  // ---- Session token: header se, warna httpOnly cookie se ----
  // Priority:
  //   1. `Authorization` header (register form - user authenticated nahi hai
  //      us moment, token React state me hota hai)
  //   2. `wideo11_session` httpOnly cookie (security gate - jahan token React
  //      state me nahi hota, cookie me hai aur browser JS use nahi padh sakta)
  //
  // ---- CRITICAL FIX: empty "Bearer " header ko IGNORE karo ----
  // Pehle simple `headerAuth ?? cookie` likha tha. Problem: security-setup
  // page `accessToken=""` pass karta hai, jisse gate bhejta tha
  // `Authorization: "Bearer "` - ek MALFORMED header.
  //
  // Wo string JS me TRUTHY hai, isliye ye cookie ko override kar deta tha
  // aur auth-service ko `Authorization: Bearer ` (koi token nahi) milta ->
  // 401 -> "Could not start biometric registration".
  //
  // Yaani: valid cookie hone ke bawajood bhi biometric registration fail
  // ho rahi thi. Ab hum header me sirf SAHI token accept karte hain, aur
  // khaali/garbage hua to cookie par fall back karte hain.
  const rawHeader = request.headers.get('authorization');
  const headerToken = extractBearerToken(rawHeader);
  const cookieToken = readSessionCookie(request);
  const authorization = headerToken
    ? `Bearer ${headerToken}`
    : cookieToken
    ? `Bearer ${cookieToken}`
    : null;

  try {
    const authResponse = await fetch(`${AUTH_SERVICE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Challenge header zaroori hai - server usse session dhoondhta hai
        ...(request.headers.get('x-challenge')
          ? { 'X-Challenge': request.headers.get('x-challenge')! }
          : {}),
        // Authenticated flows ke liye bearer token forward karo
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: method === 'GET' ? undefined : body,
      cache: 'no-store',
    });

    const payload = await authResponse.json().catch(() => ({}));
    return NextResponse.json(payload, { status: authResponse.status });
  } catch {
    return NextResponse.json(
      { error: 'Authentication service unavailable' },
      { status: 503 }
    );
  }
}

/** Session cookie name (login route sets it, middleware verifies it) */
const SESSION_COOKIE = 'wideo11_session';

/**
 * Extract a real token from an `Authorization` header.
 *
 * Returns `null` when the header is absent, malformed, or carries an EMPTY
 * token. The empty-token case is the important one: a caller that does
 * `` `Bearer ${emptyToken}` `` produces the string `"Bearer "`, which is
 * truthy in JavaScript and would otherwise be forwarded as a valid-looking
 * (but useless) credential, shadowing the cookie fallback.
 *
 * We therefore require an actual non-empty token after the "Bearer " prefix.
 */
function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Read the httpOnly session cookie from an incoming Request.
 *
 * In a Next.js Route Handler, `request.cookies` is available on NextRequest.
 * This helper is typed loosely (`Request`) so it works with the plain
 * `Request` type that `forwardToAuth` accepts, and fails SAFE (returns null)
 * when cookies are unavailable - it never throws.
 */
function readSessionCookie(request: Request): string | null {
  const anyReq = request as Request & {
    cookies?: { get?: (name: string) => { value?: string } | undefined };
  };
  const getter = anyReq.cookies?.get;
  if (typeof getter !== 'function') return null;
  try {
    const cookie = getter.call(anyReq.cookies, SESSION_COOKIE);
    return cookie?.value ?? null;
  } catch {
    return null;
  }
}

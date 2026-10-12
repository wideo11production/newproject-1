// ============================================================================
// Authenticated API proxy helper (creator dashboard + account features)
// ============================================================================
//
// Session token `wideo11_session` cookie me **httpOnly** hai - browser JS use
// padh nahi sakta. Isliye client-side components seedha auth-service ko
// nahi bula sakte; unhe SAME-ORIGIN proxy chahiye jo token SERVER-SIDE
// attach kare.
//
// Do fayde:
//   1. Token kabhi browser JS tak nahi jaata (XSS se churi nahi ho sakta)
//   2. CORS issue zero - browser same-origin hit karta hai
//
// Ye `security-proxy.ts` ke pattern par hai, lekin GENERIC hai (koi bhi
// auth-service path forward kar sakta hai).
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

const SESSION_COOKIE = 'wideo11_session';

/** httpOnly session cookie se token padho (missing -> null, kabhi throw nahi) */
function readSessionToken(req: NextRequest): string | null {
  try {
    return req.cookies?.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Forward an authenticated request to auth-service.
 *
 * @param req     - incoming request
 * @param apiPath - path AFTER `/api/v1/auth`, e.g. `/channels`
 * @param method  - HTTP method
 */
export async function forwardAuth(
  req: NextRequest,
  apiPath: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
) {
  const token = readSessionToken(req);

  // ---- No session -> 401, fail closed ----
  // Explicit check rakhte hain taaki request auth-service tak jaaye hi nahi
  // jab session hi nahi hai.
  if (!token) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'No active session. Please log in.' },
      { status: 401 }
    );
  }

  // ---- Body sirf wahi methods ke liye jo body lete hain ----
  let bodyText: string | undefined;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const raw = await req.text();
    if (raw && raw.length > 0) bodyText = raw;
  }

  try {
    const upstream = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth${apiPath}`, {
      method,
      headers: {
        // Token yahan, server-side, attach hota hai
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

/**
 * Forward an authenticated request and return the RAW upstream response.
 *
 * A second helper rather than an option on `forwardAuth`, because the two have
 * incompatible return types: `forwardAuth` parses JSON so callers can read
 * `payload.message`, and a video segment is not JSON. Making one function do
 * both would mean a caller discovering at runtime whether it got a parsed object
 * or a stream - which is exactly the kind of branch that gets written wrong.
 *
 * Use this for anything that streams bytes. The session handling is identical,
 * so the 401-on-no-session rule is the same.
 *
 * @param extraHeaders - headers to merge (Range, for a partial request)
 */
export async function forwardAuthRaw(
  req: NextRequest,
  apiPath: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  extraHeaders?: HeadersInit
): Promise<Response> {
  const token = readSessionToken(req);
  if (!token) {
    return Response.json(
      { error: 'unauthorized', message: 'No active session. Please log in.' },
      { status: 401 }
    );
  }

  try {
    const upstream = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth${apiPath}`, {
      method,
      // The caller's headers come LAST so Range wins over anything set here.
      headers: {
        Authorization: `Bearer ${token}`,
        ...(extraHeaders ?? {}),
      },
      cache: 'no-store',
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch {
    return Response.json(
      {
        error: 'service_unavailable',
        message:
          'Could not reach the authentication service. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}

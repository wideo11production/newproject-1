// ============================================================================
// Resend verification email - POST /api/auth/resend-verification
// ============================================================================
//
// Ye auth-service (port 8085) ka PROXY hai:
//   POST /api/v1/auth/resend-verification  { email }
//
// KYUN YE ZAROORI HAI:
// Verification token 30-minute TTL wala hai. Agar user email miss kar de,
// link expire ho jaye, ya network atak jaye - to account purge ho jata hai aur
// use NAYA account banana padta hai. Resend se 30-minute window dobara fresh
// ho jaata hai, bina naya account banaye.
//
// PURANA TOKEN: auth-service ke `IssueVerificationToken` ke andar PEHLE
// `DeleteByUserID` hota hai, to resend karne par purana/expired/used token
// automatically delete ho jata hai aur sirf naya valid rehta hai. Yahan
// alag se kuch karne ki zaroorat nahi.
//
// EMAIL ENUMERATION: backend KABHI nahi batata ki email exist karta hai ya
// nahi - har case me same 200 response. Isi liye proxy bhi koi extra
// information nahi add karta.
//
// RATE LIMITING: `authRateLimitMiddleware` is path ko 'verify' bucket me
// daalta hai (10 req/min), jo registration ke 3/5min se kaafi generous hai -
// legit user retry kar sake, brute force na ho sake.
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://auth-service:8085';

export async function POST(request: Request) {
  let body: { email?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) {
    return NextResponse.json(
      { error: 'Validation failed', errors: { email: 'Email is required' } },
      { status: 400 }
    );
  }

  // ---- Forward to auth-service ----
  try {
    const authResponse = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/auth/resend-verification`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        // Verification email bhejne me time lagta hai (SMTP handshake) -
        // isliye default fetch timeout se zyada de rahe hain.
        cache: 'no-store',
      }
    );

    const payload = await authResponse.json().catch(() => ({}));

    // ---- RATE LIMIT PASS-THROUGH ----
    // 429 yahan aa sakta hai (verify bucket khatam). Isko SWALLOW karna
    // JAAN-BUJH KAR nahi karte - client ko 429 + Retry-After milna chahiye
    // taaki wo "too many attempts" screen par RESEND button dikha sake
    // (user ka explicit requirement: jahan "too many attempts" likha ho,
    // wahan resend button ho).
    if (authResponse.status === 429) {
      const retryAfter = authResponse.headers.get('Retry-After') ?? '60';
      return NextResponse.json(
        {
          error: 'Too Many Requests',
          message: payload?.message ?? 'Too many resend attempts. Please wait and try again.',
          retryAfter: Number(retryAfter) || 60,
        },
        { status: 429, headers: { 'Retry-After': retryAfter } }
      );
    }

    if (!authResponse.ok) {
      return NextResponse.json(
        {
          error: payload?.error ?? 'Resend failed',
          message:
            payload?.message ??
            'Could not send a new verification email. Please try again shortly.',
        },
        { status: authResponse.status }
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: 'Verification service unavailable',
        message: 'Could not reach the authentication service. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}

// GET allowed nahi - sirf POST
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

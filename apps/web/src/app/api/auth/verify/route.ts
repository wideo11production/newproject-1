// Email verification proxy - GET /api/auth/verify?token=<token>
//
// KYUN YE FILE ZAROORI THI (aur pehle se gayab thi):
// Verification email ka link `http://localhost:3000/auth/verify?token=...`
// banta hai (auth-service `BuildVerificationURL`). Wo page browser me khulta
// hai aur usko backend ke `GET /api/v1/auth/verify` endpoint tak pahuchana
// padta hai - lekin ye proxy route KABHI exist hi nahi kiya gaya tha.
//
// Result: user ko email link milti thi, wo link kholta, aur 404 aata.
// Matlab KISI user ka email verify hi nahi ho sakta tha. Isi wajah se
// verification gate lagane ke baad har user login nahi kar paata, aur
// 30-minute purge worker unhe permanently delete kar deta tha.
//
// Ye route GET query string se `token` forward karta hai aur backend ka
// status pass-through karta hai:
//   200 -> { verified: true,  email, message }
//   400 -> { verified: false, error }
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';

// Auth service ka internal address (compose network me service name se reachable)
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://auth-service:8085';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');

  // Token nahi hai to backend jaane ka matlab hi nahi - seedha 400.
  // (Backend bhi ye check karta hai, par early return se clear message milta hai)
  if (!token) {
    return NextResponse.json(
      { verified: false, error: 'Missing verification token.' },
      { status: 400 }
    );
  }

  try {
    const authResponse = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        // Verification token single-use aur short-lived hai, isliye kabhi cache
        // nahi karna - warna doosra user cached "verified" response dekh sake
        cache: 'no-store',
      }
    );

    const payload = await authResponse.json().catch(() => ({}));

    // Backend ka status pass-through (200 verified / 400 invalid-expired)
    return NextResponse.json(payload, { status: authResponse.status });
  } catch {
    // Auth service reachable nahi
    return NextResponse.json(
      {
        verified: false,
        error: 'Authentication service unavailable. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}

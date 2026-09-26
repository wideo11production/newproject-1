// Login API endpoint - POST /api/auth/login
//
// Ye auth-service (port 8085) ka PROXY hai. Register route jaisa hi kaam karta hai:
//   1. Server side validation (client validation bypass ho sakti hai)
//   2. Real backend tak forward karna - jahan bcrypt password verify hota hai
//      aur JWT session issue hota hai
//
// NOTE: Pehle ye route ek stub tha jo hamesha 503 "provider not configured"
// return karta tha. Ab auth-service live hone se ye REAL login proxy ban gaya hai -
// frontend UI ke saath properly wired hai.
//
// SECURITY: Ye path middleware ke rate limiter ke under aata hai
// (1 request per IP per minute) - credential stuffing protection ke liye.
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://auth-service:8085';

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  // Body parse - malformed JSON par 400
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fields normalize karo
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // ---- Server side validation ----
  // Ye client validation se ALAG hai - koi seedha API call karke bypass kar sakta hai
  const errors: Record<string, string> = {};

  if (!email) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address';
  }

  if (!password) {
    errors.password = 'Password is required';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  // ---- Forward to auth-service ----
  try {
    const authResponse = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        // Fingerprint nahi bhejte - auth-service use tabhi store karta hai
        // jab non-empty ho (unique index protection)
        device: {},
      }),
      cache: 'no-store',
    });

    const payload = await authResponse.json().catch(() => ({}));

    // Backend ka status pass-through (200 success, 401 wrong password, etc.)
    return NextResponse.json(payload, { status: authResponse.status });
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

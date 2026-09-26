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

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  // Body parse - malformed JSON par 400
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fields normalize karo
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const enableBiometric = body.enableBiometric === true;

  // ---- Server side validation ----
  // Ye client validation se ALAG hai, kyunki koi bhi seedha API call karke
  // client validation bypass kar sakta hai. Server par hi final authority hai.
  const errors: Record<string, string> = {};

  if (!fullName) {
    errors.fullName = 'Full name is required';
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
        full_name: fullName,
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

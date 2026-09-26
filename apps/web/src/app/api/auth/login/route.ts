// Login API endpoint - POST /api/auth/login
// Ye path bhi middleware ke rate limiter ke under aata hai (1 request per IP per minute),
// isliye credential stuffing jaise patterns yahan block hote hain.
// Server side validation + password kabhi log ya return nahi hota.
// Hinglish comments: har block ka arth samjhne ke liye.

import { NextResponse } from 'next/server';

// Sirf POST allowed hai
export async function POST(request: Request) {
  let body: Record<string, unknown>;

  // Body parse karna - malformed JSON par 400
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // Server side validation
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

  // Identity provider check
  // Is repo me abhi koi credential store / session issuer wired nahi hai.
  // Isliye fake success nahi bhejte - clear signal dete hain ki provider connect karna baaki hai.
  // Hinglish: provider na hone par honest 503, koi chhupi hui failure nahi
  return NextResponse.json(
    {
      error: 'Authentication provider not configured',
      message:
        'Credentials validated, but no credential store or session issuer is connected yet.',
    },
    { status: 503 }
  );
}

// GET requests allowed nahi
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

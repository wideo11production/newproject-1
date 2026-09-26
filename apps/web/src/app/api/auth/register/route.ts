// Registration API endpoint - POST /api/auth/register
// Ye path middleware ke rate limiter ke under aata hai (1 request per IP per minute),
// isliye yahan tak pahunchne ka matlab hai ki request ne defense barrier cross kiya hai.
// Server side validation bhi yahan dobara hoti hai - client validation akeli kaafi nahi,
// kyunki koi bhi direct API call bypass kar sakta hai.
// Hinglish comments: har block ka arth samjhne ke liye.

import { NextResponse } from 'next/server';

// Ye route sirf POST requests accept karti hai
export async function POST(request: Request) {
  let body: Record<string, unknown>;

  // Body parse karna - malformed JSON par 400 return karte hain
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fields ko string me normalize karte hain
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // Server side validation - errors collect karke ek saath return karte hain
  const errors: Record<string, string> = {};

  if (!fullName) {
    errors.fullName = 'Full name is required';
  }

  if (!email) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Email shape validation - duplicate accounts aur bots dono rokne me madad karta hai
    errors.email = 'Enter a valid email address';
  }

  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < 8) {
    // Minimum 8 characters - weak password block karne ke liye
    errors.password = 'Password must be at least 8 characters';
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  // Identity provider check
  // Is repo me abhi koi identity provider wired nahi hai (koi user store / session issuer nahi).
  // Isliye hum jhootha success nahi bhejte - user ko clearly bata dete hain ki
  // account banane ke liye provider connect karna baaki hai.
  // Hinglish: jab tak provider nahi hai, honest 503 return karte hain
  return NextResponse.json(
    {
      error: 'Authentication provider not configured',
      message:
        'Request validated successfully, but no identity provider is connected yet. Wire an identity provider before enabling live signups.',
    },
    { status: 503 }
  );
}

// GET requests par method allowed nahi hai
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

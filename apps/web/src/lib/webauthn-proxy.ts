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
        ...(request.headers.get('authorization')
          ? { Authorization: request.headers.get('authorization')! }
          : {}),
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

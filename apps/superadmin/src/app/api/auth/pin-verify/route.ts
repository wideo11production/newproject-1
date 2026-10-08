// Verify a 6-digit security PIN to clear a lockout.
//
// WHY THIS ROUTE EXISTS
//
// auth-service enforces a lockout after 3 failed password attempts. When the
// operator hits that state they get a 423 with `pin_required: true` and a
// countdown. The login page needs a same-origin endpoint to verify the PIN,
// because the browser cannot POST directly to auth-service:8085 (CORS).
//
// This route is a thin relay — it forwards the email + PIN to auth-service and
// returns the result. It does NOT issue a session: clearing the lockout is
// separate from authenticating, and the operator still has to enter the
// password to get a cookie.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!email || !pin) {
    return NextResponse.json({ error: 'Email and PIN are required' }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${AUTH_SERVICE}/api/v1/security/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pin }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'auth_unavailable', message: 'Cannot reach the authentication service.' },
      { status: 503 }
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // auth-service returns 401 for a wrong PIN, 423 for an account that is
  // already blocked. Both mean "try again" to the operator, so surface them
  // as such rather than leaking the distinction.
  if (!res.ok) {
    return NextResponse.json(
      {
        verified: false,
        error: (payload.error as string) ?? 'invalid_pin',
        message: (payload.message as string) ?? 'Invalid PIN. Try again.',
      },
      { status: 401 }
    );
  }

  return NextResponse.json(
    {
      verified: true,
      message: (payload.message as string) ?? 'PIN verified. Please proceed with login.',
    },
    { status: 200 }
  );
}
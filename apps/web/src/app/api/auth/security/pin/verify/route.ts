// POST /api/auth/security/pin/verify - PIN verification proxy
//
// Same-origin proxy (CORS-free) - browser seedha auth-service (port 8085)
// cross-origin call karta to CORS block hota tha.
// Hinglish: same-origin proxy - CORS issue nahi hoga
import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

export async function POST(request: Request) {
  try {
    const body = await request.text();

    const res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/security/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Service Unavailable',
        message: 'Cannot reach authentication service',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 }
    );
  }
}

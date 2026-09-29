// /api/auth/settings-meta  -  allowed themes / accents / languages
//
// Public hai taki login page bhi options render kar sake (user logged out
// ho tab bhi). SSOT backend se aata hai - frontend hardcode nahi karta,
// warna dono side drift kar sakte hain (UI me dikhe, backend reject kare).
import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ??
  process.env.AUTH_SERVICE_URL ??
  'http://localhost:8085';

export async function GET() {
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/settings/meta`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: 'service_unavailable' },
      { status: 503 }
    );
  }
}
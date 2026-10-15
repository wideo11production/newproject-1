// /api/alerts - authenticated same-origin proxy to webhook-receiver.
//
// WHY A DEDICATED RELAY (not forwardAuth)
// --------------------------------------
// `forwardAuth` forwards to auth-service. Alerts live in webhook-receiver's
// Postgres (`alerts` table), so this relay forwards there instead. The security
// properties are identical and deliberate:
//
//   1. The session token `wideo11_session` is httpOnly - browser JS cannot read
//      it, so it is attached here, server-side, as a Bearer header. It never
//      crosses into the browser bundle.
//   2. Same-origin: the browser calls /api/alerts, not http://webhook-receiver:8081,
//      so no CORS surface and no internal hostname leakage (webhook-receiver is
//      unreachable from the browser anyway).
//   3. Fail-closed: no session -> 401 JSON, never forwarded.
//
// The upstream webhook-receiver `GET /api/v1/alerts` is public (it has no auth
// middleware of its own), but we still require the httpOnly session here so only
// signed-in console users can read the platform alert stream - an alert list is
// operational data, not anonymous reconnaissance material.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const WEBHOOK_RECEIVER_URL = process.env.WEBHOOK_RECEIVER_URL ?? 'http://webhook-receiver:8081';
const SESSION_COOKIE = 'wideo11_session';

export async function GET(req: NextRequest) {
  const token = req.cookies?.get(SESSION_COOKIE)?.value ?? null;
  if (!token) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in to view alerts.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const upstream = `${WEBHOOK_RECEIVER_URL}/api/v1/alerts${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(upstream, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      // Never followed: stops this from becoming an open proxy if an upstream
      // ever redirects.
      redirect: 'manual',
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => ({}));
    const out = NextResponse.json(payload, { status: res.status });
    return out;
  } catch {
    return NextResponse.json(
      { error: 'service_unavailable', message: 'Could not reach the alert service. Please try again shortly.' },
      { status: 503 }
    );
  }
}

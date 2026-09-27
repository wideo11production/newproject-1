// Superadmin API - awareness/security data for the master dashboard
//
// Ye sirf SUPERADMIN ko data deta hai. Abhi simple bearer token check hai;
// proper role-gating BLOCKER Q4.3 ke jawab tak pending hai.
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');

    // Auth token nahi hai to SAHI error batao (na ki "0 events").
    // Pehle ye fallback empty list return karta tha, jisse UI galat message
    // dikhata tha ("no security events") jabki asal reason login hona tha.
    if (!authHeader) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Superadmin access token required',
        },
        { status: 401 }
      );
    }

    // Security events (lockouts, failed logins, device breaches)
    const eventsRes = await fetch(
      `${AUTH_SERVICE_URL}/api/v1/auth/security/events`,
      {
        headers: { Authorization: authHeader },
        cache: 'no-store',
      }
    );

    if (!eventsRes.ok) {
      return NextResponse.json(
        {
          error: eventsRes.status === 403 ? 'Forbidden' : 'Unauthorized',
          message:
            eventsRes.status === 403
              ? 'Superadmin role required'
              : 'Invalid or expired session',
        },
        { status: eventsRes.status }
      );
    }

    const eventsPayload = await eventsRes.json();

    return NextResponse.json(
      {
        security_events: eventsPayload.events ?? [],
        total: eventsPayload.total ?? 0,
        fetched_at: new Date().toISOString(),
      },
      { status: 200 }
    );
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

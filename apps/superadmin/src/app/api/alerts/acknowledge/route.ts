// Acknowledge a critical security alert.
//
// Superadmin-only relay to auth-service.
//
// -----------------------------------------------------------------------------
// WHY THE SUPERADMIN DASHBOARD CANNOT CALL auth-service DIRECTLY
// -----------------------------------------------------------------------------
//
// Because the session credential is an httpOnly cookie and JavaScript cannot attach
// it by hand — that is the property `httpOnly` exists for. A direct
// cross-origin POST from the browser would need
// `Access-Control-Allow-Credentials` plus an explicit allow-origin per app origin,
// which is a much wider CORS surface than a same-origin relay needs.
//
// The relay reads the cookie on the server and turns it into the bearer header
// auth-service expects. The browser never handles the auth-service address.
//
// -----------------------------------------------------------------------------
// THE OPERATOR IDENTITY IS NOT TRUSTED FROM THE BODY
// -----------------------------------------------------------------------------
//
// Only `event_id` and `note` come from the request. Who acknowledged is taken from
// the verified token by auth-service.
//
// A field named `acknowledged_by` arriving in a body would make the entire
// attribution feature forgeable — the whole point of it is a trustworthy record of
// who reviewed what, and a body field would let anyone write anyone else's name on
// it.
//
// The client does echo back who it thinks acknowledged, as a guard against a
// session swap mid-request. auth-service ignores it, and the response's
// `acknowledged_by` is what the UI shows. Echo-and-verify is the right shape for a
// critical mutation; echo-and-trust is not.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = cookies().get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { error: 'sign_in_required', message: 'Sign in to acknowledge alerts.' },
      { status: 401 }
    );
  }

  let body: { event_id?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
  if (!eventId) {
    // Server-side validation, not just a trust-the-client assumption. The client
    // already checks this; duplicating it here is cheap and means a hand-written
    // `curl` gets a clear message rather than a UUID parse error from Go.
    return NextResponse.json(
      { error: 'invalid_request', message: 'event_id is required.' },
      { status: 400 }
    );
  }

  const note = typeof body.note === 'string' ? body.note : '';

  try {
    const res = await fetch(
      `${AUTH_INTERNAL}/api/v1/auth/admin/security/alerts/${encodeURIComponent(eventId)}/acknowledge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session}`,
        },
        // Only the two fields the body owns. No identity — see the note above.
        body: JSON.stringify({ note }),
        cache: 'no-store',
      }
    );

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // ---- 409 IS A SUCCESS FROM THE OPERATOR'S POINT OF VIEW ----
    //
    // Somebody got there first, so the outcome they wanted — "this is recorded as
    // seen" — is already true. Passing it through as a 409 and letting the UI treat
    // it as "already acknowledged" is correct and keeps the server's answer intact,
    // rather than rewriting a 409 into a 200 and losing the distinction.
    return NextResponse.json(payload, { status: res.status });
  } catch {
    // Upstream unreachable. Not 401: an unreachable auth-service is an
    // infrastructure problem, and answering 401 would make the client tear down a
    // perfectly valid session.
    return NextResponse.json(
      {
        error: 'upstream_unavailable',
        message: 'Cannot reach the authentication service.',
      },
      { status: 503 }
    );
  }
}

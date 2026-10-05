// Shared proxy helper for superadmin app
//
// Same-origin relay: browser sirf :3008 se baat karta hai, server internally
// auth-service (8085) tak jaata hai. Isse CORS issue nahi hota.
//
// SECURITY: the caller's credential is relayed, and the backend does its own role
// check (only superadmin/recovery passes) - this is only a relay.
//
// ---- WHY THE CREDENTIAL COMES FROM `bearerFromRequest` ----
//
// This used to be `request.headers.get('authorization')`. That was correct while
// the operator pasted a JWT into a box, and wrong the moment login became
// cookie-based: the browser sends an httpOnly cookie and CANNOT attach a header by
// hand, because that is what `httpOnly` is for.
//
// The failure was quiet and self-contradictory. The operator signed in fine,
// `/api/session` answered `authenticated: true`, and then every relay here 401'd -
// so the dashboard told a still-signed-in operator "Your session ended. Sign in
// again." Two endpoints of the same app disagreeing about the same cookie is the
// tell that the session was never the problem; which function read it was.
import { NextResponse } from 'next/server';
import { bearerFromRequest } from './telemetry-proxy';

const AUTH_SERVICE_URL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

/**
 * forward - auth-service ke admin path tak request relay karta hai
 *
 * @param path  auth-service ka path (e.g. "/admin/clicks/stats")
 * @param request original request (headers + query string ke liye)
 * @param method GET ya POST
 */
export async function forward(
  path: string,
  request: Request,
  method: 'GET' | 'POST' = 'GET'
) {
  // Header first, cookie second - see `bearerFromRequest`. A scripted caller has no
  // cookie; a browser cannot produce a header. Both have to work.
  const authHeader = bearerFromRequest(request);

  // Credential nahi hai to 401 (UI ko clearly batao ki login chahiye)
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'No active session. Sign in to continue.' },
      { status: 401 }
    );
  }

  try {
    let url = `${AUTH_SERVICE_URL}/api/v1/auth${path}`;

    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      cache: 'no-store',
    };

    // GET me query params forward karo (filters/pagination)
    if (method === 'GET') {
      const qs = new URL(request.url).search;
      if (qs) url += qs;
    } else {
      init.body = await request.text();
    }

    const res = await fetch(url, init);
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

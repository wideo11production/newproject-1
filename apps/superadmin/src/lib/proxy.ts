// Shared proxy helper for superadmin app
//
// Same-origin relay: browser sirf :3008 se baat karta hai, server internally
// auth-service (8085) tak jaata hai. Isse CORS issue nahi hota.
//
// SECURITY: Authorization header forward hota hai. Backend khud role check
// karta hai (superadmin/recovery hi pass hota hai) - ye sirf relay hai.
//
// Hinglish: browser se server tak ka safe rasta
import { NextResponse } from 'next/server';

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
  const authHeader = request.headers.get('authorization');

  // Token nahi hai to 401 (UI ko clearly batao ki login chahiye)
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Superadmin access token required' },
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

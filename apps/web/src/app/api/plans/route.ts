// SELF-SERVICE PLAN SELECTION  -  `/api/plans` and `/api/plan`.
//
// Same-origin relay to auth-service's `/me/plans` and `/me/plan`.
//
// -----------------------------------------------------------------------------
// WHY THESE EXIST AND THE OLD ONES DID NOT
// -----------------------------------------------------------------------------
//
// The plan catalogue used to surface only through `/admin/entitlements`, which is
// superadmin-gated. That was correct while a plan gated PERMISSION: a user who
// could pick their own plan could simply give themselves a better one.
//
// The product decision changed. Uploading is now free and unlimited for every
// account, and what a paid plan buys is the right to EARN. So the interesting
// question moved from "may I have this permission" to "do I want to be paid" - and
// the second is not something an operator should have to broker.
//
// -----------------------------------------------------------------------------
// WHAT THIS RELAY DOES NOT DECIDE
// -----------------------------------------------------------------------------
//
// It forwards, attaches the session cookie as a bearer header, and stops. It does
// not validate the plan code, does not check the cycle, and does not apply prices.
//
// All three of those live in the service, and the reason is in the refusal shape:
// `POST /me/plan` refuses lifetime plans by CYCLE, not by a hardcoded list of
// codes. A second list here would be exactly the drift this repository has been
// bitten by before - a UI believing a plan is selectable that the service refuses,
// or the reverse, with nothing saying which.
//
// -----------------------------------------------------------------------------
// WHY THE TOKEN IS NOT IN THE BODY
// -----------------------------------------------------------------------------
//
// Same rule as every other BFF route: the browser holds an httpOnly cookie it
// cannot read, this relay reads it server-side and turns it into the bearer
// header. The request carries only the plan code, which is a public catalogue
// identifier and not a credential.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const SESSION_COOKIE = 'wideo11_session';

/** `no-store` on the response, for the same reason my-plan uses it: a cached
 *  catalogue is one that still sells a price that has since changed, and a cached
 *  subscription confirmation is one that claims a grant nobody recorded. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

// ---------------------------------------------------------------------------
// GET /api/plans  -  the catalogue a user may choose from
// ---------------------------------------------------------------------------
//
// Authenticated, matching the upstream `/me/plans`. A public pricing page is a
// legitimate product, but it would not be a `/me` route, and pretending this is
// one would leave a reader believing anonymous callers get here.

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in to see plans.' },
      { status: 401, headers: NO_STORE }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_INTERNAL}/api/v1/auth/me/plans`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unavailable', message: 'Could not reach the plans service.' },
      { status: 502, headers: NO_STORE }
    );
  }

  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status, headers: NO_STORE });
}

// ---------------------------------------------------------------------------
// POST /api/plan  -  subscribe to a monthly plan
// ---------------------------------------------------------------------------
//
// The request body carries the plan code and nothing else. No identity field,
// because the buyer is resolved from the token upstream - adding one here would
// be a field a future edit could start trusting.

export async function POST(req: Request) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in to subscribe.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // The code is read as an opaque string rather than validated against a list.
  //
  // A list here would be a SECOND catalogue - the exact two-sources-of-truth
  // problem the catalogue endpoint comment in entitlement_admin.go describes. An
  // unknown or unselectable code is answered upstream, with the list of what IS
  // available, which is a better error than one assembled from a local copy that
  // has drifted.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send a JSON body with plan_code.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const planCode =
    raw && typeof raw === 'object' && 'plan_code' in raw
      ? String((raw as Record<string, unknown>).plan_code ?? '').trim()
      : '';

  if (!planCode) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'plan_code is required.' },
      { status: 400, headers: NO_STORE }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_INTERNAL}/api/v1/auth/me/plan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan_code: planCode }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unavailable', message: 'Could not reach the plans service.' },
      { status: 502, headers: NO_STORE }
    );
  }

  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status, headers: NO_STORE });
}
